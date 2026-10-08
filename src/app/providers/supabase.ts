import { inject, type App, type InjectionKey } from 'vue'

import type { AppSupabaseClient } from '@/shared/lib/supabaseClient'

export const SUPABASE_KEY: InjectionKey<AppSupabaseClient> = Symbol('lifeadmin.supabase')

export function provideSupabase(app: App, client: AppSupabaseClient): void {
  app.provide(SUPABASE_KEY, client)
}

/** Client Supabase dell'app. Va passato ai service delle feature, mai usato direttamente nei componenti. */
export function useSupabase(): AppSupabaseClient {
  const client = inject(SUPABASE_KEY)
  if (!client) {
    throw new Error('Supabase non fornito: chiamare provideSupabase() all’avvio dell’app.')
  }
  return client
}
