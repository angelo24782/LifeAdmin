-- M2 · 1/5 · Fondamenta: schema `private` e funzioni di supporto.
--
-- Lo schema `private` NON è esposto da PostgREST (config.toml [api] schemas = public, graphql_public):
-- ospita trigger e funzioni interne che i client non devono mai poter chiamare come RPC.

create schema if not exists private;

-- Nessun accesso diretto allo schema per i ruoli client. `service_role` e i proprietari non ne hanno
-- bisogno: i trigger richiamano le funzioni per OID.
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Trigger generici
-- ---------------------------------------------------------------------------------------------

-- Mantiene `updated_at` (il client non ha il privilegio di scriverlo).
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- `owner_id` è immutabile (SPECIFICA §5/§6): seconda barriera dopo l'assenza del privilegio di colonna.
create or replace function private.prevent_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Funzioni di validazione pure
-- ---------------------------------------------------------------------------------------------

-- Preavvisi di una scadenza: al massimo 5 valori interi 0..365, senza duplicati né NULL.
-- L'array vuoto è ammesso ("nessun avviso"). Usata da un CHECK, quindi IMMUTABLE.
create or replace function private.valid_reminder_days(days smallint[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    days is not null
    and coalesce(array_ndims(days), 1) = 1
    and cardinality(days) <= 5
    and array_position(days, null) is null
    and not exists (select 1 from unnest(days) as d where d < 0 or d > 365)
    and (select count(distinct d) = count(*) from unnest(days) as d)
$$;

-- ---------------------------------------------------------------------------------------------
-- Versioni di privacy policy supportate dal backend (fonte server-side semplice e verificabile).
-- Per supportare una nuova versione si ridefinisce questa funzione con una nuova migration.
-- ---------------------------------------------------------------------------------------------
create or replace function private.supported_privacy_versions()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array['2026-10-01']::text[]
$$;
