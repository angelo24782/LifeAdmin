import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakePlatform } from '@/platform/fake'
import { AppError, type AppErrorCode } from '@/shared/lib/errors'
import {
  AUTH_STORAGE_KEY,
  createSupabaseClient,
  type AppSupabaseClient,
} from '@/shared/lib/supabaseClient'

import {
  getPasswordSetupPending,
  signOut,
  type PasswordSetupPendingResult,
  type SignOutResult,
  type SignOutScope,
} from './service'

/**
 * Service A4 (SPECIFICA §20 M3): `getPasswordSetupPending` (decisione A4 3) e `signOut` (decisione
 * A4 4). Il client è quello vero (`createSupabaseClient`, supabase-js 2.117.3): si simula solo la
 * rete, così il test verifica anche le richieste inviate a PostgREST e a GoTrue. Il comportamento con
 * PostgREST, GoTrue e RLS reali è in `tests/integration/auth-service.int.test.ts`.
 */

const USER_ID = '00000000-0000-4000-8000-000000000001'

afterEach(() => {
  vi.unstubAllGlobals()
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
