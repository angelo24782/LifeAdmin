/**
 * Errori applicativi (SPECIFICA §2, §13): i service convertono gli errori di PostgREST/Postgres in
 * `AppError` con un codice stabile e un messaggio utente in italiano. I dettagli tecnici restano in
 * `cause` (solo per i log), mai nella UI.
 */
export type AppErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_data'
  | 'network'
  | 'unknown'

const USER_MESSAGES: Record<AppErrorCode, string> = {
  unauthenticated: 'La sessione è scaduta. Accedi di nuovo.',
  forbidden: 'Non hai i permessi per eseguire questa operazione.',
  not_found: 'Elemento non trovato.',
  conflict: 'Esiste già un elemento con questi dati.',
  invalid_data: 'I dati inseriti non sono validi.',
  network: 'Impossibile contattare il server. Controlla la connessione e riprova.',
  unknown: 'Qualcosa è andato storto. Riprova tra poco.',
}

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    options?: { cause?: unknown },
  ) {
    super(USER_MESSAGES[code], options)
    this.name = 'AppError'
  }
}

/** Forma minima di un errore PostgREST (supabase-js `PostgrestError`). */
interface PostgrestLike {
  readonly code?: string
  readonly message?: string
}

const INVALID_DATA_SQLSTATES = new Set([
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '22P02', // invalid_text_representation
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '22001', // string_data_right_truncation
])

function isPostgrestLike(error: unknown): error is PostgrestLike {
  return typeof error === 'object' && error !== null && 'message' in error
}

/** Converte qualsiasi errore ricevuto da supabase-js in un `AppError`. Idempotente. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof TypeError) {
    return new AppError('network', { cause: error })
  }

  if (!isPostgrestLike(error)) {
    return new AppError('unknown', { cause: error })
  }

  const code = error.code ?? ''

  if (code === '42501') return new AppError('forbidden', { cause: error })
  if (code === 'PGRST301' || code === 'PGRST303') {
    return new AppError('unauthenticated', { cause: error })
  }
  if (code === 'PGRST116') return new AppError('not_found', { cause: error })
  if (code === '23505') return new AppError('conflict', { cause: error })
  if (INVALID_DATA_SQLSTATES.has(code)) return new AppError('invalid_data', { cause: error })

  // supabase-js riporta i fallimenti di rete come errore senza codice ("TypeError: fetch failed").
  if (code === '' && /fetch|network/i.test(error.message ?? '')) {
    return new AppError('network', { cause: error })
  }

  return new AppError('unknown', { cause: error })
}
