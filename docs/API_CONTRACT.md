# Contratto frontend/backend (M2)

Riferimento: `docs/SPECIFICA.md` §5, §6, §23.10. Questo documento elenca ciò che i client (Web, iOS,
Android) possono legittimamente usare. **Schema, privilegi di colonna e policy RLS sono parte
dell'API**: non si cambiano in modo incompatibile finché esistono versioni mobile in circolazione
(finestra di supporto N-2 / 90 giorni, §23.10).

Regole per chi scrive codice client:

1. Query con **colonne esplicite**, mai `select *`.
2. Ignorare campi e valori enum sconosciuti nelle risposte.
3. Nessun filtro per `owner_id`: l'isolamento è della RLS.
4. Ogni chiamata a Supabase passa dalla factory `createSupabaseClient`, che invia `x-app-version` e
   `x-app-platform`.

## Ruoli e privilegi

| Ruolo           | Accesso                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `anon`          | **Nessuno** su tutte le tabelle (errore `42501`).                        |
| `authenticated` | Solo ciò che è elencato sotto, sempre limitato alle proprie righe (RLS). |
| `service_role`  | Solo Edge Function e test. **Mai** nel client.                           |

## Tabelle (schema `public`)

| Tabella            | SELECT            | INSERT (colonne)                                                       | UPDATE (colonne)                                                                                  | DELETE  |
| ------------------ | ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------- |
| `profiles`         | proprio           | — (creato dal trigger di signup)                                       | `display_name, timezone, email_notifications_enabled, notification_hour, onboarding_completed_at` | —       |
| `categories`       | sistema + proprie | —                                                                      | —                                                                                                 | —       |
| `life_items`       | proprie           | `id, category_id, title, due_date, amount_cents, notes, reminder_days` | `category_id, title, due_date, amount_cents, notes, reminder_days, status, completed_at`          | proprie |
| `recurrence_rules` | proprie           | `item_id, interval_unit, interval_count, anchor_date`                  | `interval_unit, interval_count, anchor_date`                                                      | proprie |
| `item_completions` | proprie           | —                                                                      | —                                                                                                 | —       |

- `owner_id` non è mai inseribile né aggiornabile dal client: lo valorizza `default auth.uid()`.
- `recurrence_rules` e `item_completions` usano la FK composta `(item_id, owner_id) →
life_items(id, owner_id)`: il database garantisce che il figlio appartenga allo stesso utente.
- Una `life_item` può usare solo categorie **visibili** all'utente (di sistema o proprie).
- Il calcolo delle ricorrenze (`recurrence_next`) e il completamento (`complete_life_item`) arrivano
  in M6; `item_completions` è in sola lettura per i client.

## Registrazione e consenso privacy

Il profilo si crea con un trigger su `auth.users` (`private.handle_new_user`). Il client deve passare
nei metadata di `signUp`:

| Metadata          | Obbligatorio | Note                                                                 |
| ----------------- | ------------ | -------------------------------------------------------------------- |
| `privacy_version` | sì           | Deve essere una versione supportata dal backend (oggi `2026-10-01`). |
| `display_name`    | no           | Max 80 caratteri dopo il trim.                                       |

- Se `privacy_version` manca o non è supportata, **la registrazione è rifiutata** (nessun utente Auth
  viene creato). GoTrue restituisce un errore generico ("Database error saving new user"): la UI
  (M3) deve validare la versione prima dell'invio.
- `privacy_accepted_at` è `now()` lato database; qualunque timestamp inviato dal client è ignorato.
- Le versioni supportate sono in `private.supported_privacy_versions()`; per aggiungerne una si
  ridefinisce la funzione con una nuova migration.

## Errori

I service convertono gli errori di PostgREST/Postgres in `AppError` (`src/shared/lib/errors.ts`):

| Origine                                                       | `AppError.code`   |
| ------------------------------------------------------------- | ----------------- |
| `42501` (permesso negato o violazione RLS)                    | `forbidden`       |
| `PGRST301`, `PGRST303` (JWT scaduto/non valido)               | `unauthenticated` |
| `PGRST116` (nessuna riga)                                     | `not_found`       |
| `23505`                                                       | `conflict`        |
| `23502`, `23503`, `23514`, `22P02`, `22007`, `22008`, `22001` | `invalid_data`    |
| errori di rete                                                | `network`         |

## Non esposto

Lo schema `private` (trigger e funzioni interne) non è raggiungibile da PostgREST e nessuna funzione
applicativa è esposta in `public` (nessun RPC in M2).
