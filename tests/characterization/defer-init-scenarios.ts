/**
 * Scenari di caratterizzazione dell'avvio differito di @supabase/auth-js 2.117.3
 * (`skipAutoInitialize: true`), con risposte SIMULATE. Condivisi dai due file di test
 * `auth-js-defer-init.test.ts` (ambiente node) e `auth-js-defer-init.jsdom.test.ts` (jsdom), perché
 * `isBrowser()` di auth-js cambia il percorso di `_initialize`.
 *
 * Documenta il comportamento OSSERVATO: eventi (nell'ordine, con marcatori delle chiamate del test),
 * richieste, letture dello storage. NON è un contratto di auth-js né del nostro store, e NON dimostra
 * il comportamento di GoTrue reale, del browser o di Supabase: `fetch` è sostituito, il tempo è
 * simulato. Il client è creato con `createClient` e le stesse opzioni di `createSupabaseClient` più
 * `skipAutoInitialize`: `supabaseClient.ts` non è modificato. Non mostra mai i token.
 */
import { appendFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SecureStorage } from '@/platform'
import { AUTH_STORAGE_KEY, type AppSupabaseClient } from '@/shared/lib/supabaseClient'
import type { Database } from '@/shared/types/database'

interface Call {
  readonly method: string
  readonly path: string
}
type Reply = Response | 'network'
type Handler = (call: Call) => Reply

export interface Observation {
  readonly scenario: string
  readonly origin: 'simulata'
  readonly request: string
  readonly error: {
    readonly class: string
    readonly code: string | null
    readonly status: number | null
  } | null
  readonly detail: Readonly<Record<string, string | number | boolean | null>>
  readonly events: readonly string[]
  readonly requests: readonly string[]
  readonly storageReads: number
  readonly keyBefore: boolean
  readonly keyAfter: boolean
}

export type Summary = Omit<Observation, 'scenario' | 'origin' | 'request'>

const USER = {
  id: '00000000-0000-4000-8000-000000000000',
  aud: 'authenticated',
  email: 'user@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-08T00:00:00Z',
}

const base64Url = (value: object): string =>
  btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const nowSeconds = (): number => Math.floor(Date.now() / 1000)

function fakeAccessToken(expiresAt: number): string {
  const header = base64Url({ alg: 'none', typ: 'JWT' })
  const claims = base64Url({ sub: USER.id, role: 'authenticated', exp: expiresAt })
  return `${header}.${claims}.signature`
}

function storedSession(expiresInSeconds: number): string {
  const expiresAt = nowSeconds() + expiresInSeconds
  return JSON.stringify({
    access_token: fakeAccessToken(expiresAt),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh-token-before',
    user: USER,
  })
}

const jsonReply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const tokenReply = (): Response => {
  const expiresAt = nowSeconds() + 3600
  return jsonReply(200, {
    access_token: fakeAccessToken(expiresAt),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh-token-after',
    user: USER,
  })
}

const key = (call: Call): string => `${call.method} ${call.path}`
const REFRESH = 'POST /auth/v1/token?grant_type=refresh_token'
const USER_ENDPOINT = 'GET /auth/v1/user'

const onlineHandler: Handler = (call) => {
  const k = key(call)
  if (k === REFRESH) return tokenReply()
  if (k === USER_ENDPOINT) return jsonReply(200, USER)
  return 'network'
}
const offlineHandler: Handler = () => 'network'

interface CountingStorage extends SecureStorage {
  readonly contents: Map<string, string>
  readonly ops: { reads: number }
  fail: { read: boolean }
}

function createCountingStorage(): CountingStorage {
  const contents = new Map<string, string>()
  const ops = { reads: 0 }
  const storage: CountingStorage = {
    contents,
    ops,
    fail: { read: false },
    getItem: (name) => {
      ops.reads += 1
      return storage.fail.read
        ? Promise.reject(new Error('storage non leggibile'))
        : Promise.resolve(contents.get(name) ?? null)
    },
    setItem: (name, value) => {
      contents.set(name, value)
      return Promise.resolve()
    },
    removeItem: (name) => {
      contents.delete(name)
      return Promise.resolve()
    },
  }
  return storage
}

interface Harness {
  readonly client: AppSupabaseClient
  readonly calls: Call[]
  readonly events: string[]
  readonly storage: CountingStorage
  setHandler(handler: Handler): void
  subscribe(): void
  mark(label: string): void
}

const clients: AppSupabaseClient[] = []

/** Client con avvio differito (`skipAutoInitialize`), senza sottoscrizioni né chiamate. */
function startDeferred(storedExpiresIn: number | null, handler: Handler): Harness {
  const storage = createCountingStorage()
  const calls: Call[] = []
  let current = handler
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (url.hostname !== '127.0.0.1') {
      throw new Error(`Richiesta fuori dal perimetro simulato: ${url.hostname}`)
    }
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: `${url.pathname}${url.search}`,
    }
    calls.push(call)
    const reply = current(call)
    return reply === 'network'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(reply)
  })
  if (storedExpiresIn !== null)
    storage.contents.set(AUTH_STORAGE_KEY, storedSession(storedExpiresIn))
  const client = createClient<Database>('http://127.0.0.1:54321', 'anon-key', {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage,
      storageKey: AUTH_STORAGE_KEY,
      skipAutoInitialize: true,
    },
  })
  clients.push(client)
  const events: string[] = []
  return {
    client,
    calls,
    events,
    storage,
    setHandler: (next) => {
      current = next
    },
    subscribe: () => {
      client.auth.onAuthStateChange((event, session) => {
        events.push(`${event}:${session ? 'sessione' : 'null'}`)
      })
    },
    mark: (label) => {
      events.push(`>> ${label}`)
    },
  }
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

interface ActionResult {
  readonly error: unknown
  readonly detail: Observation['detail']
}

const NOTHING: ActionResult = { error: null, detail: {} }

/** Avanza il tempo simulato a passi di 500 ms finché l'azione non si risolve (massimo `maxMs`). */
async function observe(
  scenario: string,
  request: string,
  h: Harness,
  action: () => Promise<ActionResult>,
  options: { readonly fixedMs?: number; readonly maxMs?: number } = {},
): Promise<Observation> {
  const eventsBefore = h.events.length
  const callsBefore = h.calls.length
  const readsBefore = h.storage.ops.reads
  const keyBefore = h.storage.contents.has(AUTH_STORAGE_KEY)
  let settled = false
  const pending = action().then(
    (result) => ({ ...result, thrown: false }),
    (error: unknown) => ({ error, detail: {}, thrown: true }),
  )
  void pending.then(() => {
    settled = true
  })
  let elapsed = 0
  const limit = options.fixedMs ?? options.maxMs ?? 180_000
  while ((options.fixedMs !== undefined || !settled) && elapsed < limit) {
    await vi.advanceTimersByTimeAsync(500)
    elapsed += 500
  }
  const result = settled ? await pending : { error: null, detail: {}, thrown: false }
  return {
    scenario,
    origin: 'simulata',
    request,
    error: describeError(result.error),
    detail: {
      ...result.detail,
      lanciata: result.thrown,
      risolta: settled,
      secondiSimulati: elapsed / 1000,
    },
    events: h.events.slice(eventsBefore),
    requests: h.calls.slice(callsBefore).map(key),
    storageReads: h.storage.ops.reads - readsBefore,
    keyBefore,
    keyAfter: h.storage.contents.has(AUTH_STORAGE_KEY),
  }
}

const summary = (o: Observation): Summary => ({
  error: o.error,
  detail: o.detail,
  events: o.events,
  requests: o.requests,
  storageReads: o.storageReads,
  keyBefore: o.keyBefore,
  keyAfter: o.keyAfter,
})

const initialize = (h: Harness, label: string) => async (): Promise<ActionResult> => {
  h.mark(`initialize() ${label}: chiamato`)
  const { error } = await h.client.auth.initialize()
  h.mark(`initialize() ${label}: risolto`)
  return { error, detail: {} }
}

const getSession = (h: Harness) => async (): Promise<ActionResult> => {
  const { data, error } = await h.client.auth.getSession()
  return { error, detail: { sessione: data.session !== null } }
}

const getUser = (h: Harness) => async (): Promise<ActionResult> => {
  const { data, error } = await h.client.auth.getUser()
  return { error, detail: { utente: data.user !== null } }
}

/** Definisce tutti gli scenari D1–D8. `expected` contiene i valori osservati e fissati. */
export function defineDeferInitScenarios(
  environment: 'node' | 'jsdom',
  expected: Record<string, Summary>,
): void {
  function check(observation: Observation): void {
    const out = process.env.CHARACTERIZATION_REPORT
    if (out) {
      appendFileSync(out, `${JSON.stringify({ ...observation, environment })}\n`)
    }
    // `expect.soft`: la prova continua, così il report è completo anche con valori mancanti.
    expect
      .soft(
        observation.scenario in expected,
        `Valore atteso mancante per lo scenario ${observation.scenario}`,
      )
      .toBe(true)
    if (observation.scenario in expected) {
      expect.soft(summary(observation)).toEqual(expected[observation.scenario])
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // `dispose()` ferma il rinnovo, chiude il BroadcastChannel e svuota i sottoscrittori.
    for (const client of clients.splice(0)) await client.auth.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe(`D1: client differito senza sottoscrizioni né chiamate (${environment})`, () => {
    it('D1: nessuna richiesta, nessun evento, nessuna lettura in 60 s simulati', async () => {
      const h = startDeferred(3600, onlineHandler)
      check(
        await observe('D1', 'client differito, 60 s di attesa', h, () => Promise.resolve(NOTHING), {
          fixedMs: 60_000,
        }),
      )
    })
  })

  const TOKENS = [
    ['valido', 3600],
    ['scaduto', -60],
  ] as const
  const NETWORKS = [
    ['online', onlineHandler],
    ['offline', offlineHandler],
  ] as const
  const ORDERS = ['prima', 'dopo'] as const

  describe(`D2–D5: matrice token × rete × ordine di sottoscrizione (${environment})`, () => {
    for (const [tokenLabel, expiresIn] of TOKENS) {
      for (const [networkLabel, handler] of NETWORKS) {
        for (const order of ORDERS) {
          const id = `M-${tokenLabel}-${networkLabel}-${order}`
          it(`${id}`, async () => {
            const h = startDeferred(expiresIn, handler)
            if (order === 'prima') {
              h.subscribe()
              h.mark('sottoscritto (client non inizializzato)')
              check(
                await observe(
                  `${id}-sottoscrizione`,
                  'dopo la sottoscrizione, prima di initialize()',
                  h,
                  () => Promise.resolve(NOTHING),
                  { fixedMs: 30_000 },
                ),
              )
              if (networkLabel === 'offline') h.setHandler(onlineHandler)
              check(
                await observe(
                  `${id}-initialize`,
                  networkLabel === 'offline'
                    ? 'initialize() con rete ripristinata'
                    : 'initialize()',
                  h,
                  initialize(h, '1'),
                ),
              )
            } else {
              check(
                await observe(
                  `${id}-initialize`,
                  'initialize() prima della sottoscrizione',
                  h,
                  initialize(h, '1'),
                ),
              )
              h.subscribe()
              h.mark('sottoscritto (client già inizializzato)')
              check(
                await observe(
                  `${id}-sottoscrizione`,
                  'dopo la sottoscrizione tardiva',
                  h,
                  () => Promise.resolve(NOTHING),
                  { fixedMs: 5_000 },
                ),
              )
              if (networkLabel === 'offline') {
                h.setHandler(onlineHandler)
                check(
                  await observe(
                    `${id}-initialize-rete-ripristinata`,
                    'initialize() di nuovo, rete ripristinata',
                    h,
                    initialize(h, '2'),
                  ),
                )
              }
            }
            if (networkLabel === 'offline') {
              await vi.advanceTimersByTimeAsync(61_000)
              check(
                await observe(
                  `${id}-getSession-oltre-60s`,
                  'getSession() oltre i 60 s, rete ripristinata',
                  h,
                  getSession(h),
                ),
              )
            }
          }, 60_000)
        }
      }
    }
  })

  describe(`D6: getSession() e getUser() prima di initialize() (${environment})`, () => {
    it.each(TOKENS)('D6: token %s, rete presente', async (tokenLabel, expiresIn) => {
      const id = `D6-${tokenLabel}`
      const h = startDeferred(expiresIn, onlineHandler)
      h.subscribe()
      h.mark('sottoscritto (client non inizializzato)')
      check(
        await observe(
          `${id}-sottoscrizione`,
          'dopo la sottoscrizione',
          h,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      check(
        await observe(`${id}-getSession`, 'getSession() prima di initialize()', h, getSession(h)),
      )
      check(await observe(`${id}-getUser`, 'getUser() prima di initialize()', h, getUser(h)))
      check(
        await observe(
          `${id}-initialize`,
          'initialize() dopo getSession e getUser',
          h,
          initialize(h, '1'),
        ),
      )
    })
  })

  describe(`D7: initialize() ripetuto (${environment})`, () => {
    it('D7: due chiamate in parallelo, poi una terza', async () => {
      const h = startDeferred(-60, onlineHandler)
      h.subscribe()
      h.mark('sottoscritto (client non inizializzato)')
      check(
        await observe(
          'D7-sottoscrizione',
          'dopo la sottoscrizione',
          h,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      check(
        await observe('D7-parallelo', 'due initialize() in parallelo', h, async () => {
          h.mark('initialize() parallelo: chiamate')
          const [a, b] = await Promise.all([h.client.auth.initialize(), h.client.auth.initialize()])
          h.mark('initialize() parallelo: risolte')
          return { error: a.error ?? b.error, detail: {} }
        }),
      )
      check(await observe('D7-terza', 'terza initialize()', h, initialize(h, '3')))
    })
  })

  describe(`D8: avvio differito con lettura dello storage che fallisce (${environment})`, () => {
    it('D8: sottoscrizione prima di initialize()', async () => {
      const unhandled: unknown[] = []
      const original = process.listeners('unhandledRejection')
      const record = (reason: unknown, promise: Promise<unknown>): void => {
        if (reason instanceof Error && reason.message === 'storage non leggibile') {
          unhandled.push(reason)
          return
        }
        for (const listener of original) listener(reason, promise)
      }
      process.removeAllListeners('unhandledRejection')
      process.on('unhandledRejection', record)
      try {
        const h = startDeferred(3600, onlineHandler)
        h.storage.fail.read = true
        h.subscribe()
        h.mark('sottoscritto (client non inizializzato)')
        check(
          await observe(
            'D8-sottoscrizione',
            'dopo la sottoscrizione',
            h,
            () => Promise.resolve(NOTHING),
            {
              fixedMs: 5_000,
            },
          ),
        )
        check(await observe('D8-initialize', 'initialize()', h, initialize(h, '1')))
        for (let i = 0; i < 50; i += 1)
          await new Promise<void>((resolve) => process.nextTick(resolve))
        check({
          scenario: 'D8-rifiuti-non-gestiti',
          origin: 'simulata',
          request: 'rifiuti di promessa non gestiti emessi da auth-js',
          error: null,
          detail: { rifiutiNonGestiti: unhandled.length },
          events: [],
          requests: [],
          storageReads: 0,
          keyBefore: true,
          keyAfter: h.storage.contents.has(AUTH_STORAGE_KEY),
        })
      } finally {
        await new Promise<void>((resolve) => process.nextTick(resolve))
        process.removeListener('unhandledRejection', record)
        for (const listener of original) process.on('unhandledRejection', listener)
      }
    })
  })
}
