import { AppError, toAppError } from '@/shared/lib/errors'
import type { AppSupabaseClient } from '@/shared/lib/supabaseClient'

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
