// @vitest-environment node
/**
 * Caratterizzazione di @supabase/auth-js 2.117.3 (supabase-js 2.117.3) con risposte SIMULATE:
 * refresh a client avviato (T5), errori dello storage (T6), `getUser()` e `getSession()` su un
 * client bloccato dopo un avvio fallito (T7) e `signOut` che non si risolve (T8).
 *
 * Documenta il comportamento OSSERVATO: errore restituito o lanciato, eventi emessi (nell'ordine),
 * presenza della chiave nello storage e richieste effettuate. NON è un contratto di auth-js né del
 * nostro store: se un aggiornamento della libreria cambia questi valori, la classificazione va rivista.
 * Non mostra mai i token. Nessuna rete reale: `fetch` è sostituito e ogni richiesta è registrata.
 * Gli scenari con server locale reale sono in `tests/integration/auth-events.characterization.int.test.ts`.
 * Ambiente `node`: BroadcastChannel e visibilitychange (solo browser) non sono coperti.
 */
import { appendFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SecureStorage } from '@/platform'
import {
  AUTH_STORAGE_KEY,
  createSupabaseClient,
  type AppSupabaseClient,
} from '@/shared/lib/supabaseClient'

interface Call {
  readonly method: string
  readonly path: string
}
type Reply = Response | Promise<Response> | 'network'
type Handler = (call: Call) => Reply

interface Observation {
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
  readonly keyBefore: boolean
  readonly keyAfter: boolean
  readonly requests: number
}

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

/** Sessione con access token che scade tra `expiresInSeconds` secondi (negativo = già scaduto). */
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

/** Risposta di successo di un login/refresh: contiene una sessione completa. */
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
const PASSWORD_LOGIN = 'POST /auth/v1/token?grant_type=password'
const LOGOUT_PREFIX = 'POST /auth/v1/logout'

const clients: AppSupabaseClient[] = []

/** Storage in memoria con guasti attivabili per operazione (la promessa viene RIFIUTATA). */
interface FaultyStorage extends SecureStorage {
  readonly contents: Map<string, string>
  readonly faults: { get: boolean; set: boolean; remove: boolean }
}

function createFaultyStorage(): FaultyStorage {
  const contents = new Map<string, string>()
  const faults = { get: false, set: false, remove: false }
  return {
    contents,
    faults,
    getItem: (name) =>
      faults.get
        ? Promise.reject(new Error('storage non leggibile'))
        : Promise.resolve(contents.get(name) ?? null),
    setItem: (name, value) => {
      if (faults.set) return Promise.reject(new Error('storage non scrivibile'))
      contents.set(name, value)
      return Promise.resolve()
    },
    removeItem: (name) => {
      if (faults.remove) return Promise.reject(new Error('storage non cancellabile'))
      contents.delete(name)
      return Promise.resolve()
    },
  }
}

interface Harness {
  readonly client: AppSupabaseClient
  readonly calls: Call[]
  readonly events: string[]
  readonly storage: FaultyStorage
  setHandler(handler: Handler): void
  keyPresent(): boolean
}

function start(
  storedExpiresIn: number | null,
  initialHandler: Handler,
  prepare?: (storage: FaultyStorage) => void,
): Promise<Harness> {
  const storage = createFaultyStorage()
  const calls: Call[] = []
  let handler = initialHandler
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
    const reply = handler(call)
    if (reply === 'network') return Promise.reject(new TypeError('fetch failed'))
    return Promise.resolve(reply)
  })
  if (storedExpiresIn !== null)
    storage.contents.set(AUTH_STORAGE_KEY, storedSession(storedExpiresIn))
  prepare?.(storage)
  const client = createSupabaseClient({
    url: 'http://127.0.0.1:54321',
    anonKey: 'anon-key',
    storage,
    platform: 'web',
    appVersion: 'characterization',
  })
  clients.push(client)
  const events: string[] = []
  client.auth.onAuthStateChange((event, session) => {
    events.push(`${event}:${session ? 'sessione' : 'null'}`)
  })
  return Promise.resolve({
    client,
    calls,
    events,
    storage,
    setHandler: (next) => {
      handler = next
    },
    keyPresent: () => storage.contents.has(AUTH_STORAGE_KEY),
  })
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

/** Esegue `action` facendo avanzare il tempo simulato; un'eccezione lanciata è registrata, non propagata. */
async function observe(
  scenario: string,
  request: string,
  h: Harness,
  action: () => Promise<ActionResult>,
  advanceMs = 10,
): Promise<Observation> {
  const eventsBefore = h.events.length
  const callsBefore = h.calls.length
  const keyBefore = h.keyPresent()
  const pending = action().then(
    (result) => ({ ...result, thrown: false }),
    (error: unknown) => ({ error, detail: {}, thrown: true }),
  )
  await vi.advanceTimersByTimeAsync(advanceMs)
  const result = await pending
  await vi.advanceTimersByTimeAsync(10)
  return {
    scenario,
    origin: 'simulata',
    request,
    error: describeError(result.error),
    detail: { ...result.detail, lanciata: result.thrown },
    events: h.events.slice(eventsBefore),
    keyBefore,
    keyAfter: h.keyPresent(),
    requests: h.calls.length - callsBefore,
  }
}

/**
 * Come `observe`, ma avanza il tempo simulato a passi di 500 ms finché l'azione non si risolve
 * (massimo `maxMs`) e registra quanti secondi simulati sono serviti.
 */
async function observeSettled(
  scenario: string,
  request: string,
  h: Harness,
  action: () => Promise<ActionResult>,
  maxMs = 180_000,
): Promise<Observation> {
  const eventsBefore = h.events.length
  const callsBefore = h.calls.length
  const keyBefore = h.keyPresent()
  let settled = false
  const pending = action().then(
    (result) => ({ ...result, thrown: false }),
    (error: unknown) => ({ error, detail: {}, thrown: true }),
  )
  void pending.then(() => {
    settled = true
  })
  let elapsed = 0
  while (!settled && elapsed < maxMs) {
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
    keyBefore,
    keyAfter: h.keyPresent(),
    requests: h.calls.length - callsBefore,
  }
}

const getSession = (h: Harness) => async (): Promise<ActionResult> => {
  const { data, error } = await h.client.auth.getSession()
  return { error, detail: { sessione: data.session !== null } }
}

const getUser = (h: Harness) => async (): Promise<ActionResult> => {
  const { data, error } = await h.client.auth.getUser()
  return { error, detail: { utente: data.user !== null } }
}

type Summary = Omit<Observation, 'scenario' | 'origin' | 'request'>
const summary = (o: Observation): Summary => ({
  error: o.error,
  detail: o.detail,
  events: o.events,
  keyBefore: o.keyBefore,
  keyAfter: o.keyAfter,
  requests: o.requests,
})

/** Valori osservati, fissati dopo la prima esecuzione (vedi la nota in testa al file). */
const THROWN = { class: 'Error', code: null, status: null }
const EXPECTED: Record<string, Summary> = {
  'T6a-initialize': {
    error: null,
    detail: { eventiDallAvvio: '', lanciata: false },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T6a-getSession': {
    error: THROWN,
    detail: { lanciata: true },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T6a-getUser': {
    error: THROWN,
    detail: { lanciata: true },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T6b-login': {
    error: THROWN,
    detail: { lanciata: true },
    events: [],
    keyBefore: false,
    keyAfter: false,
    requests: 1,
  },
  'T6b-getSession': {
    error: null,
    detail: { sessione: false, lanciata: false },
    events: [],
    keyBefore: false,
    keyAfter: false,
    requests: 0,
  },
  'T6c-signOut': {
    error: THROWN,
    detail: { lanciata: true },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T6c-getSession': {
    error: null,
    detail: { sessione: true, lanciata: false },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T6a-rifiuti-non-gestiti': {
    error: null,
    detail: {
      rifiutiNonGestiti: 2,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T5-rete-assente': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 8,
  },
  'T5-http-500': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 8,
  },
  'T5-http-429': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    requests: 1,
  },
  'T5-refresh-token-non-trovato': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    requests: 1,
  },
  'T5-http-401-senza-corpo': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    requests: 1,
  },
  'T7-getUser-rete-assente': {
    error: {
      class: 'AuthRetryableFetchError',
      code: null,
      status: 0,
    },
    detail: {
      utente: false,
      secondiDalFallimentoAvvio: 0,
      percorsi: '',
      lanciata: false,
      risolta: true,
      secondiSimulati: 0.5,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T7-getUser-rete-ripristinata': {
    error: {
      class: 'AuthRetryableFetchError',
      code: null,
      status: 0,
    },
    detail: {
      utente: false,
      secondiDalFallimentoAvvio: 1,
      percorsi: '',
      lanciata: false,
      risolta: true,
      secondiSimulati: 0.5,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T7-getSession-rete-ripristinata': {
    error: {
      class: 'AuthRetryableFetchError',
      code: null,
      status: 0,
    },
    detail: {
      sessione: false,
      secondiDalFallimentoAvvio: 1,
      percorsi: '',
      lanciata: false,
      risolta: true,
      secondiSimulati: 0.5,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T7-getUser-dopo-60s': {
    error: null,
    detail: {
      utente: true,
      secondiDalFallimentoAvvio: 63,
      percorsi: 'GET /auth/v1/user',
      lanciata: false,
      risolta: true,
      secondiSimulati: 0.5,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T7-getSession-dopo-60s': {
    error: null,
    detail: {
      sessione: true,
      secondiDalFallimentoAvvio: 63,
      percorsi: '',
      lanciata: false,
      risolta: true,
      secondiSimulati: 0.5,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 0,
  },
  'T8-logout-0s': {
    error: null,
    detail: {
      risolta: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T8-logout-5s': {
    error: null,
    detail: {
      risolta: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T8-logout-30s': {
    error: null,
    detail: {
      risolta: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T8-logout-60s': {
    error: null,
    detail: {
      risolta: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T8-logout-dopo-rilascio': {
    error: null,
    detail: {
      risolta: true,
    },
    events: ['SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    requests: 1,
  },
  'T8-coda-5s': {
    error: null,
    detail: {
      risolta: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T8-coda-30s': {
    error: null,
    detail: {
      risolta: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T8-coda-60s': {
    error: null,
    detail: {
      risolta: false,
    },
    events: [],
    keyBefore: true,
    keyAfter: true,
    requests: 1,
  },
  'T8-coda-dopo-rilascio': {
    error: null,
    detail: {
      risolta: true,
    },
    events: ['TOKEN_REFRESHED:sessione', 'SIGNED_OUT:null'],
    keyBefore: true,
    keyAfter: false,
    requests: 2,
  },
}

function check(observation: Observation): void {
  const out = process.env.CHARACTERIZATION_REPORT
  if (out) appendFileSync(out, `${JSON.stringify(observation)}\n`)
  // Anche in modalità di registrazione (CHARACTERIZATION_REPORT) un valore atteso mancante fallisce:
  // l'osservazione è comunque scritta nel report, ma non passa mai come "conforme".
  if (!(observation.scenario in EXPECTED)) {
    throw new Error(`Valore atteso mancante per lo scenario ${observation.scenario}`)
  }
  expect(summary(observation)).toEqual(EXPECTED[observation.scenario])
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  for (const client of clients.splice(0)) await client.auth.stopAutoRefresh()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('T6: errori dello storage (risposte simulate)', () => {
  // auth-js può lasciare rifiuti non gestiti (`unhandledRejection`) quando lo storage fallisce in
  // lettura. Solo T6a li cattura per contarli; ogni rifiuto DIVERSO da quello atteso viene inoltrato
  // ai gestori originali (Vitest), che restano ripristinati alla fine del test.
  const flushRejections = async (): Promise<void> => {
    for (let i = 0; i < 50; i += 1) await new Promise<void>((resolve) => process.nextTick(resolve))
  }

  function captureExpectedRejections(expectedMessage: string): {
    readonly captured: unknown[]
    restore(): void
  } {
    const captured: unknown[] = []
    const original = process.listeners('unhandledRejection')
    const record = (reason: unknown, promise: Promise<unknown>): void => {
      if (reason instanceof Error && reason.message === expectedMessage) {
        captured.push(reason)
        return
      }
      for (const listener of original) listener(reason, promise)
    }
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', record)
    return {
      captured,
      restore: () => {
        process.removeListener('unhandledRejection', record)
        for (const listener of original) process.on('unhandledRejection', listener)
      },
    }
  }

  it('T6a: lettura che fallisce all’avvio con una sessione salvata', async () => {
    const rejections = captureExpectedRejections('storage non leggibile')
    try {
      const h = await start(
        3600,
        () => 'network',
        (storage) => {
          storage.faults.get = true
        },
      )

      check(
        await observe(
          'T6a-initialize',
          'initialize() con getItem che fallisce',
          h,
          async () => {
            const { error } = await h.client.auth.initialize()
            await flushRejections()
            // Tutti gli eventi dalla creazione del client, non solo quelli emessi durante l'osservazione.
            return {
              error,
              detail: { eventiDallAvvio: h.events.join(',') },
            }
          },
          26_000,
        ),
      )
      check(await observe('T6a-getSession', 'getSession() dopo l’avvio', h, getSession(h)))
      check(await observe('T6a-getUser', 'getUser() dopo l’avvio', h, getUser(h)))
      await flushRejections()
      check({
        scenario: 'T6a-rifiuti-non-gestiti',
        origin: 'simulata',
        request: 'rifiuti di promessa non gestiti emessi da auth-js durante T6a',
        error: null,
        detail: { rifiutiNonGestiti: rejections.captured.length },
        events: [],
        keyBefore: true,
        keyAfter: h.keyPresent(),
        requests: 0,
      })
    } finally {
      await flushRejections()
      rejections.restore()
    }
  })

  it('T6b: scrittura che fallisce al login', async () => {
    const h = await start(null, (call) => (key(call) === PASSWORD_LOGIN ? tokenReply() : 'network'))
    await h.client.auth.initialize()
    await vi.advanceTimersByTimeAsync(50)
    h.storage.faults.set = true

    check(
      await observe('T6b-login', 'signInWithPassword() con setItem che fallisce', h, async () => {
        const { data, error } = await h.client.auth.signInWithPassword({
          email: USER.email,
          password: 'simulated-password',
        })
        return { error, detail: { sessione: data.session !== null } }
      }),
    )
    check(await observe('T6b-getSession', 'getSession() dopo il login fallito', h, getSession(h)))
  })

  it('T6c: rimozione che fallisce al logout', async () => {
    const h = await start(3600, (call) =>
      key(call).startsWith(LOGOUT_PREFIX) ? new Response(null, { status: 204 }) : 'network',
    )
    await h.client.auth.initialize()
    await vi.advanceTimersByTimeAsync(50)
    h.storage.faults.remove = true

    check(
      await observe(
        'T6c-signOut',
        'signOut({scope:local}) con removeItem che fallisce',
        h,
        async () => {
          const { error } = await h.client.auth.signOut({ scope: 'local' })
          return { error, detail: {} }
        },
      ),
    )
    check(await observe('T6c-getSession', 'getSession() dopo il logout fallito', h, getSession(h)))
  })
})

const REFRESH = 'POST /auth/v1/token?grant_type=refresh_token'
const USER_ENDPOINT = 'GET /auth/v1/user'

const authFailure = (status: number, errorCode: string): Response =>
  jsonReply(status, { code: status, error_code: errorCode, msg: 'simulated' })

/**
 * Porta la sessione salvata dentro il margine di 90 s della libreria, ancora valida in questo
 * momento ma già scaduta al primo tick di auto-refresh (30 s dall'avvio del client). Con +30 s la
 * scadenza, arrotondata al secondo, cadeva sul tick stesso: se l'orologio simulato partiva con
 * millisecondi ≥ 950 il token risultava ancora valido, auth-js conservava la sessione e ritentava
 * dopo la pausa di 60 s (2 richieste invece di 1).
 */
function bringNearExpiry(h: Harness): void {
  const raw = h.storage.contents.get(AUTH_STORAGE_KEY)
  if (!raw) throw new Error('Nessuna sessione nello storage.')
  const session = JSON.parse(raw) as { expires_at: number }
  h.storage.contents.set(
    AUTH_STORAGE_KEY,
    JSON.stringify({ ...session, expires_at: nowSeconds() + 20 }),
  )
}

describe('T5: refresh fallito a client già avviato (risposte simulate)', () => {
  const cases: readonly (readonly [string, Handler])[] = [
    ['rete-assente', () => 'network'],
    [
      'http-500',
      (call) => (key(call) === REFRESH ? authFailure(500, 'unexpected_failure') : 'network'),
    ],
    [
      'http-429',
      (call) => (key(call) === REFRESH ? authFailure(429, 'over_request_rate_limit') : 'network'),
    ],
    [
      'refresh-token-non-trovato',
      (call) => (key(call) === REFRESH ? authFailure(400, 'refresh_token_not_found') : 'network'),
    ],
    [
      'http-401-senza-corpo',
      (call) => (key(call) === REFRESH ? new Response(null, { status: 401 }) : 'network'),
    ],
  ]

  it.each(cases)('T5: %s sul rinnovo automatico', async (label, handler) => {
    const h = await start(3600, handler)
    await h.client.auth.initialize()
    await vi.advanceTimersByTimeAsync(50)
    bringNearExpiry(h)

    check(
      await observe(
        `T5-${label}`,
        `rinnovo automatico con ${label}`,
        h,
        () => Promise.resolve({ error: null, detail: {} }),
        90_000,
      ),
    )
  })
})

describe('T7: getUser() e getSession() su un client bloccato dopo l’avvio fallito (risposte simulate)', () => {
  it('T7: a rete assente, con rete ripristinata, oltre i 60 s dal fallimento', async () => {
    const h = await start(-60, () => 'network')
    const initializing = h.client.auth.initialize()
    await vi.advanceTimersByTimeAsync(26_000)
    await initializing
    const failedAt = Date.now()
    const stamped = (action: () => Promise<ActionResult>) => async (): Promise<ActionResult> => {
      const callsBefore = h.calls.length
      const result = await action()
      return {
        error: result.error,
        detail: {
          ...result.detail,
          secondiDalFallimentoAvvio: Math.round((Date.now() - failedAt) / 1000),
          percorsi: h.calls.slice(callsBefore).map(key).join(' | '),
        },
      }
    }

    check(
      await observeSettled(
        'T7-getUser-rete-assente',
        "getUser() dopo l'avvio fallito, rete assente",
        h,
        stamped(getUser(h)),
      ),
    )

    h.setHandler((call) => {
      if (key(call) === USER_ENDPOINT) return jsonReply(200, USER)
      if (key(call) === REFRESH) return tokenReply()
      return 'network'
    })
    check(
      await observeSettled(
        'T7-getUser-rete-ripristinata',
        'getUser() con rete ripristinata',
        h,
        stamped(getUser(h)),
      ),
    )
    check(
      await observeSettled(
        'T7-getSession-rete-ripristinata',
        'getSession() con rete ripristinata',
        h,
        stamped(getSession(h)),
      ),
    )

    await vi.advanceTimersByTimeAsync(61_000)
    check(
      await observeSettled(
        'T7-getUser-dopo-60s',
        'getUser() oltre i 60 s dal fallimento, rete ripristinata',
        h,
        stamped(getUser(h)),
      ),
    )
    check(
      await observeSettled(
        'T7-getSession-dopo-60s',
        'getSession() oltre i 60 s dal fallimento, rete ripristinata',
        h,
        stamped(getSession(h)),
      ),
    )
  }, 60_000)
})

describe('T8: signOut locale che non si risolve (risposte simulate)', () => {
  /** Osservazione a checkpoint: stato di una promessa `signOut` ancora in sospeso. */
  function checkpoints(h: Harness, signOutSettled: () => boolean) {
    const eventsBefore = h.events.length
    const callsBefore = h.calls.length
    return (scenario: string, request: string): Observation => ({
      scenario,
      origin: 'simulata',
      request,
      error: null,
      detail: { risolta: signOutSettled() },
      events: h.events.slice(eventsBefore),
      keyBefore: true,
      keyAfter: h.keyPresent(),
      requests: h.calls.length - callsBefore,
    })
  }

  it('T8: richiesta di logout che non si risolve', async () => {
    let release!: () => void
    const gate = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(null, { status: 204 }))
    })
    const h = await start(3600, (call) => (key(call).startsWith(LOGOUT_PREFIX) ? gate : 'network'))
    await h.client.auth.initialize()
    await vi.advanceTimersByTimeAsync(50)

    let settled = false
    const snapshot = checkpoints(h, () => settled)
    const pending = h.client.auth.signOut({ scope: 'local' }).then(
      (result) => {
        settled = true
        return result
      },
      (error: unknown) => {
        settled = true
        throw error
      },
    )

    await vi.advanceTimersByTimeAsync(0)
    check(snapshot('T8-logout-0s', 'signOut con logout sospeso, subito'))
    await vi.advanceTimersByTimeAsync(5_000)
    check(snapshot('T8-logout-5s', 'signOut con logout sospeso da 5 s'))
    await vi.advanceTimersByTimeAsync(25_000)
    check(snapshot('T8-logout-30s', 'signOut con logout sospeso da 30 s'))
    await vi.advanceTimersByTimeAsync(30_000)
    check(snapshot('T8-logout-60s', 'signOut con logout sospeso da 60 s'))

    release()
    await pending
    await vi.advanceTimersByTimeAsync(50)
    check(snapshot('T8-logout-dopo-rilascio', 'signOut dopo il rilascio del logout'))
  })

  it('T8: signOut in coda dietro un refresh che non si risolve', async () => {
    let release!: () => void
    const gate = new Promise<Response>((resolve) => {
      release = () => resolve(tokenReply())
    })
    const h = await start(3600, (call) => {
      if (key(call) === REFRESH) return gate
      if (key(call).startsWith(LOGOUT_PREFIX)) return new Response(null, { status: 204 })
      return 'network'
    })
    await h.client.auth.initialize()
    await vi.advanceTimersByTimeAsync(50)
    const raw = h.storage.contents.get(AUTH_STORAGE_KEY)
    if (!raw) throw new Error('Nessuna sessione nello storage.')
    h.storage.contents.set(
      AUTH_STORAGE_KEY,
      JSON.stringify({ ...(JSON.parse(raw) as object), expires_at: nowSeconds() - 60 }),
    )

    let settled = false
    const snapshot = checkpoints(h, () => settled)
    const pendingSession = h.client.auth.getSession()
    void pendingSession.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    const pending = h.client.auth.signOut({ scope: 'local' }).then(
      (result) => {
        settled = true
        return result
      },
      (error: unknown) => {
        settled = true
        throw error
      },
    )

    await vi.advanceTimersByTimeAsync(5_000)
    check(snapshot('T8-coda-5s', 'signOut dietro un refresh sospeso da 5 s'))
    await vi.advanceTimersByTimeAsync(25_000)
    check(snapshot('T8-coda-30s', 'signOut dietro un refresh sospeso da 30 s'))
    await vi.advanceTimersByTimeAsync(30_000)
    check(snapshot('T8-coda-60s', 'signOut dietro un refresh sospeso da 60 s'))

    release()
    await Promise.all([pendingSession, pending])
    await vi.advanceTimersByTimeAsync(50)
    check(snapshot('T8-coda-dopo-rilascio', 'signOut dopo il rilascio del refresh'))
  })
})
