import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { createFakePlatform } from '@/platform/fake'
import { createSupabaseClient, type AppSupabaseClient } from '@/shared/lib/supabaseClient'

import { sql } from './db'
import { SUBJECT_CONFIRMATION, SUBJECT_RECOVERY, waitForMail } from './mail'
import {
  anonKey,
  createAdminClient,
  createAnonClient,
  PRIVACY_VERSION,
  supabaseUrl,
} from './support'

// M3 · protezione dal pre-hijacking (SPECIFICA §23.12) con Supabase Auth REALE (GoTrue, Mailpit, PostgREST):
// V1 (codice), V2 (link), V3 (gara di polling), V4 (recovery su account non confermato), stato
// `profiles.password_setup_pending`, fail-closed, privilegi, sessioni. Nessun mock e nessuna credenziale
// nel repository: utenti e password sono generati a runtime e rimossi a fine test.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const admin = createAdminClient()
const userIds = new Set<string>()
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const newPassword = () => `${randomUUID()}${randomUUID()}`
const newEmail = (label: string) => `m3-${label}-${randomUUID()}@example.test`
/** Oltre `max_frequency` (1 s) tra due invii email allo stesso indirizzo. */
const waitEmailCooldown = () => sleep(1_300)

async function signUp(email: string, password: string) {
  const client = createAnonClient()
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { privacy_version: PRIVACY_VERSION } },
  })
  if (error) throw error
  if (data.user) userIds.add(data.user.id)
  return { client, userId: data.user?.id ?? '' }
}

/** Esito del login con password (client nuovo, senza sessione). */
async function passwordLogin(email: string, password: string) {
  const { data, error } = await createAnonClient().auth.signInWithPassword({ email, password })
  return { session: data.session !== null, code: error?.code ?? null }
}

/** Lo stato "password da scegliere" letto come lo leggerà l'app. Se il profilo manca NON è "false": è un errore. */
async function readPending(client: AppSupabaseClient): Promise<boolean> {
  const { data, error } = await client
    .from('profiles')
    .select('password_setup_pending')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('profilo mancante: invariante di M2 violata')
  return data.password_setup_pending
}

async function adminPending(userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('profiles')
    .select('password_setup_pending')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data.password_setup_pending
}

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
  return { id: data.user.id, email, password, client }
}

type LinkMail = { tokenHash: string | null; type: string | null; code: string | null }

function verifyWith(
  client: AppSupabaseClient,
  email: string,
  mail: LinkMail,
  via: 'code' | 'link',
) {
  if (via === 'code') {
    return client.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })
  }
  return client.auth.verifyOtp({ token_hash: mail.tokenHash ?? '', type: 'signup' })
}

/** L'attaccante registra l'email della vittima con la propria password; poi si registra la vittima. */
async function attackerThenVictim(label: string) {
  const email = newEmail(label)
  const attackerPassword = newPassword()
  const victimPassword = newPassword()
  const attacker = await signUp(email, attackerPassword)
  await waitForMail(email, SUBJECT_CONFIRMATION)
  await waitEmailCooldown()
  await signUp(email, victimPassword) // GoTrue ignora la password della vittima: resta quella dell'attaccante
  const mail = await waitForMail(email, SUBJECT_CONFIRMATION, { count: 2 })
  return { email, attackerPassword, victimPassword, userId: attacker.userId, mail }
}

afterAll(async () => {
  try {
    // Rete di sicurezza: se un test fosse interrotto prima del `finally`, il vincolo temporaneo non deve restare.
    sql('alter table public.profiles drop constraint if exists test_block_password_flag')
  } finally {
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
  }
})

describe('pre-hijacking: la password nota all’attaccante non dà accesso dopo la conferma', () => {
  it.each([
    ['V1: la vittima conferma con il CODICE', 'code'],
    ['V2: la vittima conferma con il LINK non richiesto', 'link'],
  ] as const)('%s', async (_label, via) => {
    const s = await attackerThenVictim(`v-${via}`)

    // Prima della conferma nessuno può accedere.
    expect((await passwordLogin(s.email, s.attackerPassword)).code).toBe('email_not_confirmed')

    const victim = createAnonClient()
    const verify = await verifyWith(victim, s.email, s.mail, via)
    expect(verify.error).toBeNull()
    expect(verify.data.session).not.toBeNull()

    // La password dell'attaccante non vale più; quella "scelta" dalla vittima al signUp non è mai esistita.
    expect(await passwordLogin(s.email, s.attackerPassword)).toEqual({
      session: false,
      code: 'invalid_credentials',
    })
    expect(await passwordLogin(s.email, s.victimPassword)).toEqual({
      session: false,
      code: 'invalid_credentials',
    })
    expect(await readPending(victim)).toBe(true)

    // La vittima sceglie la password dalla sessione legittima.
    const chosen = newPassword()
    expect((await victim.auth.updateUser({ password: chosen })).error).toBeNull()
    expect(await readPending(victim)).toBe(false)
    expect((await passwordLogin(s.email, chosen)).session).toBe(true)
    expect((await passwordLogin(s.email, s.attackerPassword)).session).toBe(false)
  })

  it('V3: nessuna sessione per l’attaccante che fa login a raffica durante la conferma', async () => {
    const email = newEmail('v3')
    const attackerPassword = newPassword()
    await signUp(email, attackerPassword)
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)

    const outcomes: string[] = []
    let stop = false
    const worker = async () => {
      while (!stop) {
        const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: anonKey(), 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: attackerPassword }),
        })
        const body = (await response.json()) as { access_token?: string; error_code?: string }
        outcomes.push(body.access_token ? 'SESSIONE' : (body.error_code ?? String(response.status)))
      }
    }
    const workers = [worker(), worker(), worker(), worker()]
    await sleep(400)

    const victim = createAnonClient()
    const verify = await victim.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })

    await sleep(600)
    stop = true
    await Promise.all(workers)

    expect(verify.error).toBeNull()
    expect(outcomes).not.toContain('SESSIONE')
    // La gara è stata davvero esercitata: tentativi sia prima sia dopo la conferma, e nient'altro.
    expect(new Set(outcomes)).toEqual(new Set(['email_not_confirmed', 'invalid_credentials']))
  })

  it('V4: il recovery su un account non confermato azzera la password dell’attaccante', async () => {
    const email = newEmail('v4')
    const attackerPassword = newPassword()
    const { userId } = await signUp(email, attackerPassword)
    await waitForMail(email, SUBJECT_CONFIRMATION)
    await waitEmailCooldown()

    const victim = createAnonClient()
    expect((await victim.auth.resetPasswordForEmail(email)).error).toBeNull()
    const recovery = await waitForMail(email, SUBJECT_RECOVERY)

    const verify = await victim.auth.verifyOtp({
      email,
      token: recovery.code ?? '',
      type: 'recovery',
    })
    expect(verify.error).toBeNull()
    expect(verify.data.session).not.toBeNull()

    expect(await passwordLogin(email, attackerPassword)).toEqual({
      session: false,
      code: 'invalid_credentials',
    })
    expect(await adminPending(userId)).toBe(true)

    const chosen = newPassword()
    expect((await victim.auth.updateUser({ password: chosen })).error).toBeNull()
    expect(await adminPending(userId)).toBe(false)
    expect((await passwordLogin(email, chosen)).session).toBe(true)
    expect((await passwordLogin(email, attackerPassword)).session).toBe(false)
  })

  it('reinvio del codice: la conferma azzera comunque la password', async () => {
    const email = newEmail('resend')
    const attackerPassword = newPassword()
    await signUp(email, attackerPassword)
    await waitForMail(email, SUBJECT_CONFIRMATION)
    await waitEmailCooldown()
    expect((await createAnonClient().auth.resend({ type: 'signup', email })).error).toBeNull()
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION, { count: 2 })

    const victim = createAnonClient()
    expect(
      (await victim.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })).error,
    ).toBeNull()
    expect((await passwordLogin(email, attackerPassword)).session).toBe(false)
  })

  it('updateUser({ password }) senza sessione è rifiutato', async () => {
    const { error } = await createAnonClient().auth.updateUser({ password: newPassword() })
    expect(error?.name).toBe('AuthSessionMissingError')
  })
})

describe('utenti legittimi: nessuna regressione', () => {
  it('utente creato dall’amministratore con email confermata: la password resta e il flag è false', async () => {
    const u = await createConfirmedUser('admin')
    expect((await passwordLogin(u.email, u.password)).session).toBe(true)
    expect(await adminPending(u.id)).toBe(false)
  })

  it('utente confermato che cambia password: nessun azzeramento, flag false', async () => {
    const u = await createConfirmedUser('chpw')
    const next = newPassword()
    expect((await u.client.auth.updateUser({ password: next })).error).toBeNull()
    expect((await passwordLogin(u.email, next)).session).toBe(true)
    expect(await adminPending(u.id)).toBe(false)
  })

  it('utente confermato che cambia email (doppia conferma): la password resta', async () => {
    const u = await createConfirmedUser('chmail')
    const newAddress = newEmail('chmail-new')
    expect((await u.client.auth.updateUser({ email: newAddress })).error).toBeNull()

    // I token (già in forma di hash) sono nella riga di auth.users.
    let tokens = { current: '', next: '' }
    for (let i = 0; i < 20 && !tokens.next; i++) {
      const [row] = sql(
        `select coalesce(email_change_token_current, '') as cur, coalesce(email_change_token_new, '') as nxt from auth.users where id = '${u.id}'`,
      )
      tokens = { current: asText(row?.cur), next: asText(row?.nxt) }
      if (!tokens.next) await sleep(300)
    }
    expect(tokens.next).not.toBe('')
    for (const hash of [tokens.current, tokens.next]) {
      if (hash) {
        const verify = await createAnonClient().auth.verifyOtp({
          token_hash: hash,
          type: 'email_change',
        })
        expect(verify.error).toBeNull()
      }
    }
    expect((await passwordLogin(newAddress, u.password)).session).toBe(true)
    expect(await adminPending(u.id)).toBe(false)
  })

  it('conferma amministrativa di un utente registrato con signUp: la password viene azzerata (atteso)', async () => {
    const email = newEmail('adminconfirm')
    const password = newPassword()
    const { userId } = await signUp(email, password)
    await waitForMail(email, SUBJECT_CONFIRMATION)
    const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true })
    expect(error).toBeNull()
    expect(await passwordLogin(email, password)).toEqual({
      session: false,
      code: 'invalid_credentials',
    })
    expect(await adminPending(userId)).toBe(true)
  })
})

describe('flag profiles.password_setup_pending', () => {
  it('persiste a una chiusura e a un riavvio: la sessione e il flag si recuperano dal server', async () => {
    const storage = createFakePlatform().secureStorage
    const makeClient = () =>
      createSupabaseClient({
        url: supabaseUrl(),
        anonKey: anonKey(),
        storage,
        platform: 'web',
        appVersion: 'integration-test',
      })
    const email = newEmail('persist')
    const attackerPassword = newPassword()
    await signUp(email, attackerPassword)
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)

    const first = makeClient()
    expect(
      (await first.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })).error,
    ).toBeNull()

    // "Chiusura della scheda": nuovo client sullo stesso storage, nessuno stato in memoria.
    const second = makeClient()
    const restored = await second.auth.getSession()
    expect(restored.data.session).not.toBeNull()
    expect(await readPending(second)).toBe(true)

    const chosen = newPassword()
    expect((await second.auth.updateUser({ password: chosen })).error).toBeNull()
    expect(await readPending(second)).toBe(false)

    // Terzo avvio: il flag è ancora false.
    expect(await readPending(makeClient())).toBe(false)
  })

  it('password rifiutata (troppo corta): il flag non cambia; poi con password valida diventa false', async () => {
    const email = newEmail('weak')
    const { userId } = await signUp(email, newPassword())
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)
    const victim = createAnonClient()
    await victim.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })

    const weak = await victim.auth.updateUser({ password: 'corta' })
    expect(weak.error?.code).toBe('weak_password')
    expect(await adminPending(userId)).toBe(true)

    expect((await victim.auth.updateUser({ password: newPassword() })).error).toBeNull()
    expect(await adminPending(userId)).toBe(false)
  })

  it('il client non può scrivere il flag; ognuno vede solo il proprio profilo; anon non legge', async () => {
    const email = newEmail('rls')
    const { userId } = await signUp(email, newPassword())
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)
    const victim = createAnonClient()
    await victim.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })
    const other = await createConfirmedUser('rls-other')

    const write = await victim
      .from('profiles')
      .update({ password_setup_pending: false })
      .eq('id', userId)
    expect(write.error?.code).toBe('42501')
    const writeOther = await victim
      .from('profiles')
      .update({ password_setup_pending: true })
      .eq('id', other.id)
    expect(writeOther.error?.code).toBe('42501')
    expect(await adminPending(userId)).toBe(true)

    const own = await victim.from('profiles').select('id, password_setup_pending')
    expect(own.error).toBeNull()
    expect(own.data?.map((row) => row.id)).toEqual([userId])
    const foreign = await victim
      .from('profiles')
      .select('password_setup_pending')
      .eq('id', other.id)
    expect(foreign.data).toEqual([])

    const anon = await createAnonClient().from('profiles').select('password_setup_pending')
    expect(anon.error?.code).toBe('42501')
  })

  it('profilo mancante: la conferma passa ma lo stato non è leggibile e l’invariante di M2 viene segnalata', async () => {
    const email = newEmail('noprofile')
    const { userId } = await signUp(email, newPassword())
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)
    // Violazione deliberata dell'invariante di M2 (un profilo per ogni utente Auth).
    expect((await admin.from('profiles').delete().eq('id', userId)).error).toBeNull()

    const victim = createAnonClient()
    const verify = await victim.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })
    expect(verify.error).toBeNull()
    expect((await passwordLogin(email, 'x'.repeat(12))).session).toBe(false)

    // L'assenza del profilo NON è "nessuna password da scegliere": chi legge lo stato deve fallire.
    await expect(readPending(victim)).rejects.toThrow('profilo mancante')
    const [orphans] = sql(
      'select count(*)::int as n from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)',
    )
    expect(orphans?.n).toBe(1)

    await admin.auth.admin.deleteUser(userId)
    const [after] = sql(
      'select count(*)::int as n from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)',
    )
    expect(after?.n).toBe(0)
  })
})

describe('fail-closed e privilegi', () => {
  it('se il trigger del flag fallisce la conferma fallisce in blocco; stesso codice riutilizzabile dopo il ripristino', async () => {
    const email = newEmail('failclosed')
    const attackerPassword = newPassword()
    const { userId } = await signUp(email, attackerPassword)
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)

    try {
      sql(
        'alter table public.profiles add constraint test_block_password_flag check (password_setup_pending = false) not valid',
      )
      const blocked = await createAnonClient().auth.verifyOtp({
        email,
        token: mail.code ?? '',
        type: 'signup',
      })
      expect(blocked.error).not.toBeNull()
      expect(blocked.data.session).toBeNull()

      const { data } = await admin.auth.admin.getUserById(userId)
      expect(data.user?.email_confirmed_at ?? null).toBeNull()
      expect(await adminPending(userId)).toBe(false)
      // Password invariata ma accesso comunque impossibile: l'account non è confermato.
      expect((await passwordLogin(email, attackerPassword)).code).toBe('email_not_confirmed')
    } finally {
      sql('alter table public.profiles drop constraint if exists test_block_password_flag')
    }

    const retry = await createAnonClient().auth.verifyOtp({
      email,
      token: mail.code ?? '',
      type: 'signup',
    })
    expect(retry.error).toBeNull()
    expect(retry.data.session).not.toBeNull()
    expect(await adminPending(userId)).toBe(true)
    expect((await passwordLogin(email, attackerPassword)).session).toBe(false)
  })

  it('con REVOKE EXECUTE applicato a entrambe le funzioni conferma e flag funzionano (ruolo reale di GoTrue)', async () => {
    const [privileges] = sql(`select
      has_function_privilege('public', 'private.wipe_password_on_first_confirmation()', 'execute') as wipe_public,
      has_function_privilege('anon', 'private.wipe_password_on_first_confirmation()', 'execute') as wipe_anon,
      has_function_privilege('authenticated', 'private.wipe_password_on_first_confirmation()', 'execute') as wipe_auth,
      has_function_privilege('supabase_auth_admin', 'private.wipe_password_on_first_confirmation()', 'execute') as wipe_gotrue,
      has_function_privilege('public', 'private.track_password_setup()', 'execute') as flag_public,
      has_function_privilege('anon', 'private.track_password_setup()', 'execute') as flag_anon,
      has_function_privilege('authenticated', 'private.track_password_setup()', 'execute') as flag_auth,
      has_function_privilege('supabase_auth_admin', 'private.track_password_setup()', 'execute') as flag_gotrue,
      has_schema_privilege('supabase_auth_admin', 'private', 'usage') as gotrue_usage_private`)
    // Il ruolo con cui GoTrue esegue l'UPDATE non ha né EXECUTE né USAGE: i trigger scattano comunque.
    expect(privileges).toEqual({
      wipe_public: false,
      wipe_anon: false,
      wipe_auth: false,
      wipe_gotrue: false,
      flag_public: false,
      flag_anon: false,
      flag_auth: false,
      flag_gotrue: false,
      gotrue_usage_private: false,
    })

    const email = newEmail('revoke')
    const attackerPassword = newPassword()
    const { userId } = await signUp(email, attackerPassword)
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)
    const victim = createAnonClient()
    expect(
      (await victim.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })).error,
    ).toBeNull()
    expect((await passwordLogin(email, attackerPassword)).session).toBe(false) // wipe scattato
    expect(await adminPending(userId)).toBe(true) // flag scattato
  })

  it('sessioni dopo il cambio password (dipendente dalla versione di GoTrue; signOut others resta come difesa)', async () => {
    const email = newEmail('sessions')
    const { userId } = await signUp(email, newPassword())
    const mail = await waitForMail(email, SUBJECT_CONFIRMATION)
    const first = createAnonClient()
    await first.auth.verifyOtp({ email, token: mail.code ?? '', type: 'signup' })
    const chosen = newPassword()
    expect((await first.auth.updateUser({ password: chosen })).error).toBeNull()

    const second = createAnonClient()
    expect((await second.auth.signInWithPassword({ email, password: chosen })).error).toBeNull()
    const sessions = () =>
      sql(`select count(*)::int as n from auth.sessions where user_id = '${userId}'`)[0]?.n
    expect(sessions()).toBe(2)

    // Osservato con GoTrue della CLI pinnata: il cambio password revoca le altre sessioni.
    expect((await first.auth.updateUser({ password: newPassword() })).error).toBeNull()
    expect(sessions()).toBe(1)
    expect((await second.auth.refreshSession()).error).not.toBeNull()

    // Difesa aggiuntiva dell'app: non cambia nulla se le altre sessioni sono già state revocate.
    expect((await first.auth.signOut({ scope: 'others' })).error).toBeNull()
    expect(sessions()).toBe(1)
    expect((await first.auth.getSession()).data.session).not.toBeNull()
  })

  it('trigger e flag: i due trigger di M3 e quello di M2 sono presenti con il momento corretto', () => {
    const rows =
      sql(`select tgname, case when tgtype & 2 = 2 then 'BEFORE' else 'AFTER' end as timing,
      case when tgtype & 4 = 4 then 'INSERT' when tgtype & 16 = 16 then 'UPDATE' else 'ALTRO' end as event
      from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by tgname`)
    expect(rows).toEqual([
      { tgname: 'on_auth_user_created', timing: 'AFTER', event: 'INSERT' },
      { tgname: 'track_password_setup', timing: 'AFTER', event: 'UPDATE' },
      { tgname: 'wipe_password_on_first_confirmation', timing: 'BEFORE', event: 'UPDATE' },
    ])
  })
})
