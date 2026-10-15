// @vitest-environment node
/**
 * Caratterizzazione di @supabase/auth-js 2.117.3 (supabase-js 2.117.3) con risposte SIMULATE.
 *
 * Documenta il comportamento OSSERVATO della versione in uso di `getUser()`, del refresh e delle
 * letture PostgREST in caso di errore di rete, cooldown, 5xx, 429 e risposte inattese: classe, codice e
 * status dell'errore, eventi emessi, presenza della chiave nello storage e variazione del refresh token
 * (senza mai mostrarne il valore). NON è un contratto di auth-js né del nostro store: se un
 * aggiornamento della libreria cambia questi valori, la classificazione degli errori va rivista.
 * Gli scenari con server reale sono in `tests/integration/auth-errors.characterization.int.test.ts`.
 * Ambiente `node`: BroadcastChannel e visibilitychange (solo browser) non sono coperti.
 */
import { appendFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakePlatform } from '@/platform/fake'
import { toAppError } from '@/shared/lib/errors'
import {
  AUTH_STORAGE_KEY,
  createSupabaseClient,
  type AppSupabaseClient,
} from '@/shared/lib/supabaseClient'

interface Call {
  readonly method: string
  readonly path: string
}
type Reply = Response | 'network'
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
  readonly returned: boolean | null
  readonly events: readonly string[]
  readonly keyBefore: boolean
  readonly keyAfter: boolean
  readonly refreshTokenChanged: boolean | null
  readonly requests: number
  readonly appError: string | null
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

/** Sessione con access token che scade tra `expiresInSeconds` secondi (negativo = già scaduto). */
function storedSession(expiresInSeconds: number): string {
  const expiresAt = nowSeconds() + expiresInSeconds
  const header = base64Url({ alg: 'none', typ: 'JWT' })
  const claims = base64Url({ sub: USER.id, role: 'authenticated', exp: expiresAt })
  return JSON.stringify({
    access_token: `${header}.${claims}.signature`,
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

const authFailure = (status: number, errorCode: string): Response =>
  jsonReply(status, { code: status, error_code: errorCode, msg: 'simulated' })

const REFRESH = 'POST /auth/v1/token?grant_type=refresh_token'
const USER_ENDPOINT = 'GET /auth/v1/user'
const key = (call: Call): string => `${call.method} ${call.path}`

const clients: AppSupabaseClient[] = []

interface Harness {
  readonly client: AppSupabaseClient
  readonly calls: Call[]
  readonly events: string[]
  keyPresent(): boolean
  refreshToken(): string | null
}

async function start(storedExpiresIn: number | null, handler: Handler): Promise<Harness> {
  const platform = createFakePlatform()
  const calls: Call[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: `${url.pathname}${url.search}`,
    }
    calls.push(call)
    const reply = handler(call)
    return reply === 'network'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(reply)
  })
  if (storedExpiresIn !== null) {
    await platform.secureStorage.setItem(AUTH_STORAGE_KEY, storedSession(storedExpiresIn))
  }
  const client = createSupabaseClient({
    url: 'http://127.0.0.1:54321',
    anonKey: 'anon-key',
    storage: platform.secureStorage,
    platform: 'web',
    appVersion: 'characterization',
  })
  clients.push(client)
  const events: string[] = []
  client.auth.onAuthStateChange((event, session) => {
    events.push(`${event}:${session ? 'sessione' : 'null'}`)
  })
  return {
    client,
    calls,
    events,
    keyPresent: () => platform.storageContents.has(AUTH_STORAGE_KEY),
    refreshToken: () => {
      const raw = platform.storageContents.get(AUTH_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { refresh_token?: unknown }
      return typeof parsed.refresh_token === 'string' ? parsed.refresh_token : null
    },
  }
}

/** Sessione valida già caricata: gli eventi di avvio non entrano nell'osservazione successiva. */
async function ready(h: Harness): Promise<void> {
  await h.client.auth.initialize()
  await vi.advanceTimersByTimeAsync(50)
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
  readonly returned: boolean | null
  readonly appError?: boolean
}

/** Esegue `action` facendo avanzare il tempo simulato e registra cosa è cambiato. */
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
  const tokenBefore = h.refreshToken()
  const pending = action()
  await vi.advanceTimersByTimeAsync(advanceMs)
  const result = await pending
  await vi.advanceTimersByTimeAsync(10)
  const tokenAfter = h.refreshToken()
  return {
    scenario,
    origin: 'simulata',
    request,
    error: describeError(result.error),
    returned: result.returned,
    events: h.events.slice(eventsBefore),
    keyBefore,
    keyAfter: h.keyPresent(),
    refreshTokenChanged:
      tokenBefore === null || tokenAfter === null ? null : tokenBefore !== tokenAfter,
    requests: h.calls.length - callsBefore,
    appError: result.appError && result.error ? toAppError(result.error).code : null,
  }
}

const getUser = (h: Harness) => async (): Promise<ActionResult> => {
  const { data, error } = await h.client.auth.getUser()
  return { error, returned: data.user !== null }
}

const getSession = (h: Harness) => async (): Promise<ActionResult> => {
  const { data, error } = await h.client.auth.getSession()
  return { error, returned: data.session !== null }
}

const initialize = (h: Harness) => async (): Promise<ActionResult> => {
  const { error } = await h.client.auth.initialize()
  return { error, returned: null }
}

const readProfile = (h: Harness) => async (): Promise<ActionResult> => {
  const { data, error } = await h.client.from('profiles').select('id').maybeSingle()
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
  S1: {
    error: { class: 'AuthRetryableFetchError', code: null, status: 0 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S2-init': {
    error: null,
    returned: null,
    events: ['INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 8,
    appError: null,
  },
  'S2-getSession': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 0 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 0,
    appError: null,
  },
  'S3-cooldown': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 0 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 0,
    appError: null,
  },
  'S3-dopo-cooldown': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 0 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 4,
    appError: null,
  },
  'S4-getUser-500': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 500 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S4-refresh-500': {
    error: null,
    returned: null,
    events: ['INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 8,
    appError: null,
  },
  'S4-getUser-502': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 502 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S4-refresh-502': {
    error: null,
    returned: null,
    events: ['INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 8,
    appError: null,
  },
  'S4-getUser-503': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 503 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S4-refresh-503': {
    error: null,
    returned: null,
    events: ['INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 8,
    appError: null,
  },
  'S4-getUser-504': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 504 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S4-refresh-504': {
    error: null,
    returned: null,
    events: ['INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 8,
    appError: null,
  },
  'S5-getUser-429': {
    error: { class: 'AuthApiError', code: 'over_request_rate_limit', status: 429 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S5-refresh-429': {
    error: null,
    returned: null,
    events: ['SIGNED_OUT:null', 'INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S12-getUser-200-json-non-valido': {
    error: { class: 'AuthRetryableFetchError', code: null, status: 0 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S12-getUser-400-codice-sconosciuto': {
    error: { class: 'AuthApiError', code: 'unknown_code', status: 400 },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S12-refresh-400-codice-sconosciuto': {
    error: null,
    returned: null,
    events: ['SIGNED_OUT:null', 'INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S12-getUser-401-senza-corpo': {
    error: { class: 'AuthUnknownError', code: null, status: null },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: null,
  },
  'S12-refresh-401-senza-corpo': {
    error: null,
    returned: null,
    events: ['SIGNED_OUT:null', 'INITIAL_SESSION:null'],
    keyBefore: true,
    keyAfter: false,
    refreshTokenChanged: null,
    requests: 1,
    appError: null,
  },
  'S13-postgrest-401-PGRST303': {
    error: { class: 'sconosciuta', code: 'PGRST303', status: null },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: 'unauthenticated',
  },
  'S13-postgrest-401-PGRST301': {
    error: { class: 'sconosciuta', code: 'PGRST301', status: null },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 1,
    appError: 'unauthenticated',
  },
  'S13-postgrest-rete-assente': {
    error: { class: 'sconosciuta', code: '', status: null },
    returned: false,
    events: [],
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
    requests: 4,
    appError: 'network',
  },
}

function check(observation: Observation): void {
  const out = process.env.CHARACTERIZATION_REPORT
  if (out) appendFileSync(out, `${JSON.stringify(observation)}\n`)
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

describe('auth-js 2.117.3: rete assente e cooldown (risposte simulate)', () => {
  it('S1: rete assente su getUser() con access token valido', async () => {
    const h = await start(3600, () => 'network')
    await ready(h)

    check(await observe('S1', `${USER_ENDPOINT} → rete assente`, h, getUser(h)))
  })

  it('S2, S3: avvio con token scaduto e rete assente; poi cooldown di 60 s', async () => {
    const h = await start(-60, () => 'network')

    check(await observe('S2-init', `${REFRESH} → rete assente (avvio)`, h, initialize(h), 26_000))
    check(await observe('S2-getSession', 'getSession() dopo l’avvio fallito', h, getSession(h)))
    check(await observe('S3-cooldown', 'getSession() ripetuta entro il cooldown', h, getSession(h)))
    await vi.advanceTimersByTimeAsync(61_000)
    check(
      await observe(
        'S3-dopo-cooldown',
        'getSession() oltre i 60 s dal fallimento',
        h,
        getSession(h),
        26_000,
      ),
    )
  })
})

describe('auth-js 2.117.3: 5xx, 429 e risposte inattese (risposte simulate)', () => {
  it.each([500, 502, 503, 504])('S4: HTTP %i su getUser() e sul refresh', async (status) => {
    const failing: Handler = () => authFailure(status, 'unexpected_failure')

    const user = await start(3600, (call) =>
      key(call) === USER_ENDPOINT ? failing(call) : 'network',
    )
    await ready(user)
    check(
      await observe(`S4-getUser-${status}`, `${USER_ENDPOINT} → ${status}`, user, getUser(user)),
    )

    const refresh = await start(-60, (call) => (key(call) === REFRESH ? failing(call) : 'network'))
    check(
      await observe(
        `S4-refresh-${status}`,
        `${REFRESH} → ${status}`,
        refresh,
        initialize(refresh),
        26_000,
      ),
    )
  })

  it('S5: HTTP 429 su getUser() e sul refresh', async () => {
    const limited: Handler = () => authFailure(429, 'over_request_rate_limit')

    const user = await start(3600, limited)
    await ready(user)
    check(await observe('S5-getUser-429', `${USER_ENDPOINT} → 429`, user, getUser(user)))

    const refresh = await start(-60, limited)
    check(await observe('S5-refresh-429', `${REFRESH} → 429`, refresh, initialize(refresh), 26_000))
  })

  it('S12: risposte inattese su getUser() e sul refresh', async () => {
    const invalidJson = await start(
      3600,
      () =>
        new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await ready(invalidJson)
    check(
      await observe(
        'S12-getUser-200-json-non-valido',
        `${USER_ENDPOINT} → 200 con corpo non JSON`,
        invalidJson,
        getUser(invalidJson),
      ),
    )

    const unknownCode: Handler = () =>
      jsonReply(400, { error_code: 'unknown_code', msg: 'simulated' })
    const userUnknown = await start(3600, unknownCode)
    await ready(userUnknown)
    check(
      await observe(
        'S12-getUser-400-codice-sconosciuto',
        `${USER_ENDPOINT} → 400 codice sconosciuto`,
        userUnknown,
        getUser(userUnknown),
      ),
    )
    const refreshUnknown = await start(-60, unknownCode)
    check(
      await observe(
        'S12-refresh-400-codice-sconosciuto',
        `${REFRESH} → 400 codice sconosciuto`,
        refreshUnknown,
        initialize(refreshUnknown),
        26_000,
      ),
    )

    const noBody: Handler = () => new Response(null, { status: 401 })
    const userNoBody = await start(3600, noBody)
    await ready(userNoBody)
    check(
      await observe(
        'S12-getUser-401-senza-corpo',
        `${USER_ENDPOINT} → 401 senza corpo`,
        userNoBody,
        getUser(userNoBody),
      ),
    )
    const refreshNoBody = await start(-60, noBody)
    check(
      await observe(
        'S12-refresh-401-senza-corpo',
        `${REFRESH} → 401 senza corpo`,
        refreshNoBody,
        initialize(refreshNoBody),
        26_000,
      ),
    )
  })
})

describe('PostgREST 2.117.3: lettura del profilo con risposte simulate (S13, parte simulata)', () => {
  const postgrest =
    (status: number, code: string, message: string): Handler =>
    (call) =>
      call.path.startsWith('/rest/v1/profiles')
        ? jsonReply(status, { code, message, details: null, hint: null })
        : 'network'

  it.each([
    ['PGRST303', 'JWT expired'],
    ['PGRST301', 'JWSError JWSInvalidSignature'],
  ])('S13: 401 %s', async (code, message) => {
    const h = await start(3600, postgrest(401, code, message))
    await ready(h)

    check(
      await observe(
        `S13-postgrest-401-${code}`,
        `GET /rest/v1/profiles → 401 ${code}`,
        h,
        readProfile(h),
      ),
    )
  })

  it('S13: rete assente', async () => {
    const h = await start(3600, () => 'network')
    await ready(h)

    check(
      await observe(
        'S13-postgrest-rete-assente',
        'GET /rest/v1/profiles → rete assente',
        h,
        readProfile(h),
        15_000,
      ),
    )
  })
})
