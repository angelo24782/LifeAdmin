/**
 * Caratterizzazione degli EVENTI di @supabase/auth-js 2.117.3 con GoTrue locale reale
 * (T1, T3, T4, T9 del piano di M3 sul contratto dello store di autenticazione).
 *
 * Documenta il comportamento OSSERVATO: quali eventi `onAuthStateChange` emette, in che ordine,
 * rispetto alla risoluzione delle promesse e alla sessione dello storage. NON è un contratto di
 * auth-js né del nostro store: se un aggiornamento della libreria o della CLI cambia questi valori,
 * la classificazione degli eventi va rivista. Non mostra mai i token.
 *
 * Perimetro: tutte le richieste devono andare a loopback (`127.0.0.1`, `localhost`); il test fallisce
 * se una richiesta esce dal perimetro. Utenti creati a runtime e rimossi a fine test; nessuna
 * credenziale nel repository. Gli scenari con risposte simulate sono in
 * `tests/characterization/auth-js-runtime-storage.test.ts`.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createFakePlatform, type FakePlatform } from '@/platform/fake'
import {
  AUTH_STORAGE_KEY,
  createSupabaseClient,
  type AppSupabaseClient,
} from '@/shared/lib/supabaseClient'

import { SUBJECT_CONFIRMATION, waitForMail } from './mail'
import { anonKey, createAdminClient, PRIVACY_VERSION, supabaseUrl } from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 })

interface Observation {
  readonly scenario: string
  readonly origin: 'locale-reale'
  readonly request: string
  readonly error: {
    readonly class: string
    readonly code: string | null
    readonly status: number | null
  } | null
  readonly detail: Readonly<Record<string, string | number | boolean | null>>
  readonly events: readonly string[]
  readonly keyBefore: boolean
  readonly keyAfter: boolean
  readonly refreshTokenChanged: boolean | null
  readonly requests: number
}

interface StoredSession {
  access_token: string
  refresh_token: string
  expires_at: number
  [field: string]: unknown
}

interface Account {
  readonly id: string
  readonly email: string
  readonly password: string
  readonly client: AppSupabaseClient
  readonly platform: FakePlatform
  readonly events: string[]
}

interface ActionResult {
  readonly error: unknown
  readonly detail: Observation['detail']
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const admin = createAdminClient()
const createdIds = new Set<string>()
const requestLog: string[] = []
const outOfPerimeter: string[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Richieste di refresh trattenute (T9): la richiesta parte verso il server solo dopo `release()`. */
let heldRefresh: { readonly promise: Promise<void>; release(): void } | null = null

function holdRefresh(): { release(): void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  heldRefresh = { promise, release }
  return {
    release: () => {
      release()
      heldRefresh = null
    },
  }
}

beforeAll(() => {
  const host = new URL(supabaseUrl()).hostname
  if (!LOOPBACK.has(host)) {
    throw new Error(`SUPABASE_URL non è un indirizzo di loopback (${host}): test interrotti.`)
  }
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (!LOOPBACK.has(url.hostname)) {
      outOfPerimeter.push(url.hostname)
      throw new Error(`Richiesta fuori dal perimetro locale: ${url.hostname}`)
    }
    const method = (init?.method ?? 'GET').toUpperCase()
    requestLog.push(`${method} ${url.pathname}${url.search}`)
    if (heldRefresh && method === 'POST' && url.search.includes('grant_type=refresh_token')) {
      await heldRefresh.promise
    }
    return realFetch(input, init)
  })
})

const accounts: Account[] = []
const extraClients: AppSupabaseClient[] = []

afterAll(async () => {
  try {
    for (const account of accounts.splice(0)) await account.client.auth.stopAutoRefresh()
    for (const client of extraClients.splice(0)) await client.auth.stopAutoRefresh()
  } finally {
    for (const id of createdIds) await admin.auth.admin.deleteUser(id)
    vi.unstubAllGlobals()
  }
  expect(outOfPerimeter).toEqual([])
})

function newClient(platform: FakePlatform): AppSupabaseClient {
  return createSupabaseClient({
    url: supabaseUrl(),
    anonKey: anonKey(),
    storage: platform.secureStorage,
    platform: 'web',
    appVersion: 'characterization',
  })
}

/** Sottoscrive subito gli eventi: `expectedId` serve a indicare se la sessione è dell'utente atteso. */
function subscribe(client: AppSupabaseClient, events: string[], expectedId: () => string): void {
  client.auth.onAuthStateChange((event, session) => {
    events.push(
      `${event}:${
        session
          ? session.user.id === expectedId()
            ? 'sessione-utente-atteso'
            : 'sessione-altro'
          : 'null'
      }`,
    )
  })
}

async function signedIn(label: string): Promise<Account> {
  const email = `m3-ev-${label}-${randomUUID()}@example.test`
  const password = `${randomUUID()}${randomUUID()}`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { privacy_version: PRIVACY_VERSION },
  })
  if (error || !data.user) throw error ?? new Error('createUser fallita')
  createdIds.add(data.user.id)
  const platform = createFakePlatform()
  const client = newClient(platform)
  const events: string[] = []
  subscribe(client, events, () => data.user.id)
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  await sleep(300)
  const account: Account = { id: data.user.id, email, password, client, platform, events }
  accounts.push(account)
  return account
}

function rawStored(platform: FakePlatform): string {
  const raw = platform.storageContents.get(AUTH_STORAGE_KEY)
  if (!raw) throw new Error('Nessuna sessione nello storage.')
  return raw
}

async function editStored(
  platform: FakePlatform,
  edit: (session: StoredSession) => StoredSession,
): Promise<void> {
  await platform.secureStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify(edit(JSON.parse(rawStored(platform)) as StoredSession)),
  )
}

const expireAccessToken = (session: StoredSession): StoredSession => ({
  ...session,
  expires_at: nowSeconds() - 60,
})

/** Dentro il margine di 90 s della libreria, ma non ancora scaduto. */
const nearExpiry = (session: StoredSession): StoredSession => ({
  ...session,
  expires_at: nowSeconds() + 30,
})

function refreshTokenOf(platform: FakePlatform): string | null {
  const raw = platform.storageContents.get(AUTH_STORAGE_KEY)
  if (!raw) return null
  const parsed = JSON.parse(raw) as { refresh_token?: unknown }
  return typeof parsed.refresh_token === 'string' ? parsed.refresh_token : null
}

function describeError(error: unknown): Observation['error'] {
  if (!error) return null
  const value = error as { name?: unknown; code?: unknown; status?: unknown }
  return {
    class: typeof value.name === 'string' ? value.name : 'sconosciuta',
    code: typeof value.code === 'string' ? value.code : null,
    status: typeof value.status === 'number' ? value.status : null,
  }
}

interface Target {
  readonly platform: FakePlatform
  readonly events: string[]
}

async function observe(
  scenario: string,
  request: string,
  target: Target,
  action: () => Promise<ActionResult>,
  settle: () => Promise<unknown> = () => sleep(400),
): Promise<Observation> {
  const eventsBefore = target.events.length
  const requestsBefore = requestLog.length
  const keyBefore = target.platform.storageContents.has(AUTH_STORAGE_KEY)
  const tokenBefore = refreshTokenOf(target.platform)
  const result = await action()
  await settle()
  const tokenAfter = refreshTokenOf(target.platform)
  return {
    scenario,
    origin: 'locale-reale',
    request,
    error: describeError(result.error),
    detail: result.detail,
    events: target.events.slice(eventsBefore),
    keyBefore,
    keyAfter: target.platform.storageContents.has(AUTH_STORAGE_KEY),
    refreshTokenChanged:
      tokenBefore === null || tokenAfter === null ? null : tokenBefore !== tokenAfter,
    requests: requestLog.length - requestsBefore,
  }
}

type Summary = Omit<Observation, 'scenario' | 'origin' | 'request'>
const summary = (o: Observation): Summary => ({
  error: o.error,
  detail: o.detail,
  events: o.events,
  keyBefore: o.keyBefore,
  keyAfter: o.keyAfter,
  refreshTokenChanged: o.refreshTokenChanged,
  requests: o.requests,
})

/** Valori osservati, fissati dopo la prima esecuzione (vedi la nota in testa al file). */
const EXPECTED: Record<string, Summary> = {
  'T1-signInWithPassword': {
    error: null,
    detail: { sessione: true },
    events: ['SIGNED_IN:sessione-utente-atteso', 'RISOLTA:signInWithPassword'],
    keyBefore: false,
    keyAfter: true,
    refreshTokenChanged: null,
    requests: 1,
  },
  'T1-verifyOtp-code': {
    error: null,
    detail: { sessione: true },
    events: ['SIGNED_IN:sessione-utente-atteso', 'RISOLTA:verifyOtp-code'],
    keyBefore: false,
    keyAfter: true,
    refreshTokenChanged: null,
    requests: 1,
  },
  'T1-verifyOtp-link': {
    error: null,
    detail: { sessione: true },
    events: ['SIGNED_IN:sessione-utente-atteso', 'RISOLTA:verifyOtp-link'],
    keyBefore: false,
    keyAfter: true,
    refreshTokenChanged: null,
    requests: 1,
  },
  'T3-refreshSession': {
    error: null,
    detail: { sessione: true },
    events: ['TOKEN_REFRESHED:sessione-utente-atteso', 'RISOLTA:refreshSession'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: true,
    requests: 1,
  },
  'T3-getSession-scaduto': {
    error: null,
    detail: { sessione: true },
    events: ['TOKEN_REFRESHED:sessione-utente-atteso', 'RISOLTA:getSession'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: true,
    requests: 1,
  },
  'T3-rinnovo-automatico': {
    error: null,
    detail: {},
    events: ['TOKEN_REFRESHED:sessione-utente-atteso'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: true,
    requests: 1,
  },
  'T4-avvio-scaduto': {
    error: null,
    detail: {},
    events: [
      'TOKEN_REFRESHED:sessione-utente-atteso',
      'RISOLTA:initialize',
      'INITIAL_SESSION:sessione-utente-atteso',
    ],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: true,
    requests: 1,
  },
  'T4-avvio-valido': {
    error: null,
    detail: {},
    events: [
      'SIGNED_IN:sessione-utente-atteso',
      'RISOLTA:initialize',
      'INITIAL_SESSION:sessione-utente-atteso',
    ],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 0,
  },
  'T9-signOut-con-refresh-in-volo': {
    error: null,
    detail: { getSessionConSessione: true, getSessionErrore: false },
    events: [
      'TOKEN_REFRESHED:sessione-utente-atteso',
      'RISOLTA:getSession',
      'SIGNED_OUT:null',
      'RISOLTA:signOut',
    ],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 2,
  },
}

function check(observation: Observation): void {
  const out = process.env.CHARACTERIZATION_REPORT
  if (out) appendFileSync(out, `${JSON.stringify(observation)}\n`)
  expect(summary(observation)).toEqual(EXPECTED[observation.scenario])
}

describe('T1: eventi dopo un flusso di accesso (GoTrue locale reale)', () => {
  it('T1: signInWithPassword', async () => {
    const email = `m3-ev-t1a-${randomUUID()}@example.test`
    const password = `${randomUUID()}${randomUUID()}`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { privacy_version: PRIVACY_VERSION },
    })
    if (error || !data.user) throw error ?? new Error('createUser fallita')
    createdIds.add(data.user.id)
    const platform = createFakePlatform()
    const client = newClient(platform)
    extraClients.push(client)
    const events: string[] = []
    subscribe(client, events, () => data.user.id)
    await sleep(300)

    check(
      await observe(
        'T1-signInWithPassword',
        'signInWithPassword',
        { platform, events },
        async () => {
          const result = await client.auth.signInWithPassword({ email, password })
          events.push('RISOLTA:signInWithPassword')
          return {
            error: result.error,
            detail: { sessione: result.data.session !== null },
          }
        },
      ),
    )
  })

  it.each([['code'], ['link']] as const)('T1: signUp e verifyOtp con %s', async (via) => {
    const email = `m3-ev-t1b-${via}-${randomUUID()}@example.test`
    const password = `${randomUUID()}${randomUUID()}`
    const platform = createFakePlatform()
    const client = newClient(platform)
    extraClients.push(client)
    const events: string[] = []
    let userId = ''
    subscribe(client, events, () => userId)
    const signUp = await client.auth.signUp({
      email,
      password,
      options: { data: { privacy_version: PRIVACY_VERSION } },
    })
    if (signUp.error || !signUp.data.user) throw signUp.error ?? new Error('signUp fallita')
    userId = signUp.data.user.id
    createdIds.add(userId)
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)
    await sleep(300)

    check(
      await observe(`T1-verifyOtp-${via}`, `verifyOtp (${via})`, { platform, events }, async () => {
        const result =
          via === 'code'
            ? await client.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })
            : await client.auth.verifyOtp({ token_hash: mail.tokenHash ?? '', type: 'signup' })
        events.push(`RISOLTA:verifyOtp-${via}`)
        return {
          error: result.error,
          detail: { sessione: result.data.session !== null },
        }
      }),
    )
  })
})

describe('T3: eventi del refresh (GoTrue locale reale)', () => {
  it('T3: refreshSession()', async () => {
    const account = await signedIn('t3a')

    check(
      await observe('T3-refreshSession', 'refreshSession()', account, async () => {
        const result = await account.client.auth.refreshSession()
        account.events.push('RISOLTA:refreshSession')
        return { error: result.error, detail: { sessione: result.data.session !== null } }
      }),
    )
  })

  it('T3: getSession() con access token scaduto', async () => {
    const account = await signedIn('t3b')
    await editStored(account.platform, expireAccessToken)

    check(
      await observe(
        'T3-getSession-scaduto',
        'getSession() con token scaduto',
        account,
        async () => {
          const result = await account.client.auth.getSession()
          account.events.push('RISOLTA:getSession')
          return { error: result.error, detail: { sessione: result.data.session !== null } }
        },
      ),
    )
  })

  it('T3: rinnovo automatico (tick simulato, rete reale)', async () => {
    // Si simula SOLO `setInterval`, creato dal client all'avvio: il tick di 30 s di auth-js scatta
    // senza attese, mentre richieste e server restano reali.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const account = await signedIn('t3c')
      await editStored(account.platform, nearExpiry)
      const before = refreshTokenOf(account.platform)

      check(
        await observe(
          'T3-rinnovo-automatico',
          'autoRefreshToken con token entro il margine',
          account,
          () => {
            vi.advanceTimersByTime(30_000)
            return Promise.resolve({ error: null, detail: {} })
          },
          async () => {
            const deadline = Date.now() + 15_000
            while (Date.now() < deadline && refreshTokenOf(account.platform) === before) {
              await sleep(100)
            }
            await sleep(400)
          },
        ),
      )
      await account.client.auth.stopAutoRefresh()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('T4: eventi all’avvio con access token scaduto e rete presente', () => {
  async function startFrom(
    source: Account,
    edit: ((session: StoredSession) => StoredSession) | null,
  ): Promise<{ platform: FakePlatform; events: string[]; client: AppSupabaseClient }> {
    await source.client.auth.stopAutoRefresh()
    const platform = createFakePlatform()
    await platform.secureStorage.setItem(AUTH_STORAGE_KEY, rawStored(source.platform))
    if (edit) await editStored(platform, edit)
    const client = newClient(platform)
    extraClients.push(client)
    const events: string[] = []
    subscribe(client, events, () => source.id)
    return { platform, events, client }
  }

  it.each([
    ['scaduto', expireAccessToken],
    ['valido', null],
  ] as const)('T4: avvio con sessione salvata, token %s', async (label, edit) => {
    const source = await signedIn(`t4-${label}`)
    const started = await startFrom(source, edit)

    check(
      await observe(
        `T4-avvio-${label}`,
        `avvio con sessione salvata (token ${label})`,
        started,
        async () => {
          const { error } = await started.client.auth.initialize()
          started.events.push('RISOLTA:initialize')
          return { error, detail: {} }
        },
      ),
    )
  })
})

describe('T9: eventi durante signOut con un refresh in volo (GoTrue locale reale)', () => {
  it('T9: signOut locale mentre un refresh è trattenuto', async () => {
    const account = await signedIn('t9')
    await editStored(account.platform, expireAccessToken)
    const gate = holdRefresh()

    check(
      await observe(
        'T9-signOut-con-refresh-in-volo',
        'signOut({scope:local}) con refresh trattenuto, poi rilascio',
        account,
        async () => {
          const pendingSession = account.client.auth.getSession().then((result) => {
            account.events.push('RISOLTA:getSession')
            return result
          })
          await sleep(200)
          const pendingSignOut = account.client.auth.signOut({ scope: 'local' }).then((result) => {
            account.events.push('RISOLTA:signOut')
            return result
          })
          await sleep(200)
          gate.release()
          const [session, signOut] = await Promise.all([pendingSession, pendingSignOut])
          return {
            error: signOut.error,
            detail: {
              getSessionConSessione: session.data.session !== null,
              getSessionErrore: session.error !== null,
            },
          }
        },
      ),
    )
  })
})
