// @vitest-environment node
/**
 * Prove, con risposte SIMULATE e nessun servizio, della logica di verifica e di pulizia usata dai test
 * d'integrazione che creano utenti temporanei (`tests/support/temporary-users.ts`): origine locale
 * attesa, perimetro di rete, email restituita da `createUser`, fallimenti di `deleteUser`. Non si
 * apre alcuna connessione: `fetch` e API amministrativa sono sostituiti da doppioni.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createPerimeterFetch,
  createTemporaryUser,
  deleteTemporaryUsers,
  expectedLocalOrigin,
  type AdminUsersApi,
} from '../support/temporary-users'

describe('expectedLocalOrigin', () => {
  it.each([
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['http://localhost:54321', 'http://localhost:54321'],
    ['http://127.0.0.1:54321/', 'http://127.0.0.1:54321'],
  ])('accetta %s', (raw, origin) => {
    expect(expectedLocalOrigin(raw)).toBe(origin)
  })

  it.each([
    ['porta diversa', 'http://127.0.0.1:54322'],
    ['porta predefinita (nessuna porta)', 'http://127.0.0.1'],
    ['protocollo https', 'https://127.0.0.1:54321'],
    ['host remoto', 'http://example.supabase.co:54321'],
    ['host remoto con porta predefinita', 'https://example.supabase.co'],
    ['credenziali che mascherano l’host', 'http://127.0.0.1:54321@example.com'],
    ['loopback IPv6 (non ammesso)', 'http://[::1]:54321'],
    ['host simile a localhost', 'http://localhost.example.com:54321'],
  ])('rifiuta: %s', (_label, raw) => {
    expect(() => expectedLocalOrigin(raw)).toThrow(/origine locale attesa/)
  })

  it('rifiuta un valore che non è un URL, senza riportarlo nel messaggio', () => {
    expect(() => expectedLocalOrigin('non-un-url')).toThrow(/non è un URL valido/)
    expect(() => expectedLocalOrigin('non-un-url')).not.toThrow(/non-un-url/)
  })
})

describe('createPerimeterFetch', () => {
  const ORIGIN = 'http://127.0.0.1:54321'
  const okResponse = () => new Response('{}', { status: 200 })

  it('inoltra solo le richieste verso l’origine verificata e ne segnala metodo e percorso', async () => {
    const real = vi.fn(() => Promise.resolve(okResponse()))
    const seen: string[] = []
    const guarded = createPerimeterFetch(real, ORIGIN, (method, path) =>
      seen.push(`${method} ${path}`),
    )

    await guarded.fetch(`${ORIGIN}/auth/v1/user?x=1`, { method: 'get' })
    await guarded.fetch(new URL(`${ORIGIN}/rest/v1/profiles`))

    expect(real).toHaveBeenCalledTimes(2)
    expect(seen).toEqual(['GET /auth/v1/user?x=1', 'GET /rest/v1/profiles'])
    expect(guarded.rejected).toEqual([])
  })

  it.each([
    ['altra porta locale', 'http://127.0.0.1:54322/auth/v1/user'],
    ['altro host locale', 'http://localhost:54321/auth/v1/user'],
    ['protocollo diverso', 'https://127.0.0.1:54321/auth/v1/user'],
    ['host remoto', 'https://example.supabase.co/auth/v1/user?apikey=segreto'],
  ])('rifiuta senza inviare: %s', async (_label, target) => {
    const real = vi.fn(() => Promise.resolve(okResponse()))
    const guarded = createPerimeterFetch(real, ORIGIN)

    await expect(guarded.fetch(target)).rejects.toThrow(/fuori dal perimetro locale/)

    expect(real).not.toHaveBeenCalled()
    expect(guarded.rejected).toEqual([new URL(target).origin])
    // Registrata solo l'origine: né percorso né parametri (che potrebbero contenere chiavi).
    expect(guarded.rejected.join(' ')).not.toMatch(/segreto|apikey/)
  })
})

/** API amministrativa simulata: esiti configurabili per `createUser` e per ogni `deleteUser`. */
function fakeApi(options: {
  create?: () => Awaited<ReturnType<AdminUsersApi['createUser']>>
  deleteBy?: Record<string, () => Promise<{ error: { message: string } | null }>>
}): AdminUsersApi & { deleted: string[] } {
  const deleted: string[] = []
  return {
    deleted,
    createUser: (attributes) =>
      Promise.resolve(
        options.create?.() ?? {
          data: { user: { id: 'id-1', email: attributes.email } },
          error: null,
        },
      ),
    deleteUser: (id) => {
      deleted.push(id)
      return options.deleteBy?.[id]?.() ?? Promise.resolve({ error: null })
    },
  }
}

const ATTRIBUTES = {
  email: 'm3-defer-prova-0000@example.test',
  password: 'password-simulata',
  user_metadata: { privacy_version: '2026-10-01' },
}

describe('createTemporaryUser', () => {
  it('restituisce l’identificativo quando l’email restituita coincide con quella richiesta', async () => {
    const api = fakeApi({})
    await expect(createTemporaryUser(api, ATTRIBUTES)).resolves.toBe('id-1')
  })

  it('lancia, con l’id nel messaggio, se l’email restituita è diversa: l’id non va registrato', async () => {
    const api = fakeApi({
      create: () => ({
        data: { user: { id: 'id-altro', email: 'altro@example.test' } },
        error: null,
      }),
    })
    await expect(createTemporaryUser(api, ATTRIBUTES)).rejects.toThrow(
      /email diversa da quella richiesta \(id id-altro\).*NON è stato registrato per la pulizia/,
    )
  })

  it('lancia se la risposta non contiene l’email', async () => {
    const api = fakeApi({
      create: () => ({ data: { user: { id: 'id-senza-email' } }, error: null }),
    })
    await expect(createTemporaryUser(api, ATTRIBUTES)).rejects.toThrow(/email diversa/)
  })

  it('rilancia l’errore restituito dalla creazione', async () => {
    const failure = new Error('creazione rifiutata')
    const api = fakeApi({ create: () => ({ data: { user: null }, error: failure }) })
    await expect(createTemporaryUser(api, ATTRIBUTES)).rejects.toBe(failure)
  })

  it('lancia se non c’è alcun utente nella risposta', async () => {
    const api = fakeApi({ create: () => ({ data: { user: null }, error: null }) })
    await expect(createTemporaryUser(api, ATTRIBUTES)).rejects.toThrow(/createUser fallita/)
  })
})

describe('deleteTemporaryUsers', () => {
  it('senza fallimenti restituisce un elenco vuoto e tenta tutti gli utenti', async () => {
    const api = fakeApi({})
    await expect(deleteTemporaryUsers(api, ['a', 'b'])).resolves.toEqual([])
    expect(api.deleted).toEqual(['a', 'b'])
  })

  it('segnala l’errore restituito da deleteUser e prosegue con gli utenti successivi', async () => {
    const api = fakeApi({
      deleteBy: { a: () => Promise.resolve({ error: { message: 'utente non eliminabile' } }) },
    })
    const failures = await deleteTemporaryUsers(api, ['a', 'b', 'c'])
    expect(failures).toEqual(['a: utente non eliminabile'])
    expect(api.deleted).toEqual(['a', 'b', 'c'])
  })

  it('segnala anche l’eccezione lanciata da deleteUser, senza interrompere la pulizia', async () => {
    const api = fakeApi({
      deleteBy: { b: () => Promise.reject(new TypeError('fetch failed')) },
    })
    const failures = await deleteTemporaryUsers(api, ['a', 'b', 'c'])
    expect(failures).toEqual(['b: eccezione fetch failed'])
    expect(api.deleted).toEqual(['a', 'b', 'c'])
  })

  it('elenca tutti i fallimenti, uno per utente', async () => {
    const api = fakeApi({
      deleteBy: {
        a: () => Promise.resolve({ error: { message: 'errore A' } }),
        c: () => Promise.reject(new Error('errore C')),
      },
    })
    await expect(deleteTemporaryUsers(api, ['a', 'b', 'c'])).resolves.toEqual([
      'a: errore A',
      'c: eccezione errore C',
    ])
  })

  it('con un elenco vuoto non chiama l’API', async () => {
    const api = fakeApi({})
    await expect(deleteTemporaryUsers(api, [])).resolves.toEqual([])
    expect(api.deleted).toEqual([])
  })
})
