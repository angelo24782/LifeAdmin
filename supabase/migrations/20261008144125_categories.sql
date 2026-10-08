-- M2 · 3/5 · `categories`: categorie di sistema (owner_id NULL) e predisposizione per quelle personali.
--
-- Nell'MVP esistono solo categorie di sistema, di sola lettura per i client. La colonna `owner_id` e la
-- policy di lettura sono già pronte per categorie personali future (nessuna policy di scrittura).

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  icon text not null,
  sort_order smallint not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint categories_slug_format check (slug ~ '^[a-z0-9-]+$'),
  constraint categories_name_length check (char_length(name) between 1 and 60)
);

comment on table public.categories is
  'owner_id NULL = categoria di sistema, visibile a tutti gli utenti autenticati; altrimenti categoria personale del proprietario.';

-- Unicità separata per sistema e per utente (gli indici parziali evitano il problema dei NULL).
create unique index categories_system_slug_key on public.categories (slug) where owner_id is null;
create unique index categories_owner_slug_key on public.categories (owner_id, slug) where owner_id is not null;
create index categories_owner_id_idx on public.categories (owner_id);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

create trigger categories_prevent_owner_change
  before update of owner_id on public.categories
  for each row execute function private.prevent_owner_change();

-- ---------------------------------------------------------------------------------------------
-- Privilegi e RLS
-- ---------------------------------------------------------------------------------------------

alter table public.categories enable row level security;

revoke all on table public.categories from public, anon, authenticated;
grant select on table public.categories to authenticated;

-- SELECT: categorie di sistema + proprie. Le categorie personali di un altro utente non sono
-- visibili: questa visibilità è riusata dalle policy di `life_items` per validare `category_id`.
create policy categories_select_visible on public.categories
  for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

-- Nessuna policy né privilegio di INSERT/UPDATE/DELETE per i client (MVP: dati gestiti da migration).

-- ---------------------------------------------------------------------------------------------
-- Dati di sistema (necessari in ogni ambiente, quindi in migration e non in seed.sql).
-- Idempotente: riesecuzione = aggiornamento per slug. Nessuna categoria "Salute" nell'MVP.
-- `icon` è il nome di un'icona lucide risolta dal client.
-- ---------------------------------------------------------------------------------------------
insert into public.categories (slug, name, icon, sort_order)
values
  ('auto', 'Auto e mezzi', 'car', 10),
  ('assicurazioni', 'Assicurazioni', 'shield-check', 20),
  ('casa', 'Casa', 'house', 30),
  ('documenti', 'Documenti personali', 'id-card', 40),
  ('abbonamenti', 'Abbonamenti', 'repeat', 50),
  ('contratti', 'Contratti e utenze', 'file-text', 60),
  ('garanzie', 'Garanzie', 'badge-check', 70),
  ('altro', 'Altro', 'folder', 90)
on conflict (slug) where owner_id is null
do update set
  name = excluded.name,
  icon = excluded.icon,
  sort_order = excluded.sort_order;
