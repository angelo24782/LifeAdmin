-- M3 · `auth_prehijack_guard`: protezione dal pre-hijacking degli account non confermati e stato
-- "password da scegliere" (SPECIFICA §23.12).
--
-- Attacco: chi registra l'email di un'altra persona con una password nota resterebbe in possesso
-- dell'account dopo la conferma della vittima (GoTrue non sovrascrive la password di un account
-- non confermato). Mitigazione: l'app registra con una password casuale monouso e, alla PRIMA
-- conferma dell'email, il database azzera la password; la password si sceglie dopo la conferma.
--
-- Tre componenti:
--   1. trigger BEFORE UPDATE su auth.users che azzera la password alla prima conferma;
--   2. colonna additiva `profiles.password_setup_pending` (stato lato server, sola lettura per i client);
--   3. trigger AFTER UPDATE su auth.users che mantiene coerente il flag.
--
-- Non modifica il trigger di M2 `on_auth_user_created` (AFTER INSERT) né `private.create_profile_for_user`:
-- la creazione atomica di utente, profilo e consenso privacy resta invariata.

-- ---------------------------------------------------------------------------------------------
-- 1. Azzeramento della password alla prima conferma dell'email
-- ---------------------------------------------------------------------------------------------

-- Condizione (osservata sugli UPDATE reali di GoTrue, SPECIFICA §23.12 A):
--   * `old.email_confirmed_at is null and new.email_confirmed_at is not null`: è la PRIMA conferma;
--   * `old.confirmation_sent_at is not null`: la conferma è passata dal flusso email (signUp). Gli utenti
--     creati dall'amministratore con `email_confirm: true` non hanno mai `confirmation_sent_at`, quindi
--     la loro password NON viene azzerata. Non togliere questa clausola.
-- Il trigger gira con i privilegi di chi aggiorna (SECURITY INVOKER): modifica solo `new`.
create or replace function private.wipe_password_on_first_confirmation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null
     and old.confirmation_sent_at is not null then
    new.encrypted_password := null;
  end if;
  return new;
end;
$$;

create trigger wipe_password_on_first_confirmation
  before update on auth.users
  for each row execute function private.wipe_password_on_first_confirmation();

-- ---------------------------------------------------------------------------------------------
-- 2. Stato "password da scegliere" (colonna additiva)
-- ---------------------------------------------------------------------------------------------

-- `true` dal trigger quando la password viene azzerata, `false` quando torna valorizzata.
-- Nessun privilegio nuovo: la lettura deriva dal grant SELECT di tabella già concesso da M2
-- (`profiles_select_own` limita ogni utente alla propria riga); la colonna NON è nella lista dei
-- privilegi di UPDATE né di INSERT, quindi il client non può scriverla.
alter table public.profiles
  add column password_setup_pending boolean not null default false;

comment on column public.profiles.password_setup_pending is
  'true se l''email è confermata ma la password va ancora scelta. Mantenuta dal trigger su auth.users; sola lettura per i client.';

-- ---------------------------------------------------------------------------------------------
-- 3. Coerenza del flag
-- ---------------------------------------------------------------------------------------------

-- SECURITY DEFINER: deve poter aggiornare `profiles`, dove i client non hanno UPDATE su questa colonna.
-- Scrive esclusivamente la riga dell'utente indicato. Lo stesso statement e la stessa transazione di
-- GoTrue: se l'UPDATE del flag fallisce, fallisce l'intera conferma (fail-closed).
-- Nota: se il profilo non esiste l'UPDATE tocca 0 righe senza errori; l'invariante di M2 (un profilo per
-- ogni utente) è protetta dai test, non da questo trigger.
create or replace function private.track_password_setup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.encrypted_password is not null and new.encrypted_password is null then
    update public.profiles set password_setup_pending = true where id = new.id;
  elsif old.encrypted_password is null and new.encrypted_password is not null then
    update public.profiles set password_setup_pending = false where id = new.id;
  end if;
  return null;
end;
$$;

-- Niente `UPDATE OF encrypted_password`: non scatterebbe quando la colonna è azzerata da un trigger
-- BEFORE (l'UPDATE di GoTrue non la elenca nel SET). La clausola WHEN limita l'esecuzione ai cambi reali.
create trigger track_password_setup
  after update on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.track_password_setup();

-- ---------------------------------------------------------------------------------------------
-- Privilegi delle funzioni
-- ---------------------------------------------------------------------------------------------

-- PostgreSQL concede EXECUTE a PUBLIC per default. Le funzioni di trigger non vanno chiamate da nessun
-- client (lo schema `private` non è esposto): si revoca comunque. Il funzionamento dei trigger CON la
-- revoca è verificato da test (pgTAP e integrazione con GoTrue reale), non presunto.
revoke execute on function private.wipe_password_on_first_confirmation() from public, anon, authenticated;
revoke execute on function private.track_password_setup() from public, anon, authenticated;
