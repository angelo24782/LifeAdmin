/**
 * Caratterizzazione dell'avvio differito (`skipAutoInitialize`) di @supabase/auth-js 2.117.3 con
 * GoTrue LOCALE reale (R1–R4), a complemento degli scenari simulati D1–D8 in
 * `tests/characterization/auth-js-defer-init*.test.ts`.
 *
 * Documenta il comportamento OSSERVATO: eventi (nell'ordine, con marcatori delle chiamate del test),
 * richieste, letture dello storage, variazione del refresh token. NON è un contratto di auth-js né
 * del nostro store, e NON dimostra il comportamento di Supabase in hosting né del browser. Non mostra
 * mai i token. Il client è creato con `createClient` e le stesse opzioni di `createSupabaseClient`
 * più `skipAutoInitialize`: `supabaseClient.ts` non è modificato.
 *
 * Perimetro: `beforeAll` verifica che `SUPABASE_URL` sia l'origine locale attesa
 * (`http://127.0.0.1:54321` o `http://localhost:54321`, porta di `[api] port` in `supabase/config.toml`)
 * e il `fetch` sostituito rifiuta, senza inviarla, ogni richiesta verso un'origine diversa da quella
 * verificata (protocollo, host e porta); il test fallisce se ne rifiuta qualcuna.
 *
 * Utenti temporanei: creati dal test con un prefisso proprio e un UUID. Un identificativo entra
 * nell'elenco da eliminare SOLO dopo che l'email restituita da `createUser` coincide con quella
 * richiesta. A fine file `afterAll` elimina soltanto quegli identificativi e fa FALLIRE il file se
 * `deleteUser` restituisce un errore o lancia (nessuna eliminazione per pattern né in SQL).
 * **Se il processo termina prima di `afterAll`** (interruzione, crash, timeout dei hook) gli utenti
 * già creati possono restare nel database locale (email `m3-defer-<etichetta>-<UUID>@example.test`) e
 * vanno eliminati a mano: non esiste una pulizia automatica più ampia.
 *
 * Nessuna credenziale nel repository. L'offline non è simulabile contro lo stack locale senza
 * alterarlo: resta coperto dalle sole simulazioni. La logica di verifica e di pulizia è in
 * `../support/temporary-users` ed è provata con risposte simulate in `tests/characterization/temporary-users.test.ts`.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createFakePlatform, type FakePlatform } from '@/platform/fake'
import {
  AUTH_STORAGE_KEY,
  createSupabaseClient,
  type AppSupabaseClient,
} from '@/shared/lib/supabaseClient'
import type { Database } from '@/shared/types/database'

import { anonKey, createAdminClient, PRIVACY_VERSION, supabaseUrl } from './support'
import {
  createPerimeterFetch,
  createTemporaryUser,
  deleteTemporaryUsers,
  expectedLocalOrigin,
  type AdminUsersApi,
  type PerimeterFetch,
} from '../support/temporary-users'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

interface Observation {
  readonly scenario: string
  readonly origin: 'locale-reale'
  readonly request: string
  readonly error: {
    readonly class: string
    readonly code: string | null
    readonly status: number | null
  } | null
  readonly detail: Readonly<Record<string, string | number | boolean | null>>
  readonly events: readonly string[]
  readonly requests: readonly string[]
  readonly storageReads: number
  readonly keyBefore: boolean
  readonly keyAfter: boolean
  readonly refreshTokenChanged: boolean | null
}

type Summary = Omit<Observation, 'scenario' | 'origin' | 'request'>

interface StoredSession {
  access_token: string
  refresh_token: string
  expires_at: number
  [field: string]: unknown
}

const TEST_EMAIL_PREFIX = 'm3-defer-'
const admin = createAdminClient()
const adminUsers: AdminUsersApi = {
  createUser: (attributes) => admin.auth.admin.createUser(attributes),
  deleteUser: (id) => admin.auth.admin.deleteUser(id),
}
/** Solo gli utenti creati da questo file, con email verificata: sono gli unici che vengono eliminati. */
const createdIds = new Set<string>()
const requestLog: string[] = []
let perimeter: PerimeterFetch | null = null
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const nowSeconds = () => Math.floor(Date.now() / 1000)

beforeAll(() => {
  // Prima di qualunque richiesta: l'URL deve essere l'origine locale attesa, porta compresa.
  const allowedOrigin = expectedLocalOrigin(supabaseUrl())
  perimeter = createPerimeterFetch(globalThis.fetch, allowedOrigin, (method, pathAndQuery) => {
    requestLog.push(`${method} ${pathAndQuery}`)
  })
  vi.stubGlobal('fetch', perimeter.fetch)
})

const clients: { auth: { stopAutoRefresh(): Promise<void> } }[] = []

afterAll(async () => {
  let cleanupFailures: string[]
  try {
    for (const client of clients.splice(0)) await client.auth.stopAutoRefresh()
  } finally {
    // Ogni errore (restituito o lanciato) è raccolto: nessun fallimento di pulizia viene ignorato.
    cleanupFailures = await deleteTemporaryUsers(adminUsers, [...createdIds])
    vi.unstubAllGlobals()
  }
  expect(perimeter?.rejected ?? [], 'Richieste rifiutate dal perimetro locale').toEqual([])
  expect(
    cleanupFailures,
    'Utenti temporanei NON eliminati: eliminarli a mano dal database locale (email m3-defer-…@example.test)',
  ).toEqual([])
})

interface Source {
  readonly id: string
  readonly rawSession: string
}

/** Crea un utente temporaneo (identificato dal prefisso) e ne ottiene una sessione reale. */
async function createSource(label: string): Promise<Source> {
  const email = `${TEST_EMAIL_PREFIX}${label}-${randomUUID()}@example.test`
  const password = `${randomUUID()}${randomUUID()}`
  // L'identificativo è registrato per la pulizia solo se l'email restituita coincide con quella richiesta.
  const userId = await createTemporaryUser(adminUsers, {
    email,
    password,
    user_metadata: { privacy_version: PRIVACY_VERSION },
  })
  createdIds.add(userId)

  const platform = createFakePlatform()
  const client: AppSupabaseClient = createSupabaseClient({
    url: supabaseUrl(),
    anonKey: anonKey(),
    storage: platform.secureStorage,
    platform: 'web',
    appVersion: 'characterization',
  })
  clients.push(client)
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  await client.auth.stopAutoRefresh()
  const raw = platform.storageContents.get(AUTH_STORAGE_KEY)
  if (!raw) throw new Error('Nessuna sessione nello storage.')
  return { id: userId, rawSession: raw }
}

interface Deferred {
  readonly client: AppSupabaseClient
  readonly platform: FakePlatform
  readonly events: string[]
  readonly reads: { count: number }
  subscribe(): void
  mark(label: string): void
  refreshToken(): string | null
}

/** Client differito su una sessione salvata; `expired` porta `expires_at` nel passato. */
function startDeferred(source: Source, expired: boolean): Deferred {
  const platform = createFakePlatform()
  const stored = JSON.parse(source.rawSession) as StoredSession
  const reads = { count: 0 }
  const storage = {
    getItem: (name: string) => {
      reads.count += 1
      return platform.secureStorage.getItem(name)
    },
    setItem: (name: string, value: string) => platform.secureStorage.setItem(name, value),
    removeItem: (name: string) => platform.secureStorage.removeItem(name),
  }
  const initial: StoredSession = expired ? { ...stored, expires_at: nowSeconds() - 60 } : stored
  void platform.secureStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(initial))
  const client = createClient<Database>(supabaseUrl(), anonKey(), {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage,
      storageKey: AUTH_STORAGE_KEY,
      skipAutoInitialize: true,
    },
  })
  clients.push(client)
  const events: string[] = []
  return {
    client,
    platform,
    events,
    reads,
    subscribe: () => {
      client.auth.onAuthStateChange((event, session) => {
        events.push(`${event}:${session ? 'sessione' : 'null'}`)
      })
    },
    mark: (label) => {
      events.push(`>> ${label}`)
    },
    refreshToken: () => {
      const raw = platform.storageContents.get(AUTH_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { refresh_token?: unknown }
      return typeof parsed.refresh_token === 'string' ? parsed.refresh_token : null
    },
  }
}

function describeError(error: unknown): Observation['error'] {
  if (!error) return null
  const value = error as { name?: unknown; code?: unknown; status?: unknown }
  return {
    class: typeof value.name === 'string' ? value.name : 'sconosciuta',
    code: typeof value.code === 'string' ? value.code : null,
    status: typeof value.status === 'number' ? value.status : null,
  }
}

interface ActionResult {
  readonly error: unknown
  readonly detail: Observation['detail']
}

const NOTHING: ActionResult = { error: null, detail: {} }

async function observe(
  scenario: string,
  request: string,
  d: Deferred,
  action: () => Promise<ActionResult>,
  settleMs = 1_500,
): Promise<Observation> {
  const eventsBefore = d.events.length
  const requestsBefore = requestLog.length
  const readsBefore = d.reads.count
  const keyBefore = d.platform.storageContents.has(AUTH_STORAGE_KEY)
  const tokenBefore = d.refreshToken()
  const result = await action().then(
    (value) => ({ ...value, thrown: false }),
    (error: unknown) => ({ error, detail: {}, thrown: true }),
  )
  await sleep(settleMs)
  const tokenAfter = d.refreshToken()
  return {
    scenario,
    origin: 'locale-reale',
    request,
    error: describeError(result.error),
    detail: { ...result.detail, lanciata: result.thrown },
    events: d.events.slice(eventsBefore),
    requests: requestLog.slice(requestsBefore),
    storageReads: d.reads.count - readsBefore,
    keyBefore,
    keyAfter: d.platform.storageContents.has(AUTH_STORAGE_KEY),
    refreshTokenChanged:
      tokenBefore === null || tokenAfter === null ? null : tokenBefore !== tokenAfter,
  }
}

const summary = (o: Observation): Summary => ({
  error: o.error,
  detail: o.detail,
  events: o.events,
  requests: o.requests,
  storageReads: o.storageReads,
  keyBefore: o.keyBefore,
  keyAfter: o.keyAfter,
  refreshTokenChanged: o.refreshTokenChanged,
})

/** Valori osservati, fissati dopo la prima esecuzione (vedi la nota in testa al file). */
const EXPECTED: Record<string, Summary> = {
  'R1-sottoscrizione': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['INITIAL_SESSION:sessione'],
    requests: [],
    storageReads: 2,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
  },
  'R1-initialize': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['>> initialize() 1: chiamato', 'SIGNED_IN:sessione', '>> initialize() 1: risolto'],
    requests: [],
    storageReads: 2,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
  },
  'R2-sottoscrizione': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['TOKEN_REFRESHED:sessione', 'INITIAL_SESSION:sessione'],
    requests: ['POST /auth/v1/token?grant_type=refresh_token'],
    storageReads: 4,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: true,
  },
  'R2-initialize': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['>> initialize() 1: chiamato', 'SIGNED_IN:sessione', '>> initialize() 1: risolto'],
    requests: [],
    storageReads: 2,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
  },
  'R3-initialize': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['>> initialize() 1: chiamato', '>> initialize() 1: risolto'],
    requests: ['POST /auth/v1/token?grant_type=refresh_token'],
    storageReads: 5,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: true,
  },
  'R3-sottoscrizione': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['INITIAL_SESSION:sessione'],
    requests: [],
    storageReads: 1,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
  },
  'R4-getUser': {
    error: null,
    detail: {
      utente: true,
      lanciata: false,
    },
    events: [],
    requests: ['GET /auth/v1/user'],
    storageReads: 2,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
  },
  'R4-sottoscrizione': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['INITIAL_SESSION:sessione'],
    requests: [],
    storageReads: 1,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
  },
  'R4-initialize': {
    error: null,
    detail: {
      lanciata: false,
    },
    events: ['>> initialize() 1: chiamato', 'SIGNED_IN:sessione', '>> initialize() 1: risolto'],
    requests: [],
    storageReads: 2,
    keyBefore: true,
    keyAfter: true,
    refreshTokenChanged: false,
  },
}

function check(observation: Observation): void {
  const out = process.env.CHARACTERIZATION_REPORT
  if (out) appendFileSync(out, `${JSON.stringify(observation)}\n`)
  // `expect.soft`: la prova continua, così il report è completo anche con valori mancanti.
  expect
    .soft(
      observation.scenario in EXPECTED,
      `Valore atteso mancante per lo scenario ${observation.scenario}`,
    )
    .toBe(true)
  if (observation.scenario in EXPECTED) {
    expect.soft(summary(observation)).toEqual(EXPECTED[observation.scenario])
  }
}

const initialize = (d: Deferred, label: string) => async (): Promise<ActionResult> => {
  d.mark(`initialize() ${label}: chiamato`)
  const { error } = await d.client.auth.initialize()
  d.mark(`initialize() ${label}: risolto`)
  return { error, detail: {} }
}

describe('R1: sottoscrizione prima di initialize(), token valido (GoTrue locale reale)', () => {
  it('R1', async () => {
    const d = startDeferred(await createSource('r1'), false)
    d.subscribe()
    d.mark('sottoscritto (client non inizializzato)')
    check(
      await observe('R1-sottoscrizione', 'dopo la sottoscrizione', d, () =>
        Promise.resolve(NOTHING),
      ),
    )
    check(await observe('R1-initialize', 'initialize()', d, initialize(d, '1')))
  })
})

describe('R2: sottoscrizione prima di initialize(), token scaduto (GoTrue locale reale)', () => {
  it('R2', async () => {
    const d = startDeferred(await createSource('r2'), true)
    d.subscribe()
    d.mark('sottoscritto (client non inizializzato)')
    check(
      await observe('R2-sottoscrizione', 'dopo la sottoscrizione', d, () =>
        Promise.resolve(NOTHING),
      ),
    )
    check(await observe('R2-initialize', 'initialize()', d, initialize(d, '1')))
  })
})

describe('R3: initialize() prima della sottoscrizione, token scaduto (GoTrue locale reale)', () => {
  it('R3', async () => {
    const d = startDeferred(await createSource('r3'), true)
    check(
      await observe(
        'R3-initialize',
        'initialize() prima della sottoscrizione',
        d,
        initialize(d, '1'),
      ),
    )
    d.subscribe()
    d.mark('sottoscritto (client già inizializzato)')
    check(
      await observe('R3-sottoscrizione', 'dopo la sottoscrizione tardiva', d, () =>
        Promise.resolve(NOTHING),
      ),
    )
  })
})

describe('R4: getUser() prima di initialize() (GoTrue locale reale)', () => {
  it('R4', async () => {
    const d = startDeferred(await createSource('r4'), false)
    check(
      await observe(
        'R4-getUser',
        'getUser() su client non inizializzato e senza sottoscrizioni',
        d,
        async () => {
          const { data, error } = await d.client.auth.getUser()
          return { error, detail: { utente: data.user !== null } }
        },
      ),
    )
    d.subscribe()
    d.mark('sottoscritto (client non inizializzato)')
    check(
      await observe('R4-sottoscrizione', 'dopo la sottoscrizione', d, () =>
        Promise.resolve(NOTHING),
      ),
    )
    check(await observe('R4-initialize', 'initialize()', d, initialize(d, '1')))
  })
})
