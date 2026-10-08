-- Struttura dello schema, privilegi e regole trasversali di sicurezza (test "meta").
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Tabelle e tipi ---------------------------------------------------------------------------------
select has_table('public', t, format('tabella public.%I esiste', t))
from unnest(array['profiles', 'categories', 'life_items', 'recurrence_rules', 'item_completions']) as t;  -- 5

select has_type('public', 'item_status', 'enum item_status esiste');                                         -- 6
select enum_has_labels('public', 'item_status', array['active', 'completed'], 'item_status: valori');         -- 7
select has_type('public', 'recurrence_unit', 'enum recurrence_unit esiste');                                  -- 8
select enum_has_labels('public', 'recurrence_unit', array['day', 'week', 'month', 'year'], 'recurrence_unit: valori'); -- 9

-- Colonne chiave ----------------------------------------------------------------------------------------
select col_type_is('public', 'life_items', 'reminder_days', 'smallint[]', 'life_items.reminder_days è smallint[]'); -- 10
select col_type_is('public', 'life_items', 'due_date', 'date', 'life_items.due_date è date');                       -- 11
select col_type_is('public', 'life_items', 'amount_cents', 'bigint', 'life_items.amount_cents è bigint');           -- 12
select col_default_is('public', 'life_items', 'reminder_days', '{30,7,1}', 'preavvisi di default 30/7/1');          -- 13
select col_not_null('public', 'life_items', 'owner_id', 'life_items.owner_id NOT NULL');                            -- 14
select col_not_null('public', 'recurrence_rules', 'owner_id', 'recurrence_rules.owner_id NOT NULL');                -- 15
select col_not_null('public', 'profiles', 'privacy_accepted_at', 'profiles.privacy_accepted_at NOT NULL');          -- 16

-- Chiavi primarie ----------------------------------------------------------------------------------------
select col_is_pk('public', t, 'id', format('%I: PK su id', t))
from unnest(array['profiles', 'categories', 'life_items', 'recurrence_rules', 'item_completions']) as t;           -- 21

-- Chiavi esterne composte (item_id, owner_id) -> life_items(id, owner_id) ---------------------------------------
select fk_ok('public', 'recurrence_rules', array['item_id', 'owner_id'], 'public', 'life_items', array['id', 'owner_id'],
  'recurrence_rules: FK composta (item_id, owner_id)');                                                              -- 22
select fk_ok('public', 'item_completions', array['item_id', 'owner_id'], 'public', 'life_items', array['id', 'owner_id'],
  'item_completions: FK composta (item_id, owner_id)');                                                              -- 23
select col_is_unique('public', 'life_items', array['id', 'owner_id'], 'life_items: UNIQUE (id, owner_id)');          -- 24

-- Indici ---------------------------------------------------------------------------------------------------------
select has_index('public', 'life_items', 'life_items_owner_status_due_idx', 'life_items: indice (owner_id, status, due_date)'); -- 25
select has_index('public', 'life_items', 'life_items_category_id_idx', 'life_items: indice category_id');                      -- 26
select has_index('public', 'categories', 'categories_system_slug_key', 'categories: unicità slug di sistema');                  -- 27
select has_index('public', 'item_completions', 'item_completions_item_completed_idx', 'item_completions: indice storico');     -- 28

-- Sicurezza trasversale ---------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint, 'RLS abilitata su TUTTE le tabelle di public');                                                         -- 29

select is(
  (select count(*) from information_schema.role_table_grants where grantee in ('anon', 'PUBLIC') and table_schema = 'public'),
  0::bigint, 'anon/PUBLIC non hanno alcun privilegio sulle tabelle di public');                                       -- 30

select is(
  (select count(*) from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')),
  0::bigint, 'nessuna policy permissiva "using (true)"');                                                            -- 31

select is(
  (select count(*) from pg_policies where schemaname = 'public' and roles <> '{authenticated}'::name[]),
  0::bigint, 'tutte le policy sono limitate al ruolo authenticated');                                                -- 32

-- Ogni tabella con `owner_id` deve avere una FK in cascata che lo coinvolge (verso auth.users o la FK composta).
select is(
  (select count(*)
   from information_schema.columns col
   where col.table_schema = 'public' and col.column_name = 'owner_id'
     and not exists (
       select 1 from pg_constraint k
       where k.contype = 'f' and k.confdeltype = 'c'
         and k.conrelid = format('public.%I', col.table_name)::regclass
         and (select attnum from pg_attribute where attrelid = k.conrelid and attname = 'owner_id') = any (k.conkey))),
  0::bigint, 'ogni tabella con owner_id ha una FK ON DELETE CASCADE che lo include');                                 -- 33

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  0::bigint, 'nessuna funzione applicativa in public (nessun RPC esposto da PostgREST)');                            -- 34

select * from finish();
rollback;
