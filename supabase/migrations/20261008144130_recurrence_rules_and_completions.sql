-- M2 · 5/5 · `recurrence_rules` e `item_completions`: tabelle figlie di `life_items`.
--
-- Solo modello dati e sicurezza. Il calcolo delle occorrenze (`recurrence_next`) e il completamento
-- (`complete_life_item`) arrivano in M6. Entrambe usano la FK composta (item_id, owner_id) →
-- life_items(id, owner_id): il database impedisce che un figlio appartenga a un altro utente.

create type public.recurrence_unit as enum ('day', 'week', 'month', 'year');

-- ---------------------------------------------------------------------------------------------
-- recurrence_rules: al più una regola per scadenza.
-- ---------------------------------------------------------------------------------------------
create table public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  owner_id uuid not null default auth.uid(),
  interval_unit public.recurrence_unit not null,
  interval_count smallint not null default 1,
  anchor_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recurrence_rules_item_key unique (item_id),
  constraint recurrence_rules_item_owner_fkey
    foreign key (item_id, owner_id) references public.life_items (id, owner_id) on delete cascade,
  constraint recurrence_rules_interval_count_range check (interval_count between 1 and 120)
);

comment on table public.recurrence_rules is
  'Regola di ricorrenza di una scadenza: occorrenze = anchor_date + k × intervallo (calcolo in M6).';

create index recurrence_rules_owner_id_idx on public.recurrence_rules (owner_id);

create trigger recurrence_rules_set_updated_at
  before update on public.recurrence_rules
  for each row execute function private.set_updated_at();

create trigger recurrence_rules_prevent_owner_change
  before update of owner_id on public.recurrence_rules
  for each row execute function private.prevent_owner_change();

alter table public.recurrence_rules enable row level security;

revoke all on table public.recurrence_rules from public, anon, authenticated;
grant select, delete on table public.recurrence_rules to authenticated;
-- `owner_id` valorizzato da `default auth.uid()`; `item_id` non è più modificabile dopo l'inserimento,
-- così una regola non può essere spostata su un'altra scadenza.
grant insert (item_id, interval_unit, interval_count, anchor_date) on table public.recurrence_rules to authenticated;
grant update (interval_unit, interval_count, anchor_date) on table public.recurrence_rules to authenticated;

-- SELECT/INSERT/UPDATE/DELETE: solo righe del proprietario. Per INSERT la coerenza con l'item è
-- imposta dalla FK composta: (item_id, owner_id) deve esistere in life_items, quindi l'item è
-- necessariamente di chi inserisce.
create policy recurrence_rules_select_own on public.recurrence_rules
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy recurrence_rules_insert_own on public.recurrence_rules
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy recurrence_rules_update_own on public.recurrence_rules
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy recurrence_rules_delete_own on public.recurrence_rules
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- item_completions: storico delle scadenze gestite (scrittura riservata a `complete_life_item`, M6).
-- ---------------------------------------------------------------------------------------------
create table public.item_completions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  owner_id uuid not null,
  due_date date not null,
  completed_at timestamptz not null default now(),

  constraint item_completions_item_owner_fkey
    foreign key (item_id, owner_id) references public.life_items (id, owner_id) on delete cascade
);

comment on table public.item_completions is
  'Storico dei completamenti. Sola lettura per i client; la scrittura avverrà solo tramite complete_life_item (M6).';

create index item_completions_item_completed_idx on public.item_completions (item_id, completed_at desc);
create index item_completions_owner_id_idx on public.item_completions (owner_id);

create trigger item_completions_prevent_owner_change
  before update of owner_id on public.item_completions
  for each row execute function private.prevent_owner_change();

alter table public.item_completions enable row level security;

revoke all on table public.item_completions from public, anon, authenticated;
grant select on table public.item_completions to authenticated;

create policy item_completions_select_own on public.item_completions
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Nessuna policy né privilegio di INSERT/UPDATE/DELETE per i client.
