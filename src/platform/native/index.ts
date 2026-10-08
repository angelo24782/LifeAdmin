import type { Platform } from '../ports'

/**
 * Punto di ingresso degli adapter nativi (Capacitor). L'unica cartella in cui è consentito
 * importare `@capacitor/*` (vedi eslint/architecture-rules.js).
 *
 * Gli adapter reali arrivano in M14 e nelle milestone mobile successive. Finché `isNativeRuntime()`
 * è falso (Web, test) questo modulo non viene mai caricato.
 */
export function createNativePlatform(): Platform {
  throw new Error('Gli adapter nativi non sono ancora implementati (previsti in M14).')
}
