import { randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { createFakePlatform } from '@/platform/fake'
import { createSupabaseClient, type AppSupabaseClient } from '@/shared/lib/supabaseClient'
import type { Database } from '@/shared/types/database'

/**
 * Supporto ai test di integrazione. La `service_role` è usata ESCLUSIVAMENTE qui (creazione e
 * pulizia di utenti e dati di prova): non compare mai in `src/`. Gli utenti sono creati a runtime
 * con password casuali per esecuzione: nessuna credenziale è scritta nel repository.
 */

export const PRIVACY_VERSION = '2026-10-01'

function requireEnv(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} non impostata: eseguire i test con \`pnpm test:integration\`.`)
  }
  return value
}

export const supabaseUrl = (): string => requireEnv('SUPABASE_URL')

/** Client amministrativo (service_role): bypassa la RLS. Solo per setup/verifica nei test. */
export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Client dell'app senza sessione (ruolo `anon`), creato con la stessa factory usata in produzione. */
export function createAnonClient(): AppSupabaseClient {
  return createSupabaseClient({
    url: supabaseUrl(),
    anonKey: requireEnv('SUPABASE_ANON_KEY'),
    storage: createFakePlatform().secureStorage,
    platform: 'web',
    appVersion: 'integration-test',
  })
}

export interface TestUser {
  readonly id: string
  readonly email: string
  /** Client dell'app autenticato come questo utente (passa dalla RLS reale via PostgREST). */
  readonly client: AppSupabaseClient
}

/**
 * Crea un utente tramite l'API di amministrazione (come fa il signup: scatta il trigger del profilo)
 * e restituisce un client autenticato. La password è casuale e non esce da questo processo.
 */
export async function createTestUser(
  admin: SupabaseClient<Database>,
  label: string,
): Promise<TestUser> {
  const email = `m2-${label}-${randomUUID()}@example.test`
  const password = `${randomUUID()}${randomUUID()}`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { privacy_version: PRIVACY_VERSION, display_name: `Utente ${label}` },
  })
  if (error || !data.user) throw error ?? new Error('createUser: nessun utente restituito')

  const client = createAnonClient()
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error

  return { id: data.user.id, email, client }
}

export async function deleteTestUsers(
  admin: SupabaseClient<Database>,
  users: readonly TestUser[],
): Promise<void> {
  for (const user of users) {
    await admin.auth.admin.deleteUser(user.id)
  }
}

/** Id della categoria di sistema con lo slug indicato. */
export async function systemCategoryId(
  admin: SupabaseClient<Database>,
  slug: string,
): Promise<string> {
  const { data, error } = await admin
    .from('categories')
    .select('id')
    .eq('slug', slug)
    .is('owner_id', null)
    .single()
  if (error) throw error
  return data.id
}
