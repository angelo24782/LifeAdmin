-- M2 · 4/5 · `life_items`: la scadenza (entità centrale del prodotto).
--
-- Solo modello dati: nessuna logica di ricorrenza/completamento (M6), nessuna pianificazione avvisi (M9).

create type public.item_status as enum ('active', 'completed');

create table public.life_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  title text not null,
  due_date date not null,
  amount_cents bigint,
  notes text,
  reminder_days smallint[] not null default '{30,7,1}',
  status public.item_status not null default 'active',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Necessario per le FK composte `(item_id, owner_id)` delle tabelle figlie: un figlio non può
  -- appartenere a un utente diverso da quello del suo item (SPECIFICA §5).
  constraint life_items_id_owner_key unique (id, owner_id),

  constraint life_items_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint life_items_amount_range check (amount_cents is null or amount_cents between 0 and 100000000000),
  constraint life_items_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint life_items_reminder_days_valid check (private.valid_reminder_days(reminder_days)),
  constraint life_items_completed_consistency check ((status = 'completed') = (completed_at is not null))
);

comment on table public.life_items is
  'Scadenza dell''utente. Isolata per owner_id; le tabelle figlie la referenziano con FK composta (id, owner_id).';

-- Query di dashboard e lista: filtro per proprietario e stato, ordinamento per scadenza.
create index life_items_owner_status_due_idx on public.life_items (owner_id, status, due_date);
-- Filtro per categoria e FK `on delete restrict` senza scansioni complete.
create index life_items_category_id_idx on public.life_items (category_id);

create trigger life_items_set_updated_at
  before update on public.life_items
  for each row execute function private.set_updated_at();

create trigger life_items_prevent_owner_change
  before update of owner_id on public.life_items
  for each row execute function private.prevent_owner_change();

-- ---------------------------------------------------------------------------------------------
-- Privilegi e RLS
-- ---------------------------------------------------------------------------------------------

alter table public.life_items enable row level security;

revoke all on table public.life_items from public, anon, authenticated;
grant select, delete on table public.life_items to authenticated;
-- `owner_id` NON è inseribile né aggiornabile dal client: lo valorizza `default auth.uid()`.
-- La policy WITH CHECK resta comunque come seconda barriera. `status`/`completed_at` non sono
-- inseribili (una nuova scadenza è sempre attiva), ma lo sono in UPDATE ("Riapri", completamento).
grant insert (id, category_id, title, due_date, amount_cents, notes, reminder_days)
  on table public.life_items to authenticated;
grant update (category_id, title, due_date, amount_cents, notes, reminder_days, status, completed_at)
  on table public.life_items to authenticated;

-- SELECT: solo le proprie scadenze.
create policy life_items_select_own on public.life_items
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- INSERT: la riga deve appartenere a chi la crea E usare una categoria che l'utente può vedere.
-- La subquery su `categories` è soggetta alla RLS dell'utente chiamante: una categoria personale di
-- un altro utente non è visibile, quindi non è referenziabile (la sola FK non lo impedirebbe).
create policy life_items_insert_own on public.life_items
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.categories c where c.id = life_items.category_id)
  );

-- UPDATE: solo le proprie righe; la categoria (anche se invariata) deve restare visibile.
create policy life_items_update_own on public.life_items
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.categories c where c.id = life_items.category_id)
  );

-- DELETE: solo le proprie righe (le figlie seguono per cascade).
create policy life_items_delete_own on public.life_items
  for delete to authenticated
  using (owner_id = (select auth.uid()));
