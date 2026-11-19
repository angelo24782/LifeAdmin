import {
  isAuthApiError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'

import { AppError, toAppError } from '@/shared/lib/errors'
import type { AppSupabaseClient } from '@/shared/lib/supabaseClient'

import { toAuthAppError } from './errors'

/**
 * Service di autenticazione (A4, SPECIFICA §20 M3). Funzioni pure su `AppSupabaseClient`: non
 * modificano Pinia, cache, storage applicativo o router e non traducono gli esiti negli stati
 * applicativi, che sono responsabilità dello store (A5).
 */

/**
 * Esito della lettura di `profiles.password_setup_pending` (SPECIFICA §20 M3, «Lettura di
 * `password_setup_pending`», decisione A4 3):
 *  - `pending`: il valore è `true`, la password va ancora scelta;
 *  - `completed`: il valore è `false`, la password è già stata scelta;
 *  - `profile_missing`: nessuna riga visibile (violazione dell'invariante di M2, criterio 18);
 *  - `unreadable`: errore di rete o di PostgREST, valore nullo o non booleano, eccezione. `error`
 *    conserva un `AppError` utile alla diagnosi.
 * Solo `completed` soddisfa la condizione «password già scelta» di G.6.
 */
export type PasswordSetupPendingResult =
  | { readonly status: 'pending' }
  | { readonly status: 'completed' }
  | { readonly status: 'profile_missing' }
  | { readonly status: 'unreadable'; readonly error: AppError }

const PENDING: PasswordSetupPendingResult = { status: 'pending' }
const COMPLETED: PasswordSetupPendingResult = { status: 'completed' }
const PROFILE_MISSING: PasswordSetupPendingResult = { status: 'profile_missing' }

const unreadable = (error: AppError): PasswordSetupPendingResult => ({
  status: 'unreadable',
  error,
})

/**
 * Legge dal server se l'utente deve ancora scegliere la password (`profiles.password_setup_pending`).
 * Seleziona solo quella colonna e filtra per `id` (l'`id` del profilo è l'`id` dell'utente; nessun
 * filtro per `owner_id`, la visibilità la decide la RLS). Non lancia mai eccezioni: un errore, un
 * valore nullo o inatteso e un profilo mancante non diventano mai `completed`.
 */
export async function getPasswordSetupPending(
  client: AppSupabaseClient,
  userId: string,
): Promise<PasswordSetupPendingResult> {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('password_setup_pending')
      .eq('id', userId)
      .maybeSingle()

    if (error) return unreadable(toAppError(error))
    if (data === null) return PROFILE_MISSING

    // Il tipo generato dice `boolean`, ma il valore arriva dalla rete: si controlla davvero.
    const value: unknown = data.password_setup_pending
    if (value === true) return PENDING
    if (value === false) return COMPLETED
    // Nessun errore da convertire: un `AppError` diagnostico con il valore ricevuto come `cause`.
    return unreadable(new AppError('unknown', { cause: value }))
  } catch (error) {
    return unreadable(toAppError(error))
  }
}

/**
 * Scope di `signOut` (SPECIFICA §20 M3, Decisione A4 4):
 *  - `local`: termina la sessione corrente (il normale «Esci»);
 *  - `global`: revoca i refresh token di tutte le sessioni dell'utente (azione distinta e deliberata);
 *  - `others`: termina le altre sessioni e conserva quella corrente (G.10, dopo il cambio password).
 */
export type SignOutScope = 'local' | 'global' | 'others'

const SIGN_OUT_SCOPES: ReadonlySet<string> = new Set<SignOutScope>(['local', 'global', 'others'])

/**
 * Esito di `signOut`, distinto dagli eventi e dalla diagnostica della sessione locale:
 *  - `no_error`: auth-js non ha esposto errori. NON certifica la revoca remota: auth-js 2.117.3
 *    ignora gli errori HTTP 401/403/404 e la sessione mancante, e senza sessione non chiama il server;
 *  - `auth_error`: auth-js ha restituito un errore (`AppError` di `toAuthAppError`, originale in `cause`);
 *  - `exception`: la chiamata ha lanciato un'eccezione, oppure lo scope non è valido.
 */
export type SignOutResult =
  | { readonly status: 'no_error' }
  | { readonly status: 'auth_error'; readonly error: AppError }
  | { readonly status: 'exception'; readonly error: AppError }

/**
 * Inoltra `signOut` a Supabase Auth con lo scope indicato, obbligatorio e senza default implicito.
 * Non modifica Pinia, cache, storage applicativo o router e non deduce lo stato locale: con
 * `local`/`global` è auth-js a rimuovere la sessione locale (anche dopo alcuni errori), con `others`
 * no. Non lancia mai eccezioni verso il chiamante.
 */
export async function signOut(
  client: AppSupabaseClient,
  scope: SignOutScope,
): Promise<SignOutResult> {
  // Controllo anche a runtime: con `{ scope: undefined }` auth-js 2.117.3 userebbe `global` e
  // chiuderebbe tutte le sessioni dell'utente. Uno scope non valido non arriva mai ad Auth.
  if (!SIGN_OUT_SCOPES.has(scope)) {
    const cause = new TypeError(`signOut: scope non valido (${String(scope)})`)
    return { status: 'exception', error: new AppError('unknown', { cause }) }
  }

  try {
    const { error } = await client.auth.signOut({ scope })
    if (error) return { status: 'auth_error', error: toAuthAppError(error) }
    return { status: 'no_error' }
  } catch (error) {
    return { status: 'exception', error: toAuthAppError(error) }
  }
}

/**
 * Esito di `setPassword` (SPECIFICA §20 M3, G.10). La traduzione negli stati applicativi è dello
 * store (A5). `error` è l'`AppError` di `toAuthAppError`, con l'originale in `cause` (per un utente
 * senza `id` stringa è un `AppError('unknown')` con il valore ricevuto in `cause`).
 *  - `changed`: password cambiata, flag riletto `completed` e `signOut('others')` senza errori;
 *  - `changed_with_warnings`: password cambiata, ma la rilettura non ha dato `completed` oppure
 *    `signOut('others')` ha dato un errore. Resta un successo del cambio password;
 *  - `already_running`: un cambio è già in corso su questo client; nessuna richiesta inviata;
 *  - `session_missing`: `getUser` ha restituito `AuthSessionMissingError`;
 *  - `verification_failed`: identità non verificabile. `reason`: `server_rejected` (GoTrue ha
 *    risposto `user_not_found` o `bad_jwt`), `request_failed` (rete, 5xx, 429, risposta non valida,
 *    errore inatteso o utente senza `id`), `exception` (eccezione lanciata, per esempio dallo storage);
 *  - `user_mismatch`: il server ha restituito un utente diverso da `expectedUserId`;
 *  - `update_failed`: `updateUser` rifiutato in modo esplicito (errore HTTP < 500 compreso 429,
 *    password debole, sessione assente): la password non è cambiata;
 *  - `update_outcome_unknown`: esito remoto di `updateUser` incerto (rete, 5xx, risposta non
 *    classificabile, eccezione): la password può essere cambiata o no, non va dichiarato un fallimento.
 * Con `session_missing`, `verification_failed` e `user_mismatch` `updateUser` non viene chiamato.
 */
export type SetPasswordResult =
  | { readonly status: 'changed' }
  | {
      readonly status: 'changed_with_warnings'
      readonly passwordSetup: PasswordSetupPendingResult
      readonly signOutOthers: SignOutResult
    }
  | { readonly status: 'already_running' }
  | { readonly status: 'session_missing'; readonly error: AppError }
  | {
      readonly status: 'verification_failed'
      readonly reason: 'server_rejected' | 'request_failed' | 'exception'
      readonly error: AppError
    }
  | { readonly status: 'user_mismatch' }
  | { readonly status: 'update_failed'; readonly error: AppError }
  | { readonly status: 'update_outcome_unknown'; readonly error: AppError }

const CHANGED: SetPasswordResult = { status: 'changed' }
const ALREADY_RUNNING: SetPasswordResult = { status: 'already_running' }
const USER_MISMATCH: SetPasswordResult = { status: 'user_mismatch' }

/** Codici di `AuthApiError` con cui GoTrue rifiuta il token o l'utente (S8, S9 [LR]). */
const SERVER_REJECTION_CODES: ReadonlySet<string> = new Set(['user_not_found', 'bad_jwt'])

/**
 * Cambi password in corso, uno per istanza di client (G.10, «Concorrenza»). `WeakMap`: il registro
 * non trattiene i client. Non copre altre schede o altri dispositivi: il controllo finale è del server.
 */
const runningSetPassword = new WeakMap<AppSupabaseClient, Promise<SetPasswordResult>>()

/**
 * Cambia la password dell'utente autenticato (SPECIFICA §20 M3, G.10). Nessuna validazione della
 * password (la fa il form; l'autorità è il server) e nessun nuovo tentativo automatico.
 * Ordine: blocco per client → `getUser()` e confronto stretto con `expectedUserId` (fail-closed:
 * senza verifica `updateUser` non parte) → `updateUser({ password })` → dopo il successo, sempre,
 * `getPasswordSetupPending` e `signOut(client, 'others')`. Non lancia mai eccezioni.
 */
export function setPassword(
  client: AppSupabaseClient,
  { password, expectedUserId }: { password: string; expectedUserId: string },
): Promise<SetPasswordResult> {
  // Controllo e registrazione sincroni: nessun `await` prima, quindi nessuna finestra per una
  // seconda chiamata sullo stesso client.
  if (runningSetPassword.has(client)) return Promise.resolve(ALREADY_RUNNING)

  const run = changePassword(client, password, expectedUserId).finally(() => {
    runningSetPassword.delete(client)
  })
  runningSetPassword.set(client, run)
  return run
}

async function changePassword(
  client: AppSupabaseClient,
  password: string,
  expectedUserId: string,
): Promise<SetPasswordResult> {
  const verification = await verifyUser(client, expectedUserId)
  if (verification !== 'verified') return verification

  const update = await updatePassword(client, password)
  if (update !== 'updated') return update

  // Da qui la password è cambiata: nessun esito successivo può diventare un fallimento.
  const passwordSetup = await getPasswordSetupPending(client, expectedUserId)
  const signOutOthers = await signOut(client, 'others')
  if (passwordSetup.status === 'completed' && signOutOthers.status === 'no_error') return CHANGED
  return { status: 'changed_with_warnings', passwordSetup, signOutOthers }
}

/** Verifica con il server che l'utente autenticato sia `expectedUserId` (G.10, passi 1–3). */
async function verifyUser(
  client: AppSupabaseClient,
  expectedUserId: string,
): Promise<SetPasswordResult | 'verified'> {
  let user: unknown
  try {
    const { data, error } = await client.auth.getUser()
    if (error) {
      if (isAuthSessionMissingError(error)) {
        return { status: 'session_missing', error: toAuthAppError(error) }
      }
      const rejected =
        isAuthApiError(error) &&
        typeof error.code === 'string' &&
        SERVER_REJECTION_CODES.has(error.code)
      return {
        status: 'verification_failed',
        reason: rejected ? 'server_rejected' : 'request_failed',
        error: toAuthAppError(error),
      }
    }
    // Il tipo dice `User`, ma il valore arriva dalla rete: si controlla davvero.
    user = data.user
  } catch (error) {
    return { status: 'verification_failed', reason: 'exception', error: toAuthAppError(error) }
  }

  const id: unknown =
    typeof user === 'object' && user !== null && 'id' in user ? user.id : undefined
  if (typeof id !== 'string') {
    return {
      status: 'verification_failed',
      reason: 'request_failed',
      error: new AppError('unknown', { cause: user }),
    }
  }
  return id === expectedUserId ? 'verified' : USER_MISMATCH
}

/**
 * Rifiuto esplicito di `updateUser`, con la password certamente non cambiata: risposta HTTP < 500
 * (compreso 429), password debole, sessione assente. Tutto il resto è un esito remoto incerto.
 */
function isExplicitUpdateRejection(error: unknown): boolean {
  if (isAuthWeakPasswordError(error) || isAuthSessionMissingError(error)) return true
  return isAuthApiError(error) && error.status < 500
}

/** `updateUser({ password })` (G.10, passo 4), senza nuovi tentativi. */
async function updatePassword(
  client: AppSupabaseClient,
  password: string,
): Promise<SetPasswordResult | 'updated'> {
  try {
    const { error } = await client.auth.updateUser({ password })
    if (!error) return 'updated'
    return {
      status: isExplicitUpdateRejection(error) ? 'update_failed' : 'update_outcome_unknown',
      error: toAuthAppError(error),
    }
  } catch (error) {
    return { status: 'update_outcome_unknown', error: toAuthAppError(error) }
  }
}
