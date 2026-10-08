-- recurrence_rules e item_completions: FK composta (item_id, owner_id) e isolamento RLS A/B.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test', '{"privacy_version":"2026-10-01"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test', '{"privacy_version":"2026-10-01"}');

-- Due scadenze per A e due per B (la seconda di B resta senza regola).
insert into public.life_items (id, owner_id, category_id, title, due_date)
select v.id::uuid, v.owner::uuid, c.id, v.title, '2026-12-15'
from (values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Assicurazione A'),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bollo A'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Assicurazione B'),
  ('b1000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bollo B (senza regola)')
) as v(id, owner, title)
cross join public.categories c where c.slug = 'altro' and c.owner_id is null;

-- Regola e completamento di B (ruolo di servizio).
insert into public.recurrence_rules (id, item_id, owner_id, interval_unit, interval_count, anchor_date) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'year', 1, '2026-12-15');
insert into public.item_completions (id, item_id, owner_id, due_date) values
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2025-12-15');
-- Completamento di A.
insert into public.item_completions (id, item_id, owner_id, due_date) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2025-12-15');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'discard plans';
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'discard plans';
  perform set_config('role', 'anon', true);
end $$;

-- ===== La FK composta vale anche per il ruolo di servizio (indipendente dalla RLS) ==============================
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, owner_id, interval_unit, anchor_date)
     values ('b1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'month', '2026-12-15') $$,
  '23503', null, 'FK composta: una regola di A non può puntare alla scadenza di B (anche senza RLS)');                  -- 1
select throws_ok(
  $$ insert into public.item_completions (item_id, owner_id, due_date)
     values ('b1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-01-01') $$,
  '23503', null, 'FK composta: un completamento di A non può puntare alla scadenza di B (anche senza RLS)');             -- 2
select throws_ok($$ update public.recurrence_rules set owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id = 'b2000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'owner_id di una regola è immutabile (trigger)');                                                    -- 3
select throws_ok($$ update public.item_completions set owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id = 'b3000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'owner_id di un completamento è immutabile (trigger)');                                              -- 4

-- ===== Utente A: regole ================================================================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select lives_ok(
  $$ insert into public.recurrence_rules (item_id, interval_unit, interval_count, anchor_date)
     values ('a1000000-0000-4000-8000-000000000001', 'year', 1, '2026-12-15') $$,
  'A crea una regola sulla propria scadenza');                                                                         -- 5
select is((select owner_id from public.recurrence_rules where item_id = 'a1000000-0000-4000-8000-000000000001'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'owner_id valorizzato automaticamente');                                -- 6

-- Relazione verso una risorsa di B: l'owner di default (A) non corrisponde -> FK composta.
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, interval_unit, anchor_date)
     values ('b1000000-0000-4000-8000-000000000002', 'month', '2026-12-15') $$,
  '23503', null, 'A non può creare una regola sulla scadenza di B (FK composta)');                                     -- 7
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, owner_id, interval_unit, anchor_date)
     values ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'month', '2026-12-15') $$,
  '42501', null, 'A non può indicare owner_id di B (privilegio di colonna)');                                          -- 8

-- Seconda barriera: concesso per errore il privilegio su owner_id, la policy WITH CHECK nega comunque.
reset role;
grant insert (owner_id) on public.recurrence_rules to authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, owner_id, interval_unit, anchor_date)
     values ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'month', '2026-12-15') $$,
  '42501', 'new row violates row-level security policy for table "recurrence_rules"', 'seconda barriera: la policy nega owner_id di B'); -- 9
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, owner_id, interval_unit, anchor_date)
     values ('a1000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'month', '2026-12-15') $$,
  '42501', 'new row violates row-level security policy for table "recurrence_rules"', 'owner_id di B con scadenza di A: la policy nega'); -- 10
reset role;
revoke insert (owner_id) on public.recurrence_rules from authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select throws_ok(
  $$ insert into public.recurrence_rules (item_id, interval_unit, anchor_date)
     values ('a1000000-0000-4000-8000-000000000001', 'month', '2026-12-15') $$,
  '23505', null, 'una sola regola per scadenza');                                                                      -- 11
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, interval_unit, interval_count, anchor_date)
     values ('a1000000-0000-4000-8000-000000000002', 'month', 0, '2026-12-15') $$,
  '23514', null, 'interval_count = 0 rifiutato');                                                                      -- 12
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, interval_unit, interval_count, anchor_date)
     values ('a1000000-0000-4000-8000-000000000002', 'month', 121, '2026-12-15') $$,
  '23514', null, 'interval_count = 121 rifiutato');                                                                    -- 13
select throws_ok(
  $$ insert into public.recurrence_rules (item_id, interval_unit, anchor_date)
     values ('a1000000-0000-4000-8000-000000000002', 'decade', '2026-12-15') $$,
  '22P02', null, 'unità non valida rifiutata');                                                                        -- 14

select is((select count(*) from public.recurrence_rules), 1::bigint, 'A vede solo la propria regola');               -- 15
select is_empty($$ select 1 from public.recurrence_rules where id = 'b2000000-0000-4000-8000-000000000001' $$,
  'A NON vede la regola di B');                                                                                        -- 16
select is_empty(
  $$ with u as (update public.recurrence_rules set interval_count = 9 where id = 'b2000000-0000-4000-8000-000000000001' returning id) select id from u $$,
  'A non può modificare la regola di B (0 righe)');                                                                    -- 17
select is_empty(
  $$ with d as (delete from public.recurrence_rules where id = 'b2000000-0000-4000-8000-000000000001' returning id) select id from d $$,
  'A non può cancellare la regola di B (0 righe)');                                                                    -- 18

select lives_ok($$ update public.recurrence_rules set interval_count = 2 where item_id = 'a1000000-0000-4000-8000-000000000001' $$,
  'A modifica la propria regola');                                                                                     -- 19
select throws_ok($$ update public.recurrence_rules set item_id = 'a1000000-0000-4000-8000-000000000002' where item_id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'una regola non può essere spostata su un''altra scadenza (item_id non aggiornabile)');                -- 20
select throws_ok($$ update public.recurrence_rules set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where item_id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'owner_id di una regola non è aggiornabile dal client');                                              -- 21

-- ===== Utente A: completamenti (sola lettura) ===================================================================
select is((select count(*) from public.item_completions), 1::bigint, 'A vede solo i propri completamenti');          -- 22
select is_empty($$ select 1 from public.item_completions where id = 'b3000000-0000-4000-8000-000000000001' $$,
  'A NON vede il completamento di B');                                                                                 -- 23
select throws_ok(
  $$ insert into public.item_completions (item_id, owner_id, due_date) values ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-01-01') $$,
  '42501', null, 'A non può scrivere completamenti (riservati a complete_life_item)');                                  -- 24
select throws_ok($$ update public.item_completions set due_date = '2000-01-01' $$,
  '42501', null, 'A non può modificare completamenti');                                                                -- 25
select throws_ok($$ delete from public.item_completions $$, '42501', null, 'A non può cancellare completamenti');      -- 26

-- ===== Accesso anonimo =================================================================================================
reset role;
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.recurrence_rules $$, '42501', null, 'anon: lettura regole negata');          -- 27
select throws_ok($$ select * from public.item_completions $$, '42501', null, 'anon: lettura completamenti negata');   -- 28

-- ===== Cascata dalla scadenza ====================================================================================================
reset role;
select is((select count(*) from public.recurrence_rules where item_id = 'a1000000-0000-4000-8000-000000000001'), 1::bigint,
  'la regola di A esiste prima della cancellazione');                                                                  -- 29
delete from public.life_items where id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*) from public.recurrence_rules where item_id = 'a1000000-0000-4000-8000-000000000001'), 0::bigint,
  'cancellando la scadenza la regola scompare (cascade)');                                                             -- 30
select is((select count(*) from public.item_completions where item_id = 'a1000000-0000-4000-8000-000000000001'), 0::bigint,
  'cancellando la scadenza i completamenti scompaiono (cascade)');                                                     -- 31

-- I dati di B sono intatti; la cancellazione dell'utente porta via anche i figli.
select is((select interval_count from public.recurrence_rules where id = 'b2000000-0000-4000-8000-000000000001'), 1::smallint,
  'la regola di B è invariata');                                                                                       -- 32
delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*) from public.recurrence_rules where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0::bigint,
  'cancellando l''utente le sue regole scompaiono (cascade)');                                                         -- 33
select is((select count(*) from public.item_completions where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0::bigint,
  'cancellando l''utente i suoi completamenti scompaiono (cascade)');                                                  -- 34

select * from finish();
rollback;
