import {
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'

import { AppError, toAppError, type AppErrorCode } from '@/shared/lib/errors'

/**
 * Codici di errore di GoTrue (`AuthApiError.code`) → `AppErrorCode`.
 *
 * Evidenza per ogni voce (auth-js 2.117.3, GoTrue locale CLI 2.120):
 *  - [LR] osservati con GoTrue reale nei test del repository: `invalid_credentials`,
 *    `email_not_confirmed`, `weak_password`, `refresh_token_not_found`, `refresh_token_already_used`,
 *    `user_not_found`, `bad_jwt`;
 *  - [SIM] solo con risposte simulate: `over_request_rate_limit`;
 *  - [spec] riportati da SPECIFICA §20 e §23.12 come osservati negli spike locali, ma NON ancora
 *    riprodotti da un test del repository (da verificare in A4): `otp_expired`,
 *    `over_email_send_rate_limit`, `user_already_exists`.
 * Ogni codice non elencato (anche `session_expired`, `email_exists`, `validation_failed`…) cade nel
 * fallback `unknown`: non si indovina il significato di un codice non verificato.
 * Si usa una `Map` e non un oggetto: un codice ostile come `constructor` non deve trovare nulla.
 */
const CODE_MAP: ReadonlyMap<string, AppErrorCode> = new Map<string, AppErrorCode>([
  ['invalid_credentials', 'invalid_credentials'],
  ['email_not_confirmed', 'email_not_confirmed'],
  ['weak_password', 'weak_password'],
  ['over_request_rate_limit', 'rate_limited'],
  ['over_email_send_rate_limit', 'rate_limited'],
  ['otp_expired', 'invalid_code'],
  // Neutralità (SPECIFICA F1, §23.12 D): il messaggio è identico all'esito di una registrazione
  // riuscita. Il service deve comunque trattare questo codice come l'esito di successo (A4).
  ['user_already_exists', 'already_registered'],
  // Sessione assente o rifiutata dal server.
  ['refresh_token_not_found', 'unauthenticated'],
  ['refresh_token_already_used', 'unauthenticated'],
  ['user_not_found', 'unauthenticated'],
  ['bad_jwt', 'unauthenticated'],
])

/**
 * Converte un errore di Supabase Auth in un `AppError` con codice stabile e messaggio italiano
 * (SPECIFICA §20 M3, §23.12). Gli errori che non sono di Auth (PostgREST, rete, e un `AppError` già
 * convertito, che `toAppError` restituisce invariato: la funzione è quindi idempotente) passano da
 * `toAppError`, che resta invariato. Non legge mai il testo del messaggio del server: i dettagli
 * tecnici restano solo in `cause`.
 */
export function toAuthAppError(error: unknown): AppError {
  // Errore di rete (o 502/503/504): non è un logout e non dipende dalle credenziali (§23.3).
  if (isAuthRetryableFetchError(error)) return new AppError('network', { cause: error })

  if (isAuthSessionMissingError(error)) return new AppError('unauthenticated', { cause: error })
  if (isAuthWeakPasswordError(error)) return new AppError('weak_password', { cause: error })

  if (isAuthApiError(error)) {
    const mapped = typeof error.code === 'string' ? CODE_MAP.get(error.code) : undefined
    if (mapped) return new AppError(mapped, { cause: error })
    if (error.status === 429) return new AppError('rate_limited', { cause: error })
    return new AppError('unknown', { cause: error })
  }

  // Altri errori di Auth non caratterizzati (`AuthUnknownError`, classi interne dell'SDK).
  if (isAuthError(error)) return new AppError('unknown', { cause: error })

  return toAppError(error)
}
