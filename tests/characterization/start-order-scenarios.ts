/**
 * Scenari E1–E7 di caratterizzazione dell'ordine di avvio di @supabase/auth-js 2.117.3, con risposte
 * SIMULATE. Condivisi dai due file di test `auth-js-start-order.test.ts` (ambiente node) e
 * `auth-js-start-order.jsdom.test.ts` (jsdom). Complementano D1–D8 (`defer-init-scenarios.ts`) e
 * R1–R4 (integrazione locale).
 *
 * Documenta il comportamento OSSERVATO: eventi (nell'ordine, con marcatori), richieste, letture dello
 * storage, stato della chiave. NON è un contratto di auth-js né del nostro store e NON dimostra il
 * comportamento di GoTrue reale, del browser o di Supabase: `fetch` è sostituito, il tempo è simulato.
 * I client sono creati con `createClient` e le stesse opzioni di `createSupabaseClient`
 * (`skipAutoInitialize` solo dove indicato): `supabaseClient.ts` non è modificato. Non mostra mai i token.
 */
import { appendFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SecureStorage } from '@/platform'
import { AUTH_STORAGE_KEY, type AppSupabaseClient } from '@/shared/lib/supabaseClient'
import type { Database } from '@/shared/types/database'

interface Call {
  readonly method: string
  readonly path: string
  /** Identificativo del client che ha emesso la richiesta (intestazione `x-test-client`), `null` se assente. */
  readonly client: number | null
}
type Reply = Response | 'network'
type Handler = (call: Call) => Reply

export interface Observation {
  readonly scenario: string
  readonly origin: 'simulata'
  readonly request: string
  readonly error: {
    readonly class: string
    readonly code: string | null
    readonly status: number | null
  } | null
  readonly detail: Readonly<Record<string, string | number | boolean | null>>
  readonly events: readonly string[]
  /** Solo le richieste dei client creati dal test corrente. */
  readonly requests: readonly string[]
  /** Richieste di client estranei al test corrente: non devono esistere (vedi `check`). Non fanno parte di `Summary`. */
  readonly foreignRequests?: readonly string[]
  readonly storageReads: number
  readonly keyBefore: boolean
  readonly keyAfter: boolean
}

export type Summary = Omit<Observation, 'scenario' | 'origin' | 'request'>

const USER = {
  id: '00000000-0000-4000-8000-000000000000',
  aud: 'authenticated',
  email: 'user@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-08T00:00:00Z',
}

const base64Url = (value: object): string =>
  btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const nowSeconds = (): number => Math.floor(Date.now() / 1000)

function fakeAccessToken(expiresAt: number): string {
  const header = base64Url({ alg: 'none', typ: 'JWT' })
  const claims = base64Url({ sub: USER.id, role: 'authenticated', exp: expiresAt })
  return `${header}.${claims}.signature`
}

function storedSession(expiresInSeconds: number): string {
  const expiresAt = nowSeconds() + expiresInSeconds
  return JSON.stringify({
    access_token: fakeAccessToken(expiresAt),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh-token-before',
    user: USER,
  })
}

const jsonReply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const tokenReply = (): Response => {
  const expiresAt = nowSeconds() + 3600
  return jsonReply(200, {
    access_token: fakeAccessToken(expiresAt),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh-token-after',
    user: USER,
  })
}

const key = (call: Call): string => `${call.method} ${call.path}`
const REFRESH = 'POST /auth/v1/token?grant_type=refresh_token'
const USER_ENDPOINT = 'GET /auth/v1/user'

const onlineHandler: Handler = (call) => {
  const k = key(call)
  if (k === REFRESH) return tokenReply()
  if (k === USER_ENDPOINT) return jsonReply(200, USER)
  return 'network'
}
const offlineHandler: Handler = () => 'network'

interface CountingStorage extends SecureStorage {
  readonly contents: Map<string, string>
  readonly ops: { reads: number }
}

function createCountingStorage(): CountingStorage {
  const contents = new Map<string, string>()
  const ops = { reads: 0 }
  return {
    contents,
    ops,
    getItem: (name) => {
      ops.reads += 1
      return Promise.resolve(contents.get(name) ?? null)
    },
    setItem: (name, value) => {
      contents.set(name, value)
      return Promise.resolve()
    },
    removeItem: (name) => {
      contents.delete(name)
      return Promise.resolve()
    },
  }
}

/** Ambiente condiviso da più client: stesso storage, stesso `fetch` simulato, stessa lista di richieste. */
interface Env {
  readonly storage: CountingStorage
  readonly calls: Call[]
  setHandler(handler: Handler): void
}

const clients: AppSupabaseClient[] = []

/** Solo per le prove di diagnosi: con `CHARACTERIZATION_TRACE=<file>` registra creazioni, letture e richieste per client. */
let clientCounter = 0
/** Primo identificativo dei client creati dal test corrente: i precedenti sono «estranei». */
let firstOwnClientId = 1
function trace(line: string): void {
  const out = process.env.CHARACTERIZATION_TRACE
  if (out)
    appendFileSync(
      out,
      `${line}
`,
    )
}

function createEnv(initialRaw: string | null, handler: Handler): Env {
  const storage = createCountingStorage()
  const calls: Call[] = []
  let current = handler
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (url.hostname !== '127.0.0.1') {
      throw new Error(`Richiesta fuori dal perimetro simulato: ${url.hostname}`)
    }
    const clientHeader = new Headers(init?.headers).get('x-test-client')
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: `${url.pathname}${url.search}`,
      client: clientHeader !== null && /^\d+$/.test(clientHeader) ? Number(clientHeader) : null,
    }
    calls.push(call)
    trace(`REQ client=${clientHeader ?? '?'} ${key(call)}`)
    const reply = current(call)
    return reply === 'network'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(reply)
  })
  if (initialRaw !== null) storage.contents.set(AUTH_STORAGE_KEY, initialRaw)
  return {
    storage,
    calls,
    setHandler: (next) => {
      current = next
    },
  }
}

interface Actor {
  readonly client: AppSupabaseClient
  readonly events: string[]
  subscribe(): void
  mark(label: string): void
}

/** Nuovo client sull'ambiente dato. `defer` = `skipAutoInitialize` (avvio differito). */
function newActor(env: Env, defer: boolean): Actor {
  clientCounter += 1
  const id = clientCounter
  trace(`NEW client=${id} test=${expect.getState().currentTestName ?? '?'} defer=${defer}`)
  // Le letture passano da qui solo per registrarle; i conteggi restano quelli di `env.storage`.
  const storage: SecureStorage = {
    getItem: (name) => {
      trace(`READ client=${id} ${name}`)
      return env.storage.getItem(name)
    },
    setItem: (name, value) => env.storage.setItem(name, value),
    removeItem: (name) => env.storage.removeItem(name),
  }
  const client = createClient<Database>('http://127.0.0.1:54321', 'anon-key', {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage,
      storageKey: AUTH_STORAGE_KEY,
      skipAutoInitialize: defer,
    },
    global: { headers: { 'x-test-client': String(id) } },
  })
  clients.push(client)
  const events: string[] = []
  return {
    client,
    events,
    subscribe: () => {
      client.auth.onAuthStateChange((event, session) => {
        events.push(`${event}:${session ? 'sessione' : 'null'}`)
      })
    },
    mark: (label) => {
      events.push(`>> ${label}`)
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

interface ObserveOptions {
  readonly fixedMs?: number
  readonly maxMs?: number
  readonly stepMs?: number
}

/** Avanza il tempo simulato finché l'azione non si risolve (o per `fixedMs`) e registra cosa è cambiato. */
async function observe(
  scenario: string,
  request: string,
  env: Env,
  actor: Actor,
  action: () => Promise<ActionResult>,
  options: ObserveOptions = {},
): Promise<Observation> {
  const eventsBefore = actor.events.length
  const callsBefore = env.calls.length
  const readsBefore = env.storage.ops.reads
  const keyBefore = env.storage.contents.has(AUTH_STORAGE_KEY)
  let settled = false
  const pending = action().then(
    (result) => ({ ...result, thrown: false }),
    (error: unknown) => ({ error, detail: {}, thrown: true }),
  )
  void pending.then(() => {
    settled = true
  })
  let elapsed = 0
  const step = options.stepMs ?? 500
  const limit = options.fixedMs ?? options.maxMs ?? 180_000
  while ((options.fixedMs !== undefined || !settled) && elapsed < limit) {
    await vi.advanceTimersByTimeAsync(step)
    elapsed += step
  }
  const result = settled ? await pending : { error: null, detail: {}, thrown: false }
  const observed = env.calls.slice(callsBefore)
  const isOwn = (call: Call): boolean => call.client !== null && call.client >= firstOwnClientId
  return {
    scenario,
    origin: 'simulata',
    request,
    error: describeError(result.error),
    detail: {
      ...result.detail,
      lanciata: result.thrown,
      risolta: settled,
      secondiSimulati: elapsed / 1000,
    },
    events: actor.events.slice(eventsBefore),
    requests: observed.filter(isOwn).map(key),
    foreignRequests: observed
      .filter((call) => !isOwn(call))
      .map((call) => `client ${call.client ?? 'sconosciuto'}: ${key(call)}`),
    storageReads: env.storage.ops.reads - readsBefore,
    keyBefore,
    keyAfter: env.storage.contents.has(AUTH_STORAGE_KEY),
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
})

const initialize = (actor: Actor, label: string) => async (): Promise<ActionResult> => {
  actor.mark(`initialize() ${label}: chiamato`)
  const { error } = await actor.client.auth.initialize()
  actor.mark(`initialize() ${label}: risolto`)
  return { error, detail: {} }
}

const getSession = (actor: Actor) => async (): Promise<ActionResult> => {
  const { data, error } = await actor.client.auth.getSession()
  return { error, detail: { sessione: data.session !== null } }
}

/** Definisce gli scenari E1–E7. `expected` contiene i valori osservati e fissati. */
export function defineStartOrderScenarios(
  environment: 'node' | 'jsdom',
  expected: Record<string, Summary>,
): void {
  function check(observation: Observation): void {
    const out = process.env.CHARACTERIZATION_REPORT
    if (out) appendFileSync(out, `${JSON.stringify({ ...observation, environment })}\n`)
    // `expect.soft`: la prova continua, così il report è completo anche con valori mancanti.
    expect
      .soft(
        observation.foreignRequests ?? [],
        `Richieste attribuibili a client estranei allo scenario ${observation.scenario}: ` +
          'client di test precedenti non ripuliti (dispose) o interferenza tra client (es. BroadcastChannel)',
      )
      .toEqual([])
    expect
      .soft(
        observation.scenario in expected,
        `Valore atteso mancante per lo scenario ${observation.scenario}`,
      )
      .toBe(true)
    if (observation.scenario in expected) {
      expect.soft(summary(observation)).toEqual(expected[observation.scenario])
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    firstOwnClientId = clientCounter + 1
    // Solo per le prove di diagnosi: `CHARACTERIZATION_NO_BROADCAST=1` toglie `BroadcastChannel` per la
    // durata del singolo test (`vi.unstubAllGlobals()` in `afterEach` lo ripristina). Senza la variabile
    // il comportamento dei test è invariato.
    if (process.env.CHARACTERIZATION_NO_BROADCAST) vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(async () => {
    // `dispose()` ferma il rinnovo, chiude il BroadcastChannel e svuota i sottoscrittori: i client di
    // un test non possono più interferire con i test successivi.
    for (const client of clients.splice(0)) await client.auth.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // E1: ordine degli eventi tra `initialize()` e la sottoscrizione. Il primo rinnovo fallisce durante
  // l'inizializzazione (sessione ancora valida, conservata) e riesce subito dopo, nel giro immediato
  // del ticker: un evento emesso in quell'intervallo raggiunge solo chi è già sottoscritto.
  describe(`E1: intervallo tra initialize() e sottoscrizione (${environment})`, () => {
    // `null` = nessun `await` tra la risoluzione di `initialize()` e la sottoscrizione.
    const VARIANTS: readonly (readonly [string, (() => Promise<unknown>) | null])[] = [
      ['senza-await', null],
      ['con-await-microtask', () => Promise.resolve()],
      ['con-await-macrotask', () => vi.advanceTimersByTimeAsync(10)],
    ]
    it.each(VARIANTS)('E1: %s', async (label, between) => {
      let healthy = false
      const env = createEnv(storedSession(60), (call) =>
        key(call) === REFRESH && !healthy ? 'network' : onlineHandler(call),
      )
      const actor = newActor(env, true)
      check(
        await observe(
          `E1-${label}`,
          `initialize(), rinnovo che riesce subito dopo, sottoscrizione ${label}`,
          env,
          actor,
          async () => {
            actor.mark('initialize(): chiamato')
            await actor.client.auth.initialize()
            actor.mark('initialize(): risolto')
            healthy = true
            if (between) await between()
            actor.subscribe()
            actor.mark('sottoscritto')
            return NOTHING
          },
        ),
      )
      check(
        await observe(
          `E1-${label}-dopo`,
          'attesa di 10 s dopo la sottoscrizione',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          { fixedMs: 10_000 },
        ),
      )
    })
  })

  // E2: client differito inattivo offline, poi rete (alternative (a) e (c)).
  describe(`E2: attesa offline di un client differito, poi rete (${environment})`, () => {
    it.each([
      ['120s', 120_000],
      ['1h', 3_600_000],
    ] as const)('E2: inattivo %s', async (label, idleMs) => {
      const env = createEnv(storedSession(-60), offlineHandler)
      const actor = newActor(env, true)
      check(
        await observe(
          `E2-${label}-inattivo`,
          'client differito inattivo, rete assente',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          { fixedMs: idleMs, stepMs: 5_000 },
        ),
      )
      env.setHandler(onlineHandler)
      check(
        await observe(
          `E2-${label}-initialize`,
          'initialize() a rete ripristinata',
          env,
          actor,
          initialize(actor, '1'),
        ),
      )
      actor.subscribe()
      actor.mark('sottoscritto')
      check(
        await observe(
          `E2-${label}-sottoscrizione`,
          'dopo la sottoscrizione',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      check(await observe(`E2-${label}-getSession`, 'getSession()', env, actor, getSession(actor)))
    })
  })

  // E3: nessuna sessione salvata, rete assente.
  describe(`E3: nessuna sessione salvata, rete assente (${environment})`, () => {
    it('E3', async () => {
      const env = createEnv(null, offlineHandler)
      const actor = newActor(env, true)
      check(
        await observe(
          'E3-initialize',
          'initialize() senza sessione salvata, rete assente',
          env,
          actor,
          initialize(actor, '1'),
        ),
      )
      actor.subscribe()
      actor.mark('sottoscritto')
      check(
        await observe(
          'E3-sottoscrizione',
          'dopo la sottoscrizione',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      check(await observe('E3-getSession', 'getSession()', env, actor, getSession(actor)))
    })
  })

  // E4: alternativa (b), avvio automatico con sottoscrizione immediata; poi rete; poi nuovo client.
  describe(`E4: avvio automatico, sessione scaduta, rete assente, poi rete (${environment})`, () => {
    it('E4', async () => {
      const env = createEnv(storedSession(-60), offlineHandler)
      const actor = newActor(env, false)
      actor.subscribe()
      actor.mark('sottoscritto subito dopo la creazione (avvio automatico)')
      check(
        await observe(
          'E4-avvio-offline',
          'avvio automatico offline',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 30_000,
          },
        ),
      )
      env.setHandler(onlineHandler)
      check(
        await observe(
          'E4-attesa-con-rete',
          'rete ripristinata, 120 s di attesa',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 120_000,
            stepMs: 5_000,
          },
        ),
      )
      check(
        await observe('E4-getSession', 'getSession() dopo l’attesa', env, actor, getSession(actor)),
      )
      const second = newActor(env, false)
      second.subscribe()
      second.mark('nuovo client sullo stesso storage, sottoscritto subito')
      check(
        await observe(
          'E4-nuovo-client',
          'nuovo client con avvio automatico, rete presente',
          env,
          second,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 10_000,
          },
        ),
      )
      check(
        await observe(
          'E4-nuovo-client-getSession',
          'getSession() del nuovo client',
          env,
          second,
          getSession(second),
        ),
      )
    })
  })

  // E5: alternativa (c): offline senza sottoscrizione né initialize(); a rete presente, sottoscrizione e poi initialize().
  describe(`E5: attesa della rete, poi sottoscrizione e initialize() (${environment})`, () => {
    it.each([
      ['valido', 3600],
      ['scaduto', -60],
    ] as const)('E5: token %s', async (label, expiresIn) => {
      const env = createEnv(storedSession(expiresIn), offlineHandler)
      const actor = newActor(env, true)
      check(
        await observe(
          `E5-${label}-attesa`,
          'attesa offline, nessuna chiamata',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 60_000,
            stepMs: 5_000,
          },
        ),
      )
      env.setHandler(onlineHandler)
      actor.subscribe()
      actor.mark('sottoscritto (client non inizializzato), rete presente')
      check(
        await observe(
          `E5-${label}-sottoscrizione`,
          'dopo la sottoscrizione',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      check(
        await observe(`E5-${label}-initialize`, 'initialize()', env, actor, initialize(actor, '1')),
      )
    })
  })

  // E6: avvio con rete assente (come se cadesse durante il refresh iniziale), alternativa (a); recupero con un nuovo client.
  describe(`E6: inizializzazione fallita e recupero con un nuovo client (${environment})`, () => {
    it('E6', async () => {
      const env = createEnv(storedSession(-60), offlineHandler)
      const actor = newActor(env, true)
      check(
        await observe(
          'E6-initialize',
          'initialize() con refresh che fallisce',
          env,
          actor,
          initialize(actor, '1'),
        ),
      )
      actor.subscribe()
      actor.mark('sottoscritto dopo initialize()')
      check(
        await observe(
          'E6-sottoscrizione',
          'dopo la sottoscrizione',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      env.setHandler(onlineHandler)
      check(
        await observe(
          'E6-initialize-ripetuto',
          'initialize() ripetuto a rete ripristinata',
          env,
          actor,
          initialize(actor, '2'),
        ),
      )
      check(
        await observe(
          'E6-getSession',
          'getSession() dello stesso client',
          env,
          actor,
          getSession(actor),
        ),
      )
      const second = newActor(env, true)
      check(
        await observe(
          'E6-nuovo-initialize',
          'nuovo client sullo stesso storage: initialize()',
          env,
          second,
          initialize(second, '1'),
        ),
      )
      second.subscribe()
      second.mark('nuovo client sottoscritto dopo initialize()')
      check(
        await observe(
          'E6-nuovo-sottoscrizione',
          'dopo la sottoscrizione del nuovo client',
          env,
          second,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      check(
        await observe(
          'E6-nuovo-getSession',
          'getSession() del nuovo client',
          env,
          second,
          getSession(second),
        ),
      )
    })
  })

  // E7: valori anomali nella chiave di sessione. Il comportamento di auth-js è OSSERVATO; la futura
  // responsabilità di `sanitizeStoredSession` (decidere cosa fare del valore) è fuori da questo test.
  describe(`E7: chiave di sessione con contenuto anomalo (${environment})`, () => {
    it.each([
      ['non-json', '{non json'],
      ['json-senza-campi', '{"foo":1}'],
      ['json-null', 'null'],
      ['stringa-json', '"abc"'],
    ] as const)('E7: %s', async (label, raw) => {
      const env = createEnv(raw, onlineHandler)
      const actor = newActor(env, true)
      check(
        await observe(
          `E7-${label}-initialize`,
          'initialize() con contenuto anomalo',
          env,
          actor,
          initialize(actor, '1'),
        ),
      )
      actor.subscribe()
      actor.mark('sottoscritto dopo initialize()')
      check(
        await observe(
          `E7-${label}-sottoscrizione`,
          'dopo la sottoscrizione',
          env,
          actor,
          () => Promise.resolve(NOTHING),
          {
            fixedMs: 5_000,
          },
        ),
      )
      check(await observe(`E7-${label}-getSession`, 'getSession()', env, actor, getSession(actor)))
    })
  })
}
