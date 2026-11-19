import { AuthSessionMissingError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SecureStorage } from '@/platform'
import { createFakePlatform } from '@/platform/fake'
import { AppError, type AppErrorCode } from '@/shared/lib/errors'
import {
  AUTH_STORAGE_KEY,
  createSupabaseClient,
  type AppSupabaseClient,
} from '@/shared/lib/supabaseClient'

import {
  getPasswordSetupPending,
  setPassword,
  signOut,
  type PasswordSetupPendingResult,
  type SetPasswordResult,
  type SignOutResult,
  type SignOutScope,
} from './service'

/**
 * Service A4 (SPECIFICA §20 M3): `getPasswordSetupPending` (decisione A4 3), `signOut` (decisione
 * A4 4) e `setPassword` (G.10). Il client è quello vero (`createSupabaseClient`, supabase-js 2.117.3): si simula solo la
 * rete, così il test verifica anche le richieste inviate a PostgREST e a GoTrue. Il comportamento con
 * PostgREST, GoTrue e RLS reali è in `tests/integration/auth-service.int.test.ts`.
 */

const USER_ID = '00000000-0000-4000-8000-000000000001'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

function clientWith(reply: () => Promise<Response>) {
  // Firma esplicita: `mock.calls` deve esporre URL e opzioni della richiesta.
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
    reply(),
  )
  vi.stubGlobal('fetch', fetchMock)
  const client = createSupabaseClient({
    url: 'http://127.0.0.1:54321',
    anonKey: 'anon-key',
    storage: createFakePlatform().secureStorage,
    platform: 'web',
    appVersion: '0.0.0',
  })
  return { client, fetchMock }
}

const read = (reply: () => Promise<Response>) =>
  getPasswordSetupPending(clientWith(reply).client, USER_ID)

function expectUnreadable(
  result: PasswordSetupPendingResult,
  code: AppErrorCode,
): asserts result is Extract<PasswordSetupPendingResult, { status: 'unreadable' }> {
  expect(result.status).toBe('unreadable')
  if (result.status !== 'unreadable') return
  expect(result.error).toBeInstanceOf(AppError)
  expect(result.error.code).toBe(code)
}

describe('getPasswordSetupPending: richiesta a PostgREST', () => {
  it('selects only password_setup_pending and filters by id, without owner_id', async () => {
    const { client, fetchMock } = clientWith(() =>
      Promise.resolve(response(200, [{ password_setup_pending: true }])),
    )

    await getPasswordSetupPending(client, USER_ID)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(requestUrl(input ?? ''))
    expect(url.pathname).toBe('/rest/v1/profiles')
    expect(init?.method ?? 'GET').toBe('GET')
    expect([...url.searchParams.entries()]).toEqual([
      ['select', 'password_setup_pending'],
      ['id', `eq.${USER_ID}`],
    ])
  })
})

describe('getPasswordSetupPending: esiti con un valore', () => {
  it('returns pending when the flag is true', async () => {
    expect(
      await read(() => Promise.resolve(response(200, [{ password_setup_pending: true }]))),
    ).toEqual({
      status: 'pending',
    })
  })

  it('returns completed when the flag is false', async () => {
    expect(
      await read(() => Promise.resolve(response(200, [{ password_setup_pending: false }]))),
    ).toEqual({ status: 'completed' })
  })

  it('returns profile_missing when no row is visible', async () => {
    expect(await read(() => Promise.resolve(response(200, [])))).toEqual({
      status: 'profile_missing',
    })
  })
})

describe('getPasswordSetupPending: unreadable, mai completed', () => {
  it.each([
    ['null', null],
    ['the string "false"', 'false'],
    ['the number 0', 0],
  ] as const)('returns unreadable with a diagnostic AppError for %s', async (_label, value) => {
    const result = await read(() =>
      Promise.resolve(response(200, [{ password_setup_pending: value }])),
    )

    expectUnreadable(result, 'unknown')
    expect(result.error.cause).toBe(value)
  })

  it('returns unreadable when the column is missing from the row', async () => {
    const result = await read(() => Promise.resolve(response(200, [{}])))

    expectUnreadable(result, 'unknown')
    expect(result.error.cause).toBeUndefined()
  })

  it.each([
    [
      '42501 (privilegio negato)',
      403,
      { code: '42501', message: 'permission denied' },
      'forbidden',
    ],
    [
      'PGRST301 (JWT non valido)',
      401,
      { code: 'PGRST301', message: 'JWSError JWSInvalidSignature' },
      'unauthenticated',
    ],
    ['un errore PostgREST non classificato', 500, { code: 'XX000', message: 'boom' }, 'unknown'],
  ] as const)(
    'returns unreadable for %s with the AppError of toAppError',
    async (_l, status, body, code) => {
      const result = await read(() => Promise.resolve(response(status, body)))

      expectUnreadable(result, code)
      expect(result.error.cause).toMatchObject({ code: body.code })
    },
  )

  it('returns unreadable (not_found) when PostgREST returns more than one row', async () => {
    const result = await read(() =>
      Promise.resolve(
        response(200, [{ password_setup_pending: false }, { password_setup_pending: false }]),
      ),
    )

    expectUnreadable(result, 'not_found')
  })

  it('returns unreadable (network) when the request fails, after the retries of postgrest-js', async () => {
    // postgrest-js 2.117.3 (`fetchWithRetry`) ripete una GET fallita per rete altre 3 volte, con attese
    // di 1, 2 e 4 s: offline l'esito arriva dopo ~7 s. Orologio simulato per non attendere davvero.
    vi.useFakeTimers()
    try {
      const { client, fetchMock } = clientWith(() => Promise.reject(new TypeError('fetch failed')))

      const pending = getPasswordSetupPending(client, USER_ID)
      // Non `runAllTimersAsync`: il ticker di auto-refresh di auth-js è periodico e non finirebbe mai.
      await vi.advanceTimersByTimeAsync(8_000)
      const result = await pending

      expectUnreadable(result, 'network')
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns unreadable and does not throw when the client throws', async () => {
    const failure = new Error('storage broken')
    const throwingClient = {
      from: () => {
        throw failure
      },
    } as unknown as AppSupabaseClient

    const result = await getPasswordSetupPending(throwingClient, USER_ID)

    expectUnreadable(result, 'unknown')
    expect(result.error.cause).toBe(failure)
  })
})

// ---------------------------------------------------------------------------------------------
// signOut (decisione A4 4)
// ---------------------------------------------------------------------------------------------

const SCOPES: readonly SignOutScope[] = ['local', 'global', 'others']

/** JWT non firmato con scadenza lontana: sufficiente perché il client lo accetti come sessione. */
function unsignedJwt(): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: USER_ID,
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`
}

const sessionBody = () => ({
  access_token: unsignedJwt(),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'refresh-token',
  user: {
    id: USER_ID,
    aud: 'authenticated',
    email: 'user@example.test',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-08T00:00:00Z',
  },
})

/**
 * Client vero con una sessione salvata nello storage finto. `logout` simula la risposta di
 * `POST /auth/v1/logout`; `events` raccoglie gli eventi Auth emessi dopo il login.
 */
async function signedInClient(logout: () => Promise<Response>) {
  const platform = createFakePlatform()
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input) => {
      const url = requestUrl(input)
      if (url.includes('/auth/v1/token')) return Promise.resolve(response(200, sessionBody()))
      if (url.includes('/auth/v1/logout')) return logout()
      return Promise.resolve(response(200, []))
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  const client = createSupabaseClient({
    url: 'http://127.0.0.1:54321',
    anonKey: 'anon-key',
    storage: platform.secureStorage,
    platform: 'web',
    appVersion: '0.0.0',
  })
  const signIn = await client.auth.signInWithPassword({
    email: 'user@example.test',
    password: 'irrelevant',
  })
  if (signIn.error) throw signIn.error

  const events: string[] = []
  client.auth.onAuthStateChange((event) => {
    events.push(event)
  })
  await vi.waitFor(() => {
    expect(events).toContain('INITIAL_SESSION')
  })
  events.length = 0

  const logoutCalls = () =>
    fetchMock.mock.calls
      .map(([input, init]) => ({ url: new URL(requestUrl(input)), init }))
      .filter(({ url }) => url.pathname === '/auth/v1/logout')

  return { client, platform, events, logoutCalls }
}

const noContent = () => Promise.resolve(new Response(null, { status: 204 }))

describe('signOut: richiesta e conseguenze locali per ogni scope', () => {
  it.each(SCOPES)('sends POST /auth/v1/logout?scope=%s with the access token', async (scope) => {
    const { client, logoutCalls } = await signedInClient(noContent)

    expect(await signOut(client, scope)).toEqual({ status: 'no_error' })

    const calls = logoutCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.searchParams.get('scope')).toBe(scope)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toMatch(/^Bearer /)
  })

  it.each(['local', 'global'] as const)(
    'with %s auth-js removes the local session and emits SIGNED_OUT',
    async (scope) => {
      const { client, platform, events } = await signedInClient(noContent)

      await signOut(client, scope)

      expect(platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(false)
      expect(events).toEqual(['SIGNED_OUT'])
    },
  )

  it('with others keeps the local session and emits no event', async () => {
    const { client, platform, events } = await signedInClient(noContent)
    const before = platform.storageContents.get(AUTH_STORAGE_KEY)

    await signOut(client, 'others')

    expect(platform.storageContents.get(AUTH_STORAGE_KEY)).toBe(before)
    expect(events).toEqual([])
  })

  it.each(SCOPES)(
    'without a session (%s) calls no endpoint and returns no_error',
    async (scope) => {
      const fetchMock = vi.fn(() => noContent())
      vi.stubGlobal('fetch', fetchMock)
      const client = createSupabaseClient({
        url: 'http://127.0.0.1:54321',
        anonKey: 'anon-key',
        storage: createFakePlatform().secureStorage,
        platform: 'web',
        appVersion: '0.0.0',
      })

      expect(await signOut(client, scope)).toEqual({ status: 'no_error' })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})

const IGNORED = [
  { status: 401, code: 'bad_jwt' },
  { status: 403, code: 'user_not_found' },
  { status: 404, code: 'user_not_found' },
] as const

describe('signOut: errori che auth-js 2.117.3 ignora (nessuna conferma della revoca remota)', () => {
  it.each(SCOPES.flatMap((scope) => IGNORED.map((c) => ({ scope, ...c }))))(
    'HTTP $status ($code) with $scope returns no_error',
    async ({ scope, status, code }) => {
      const { client, platform, logoutCalls } = await signedInClient(() =>
        Promise.resolve(response(status, { code, msg: 'server message' })),
      )

      expect(await signOut(client, scope)).toEqual({ status: 'no_error' })
      // La richiesta è partita e il server ha rifiutato, ma l'esito non lo dice: limite documentato.
      expect(logoutCalls()).toHaveLength(1)
      expect(platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(scope === 'others')
    },
  )
})

const RETURNED = [
  {
    label: 'HTTP 400 validation_failed (codice non mappato)',
    reply: () => Promise.resolve(response(400, { code: 'validation_failed', msg: 'bad scope' })),
    code: 'unknown',
  },
  {
    // auth-js 2.117.3 tratta 500–504 e 520–530 come errori di rete (`AuthRetryableFetchError`).
    label: 'HTTP 500',
    reply: () => Promise.resolve(response(500, { code: 'unexpected_failure', msg: 'boom' })),
    code: 'network',
  },
  {
    label: 'HTTP 429',
    reply: () =>
      Promise.resolve(response(429, { code: 'over_request_rate_limit', msg: 'slow down' })),
    code: 'rate_limited',
  },
  {
    label: 'rete assente',
    reply: () => Promise.reject(new TypeError('fetch failed')),
    code: 'network',
  },
] as const

describe('signOut: errori restituiti da auth-js', () => {
  it.each(SCOPES.flatMap((scope) => RETURNED.map((c) => ({ scope, ...c }))))(
    '$label with $scope returns auth_error ($code); auth-js keeps the key only for others',
    async ({ scope, reply, code }) => {
      const { client, platform } = await signedInClient(reply)

      const result = await signOut(client, scope)

      expect(result.status).toBe('auth_error')
      if (result.status === 'auth_error') {
        expect(result.error).toBeInstanceOf(AppError)
        expect(result.error.code).toBe(code)
        expect(result.error.cause).toBeDefined()
      }
      // auth-js tenta comunque la rimozione locale con local/global; con others non tocca la sessione.
      expect(platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(scope === 'others')
    },
  )
})

describe('signOut: eccezioni e scope non validi', () => {
  it('returns exception when auth.signOut throws, without rethrowing', async () => {
    const failure = new Error('lock broken')
    const client = {
      auth: { signOut: () => Promise.reject(failure) },
    } as unknown as AppSupabaseClient

    const result: SignOutResult = await signOut(client, 'local')

    expect(result.status).toBe('exception')
    if (result.status === 'exception') {
      expect(result.error.code).toBe('unknown')
      expect(result.error.cause).toBe(failure)
    }
  })

  it.each([undefined, '', 'all', 'GLOBAL'])(
    'rejects the invalid scope %s without calling Auth (auth-js would fall back to global)',
    async (scope) => {
      const authSignOut = vi.fn(() => Promise.resolve({ error: null }))
      const client = { auth: { signOut: authSignOut } } as unknown as AppSupabaseClient

      const result = await signOut(client, scope as unknown as SignOutScope)

      expect(result.status).toBe('exception')
      if (result.status === 'exception') {
        expect(result.error.code).toBe('unknown')
        expect(result.error.cause).toBeInstanceOf(TypeError)
      }
      expect(authSignOut).not.toHaveBeenCalled()
    },
  )
})

// ---------------------------------------------------------------------------------------------
// setPassword (G.10)
// ---------------------------------------------------------------------------------------------

const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002'
const NEW_PASSWORD = 'nuova-password-di-prova'

type Reply = () => Promise<Response>

interface SetPasswordRoutes {
  /** `GET /auth/v1/user` (verifica di `getUser`). */
  readonly getUser?: Reply
  /** `PUT /auth/v1/user` (`updateUser`). */
  readonly putUser?: Reply
  /** `GET /rest/v1/profiles` (rilettura di `password_setup_pending`). */
  readonly profiles?: Reply
  /** `POST /auth/v1/logout` (`signOut('others')`). */
  readonly logout?: Reply
}

interface SetPasswordClientOptions {
  /** `false`: client senza sessione salvata. */
  readonly signedIn?: boolean
  /** Host del client: client diversi nello stesso test hanno host diversi e risposte separate. */
  readonly host?: string
}

const userBody = (id: unknown = USER_ID) => ({ ...sessionBody().user, id })

/** Errore di GoTrue: con l'header di versione dell'API auth-js legge `code` dal corpo (come GoTrue reale). */
const gotrueError = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  })
const ok =
  (body: unknown): Reply =>
  () =>
    Promise.resolve(response(200, body))
const offline: Reply = () => Promise.reject(new TypeError('fetch failed'))
const notJson =
  (status: number): Reply =>
  () =>
    Promise.resolve(new Response('<html>gateway</html>', { status }))

/** Smistamento per host: un solo `fetch` globale serve tutti i client creati nel test. */
const fetchRoutes = new Map<string, (url: URL, init?: RequestInit) => Promise<Response>>()

afterEach(() => {
  fetchRoutes.clear()
})

/**
 * Client vero, opzionalmente con una sessione salvata, per `setPassword`. `routes` simula le risposte
 * degli endpoint usati da G.10 (default: tutto riuscito, flag `false`); `requests` elenca le richieste
 * di questo client successive al login; `failStorage` fa fallire da quel momento le letture dello
 * storage.
 */
async function setPasswordClient(
  routes: SetPasswordRoutes = {},
  { signedIn = true, host = '127.0.0.1:54321' }: SetPasswordClientOptions = {},
) {
  const platform = createFakePlatform()
  let storageFailure: Error | null = null
  const storage: SecureStorage = {
    getItem: (key) =>
      storageFailure ? Promise.reject(storageFailure) : platform.secureStorage.getItem(key),
    setItem: (key, value) => platform.secureStorage.setItem(key, value),
    removeItem: (key) => platform.secureStorage.removeItem(key),
  }

  const calls = vi.fn<(url: URL, init?: RequestInit) => void>()
  fetchRoutes.set(host, (url, init) => {
    calls(url, init)
    const method = init?.method ?? 'GET'
    if (url.pathname === '/auth/v1/token') return Promise.resolve(response(200, sessionBody()))
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      return (routes.getUser ?? ok(userBody()))()
    }
    if (url.pathname === '/auth/v1/user' && method === 'PUT') {
      return (routes.putUser ?? ok(userBody()))()
    }
    if (url.pathname === '/rest/v1/profiles') {
      return (routes.profiles ?? ok([{ password_setup_pending: false }]))()
    }
    if (url.pathname === '/auth/v1/logout') return (routes.logout ?? noContent)()
    return Promise.reject(new Error(`richiesta inattesa: ${method} ${url.pathname}`))
  })
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(requestUrl(input))
      const route = fetchRoutes.get(url.host)
      if (!route) return Promise.reject(new Error(`host inatteso: ${url.host}`))
      return route(url, init)
    }),
  )

  const client = createSupabaseClient({
    url: `http://${host}`,
    anonKey: 'anon-key',
    storage,
    platform: 'web',
    appVersion: '0.0.0',
  })
  if (signedIn) {
    const signIn = await client.auth.signInWithPassword({
      email: 'user@example.test',
      password: 'irrelevant',
    })
    if (signIn.error) throw signIn.error
  }
  calls.mockClear()

  const requests = () =>
    calls.mock.calls.map(([url, init]) => ({
      method: init?.method ?? 'GET',
      path: url.pathname,
      url,
      init,
    }))
  const putCount = () =>
    requests().filter((r) => r.path === '/auth/v1/user' && r.method === 'PUT').length

  return {
    client,
    platform,
    requests,
    putCount,
    failStorage: (error: Error) => {
      storageFailure = error
    },
  }
}

const run = (client: AppSupabaseClient, expectedUserId = USER_ID) =>
  setPassword(client, { password: NEW_PASSWORD, expectedUserId })

function expectError(
  result: SetPasswordResult,
  status: 'session_missing' | 'update_failed' | 'update_outcome_unknown',
  code: AppErrorCode,
): asserts result is Extract<SetPasswordResult, { status: typeof status }> {
  expect(result.status).toBe(status)
  if (!('error' in result)) return
  expect(result.error).toBeInstanceOf(AppError)
  expect(result.error.code).toBe(code)
}

function expectVerificationFailed(
  result: SetPasswordResult,
  reason: 'server_rejected' | 'request_failed' | 'exception',
  code: AppErrorCode,
): asserts result is Extract<SetPasswordResult, { status: 'verification_failed' }> {
  expect(result.status).toBe('verification_failed')
  if (result.status !== 'verification_failed') return
  expect(result.reason).toBe(reason)
  expect(result.error).toBeInstanceOf(AppError)
  expect(result.error.code).toBe(code)
}

describe('setPassword: successo', () => {
  it('sends GET user, PUT user, GET profiles and POST logout?scope=others in this order', async () => {
    const { client, platform, requests } = await setPasswordClient()

    expect(await run(client)).toEqual({ status: 'changed' })

    const sent = requests()
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /auth/v1/user',
      'PUT /auth/v1/user',
      'GET /rest/v1/profiles',
      'POST /auth/v1/logout',
    ])
    for (const request of sent) {
      expect(new Headers(request.init?.headers).get('authorization')).toMatch(/^Bearer /)
    }
    const putBody = sent[1]?.init?.body
    expect(typeof putBody).toBe('string')
    expect(JSON.parse(typeof putBody === 'string' ? putBody : '')).toMatchObject({
      password: NEW_PASSWORD,
    })
    expect([...(sent[2]?.url.searchParams.entries() ?? [])]).toEqual([
      ['select', 'password_setup_pending'],
      ['id', `eq.${USER_ID}`],
    ])
    expect(sent[3]?.url.searchParams.get('scope')).toBe('others')
    // `others` conserva la sessione corrente (auth-js la riscrive dopo `updateUser`).
    expect(platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(true)
  })
})

describe('setPassword: verifica con getUser fallita, nessuna PUT /auth/v1/user', () => {
  it('returns session_missing without any request when there is no session', async () => {
    const { client, requests } = await setPasswordClient({}, { signedIn: false })

    expectError(await run(client), 'session_missing', 'unauthenticated')
    expect(requests()).toEqual([])
  })

  it('returns session_missing when GoTrue answers session_not_found', async () => {
    const { client, putCount } = await setPasswordClient({
      getUser: () =>
        Promise.resolve(gotrueError(403, { code: 'session_not_found', msg: 'session gone' })),
    })

    expectError(await run(client), 'session_missing', 'unauthenticated')
    expect(putCount()).toBe(0)
  })

  it.each([
    ['user_not_found', 403],
    ['bad_jwt', 401],
  ] as const)('returns verification_failed (server_rejected) for %s', async (code, status) => {
    const { client, putCount } = await setPasswordClient({
      getUser: () => Promise.resolve(gotrueError(status, { code, msg: 'rejected' })),
    })

    const result = await run(client)

    expectVerificationFailed(result, 'server_rejected', 'unauthenticated')
    expect(result.error.cause).toMatchObject({ code, status })
    expect(putCount()).toBe(0)
  })

  it.each([
    { label: 'rete assente', reply: offline, code: 'network' },
    {
      label: 'HTTP 500',
      reply: () => Promise.resolve(gotrueError(500, { code: 'unexpected_failure', msg: 'boom' })),
      code: 'network',
    },
    {
      label: 'HTTP 429',
      reply: () =>
        Promise.resolve(gotrueError(429, { code: 'over_request_rate_limit', msg: 'slow down' })),
      code: 'rate_limited',
    },
    { label: 'HTTP 200 con JSON non valido', reply: notJson(200), code: 'network' },
    {
      label: 'HTTP 400 con JSON non valido (AuthUnknownError)',
      reply: notJson(400),
      code: 'unknown',
    },
    {
      label: 'HTTP 400 senza codice',
      reply: () => Promise.resolve(gotrueError(400, { msg: 'bad request' })),
      code: 'unknown',
    },
  ] as const)(
    'returns verification_failed (request_failed) for $label',
    async ({ reply, code }) => {
      const { client, putCount } = await setPasswordClient({ getUser: reply })

      const result = await run(client)

      expectVerificationFailed(result, 'request_failed', code)
      expect(result.error.cause).toBeDefined()
      expect(putCount()).toBe(0)
    },
  )

  it.each([
    ['without id', { email: 'user@example.test' }],
    ['with a numeric id', userBody(42)],
  ] as const)(
    'returns verification_failed (request_failed, unknown) for a user %s',
    async (_label, body) => {
      const { client, putCount } = await setPasswordClient({ getUser: ok(body) })

      const result = await run(client)

      expectVerificationFailed(result, 'request_failed', 'unknown')
      expect(result.error.cause).toMatchObject({ email: 'user@example.test' })
      expect(putCount()).toBe(0)
    },
  )

  it('returns verification_failed (request_failed, unknown) when getUser returns no user', async () => {
    const { client, putCount } = await setPasswordClient()
    vi.spyOn(client.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: null,
    } as unknown as Awaited<ReturnType<AppSupabaseClient['auth']['getUser']>>)

    const result = await run(client)

    expectVerificationFailed(result, 'request_failed', 'unknown')
    expect(result.error.cause).toBeNull()
    expect(putCount()).toBe(0)
  })

  it('returns verification_failed (exception) when the storage throws', async () => {
    const { client, putCount, failStorage } = await setPasswordClient()
    const failure = new Error('storage broken')
    failStorage(failure)

    const result = await run(client)

    expectVerificationFailed(result, 'exception', 'unknown')
    expect(result.error.cause).toBe(failure)
    expect(putCount()).toBe(0)
  })

  it('returns verification_failed (exception) when getUser throws', async () => {
    const { client, putCount } = await setPasswordClient()
    const failure = new Error('getUser broken')
    vi.spyOn(client.auth, 'getUser').mockRejectedValue(failure)

    const result = await run(client)

    expectVerificationFailed(result, 'exception', 'unknown')
    expect(result.error.cause).toBe(failure)
    expect(putCount()).toBe(0)
  })

  it('returns user_mismatch when the server returns another user', async () => {
    const { client, putCount } = await setPasswordClient({ getUser: ok(userBody(OTHER_USER_ID)) })

    expect(await run(client)).toEqual({ status: 'user_mismatch' })
    expect(putCount()).toBe(0)
  })

  it('compares the id strictly (no case folding or trimming)', async () => {
    const { client, putCount } = await setPasswordClient()

    expect(await run(client, ` ${USER_ID.toUpperCase()}`)).toEqual({ status: 'user_mismatch' })
    expect(putCount()).toBe(0)
  })
})

const afterPut = (requests: () => readonly { path: string }[]) =>
  requests().filter((r) => r.path === '/rest/v1/profiles' || r.path === '/auth/v1/logout')

describe('setPassword: updateUser rifiutato in modo esplicito (update_failed)', () => {
  it.each([
    {
      label: 'HTTP 422 weak_password',
      reply: () =>
        Promise.resolve(
          gotrueError(422, {
            code: 'weak_password',
            msg: 'weak',
            weak_password: { reasons: ['length'] },
          }),
        ),
      code: 'weak_password',
    },
    {
      label: 'HTTP 422 same_password (altro 4xx)',
      reply: () => Promise.resolve(gotrueError(422, { code: 'same_password', msg: 'same' })),
      code: 'unknown',
    },
    {
      label: 'HTTP 429',
      reply: () =>
        Promise.resolve(gotrueError(429, { code: 'over_request_rate_limit', msg: 'slow down' })),
      code: 'rate_limited',
    },
    {
      label: 'HTTP 403 session_not_found',
      reply: () => Promise.resolve(gotrueError(403, { code: 'session_not_found', msg: 'gone' })),
      code: 'unauthenticated',
    },
  ] as const)('$label returns update_failed ($code)', async ({ reply, code }) => {
    const { client, requests, putCount } = await setPasswordClient({ putUser: reply })

    expectError(await run(client), 'update_failed', code)
    expect(putCount()).toBe(1)
    expect(afterPut(requests)).toEqual([])
  })

  it('returns update_failed when updateUser reports a missing session (no request sent)', async () => {
    const { client, requests } = await setPasswordClient()
    vi.spyOn(client.auth, 'updateUser').mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    })

    expectError(await run(client), 'update_failed', 'unauthenticated')
    expect(afterPut(requests)).toEqual([])
  })
})

describe('setPassword: esito di updateUser incerto (update_outcome_unknown)', () => {
  it.each([
    { label: 'rete assente', reply: offline, code: 'network' },
    ...([500, 502, 503] as const).map((status) => ({
      label: `HTTP ${String(status)}`,
      reply: () =>
        Promise.resolve(gotrueError(status, { code: 'unexpected_failure', msg: 'boom' })),
      code: 'network' as const,
    })),
    {
      label: 'HTTP 505 (AuthApiError con status >= 500)',
      reply: () => Promise.resolve(gotrueError(505, { code: 'unexpected_failure', msg: 'boom' })),
      code: 'unknown',
    },
    { label: 'HTTP 200 non JSON', reply: notJson(200), code: 'network' },
    { label: 'HTTP 400 non JSON (AuthUnknownError)', reply: notJson(400), code: 'unknown' },
  ] as const)('$label returns update_outcome_unknown ($code)', async ({ reply, code }) => {
    const { client, requests, putCount } = await setPasswordClient({ putUser: reply })

    expectError(await run(client), 'update_outcome_unknown', code)
    expect(putCount()).toBe(1)
    expect(afterPut(requests)).toEqual([])
  })

  it('returns update_outcome_unknown when updateUser throws', async () => {
    const { client, requests } = await setPasswordClient()
    const failure = new Error('updateUser broken')
    vi.spyOn(client.auth, 'updateUser').mockRejectedValue(failure)

    const result = await run(client)

    expectError(result, 'update_outcome_unknown', 'unknown')
    expect(result.error.cause).toBe(failure)
    expect(afterPut(requests)).toEqual([])
  })
})

describe('setPassword: passi dopo il cambio, mai un fallimento', () => {
  it.each([
    ['pending', ok([{ password_setup_pending: true }]), { status: 'pending' }],
    ['profile_missing', ok([]), { status: 'profile_missing' }],
  ] as const)(
    'returns changed_with_warnings when the reread gives %s, and still signs out the others',
    async (_label, profiles, passwordSetup) => {
      const { client, requests } = await setPasswordClient({ profiles })

      expect(await run(client)).toEqual({
        status: 'changed_with_warnings',
        passwordSetup,
        signOutOthers: { status: 'no_error' },
      })
      expect(requests().filter((r) => r.path === '/auth/v1/logout')).toHaveLength(1)
    },
  )

  it('returns changed_with_warnings when the reread is unreadable (network), and still signs out', async () => {
    const { client, requests } = await setPasswordClient({ profiles: offline })
    // postgrest-js ripete la GET fallita per rete (attese 1/2/4 s): orologio simulato.
    vi.useFakeTimers()
    try {
      const pending = run(client)
      // Non `runAllTimersAsync`: il ticker di auto-refresh di auth-js non finirebbe mai.
      await vi.advanceTimersByTimeAsync(8_000)
      const result = await pending

      expect(result.status).toBe('changed_with_warnings')
      if (result.status === 'changed_with_warnings') {
        expectUnreadable(result.passwordSetup, 'network')
        expect(result.signOutOthers).toEqual({ status: 'no_error' })
      }
      expect(requests().filter((r) => r.path === '/rest/v1/profiles')).toHaveLength(4)
      expect(requests().filter((r) => r.path === '/auth/v1/logout')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns changed_with_warnings when signOut others returns an error (HTTP 500)', async () => {
    const { client, platform } = await setPasswordClient({
      logout: () => Promise.resolve(gotrueError(500, { code: 'unexpected_failure', msg: 'boom' })),
    })

    const result = await run(client)

    expect(result.status).toBe('changed_with_warnings')
    if (result.status === 'changed_with_warnings') {
      expect(result.passwordSetup).toEqual({ status: 'completed' })
      expect(result.signOutOthers.status).toBe('auth_error')
      if (result.signOutOthers.status === 'auth_error') {
        expect(result.signOutOthers.error.code).toBe('network')
      }
    }
    expect(platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(true)
  })

  it('returns changed_with_warnings when signOut others throws', async () => {
    const { client } = await setPasswordClient()
    const failure = new Error('signOut broken')
    const authSignOut = vi.spyOn(client.auth, 'signOut').mockRejectedValue(failure)

    const result = await run(client)

    expect(result.status).toBe('changed_with_warnings')
    if (result.status === 'changed_with_warnings') {
      expect(result.passwordSetup).toEqual({ status: 'completed' })
      expect(result.signOutOthers.status).toBe('exception')
      if (result.signOutOthers.status === 'exception') {
        expect(result.signOutOthers.error.cause).toBe(failure)
      }
    }
    expect(authSignOut).toHaveBeenCalledWith({ scope: 'others' })
  })
})

/** Risposta controllata dal test: resta in sospeso finché non si chiama `release`. */
function deferredReply(body: unknown) {
  const resolvers: ((value: Response) => void)[] = []
  const reply: Reply = () =>
    new Promise<Response>((resolve) => {
      resolvers.push(resolve)
    })
  const release = () => {
    for (const resolve of resolvers.splice(0)) resolve(response(200, body))
  }
  return { reply, release }
}

describe('setPassword: concorrenza per istanza di client', () => {
  it('returns already_running for a second call on the same client, without new requests', async () => {
    const gate = deferredReply(userBody())
    const { client, requests } = await setPasswordClient({ getUser: gate.reply })

    const first = run(client)
    await vi.waitFor(() => {
      expect(requests()).toHaveLength(1)
    })

    expect(await run(client)).toEqual({ status: 'already_running' })
    expect(requests()).toHaveLength(1)

    gate.release()
    expect(await first).toEqual({ status: 'changed' })
  })

  it('accepts a new call after a successful one', async () => {
    const { client, putCount } = await setPasswordClient()

    expect(await run(client)).toEqual({ status: 'changed' })
    expect(await run(client)).toEqual({ status: 'changed' })
    expect(putCount()).toBe(2)
  })

  it('releases the lock after a failed verification', async () => {
    let failNext = true
    const { client, putCount } = await setPasswordClient({
      getUser: () => {
        if (!failNext) return Promise.resolve(response(200, userBody()))
        failNext = false
        return Promise.resolve(gotrueError(500, { code: 'unexpected_failure', msg: 'boom' }))
      },
    })

    expectVerificationFailed(await run(client), 'request_failed', 'network')
    expect(await run(client)).toEqual({ status: 'changed' })
    expect(putCount()).toBe(1)
  })

  it('releases the lock after an exception', async () => {
    const { client, putCount } = await setPasswordClient()
    vi.spyOn(client.auth, 'getUser').mockRejectedValueOnce(new Error('getUser broken'))

    expectVerificationFailed(await run(client), 'exception', 'unknown')
    expect(await run(client)).toEqual({ status: 'changed' })
    expect(putCount()).toBe(1)
  })

  it('does not block different clients running in parallel', async () => {
    const gateA = deferredReply(userBody())
    const gateB = deferredReply(userBody())
    const a = await setPasswordClient({ getUser: gateA.reply }, { host: '127.0.0.1:54321' })
    const b = await setPasswordClient({ getUser: gateB.reply }, { host: '127.0.0.2:54321' })

    const first = run(a.client)
    const second = run(b.client)
    // Entrambe le verifiche sono partite mentre l'altra è ancora in sospeso.
    await vi.waitFor(() => {
      expect(a.requests()).toHaveLength(1)
      expect(b.requests()).toHaveLength(1)
    })
    gateA.release()
    gateB.release()

    expect(await Promise.all([first, second])).toEqual([
      { status: 'changed' },
      { status: 'changed' },
    ])
    expect(a.putCount()).toBe(1)
    expect(b.putCount()).toBe(1)
  })
})
