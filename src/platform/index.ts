import type { Platform } from './ports'
import { createWebPlatform } from './web'

export type * from './ports'
export { PLATFORM_KEY, providePlatform, usePlatform } from './usePlatform'

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
}

/**
 * Rileva se l'app gira dentro la shell nativa. Capacitor inietta `window.Capacitor` nella
 * WebView: si legge il global, senza importare `@capacitor/core` fuori da `platform/native`.
 */
export function isNativeRuntime(scope: object = globalThis): boolean {
  const capacitor = (scope as { Capacitor?: CapacitorGlobal }).Capacitor
  return capacitor?.isNativePlatform?.() === true
}

/**
 * Sceglie e crea l'implementazione della piattaforma. L'import dinamico mantiene gli adapter
 * nativi (e i plugin Capacitor) fuori dal bundle Web.
 */
export async function loadPlatform(scope: object = globalThis): Promise<Platform> {
  if (isNativeRuntime(scope)) {
    const { createNativePlatform } = await import('./native')
    return createNativePlatform()
  }
  return createWebPlatform()
}
