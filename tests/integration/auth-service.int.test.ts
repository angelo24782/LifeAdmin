import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { getPasswordSetupPending, setPassword, signOut } from '@/features/auth/service'
import { createFakePlatform } from '@/platform/fake'
import { AUTH_STORAGE_KEY, createSupabaseClient } from '@/shared/lib/supabaseClient'

import { SUBJECT_CONFIRMATION, waitForMail } from './mail'
import {
  anonKey,
  createAdminClient,
  createAnonClient,
  PRIVACY_VERSION,
  supabaseUrl,
} from './support'

// A4 · service di autenticazione (SPECIFICA §20 M3): `getPasswordSetupPending` (decisione A4 3),
// `signOut` (decisione A4 4) e `setPassword` (G.10) con GoTrue, PostgREST, RLS e Mailpit REALI. Utenti e password sono
// generati a runtime e rimossi a fine test.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const admin = createAdminClient()
const userIds = new Set<string>()
const newPassword = () => `${randomUUID()}${randomUUID()}`
const newEmail = (label: string) => `a4-${label}-${randomUUID()}@example.test`

/** Registrazione e conferma con il codice: il trigger azzera la password e porta il flag a `true`. */
async function signUpAndConfirm(label: string) {
  const email = newEmail(label)
  const client = createAnonClient()
  const signUp = await client.auth.signUp({
    email,
    password: newPassword(),
    options: { data: { privacy_version: PRIVACY_VERSION } },
  })
  if (signUp.error) throw signUp.error
  if (!signUp.data.user) throw new Error('signUp: nessun utente restituito')
  const userId = signUp.data.user.id
  userIds.add(userId)

  const mail = await waitForMail(email, SUBJECT_CONFIRMATION)
  const verify = await client.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })
  if (verify.error) throw verify.error
  if (!verify.data.session) throw new Error('verifyOtp: nessuna sessione')
  return { userId, client }
}

/** Utente creato dall'amministratore (password valorizzata, flag `false`) con un client autenticato. */
async function createConfirmedUser(label: string) {
  const email = newEmail(label)
  const password = newPassword()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { privacy_version: PRIVACY_VERSION },
  })
  if (error || !data.user) throw error ?? new Error('createUser fallita')
  userIds.add(data.user.id)
  const client = createAnonClient()
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { userId: data.user.id, client }
}

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
})

describe('getPasswordSetupPending con Supabase reale', () => {
  it('returns pending after the confirmation and completed after updateUser({ password })', async () => {
    const { userId, client } = await signUpAndConfirm('flow')

    expect(await getPasswordSetupPending(client, userId)).toEqual({ status: 'pending' })

    // Chiamata Auth diretta: isola la lettura del flag da `setPassword` (provata più sotto).
    const update = await client.auth.updateUser({ password: newPassword() })
    expect(update.error).toBeNull()

    expect(await getPasswordSetupPending(client, userId)).toEqual({ status: 'completed' })
  })

  it('returns completed for a user created by the administrator', async () => {
    const { userId, client } = await createConfirmedUser('admin')

    expect(await getPasswordSetupPending(client, userId)).toEqual({ status: 'completed' })
  })

  it('returns unreadable without a session (anon), never completed', async () => {
    const { userId } = await createConfirmedUser('anon')

    const result = await getPasswordSetupPending(createAnonClient(), userId)

    expect(result.status).toBe('unreadable')
    if (result.status === 'unreadable') expect(result.error.code).toBe('forbidden')
  })

  it("returns profile_missing when reading another user's id (RLS hides the row)", async () => {
    // Ipotesi della SPECIFICA da dimostrare, non comportamento dato per acquisito.
    const reader = await createConfirmedUser('reader')
    const other = await signUpAndConfirm('other')

    expect(await getPasswordSetupPending(reader.client, other.userId)).toEqual({
      status: 'profile_missing',
    })
    // Controllo: il proprietario vede invece la propria riga.
    expect(await getPasswordSetupPending(other.client, other.userId)).toEqual({
      status: 'pending',
    })
  })
})

/** Client dell'app con storage ispezionabile, autenticato con email e password. */
async function signedInClient(email: string, password: string) {
  const platform = createFakePlatform()
  const client = createSupabaseClient({
    url: supabaseUrl(),
    anonKey: anonKey(),
    storage: platform.secureStorage,
    platform: 'web',
    appVersion: 'integration-test',
  })
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { client, platform }
}

/** Stesso utente con due sessioni: A (quella che esegue `signOut`) e B (un altro dispositivo). */
async function userWithTwoSessions(label: string) {
  const email = newEmail(label)
  const password = newPassword()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { privacy_version: PRIVACY_VERSION },
  })
  if (error || !data.user) throw error ?? new Error('createUser fallita')
  userIds.add(data.user.id)
  const a = await signedInClient(email, password)
  const b = await signedInClient(email, password)
  return { userId: data.user.id, a, b }
}

describe('signOut con GoTrue reale (caratterizzazione auth-js 2.117.3, solo locale)', () => {
  it('local: ends only the current session; the other session can still refresh', async () => {
    const { a, b } = await userWithTwoSessions('local')

    expect(await signOut(a.client, 'local')).toEqual({ status: 'no_error' })

    expect(a.platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(false)
    const refreshB = await b.client.auth.refreshSession()
    expect(refreshB.error).toBeNull()
    expect(refreshB.data.session).not.toBeNull()
  })

  it('global: ends the current session and revokes the refresh token of the others', async () => {
    const { userId, a, b } = await userWithTwoSessions('global')

    expect(await signOut(a.client, 'global')).toEqual({ status: 'no_error' })

    expect(a.platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(false)
    // L'access token già emesso a B resta valido fino a `exp` (Decisione A4 4): la lettura passa.
    expect(await getPasswordSetupPending(b.client, userId)).toEqual({ status: 'completed' })
    // Il refresh token di B invece è revocato.
    const refreshB = await b.client.auth.refreshSession()
    expect(refreshB.error).not.toBeNull()
    expect(refreshB.data.session).toBeNull()
  })

  it('others: keeps the current session and revokes the refresh token of the others', async () => {
    const { userId, a, b } = await userWithTwoSessions('others')
    const storedBefore = a.platform.storageContents.get(AUTH_STORAGE_KEY)

    expect(await signOut(a.client, 'others')).toEqual({ status: 'no_error' })

    expect(a.platform.storageContents.get(AUTH_STORAGE_KEY)).toBe(storedBefore)
    expect((await a.client.auth.getUser()).data.user?.id).toBe(userId)
    const refreshA = await a.client.auth.refreshSession()
    expect(refreshA.error).toBeNull()

    const refreshB = await b.client.auth.refreshSession()
    expect(refreshB.error).not.toBeNull()
    expect(refreshB.data.session).toBeNull()
  })

  it.each(['local', 'others'] as const)(
    'returns no_error with %s even when the server rejects the logout (user deleted)',
    async (scope) => {
      // auth-js ignora 401/403/404: `no_error` non certifica la revoca remota (Decisione A4 4).
      const { userId, a } = await userWithTwoSessions(`deleted-${scope}`)
      await admin.auth.admin.deleteUser(userId)
      userIds.delete(userId)

      expect(await signOut(a.client, scope)).toEqual({ status: 'no_error' })
      expect(a.platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(scope === 'others')
    },
  )
})

/** Utente confermato creato dall'amministratore, con email e password note (generate a runtime). */
async function createUserWithCredentials(label: string) {
  const email = newEmail(label)
  const password = newPassword()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { privacy_version: PRIVACY_VERSION },
  })
  if (error || !data.user) throw error ?? new Error('createUser fallita')
  userIds.add(data.user.id)
  return { userId: data.user.id, email, password }
}

/** Esito di un login con email e password su un client nuovo (`true` se riuscito). */
async function canSignIn(email: string, password: string) {
  const { error } = await createAnonClient().auth.signInWithPassword({ email, password })
  return error === null
}

/** Email dell'utente, letta con l'amministratore (per gli utenti registrati con `signUpAndConfirm`). */
async function emailOf(userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user.email) throw error ?? new Error('getUserById: email assente')
  return data.user.email
}

/**
 * Conta le richieste `PUT /auth/v1/user` (cioè `updateUser`) inviate durante `action`. supabase-js
 * risolve il `fetch` globale a ogni richiesta, quindi la spia vede anche le chiamate di auth-js.
 */
async function countUpdateUserRequests(action: () => Promise<unknown>) {
  let puts = 0
  const original = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method.toUpperCase() === 'PUT' && new URL(url).pathname === '/auth/v1/user') puts += 1
    return original(input, init)
  })
  try {
    await action()
  } finally {
    spy.mockRestore()
  }
  return puts
}

describe('setPassword con GoTrue reale (caratterizzazione auth-js 2.117.3, solo locale)', () => {
  it('changes the password after the confirmation flow: flag completed, login with the new one', async () => {
    const { userId, client } = await signUpAndConfirm('setpw-flow')
    expect(await getPasswordSetupPending(client, userId)).toEqual({ status: 'pending' })
    const password = newPassword()

    expect(await setPassword(client, { password, expectedUserId: userId })).toEqual({
      status: 'changed',
    })

    expect(await getPasswordSetupPending(client, userId)).toEqual({ status: 'completed' })
    expect(await canSignIn(await emailOf(userId), password)).toBe(true)
  })

  it('keeps the current session and revokes the other one; only the new password works', async () => {
    const { userId, email, password: oldPassword } = await createUserWithCredentials('setpw-two')
    const a = await signedInClient(email, oldPassword)
    const b = await signedInClient(email, oldPassword)
    const password = newPassword()

    expect(await setPassword(a.client, { password, expectedUserId: userId })).toEqual({
      status: 'changed',
    })

    // A: sessione corrente conservata e ancora rinnovabile.
    expect(a.platform.storageContents.has(AUTH_STORAGE_KEY)).toBe(true)
    expect((await a.client.auth.getUser()).data.user?.id).toBe(userId)
    const refreshA = await a.client.auth.refreshSession()
    expect(refreshA.error).toBeNull()
    expect(refreshA.data.session).not.toBeNull()
    // B: refresh token revocato.
    const refreshB = await b.client.auth.refreshSession()
    expect(refreshB.error).not.toBeNull()
    expect(refreshB.data.session).toBeNull()

    expect(await canSignIn(email, oldPassword)).toBe(false)
    expect(await canSignIn(email, password)).toBe(true)
  })

  it('returns user_mismatch for another expectedUserId and never calls updateUser', async () => {
    const { email, password: oldPassword } = await createUserWithCredentials('setpw-mismatch')
    const { client } = await signedInClient(email, oldPassword)
    const password = newPassword()

    let result: unknown
    const puts = await countUpdateUserRequests(async () => {
      result = await setPassword(client, { password, expectedUserId: randomUUID() })
    })

    expect(result).toEqual({ status: 'user_mismatch' })
    expect(puts).toBe(0)
    expect(await canSignIn(email, oldPassword)).toBe(true)
    expect(await canSignIn(email, password)).toBe(false)
  })

  it('returns update_failed (weak_password) for a password GoTrue rejects; the old one still works', async () => {
    const { userId, email, password: oldPassword } = await createUserWithCredentials('setpw-weak')
    const { client } = await signedInClient(email, oldPassword)
    // `minimum_password_length = 10` in supabase/config.toml, nessun altro requisito: 9 caratteri.
    const weak = randomUUID().replaceAll('-', '').slice(0, 9)

    const result = await setPassword(client, { password: weak, expectedUserId: userId })

    expect(result.status).toBe('update_failed')
    if (result.status === 'update_failed') expect(result.error.code).toBe('weak_password')
    expect(await canSignIn(email, oldPassword)).toBe(true)
    expect(await canSignIn(email, weak)).toBe(false)
  })

  it('returns session_missing after a local signOut; nothing changes', async () => {
    const { userId, email, password: oldPassword } = await createUserWithCredentials('setpw-nosess')
    const { client } = await signedInClient(email, oldPassword)
    expect(await signOut(client, 'local')).toEqual({ status: 'no_error' })
    const password = newPassword()

    let result: unknown
    const puts = await countUpdateUserRequests(async () => {
      result = await setPassword(client, { password, expectedUserId: userId })
    })

    expect(result).toMatchObject({ status: 'session_missing' })
    expect(puts).toBe(0)
    expect(await canSignIn(email, oldPassword)).toBe(true)
    expect(await canSignIn(email, password)).toBe(false)
  })

  it('does not change anything for a user deleted by the administrator (session still in the client)', async () => {
    const {
      userId,
      email,
      password: oldPassword,
    } = await createUserWithCredentials('setpw-deleted')
    const { client } = await signedInClient(email, oldPassword)
    await admin.auth.admin.deleteUser(userId)
    userIds.delete(userId)

    let result: Awaited<ReturnType<typeof setPassword>> | undefined
    const puts = await countUpdateUserRequests(async () => {
      result = await setPassword(client, { password: newPassword(), expectedUserId: userId })
    })

    // Esito osservato con GoTrue locale (2026-11-19): `getUser` → AuthApiError 403 `user_not_found`.
    expect(result?.status).toBe('verification_failed')
    if (result?.status === 'verification_failed') {
      expect(result.reason).toBe('server_rejected')
      expect(result.error.code).toBe('unauthenticated')
      expect(result.error.cause).toMatchObject({ status: 403, code: 'user_not_found' })
    }
    expect(puts).toBe(0)
  })

  it('returns already_running for a second parallel call on the same client, then releases the lock', async () => {
    const { userId, email, password: oldPassword } = await createUserWithCredentials('setpw-race')
    const { client } = await signedInClient(email, oldPassword)
    const first = newPassword()
    const second = newPassword()

    const results = await Promise.all([
      setPassword(client, { password: first, expectedUserId: userId }),
      setPassword(client, { password: second, expectedUserId: userId }),
    ])

    expect(results).toEqual([{ status: 'changed' }, { status: 'already_running' }])
    expect(await canSignIn(email, first)).toBe(true)
    expect(await canSignIn(email, second)).toBe(false)

    const third = newPassword()
    expect(await setPassword(client, { password: third, expectedUserId: userId })).toEqual({
      status: 'changed',
    })
    expect(await canSignIn(email, third)).toBe(true)
  })
})
