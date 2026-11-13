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
