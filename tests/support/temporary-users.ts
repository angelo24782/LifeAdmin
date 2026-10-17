/**
 * Supporto condiviso per la gestione degli utenti temporanei nei test: verifica dell'origine locale
 * attesa dell'API, `fetch` con perimetro di rete ristretto a quell'origine, creazione di utenti
 * temporanei con controllo dell'email restituita e pulizia che segnala ogni fallimento. Nessun
 * effetto collaterale all'importazione e nessuna lettura dell'ambiente: le funzioni ricevono tutto
 * dai parametri, così possono essere usate sia da test che lavorano con lo stack Supabase locale sia da
 * test con risposte simulate (`tests/characterization/temporary-users.test.ts`). Nessun segreto.
 */

/** Porta dell'API locale: coerente con `[api] port` in `supabase/config.toml`. */
export const EXPECTED_LOCAL_API_PORT = '54321'
/** Host ammessi per l'API locale (`supabase status` stampa `127.0.0.1`). */
export const EXPECTED_LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost']

/**
 * Restituisce l'origine (`http://host:porta`) di `rawUrl` se è l'API locale attesa: protocollo `http:`,
 * host in `EXPECTED_LOCAL_HOSTS`, porta `EXPECTED_LOCAL_API_PORT`. Altrimenti lancia con un messaggio
 * esplicito. Le credenziali eventualmente presenti nell'URL non vengono riportate nel messaggio.
 */
export function expectedLocalOrigin(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('SUPABASE_URL non è un URL valido: test interrotti.')
  }
  const description = `${url.protocol}//${url.hostname}:${url.port === '' ? '(porta predefinita)' : url.port}`
  if (
    url.protocol !== 'http:' ||
    !EXPECTED_LOCAL_HOSTS.includes(url.hostname) ||
    url.port !== EXPECTED_LOCAL_API_PORT
  ) {
    throw new Error(
      `SUPABASE_URL (${description}) non è l'origine locale attesa ` +
        `(http://127.0.0.1:${EXPECTED_LOCAL_API_PORT} o http://localhost:${EXPECTED_LOCAL_API_PORT}, ` +
        'vedi `[api] port` in supabase/config.toml): test interrotti.',
    )
  }
  return url.origin
}

export interface PerimeterFetch {
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  /** Origini (solo `protocollo//host:porta`, senza percorso né parametri) di cui sono state rifiutate richieste. */
  readonly rejected: string[]
}

/**
 * `fetch` che inoltra a `realFetch` solo le richieste verso `allowedOrigin` (confronto dell'origine
 * completa: protocollo, host e porta). Ogni altra richiesta viene rifiutata SENZA essere inviata e la
 * sua origine è registrata in `rejected`. `onAllowed` riceve metodo e percorso delle richieste inoltrate.
 */
export function createPerimeterFetch(
  realFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  allowedOrigin: string,
  onAllowed?: (method: string, pathAndQuery: string) => void,
): PerimeterFetch {
  const rejected: string[] = []
  return {
    rejected,
    fetch: (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      )
      if (url.origin !== allowedOrigin) {
        rejected.push(url.origin)
        return Promise.reject(
          new Error(
            `Richiesta fuori dal perimetro locale (${url.origin}): consentita solo ${allowedOrigin}`,
          ),
        )
      }
      onAllowed?.((init?.method ?? 'GET').toUpperCase(), `${url.pathname}${url.search}`)
      return realFetch(input, init)
    },
  }
}

/** Parte dell'API amministrativa di auth-js usata qui (struttura minima, sostituibile nei test). */
export interface AdminUsersApi {
  createUser(attributes: {
    email: string
    password: string
    email_confirm: boolean
    user_metadata: Record<string, string>
  }): Promise<{
    data: { user: { id: string; email?: string } | null }
    error: unknown
  }>
  deleteUser(id: string): Promise<{ error: { message: string } | null }>
}

/**
 * Crea un utente temporaneo e restituisce il suo identificativo. Lancia se la creazione fallisce, se
 * non c'è alcun utente nella risposta o se l'email restituita **non coincide** con quella richiesta:
 * in quest'ultimo caso l'identificativo NON va registrato per la pulizia (non si elimina un utente di
 * cui non si è certi) e il messaggio riporta l'id, non segreto, per una verifica manuale.
 */
export async function createTemporaryUser(
  api: AdminUsersApi,
  attributes: {
    email: string
    password: string
    user_metadata: Record<string, string>
  },
): Promise<string> {
  const { data, error } = await api.createUser({ ...attributes, email_confirm: true })
  if (error || !data.user) {
    throw error instanceof Error ? error : new Error('createUser fallita')
  }
  if (data.user.email !== attributes.email) {
    throw new Error(
      `createUser ha restituito un'email diversa da quella richiesta (id ${data.user.id}): ` +
        "l'utente NON è stato registrato per la pulizia; verificarlo a mano nel database locale",
    )
  }
  return data.user.id
}

/**
 * Elimina gli utenti indicati e restituisce l'elenco dei fallimenti (`"<id>: <motivo>"`): un errore
 * restituito dall'API e un'eccezione vengono entrambi registrati, e un fallimento non impedisce di
 * tentare gli utenti successivi. Non lancia mai.
 */
export async function deleteTemporaryUsers(
  api: AdminUsersApi,
  ids: readonly string[],
): Promise<string[]> {
  const failures: string[] = []
  for (const id of ids) {
    try {
      const { error } = await api.deleteUser(id)
      if (error) failures.push(`${id}: ${error.message}`)
    } catch (thrown) {
      failures.push(`${id}: eccezione ${thrown instanceof Error ? thrown.message : String(thrown)}`)
    }
  }
  return failures
}
