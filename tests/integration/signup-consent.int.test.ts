import { randomUUID } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { createAdminClient, PRIVACY_VERSION } from './support'

// Consenso privacy attraverso Supabase Auth reale: la creazione dell'utente e l'attivazione del
// profilo sono atomiche; senza consenso valido l'utente non viene creato.
describe('registrazione e consenso privacy (Supabase Auth reale)', () => {
  const admin = createAdminClient()
  const createdIds: string[] = []

  afterEach(async () => {
    for (const id of createdIds.splice(0)) await admin.auth.admin.deleteUser(id)
  })

  const newEmail = (label: string) => `m2-consent-${label}-${randomUUID()}@example.test`

  async function userExists(email: string): Promise<boolean> {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    return data.users.some((u) => u.email === email)
  }

  it('metadata assenti: registrazione rifiutata e nessun utente creato', async () => {
    const email = newEmail('none')

    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true })

    expect(error).not.toBeNull()
    expect(await userExists(email)).toBe(false)
  })

  it('versione non supportata: registrazione rifiutata e nessun utente creato', async () => {
    const email = newEmail('old')

    const { error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { privacy_version: '1999-01-01' },
    })

    expect(error).not.toBeNull()
    expect(await userExists(email)).toBe(false)
  })

  it('versione supportata: profilo creato con timestamp generato dal database', async () => {
    const before = Date.now()
    const { data, error } = await admin.auth.admin.createUser({
      email: newEmail('ok'),
      email_confirm: true,
      // Il timestamp fornito dal client deve essere ignorato.
      user_metadata: {
        privacy_version: PRIVACY_VERSION,
        privacy_accepted_at: '2000-01-01T00:00:00Z',
      },
    })
    expect(error).toBeNull()
    const id = data.user?.id ?? ''
    createdIds.push(id)

    const profile = await admin
      .from('profiles')
      .select('privacy_version, privacy_accepted_at')
      .eq('id', id)
      .single()

    expect(profile.data?.privacy_version).toBe(PRIVACY_VERSION)
    const acceptedAt = new Date(profile.data?.privacy_accepted_at ?? 0).getTime()
    expect(acceptedAt).toBeGreaterThanOrEqual(before - 5_000)
    expect(acceptedAt).toBeLessThanOrEqual(Date.now() + 5_000)
  })
})
