-- M2 · 2/5 · `profiles`: profilo applicativo 1:1 con `auth.users`.
--
-- Separazione delle responsabilità:
--   * la creazione dell'UTENTE è di Supabase Auth (auth.users);
--   * la creazione/attivazione del PROFILO applicativo avviene solo se esiste un consenso privacy
--     valido (private.create_profile_for_user). Il trigger su auth.users è un semplice adattatore.
-- Se il consenso manca o non è supportato, l'intera registrazione viene rifiutata in modo atomico:
-- non possono esistere utenti Auth senza profilo.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'Europe/Rome',
  locale text not null default 'it',
  email_notifications_enabled boolean not null default true,
  notification_hour smallint not null default 9,
  onboarding_completed_at timestamptz,
  privacy_accepted_at timestamptz not null,
  privacy_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 80),
  constraint profiles_locale_supported check (locale in ('it')),
  constraint profiles_notification_hour_range check (notification_hour between 0 and 23),
  constraint profiles_privacy_version_format check (privacy_version ~ '^\d{4}-\d{2}-\d{2}$')
);

comment on table public.profiles is
  'Profilo applicativo (1:1 con auth.users). Creato solo da private.create_profile_for_user con consenso privacy valido.';
comment on column public.profiles.privacy_accepted_at is
  'Istante di accettazione, valorizzato con now() lato database: mai fornito dal client.';

-- ---------------------------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------------------------

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Un CHECK non può dipendere da un catalogo (non è immutabile), quindi la validità del fuso orario si
-- verifica in un trigger. Il trigger gira con i privilegi di chi aggiorna (non è SECURITY DEFINER):
-- usa solo `pg_catalog`, sempre accessibile, e nessun oggetto di `private`.
create or replace function private.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid timezone: %', new.timezone using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_validate_timezone
  before insert or update of timezone on public.profiles
  for each row execute function private.validate_profile_timezone();

-- ---------------------------------------------------------------------------------------------
-- Attivazione del profilo (logica) e adattatore sul trigger di auth.users
-- ---------------------------------------------------------------------------------------------

-- SECURITY DEFINER: deve poter inserire in `profiles`, dove i client non hanno INSERT.
-- Scrive esclusivamente la riga dell'utente indicato.
create or replace function private.create_profile_for_user(p_user_id uuid, p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := nullif(btrim(p_metadata ->> 'privacy_version'), '');
  v_display_name text := nullif(btrim(p_metadata ->> 'display_name'), '');
begin
  if v_version is null then
    raise exception 'privacy_version_missing: privacy consent is required to create a profile';
  end if;

  if not (v_version = any (private.supported_privacy_versions())) then
    raise exception 'privacy_version_unsupported: %', v_version;
  end if;

  -- `privacy_accepted_at` è SEMPRE now() lato database: qualunque timestamp nei metadata è ignorato.
  insert into public.profiles (id, display_name, privacy_accepted_at, privacy_version)
  values (p_user_id, v_display_name, now(), v_version);
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_profile_for_user(new.id, coalesce(new.raw_user_meta_data, '{}'::jsonb));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Privilegi e RLS
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
-- Solo preferenze modificabili dall'utente: `id`, `locale`, `privacy_*` e timestamp restano esclusi.
grant update (
  display_name,
  timezone,
  email_notifications_enabled,
  notification_hour,
  onboarding_completed_at
) on table public.profiles to authenticated;

-- SELECT: ognuno legge solo il proprio profilo.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- UPDATE: solo la propria riga, e non può "passarla" ad altri.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Nessuna policy né privilegio di INSERT/DELETE per i client: il profilo nasce dal trigger e
-- scompare con l'account (cascade da auth.users).
