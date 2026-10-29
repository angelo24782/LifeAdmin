-- Privilegi di tabella attesi per anon, authenticated e service_role: dichiarati dalle migration,
-- mai ereditati dai grant automatici di Supabase. I privilegi di colonna sono nei test 10–50.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- anon: nessun privilegio -------------------------------------------------------------------------
select table_privs_are('public', t, 'anon', array[]::name[], format('anon: nessun privilegio su %I', t))
from unnest(array['profiles', 'categories', 'life_items', 'recurrence_rules', 'item_completions']) as t;          -- 5

-- authenticated: privilegi di tabella (INSERT/UPDATE solo per colonna) -----------------------------
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT']::name[], 'authenticated: profiles SELECT');      -- 6
select table_privs_are('public', 'categories', 'authenticated', array['SELECT']::name[], 'authenticated: categories SELECT');  -- 7
select table_privs_are('public', 'life_items', 'authenticated', array['DELETE', 'SELECT']::name[],
  'authenticated: life_items SELECT, DELETE');                                                                                  -- 8
select table_privs_are('public', 'recurrence_rules', 'authenticated', array['DELETE', 'SELECT']::name[],
  'authenticated: recurrence_rules SELECT, DELETE');                                                                            -- 9
select table_privs_are('public', 'item_completions', 'authenticated', array['SELECT']::name[],
  'authenticated: item_completions SELECT');                                                                                    -- 10

-- service_role: solo ciò che è usato oggi (test di integrazione) ----------------------------------------
select table_privs_are('public', 'profiles', 'service_role', array['DELETE', 'SELECT']::name[],
  'service_role: profiles SELECT, DELETE');                                                                                     -- 11
select table_privs_are('public', 'categories', 'service_role', array['INSERT', 'SELECT']::name[],
  'service_role: categories SELECT, INSERT');                                                                                   -- 12
select table_privs_are('public', 'life_items', 'service_role', array['SELECT']::name[], 'service_role: life_items SELECT');   -- 13
select table_privs_are('public', t, 'service_role', array[]::name[], format('service_role: nessun privilegio su %I', t))
from unnest(array['recurrence_rules', 'item_completions']) as t;                                                                -- 15

-- MAINTAIN (PostgreSQL 17) non è nell'elenco controllato da table_privs_are di pgTAP 1.3.3.
select is(
  (select count(*) from pg_class c cross join unnest(array['anon', 'authenticated', 'service_role']) as r
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege(r, c.oid, 'MAINTAIN')),
  0::bigint, 'nessun ruolo della Data API ha MAINTAIN sulle tabelle di public');                                               -- 16

-- Guardia: una tabella applicativa nuova in public deve dichiarare qui i propri privilegi attesi.
select is(
  (select count(*) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and c.relname <> all (array['profiles', 'categories', 'life_items', 'recurrence_rules', 'item_completions'])
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')),
  0::bigint, 'ogni tabella applicativa di public ha i privilegi attesi dichiarati in questo test');                            -- 17

select * from finish();
rollback;
