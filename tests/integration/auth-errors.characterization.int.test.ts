/**
 * Caratterizzazione di @supabase/auth-js 2.117.3 con GoTrue e PostgREST LOCALI reali.
 *
 * Documenta il comportamento OSSERVATO della versione in uso di `getUser()`, del refresh e delle
 * letture PostgREST quando il server rifiuta una sessione: classe, codice e status dell'errore,
 * eventi emessi, presenza della chiave nello storage e variazione del refresh token (senza mai
 * mostrarne il valore). NON è un contratto di auth-js né del nostro store: se un aggiornamento della
 * libreria o della CLI cambia questi valori, la classificazione degli errori va rivista.
 * Gli errori di rete, i 5xx, il 429 e le risposte inattese sono simulati in
 * `tests/characterization/auth-js-errors.test.ts`. Utenti creati a runtime e rimossi a fine test;
 * nessuna credenziale nel repository.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createFakePlatform, type FakePlatform } from '@/platform/fake'
import { toAppError } from '@/shared/lib/errors'
import {
  AUTH_STORAGE_KEY,
  createSupabaseClient,
  type AppSupabaseClient,
} from '@/shared/lib/supabaseClient'

import { deleteAuthSessions, deleteRefreshTokens } from './db'
import { anonKey, createAdminClient, PRIVACY_VERSION, supabaseUrl } from './support'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 })

interface Observation {
  readonly scenario: string
  readonly origin: 'locale-reale'
  readonly request: string
  readonly error: {
    readonly class: string
    readonly code: string | null
    readonly status: number | null
  } | null
  readonly returned: boolean | null
  readonly events: readonly string[]
  readonly keyBefore: boolean
  readonly keyAfter: boolean
  readonly refreshTokenChanged: boolean | null
  readonly requests: number
  readonly appError: string | null
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
  readonly returned: boolean | null
  readonly appError?: boolean
}

const admin = createAdminClient()
const createdIds = new Set<string>()
const requestLog: string[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const nowSeconds = () => Math.floor(Date.now() / 1000)

beforeAll(() => {
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    requestLog.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}${url.search}`)
    return realFetch(input, init)
  })
})

const accounts: Account[] = []

afterAll(async () => {
  try {
    for (const account of accounts.splice(0)) await account.client.auth.stopAutoRefresh()
  } finally {
    for (const id of createdIds) await admin.auth.admin.deleteUser(id)
    vi.unstubAllGlobals()
  }
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

/** Utente confermato creato dall'amministratore, con una sessione reale in un nuovo client. */
async function signedIn(label: string): Promise<Account> {
  const email = `m3-char-${label}-${randomUUID()}@example.test`
  const password = `${randomUUID()}${randomUUID()}`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { privacy_version: PRIVACY_VERSION },
  })
  if (error || !data.user) throw error ?? new Error('createUser fallita')
  createdIds.add(data.user.id)
  const account = await signInAs(data.user.id, email, password)
  return account
}

async function signInAs(id: string, email: string, password: string): Promise<Account> {
  const platform = createFakePlatform()
  const client = newClient(platform)
  const events: string[] = []
  client.auth.onAuthStateChange((event, session) => {
    events.push(`${event}:${session ? 'sessione' : 'null'}`)
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  await sleep(150)
  const account: Account = { id, email, password, client, platform, events }
  accounts.push(account)
  return account
}

async function editStored(
  account: Account,
  edit: (session: StoredSession) => StoredSession,
): Promise<void> {
  const raw = account.platform.storageContents.get(AUTH_STORAGE_KEY)
  if (!raw) throw new Error('Nessuna sessione nello storage.')
  await account.platform.secureStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify(edit(JSON.parse(raw) as StoredSession)),
  )
}

/**
 * Access token con firma alterata (struttura valida, scadenza invariata). Si cambia un carattere
 * dentro la firma, non l'ultimo: l'ultimo carattere base64url può contenere bit inutilizzati e
 * lasciare invariati i byte decodificati.
 */
function tamperSignature(session: StoredSession): StoredSession {
  const token = session.access_token
  const index = token.length - 12
  const replacement = token[index] === 'A' ? 'B' : 'A'
  return {
    ...session,
    access_token: `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`,
  }
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

function refreshTokenOf(account: Account): string | null {
  const raw = account.platform.storageContents.get(AUTH_STORAGE_KEY)
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

async function observe(
  scenario: string,
  request: string,
  account: Account,
  action: () => Promise<ActionResult>,
): Promise<Observation> {
  const eventsBefore = account.events.length
  const requestsBefore = requestLog.length
  const keyBefore = account.platform.storageContents.has(AUTH_STORAGE_KEY)
  const tokenBefore = refreshTokenOf(account)
  const result = await action()
  await sleep(250)
  const tokenAfter = refreshTokenOf(account)
  return {
    scenario,
    origin: 'locale-reale',
    request,
    error: describeError(result.error),
    returned: result.returned,
    events: account.events.slice(eventsBefore),
    keyBefore,
    keyAfter: account.platform.storageContents.has(AUTH_STORAGE_KEY),
    refreshTokenChanged:
      tokenBefore === null || tokenAfter === null ? null : tokenBefore !== tokenAfter,
    requests: requestLog.length - requestsBefore,
    appError: result.appError && result.error ? toAppError(result.error).code : null,
  }
}

const getUser = (account: Account) => async (): Promise<ActionResult> => {
  const { data, error } = await account.client.auth.getUser()
  return { error, returned: data.user !== null }
}

const getSession = (account: Account) => async (): Promise<ActionResult> => {
  const { data, error } = await account.client.auth.getSession()
  return { error, returned: data.session !== null }
}

const readProfile = (account: Account) => async (): Promise<ActionResult> => {
  const { data, error } = await account.client.from('profiles').select('id').maybeSingle()
  return { error, returned: data !== null, appError: true }
}

type Summary = Omit<Observation, 'scenario' | 'origin' | 'request'>
const summary = (o: Observation): Summary => ({
  error: o.error,
  returned: o.returned,
  events: o.events,
  keyBefore: o.keyBefore,
  keyAfter: o.keyAfter,
  refreshTokenChanged: o.refreshTokenChanged,
  requests: o.requests,
  appError: o.appError,
})

/** Valori osservati, fissati dopo la prima esecuzione (vedi la nota in testa al file). */
const EXPECTED: Record<string, Summary> = {
  'S0-getUser': {
    error: null,
    returned: true,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S0-postgrest-valido': {
    error: null,
    returned: true,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S6-getUser': {
    error: { class: 'AuthSessionMissingError', code: null, status: 400 },
    returned: false,
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S6-getSession-dopo': {
    error: null,
    returned: false,
    events: [],
    keyBefore: false,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 0,
    appError: null,
  },
  'S7-getUser': {
    error: { class: 'AuthSessionMissingError', code: null, status: 400 },
    returned: false,
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S8-getUser': {
    error: { class: 'AuthApiError', code: 'user_not_found', status: 403 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S8-refresh': {
    error: { class: 'AuthApiError', code: 'refresh_token_not_found', status: 400 },
    returned: false,
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S9-getUser': {
    error: { class: 'AuthApiError', code: 'bad_jwt', status: 403 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S13-postgrest-reale-firma-non-valida': {
    error: { class: 'sconosciuta', code: 'PGRST301', status: null },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: 'unauthenticated',
  },
  'S10-sessione-cancellata': {
    error: { class: 'AuthApiError', code: 'refresh_token_not_found', status: 400 },
    returned: false,
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S10-refresh-token-cancellato': {
    error: { class: 'AuthApiError', code: 'refresh_token_not_found', status: 400 },
    returned: false,
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S10-refresh-token-gia-usato': {
    error: { class: 'AuthApiError', code: 'refresh_token_already_used', status: 400 },
    returned: false,
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S11-getSession': {
    error: null,
    returned: true,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S11-getUser': {
    error: null,
    returned: true,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
}

function check(observation: Observation): void {
  const out = process.env.CHARACTERIZATION_REPORT
  if (out) appendFileSync(out, `${JSON.stringify(observation)}\n`)
  expect(summary(observation)).toEqual(EXPECTED[observation.scenario])
}

describe('auth-js 2.117.3 con GoTrue locale reale: controllo di riferimento', () => {
  it('S0: sessione valida, getUser() e lettura del profilo riescono', async () => {
    const account = await signedIn('s0')

    check(
      await observe('S0-getUser', 'GET /auth/v1/user (sessione valida)', account, getUser(account)),
    )
    check(
      await observe(
        'S0-postgrest-valido',
        'GET /rest/v1/profiles (sessione valida)',
        account,
        readProfile(account),
      ),
    )
  })
})

describe('auth-js 2.117.3 con GoTrue locale reale: sessione assente sul server', () => {
  it('S6: sessione cancellata sul server, access token ancora valido', async () => {
    const account = await signedIn('s6')
    deleteAuthSessions(account.id)

    check(
      await observe(
        'S6-getUser',
        'GET /auth/v1/user (sessione cancellata sul server)',
        account,
        getUser(account),
      ),
    )
    check(await observe('S6-getSession-dopo', 'getSession() dopo S6', account, getSession(account)))
  })

  it('S7: logout globale da un altro client', async () => {
    const account = await signedIn('s7')
    const other = await signInAs(account.id, account.email, account.password)
    expect((await other.client.auth.signOut({ scope: 'global' })).error).toBeNull()

    check(
      await observe(
        'S7-getUser',
        'GET /auth/v1/user (dopo signOut globale altrove)',
        account,
        getUser(account),
      ),
    )
  })

  it('S8: utente eliminato', async () => {
    const withValidToken = await signedIn('s8a')
    await admin.auth.admin.deleteUser(withValidToken.id)
    check(
      await observe(
        'S8-getUser',
        'GET /auth/v1/user (utente eliminato)',
        withValidToken,
        getUser(withValidToken),
      ),
    )

    const withExpiredToken = await signedIn('s8b')
    await admin.auth.admin.deleteUser(withExpiredToken.id)
    await editStored(withExpiredToken, expireAccessToken)
    check(
      await observe(
        'S8-refresh',
        'POST /auth/v1/token?grant_type=refresh_token (utente eliminato)',
        withExpiredToken,
        getSession(withExpiredToken),
      ),
    )
  })
})

describe('auth-js 2.117.3 con GoTrue locale reale: token rifiutato', () => {
  it('S9: access token con firma alterata; S13: lettura del profilo con lo stesso token', async () => {
    const account = await signedIn('s9')
    await editStored(account, tamperSignature)
    check(
      await observe(
        'S9-getUser',
        'GET /auth/v1/user (firma non valida)',
        account,
        getUser(account),
      ),
    )

    const reader = await signedIn('s13')
    await editStored(reader, tamperSignature)
    check(
      await observe(
        'S13-postgrest-reale-firma-non-valida',
        'GET /rest/v1/profiles (firma non valida)',
        reader,
        readProfile(reader),
      ),
    )
  })

  it('S10: refresh rifiutato con access token scaduto', async () => {
    const sessionsDeleted = await signedIn('s10a')
    deleteAuthSessions(sessionsDeleted.id)
    await editStored(sessionsDeleted, expireAccessToken)
    check(
      await observe(
        'S10-sessione-cancellata',
        'refresh dopo la cancellazione della sessione (token scaduto)',
        sessionsDeleted,
        getSession(sessionsDeleted),
      ),
    )

    const tokensDeleted = await signedIn('s10b')
    deleteRefreshTokens(tokensDeleted.id)
    await editStored(tokensDeleted, expireAccessToken)
    check(
      await observe(
        'S10-refresh-token-cancellato',
        'refresh dopo la cancellazione del refresh token (token scaduto)',
        tokensDeleted,
        getSession(tokensDeleted),
      ),
    )
  })

  it('S10: riuso di un refresh token già ruotato (oltre l’intervallo di tolleranza)', async () => {
    const first = await signedIn('s10c')
    const used = first.platform.storageContents.get(AUTH_STORAGE_KEY)
    if (!used) throw new Error('Nessuna sessione nello storage.')
    // Due rotazioni: il primo refresh token (già copiato) e il suo figlio risultano entrambi usati.
    expect((await first.client.auth.refreshSession()).error).toBeNull()
    expect((await first.client.auth.refreshSession()).error).toBeNull()
    await sleep(11_000)

    const platform = createFakePlatform()
    await platform.secureStorage.setItem(AUTH_STORAGE_KEY, used)
    const client = newClient(platform)
    const events: string[] = []
    client.auth.onAuthStateChange((event, session) => {
      events.push(`${event}:${session ? 'sessione' : 'null'}`)
    })
    const reuse: Account = { ...first, client, platform, events }
    accounts.push(reuse)
    await sleep(500)
    await editStored(reuse, expireAccessToken)

    check(
      await observe(
        'S10-refresh-token-gia-usato',
        'refresh con un refresh token già ruotato',
        reuse,
        getSession(reuse),
      ),
    )
  })

  it('S11: refresh rifiutato con access token ancora entro il margine di 90 s', async () => {
    const account = await signedIn('s11')
    deleteRefreshTokens(account.id)
    await editStored(account, nearExpiry)

    check(
      await observe(
        'S11-getSession',
        'getSession() con refresh token cancellato e token entro il margine',
        account,
        getSession(account),
      ),
    )
    check(await observe('S11-getUser', 'getUser() subito dopo S11', account, getUser(account)))
  })
})
