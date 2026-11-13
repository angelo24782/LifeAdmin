import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakePlatform } from '@/platform/fake'
import { AppError, type AppErrorCode } from '@/shared/lib/errors'
import { createSupabaseClient, type AppSupabaseClient } from '@/shared/lib/supabaseClient'

import { getPasswordSetupPending, type PasswordSetupPendingResult } from './service'

/**
 * `getPasswordSetupPending` (SPECIFICA §20 M3, decisione A4 3). Il client è quello vero
 * (`createSupabaseClient`, supabase-js 2.117.3): si simula solo la rete, così il test verifica anche
 * la richiesta inviata a PostgREST (colonna e filtro). Il comportamento con PostgREST, GoTrue e RLS
 * reali è in `tests/integration/auth-service.int.test.ts`.
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
