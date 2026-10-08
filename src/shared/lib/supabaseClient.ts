import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { PlatformName, SecureStorage } from '@/platform'
import type { Database } from '@/shared/types/database'

export type AppSupabaseClient = SupabaseClient<Database>

/** Chiave sotto cui supabase-js salva la sessione (SPECIFICA §23.3). */
export const AUTH_STORAGE_KEY = 'lifeadmin.auth.session'

export interface SupabaseClientOptions {
  readonly url: string
  /** Chiave pubblica (anon). La `service_role` NON deve mai arrivare qui. */
  readonly anonKey: string
  /** Storage della sessione: localStorage sul Web, Keychain/Keystore sulle app (porta `platform`). */
  readonly storage: SecureStorage
  readonly platform: PlatformName
  readonly appVersion: string
}

/**
 * Crea il client Supabase tipizzato (SPECIFICA §23.3, §23.10).
 *  - sessione su storage iniettato, flusso PKCE, nessuna lettura dei token dall'URL;
 *  - header `x-app-version` / `x-app-platform` su ogni richiesta, per misurare l'adozione per
 *    versione e decidere quando rimuovere API obsolete.
 */
export function createSupabaseClient(options: SupabaseClientOptions): AppSupabaseClient {
  return createClient<Database>(options.url, options.anonKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage: options.storage,
      storageKey: AUTH_STORAGE_KEY,
    },
    global: {
      headers: {
        'x-app-version': options.appVersion,
        'x-app-platform': options.platform,
      },
    },
  })
}
