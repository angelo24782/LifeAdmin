import { inject, type App, type InjectionKey } from 'vue'

import type { Platform } from './ports'

export const PLATFORM_KEY: InjectionKey<Platform> = Symbol('lifeadmin.platform')

export function providePlatform(app: App, platform: Platform): void {
  app.provide(PLATFORM_KEY, platform)
}

/** Accesso alle porte della piattaforma da qualsiasi componente o composable. */
export function usePlatform(): Platform {
  const platform = inject(PLATFORM_KEY)
  if (!platform) {
    throw new Error('Platform non fornita: chiamare providePlatform() all’avvio dell’app.')
  }
  return platform
}
