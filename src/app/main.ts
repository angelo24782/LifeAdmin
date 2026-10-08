import { createPinia } from 'pinia'
import { createApp } from 'vue'

import { loadPlatform, providePlatform } from '@/platform'
import { EnvValidationError, getEnv } from '@/shared/lib/env'
import '@/styles/tailwind.css'

import App from './App.vue'
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
  try {
    getEnv()
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
  app.use(createPinia())
  app.use(createAppRouter())
  app.mount('#app')
}

void bootstrap()
