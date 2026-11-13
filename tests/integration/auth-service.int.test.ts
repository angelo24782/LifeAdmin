import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { getPasswordSetupPending } from '@/features/auth/service'

import { SUBJECT_CONFIRMATION, waitForMail } from './mail'
import { createAdminClient, createAnonClient, PRIVACY_VERSION } from './support'

// A4 · `getPasswordSetupPending` (SPECIFICA §20 M3, decisione A4 3) con GoTrue, PostgREST, RLS e Mailpit
// REALI. Utenti e password sono generati a runtime e rimossi a fine test.
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

    // `setPassword` (G.10) non esiste ancora: si usa direttamente la chiamata Auth che lo farà.
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
