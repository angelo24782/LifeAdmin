import type { SecureStorage } from '../ports'

/**
 * Web: `localStorage` (default di supabase-js, mitigato da CSP). Se lo storage non è disponibile
 * (modalità privata, accesso bloccato) si ripiega su memoria di processo: la sessione dura
 * finché la pagina resta aperta, ma l'app non si rompe.
 */
export function createWebSecureStorage(
  getStorage: () => Storage | undefined = () => safeLocalStorage(),
): SecureStorage {
  const memory = new Map<string, string>()

  return {
    getItem(key) {
      try {
        const storage = getStorage()
        return Promise.resolve(storage ? storage.getItem(key) : (memory.get(key) ?? null))
      } catch {
        return Promise.resolve(memory.get(key) ?? null)
      }
    },
    setItem(key, value) {
      try {
        const storage = getStorage()
        if (storage) {
          storage.setItem(key, value)
          return Promise.resolve()
        }
      } catch {
        // ripiego su memoria
      }
      memory.set(key, value)
      return Promise.resolve()
    },
    removeItem(key) {
      memory.delete(key)
      try {
        getStorage()?.removeItem(key)
      } catch {
        // niente da rimuovere
      }
      return Promise.resolve()
    },
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
