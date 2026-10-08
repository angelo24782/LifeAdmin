import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakePlatform } from '@/platform/fake'

import { AUTH_STORAGE_KEY, createSupabaseClient } from './supabaseClient'

afterEach(() => {
  vi.unstubAllGlobals()
})

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/** Simula il backend: risposta di sessione per il login, lista vuota per le altre richieste. */
function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(
      requestUrl(input).includes('/auth/v1/token')
        ? json({
            access_token: unsignedJwt(),
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: 'refresh-token',
            user: {
              id: '00000000-0000-4000-8000-000000000000',
              aud: 'authenticated',
              email: 'user@example.test',
              app_metadata: {},
              user_metadata: {},
              created_at: '2026-10-08T00:00:00Z',
            },
          })
        : json([]),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('createSupabaseClient', () => {
  it('sends the app version and platform headers on every request', async () => {
    const fetchMock = stubFetch()
    const client = createSupabaseClient({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon-key',
      storage: createFakePlatform().secureStorage,
      platform: 'ios',
      appVersion: '1.2.3',
    })

    await client.from('categories').select('id')

    // supabase-js invoca fetch(url, init): `init.headers` è un oggetto `Headers`.
    const [, request] = fetchMock.mock.calls[0] as unknown as [unknown, { headers: Headers }]
    expect(request.headers.get('x-app-version')).toBe('1.2.3')
    expect(request.headers.get('x-app-platform')).toBe('ios')
    expect(request.headers.get('apikey')).toBe('anon-key')
  })

  it('persists the session in the injected storage under the documented key', async () => {
    stubFetch()
    const platform = createFakePlatform()
    const client = createSupabaseClient({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon-key',
      storage: platform.secureStorage,
      platform: 'web',
      appVersion: '0.0.0',
    })

    const { error } = await client.auth.signInWithPassword({
      email: 'user@example.test',
      password: 'irrelevant',
    })

    expect(error).toBeNull()
    expect(platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(true)
    expect(platform.storageContents.get(AUTH_STORAGE_KEY)).toContain('refresh-token')
    expect(platform.storageContents.get(AUTH_STORAGE_KEY)).not.toContain('irrelevant')
  })
})

/** JWT non firmato con scadenza lontana: sufficiente perché il client lo accetti come sessione. */
function unsignedJwt(): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: '00000000-0000-4000-8000-000000000000',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`
}
