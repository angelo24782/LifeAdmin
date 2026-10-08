import { createPinia } from 'pinia'
import { createApp } from 'vue'

import { loadPlatform, providePlatform } from '@/platform'
import { EnvValidationError, getEnv, type AppEnv } from '@/shared/lib/env'
import { createSupabaseClient } from '@/shared/lib/supabaseClient'
import '@/styles/tailwind.css'

import App from './App.vue'
import { provideSupabase } from './providers/supabase'
import { createAppRouter } from './router'

function showStartupError(message: string): void {
  const root = document.getElementById('app')
  if (!root) return
  const container = document.createElement('main')
  container.style.cssText =
    'font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:1rem'
  const title = document.createElement('h1')
  title.textContent = 'LifeAdmin non può avviarsi'
  const details = document.createElement('pre')
  details.style.whiteSpace = 'pre-wrap'
  details.textContent = message
  container.append(title, details)
  root.replaceChildren(container)
}

async function bootstrap(): Promise<void> {
  let env: AppEnv
  try {
    env = getEnv()
  } catch (error) {
    if (error instanceof EnvValidationError) {
      showStartupError(error.message)
      return
    }
    throw error
  }

  const platform = await loadPlatform()
  const app = createApp(App)
  providePlatform(app, platform)
  provideSupabase(
    app,
    createSupabaseClient({
      url: env.VITE_SUPABASE_URL,
      anonKey: env.VITE_SUPABASE_ANON_KEY,
      storage: platform.secureStorage,
      platform: platform.info.name,
      appVersion: __APP_VERSION__,
    }),
  )
  app.use(createPinia())
  app.use(createAppRouter())
  app.mount('#app')
}

void bootstrap()
