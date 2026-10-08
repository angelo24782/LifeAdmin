-- life_items: vincoli di dominio, ownership e isolamento RLS A/B.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test', '{"privacy_version":"2026-10-01"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test', '{"privacy_version":"2026-10-01"}');

-- Categoria personale di B (creata dal ruolo di servizio).
insert into public.categories (id, owner_id, slug, name, icon) values
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mia', 'Categoria di B', 'folder');

-- Una scadenza per ciascun utente (inserita dal ruolo di servizio). `updated_at` nel passato per il test del trigger.
insert into public.life_items (id, owner_id, category_id, title, due_date, updated_at)
select 'a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', c.id, 'Assicurazione A', '2026-12-15', '2000-01-01'
from public.categories c where c.slug = 'assicurazioni' and c.owner_id is null;
insert into public.life_items (id, owner_id, category_id, title, due_date)
select 'b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', c.id, 'Bollo B', '2026-11-01'
from public.categories c where c.slug = 'auto' and c.owner_id is null;

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

-- Default dichiarati ------------------------------------------------------------------------------------------
select is((select reminder_days from public.life_items where id = 'a1000000-0000-4000-8000-000000000001'), '{30,7,1}'::smallint[],
  'preavvisi di default 30/7/1');                                                                                     -- 1
select is((select status from public.life_items where id = 'a1000000-0000-4000-8000-000000000001'), 'active'::public.item_status,
  'stato di default: active');                                                                                        -- 2

-- ===== Utente A: lettura ======================================================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select is((select count(*) from public.life_items), 1::bigint, 'A vede solo le proprie scadenze');                    -- 3
select is((select title from public.life_items), 'Assicurazione A', 'la scadenza visibile è quella di A');            -- 4
select is_empty($$ select 1 from public.life_items where id = 'b1000000-0000-4000-8000-000000000001' $$,
  'A NON vede la scadenza di B');                                                                                     -- 5

-- ===== Utente A: scrittura sui propri dati ====================================================================
select lives_ok(
  $$ insert into public.life_items (id, category_id, title, due_date, amount_cents, notes, reminder_days)
     select 'a1000000-0000-4000-8000-000000000002', c.id, 'Revisione', '2027-03-01', 6600, 'note', '{14,3}'
     from public.categories c where c.slug = 'auto' and c.owner_id is null $$,
  'A crea una scadenza con una categoria di sistema');                                                                -- 6
select is((select owner_id from public.life_items where id = 'a1000000-0000-4000-8000-000000000002'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'owner_id valorizzato automaticamente con l''utente corrente');       -- 7

select lives_ok($$ update public.life_items set title = 'Assicurazione auto' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'A modifica la propria scadenza');                                                                                  -- 8
reset role;
select is((select updated_at from public.life_items where id = 'a1000000-0000-4000-8000-000000000001'), now(),
  'updated_at aggiornato dal trigger');                                                                               -- 9
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- ===== Cross-user: A contro i dati di B =========================================================================
select is_empty(
  $$ with u as (update public.life_items set title = 'hacked' where id = 'b1000000-0000-4000-8000-000000000001' returning id) select id from u $$,
  'A non può modificare la scadenza di B (0 righe)');                                                                 -- 10
select is_empty(
  $$ with d as (delete from public.life_items where id = 'b1000000-0000-4000-8000-000000000001' returning id) select id from d $$,
  'A non può cancellare la scadenza di B (0 righe)');                                                                 -- 11

-- Categoria personale di B: non utilizzabile da A (RLS WITH CHECK, subquery soggetta alla RLS di categories).
select throws_ok(
  $$ insert into public.life_items (category_id, title, due_date) values ('b0000000-0000-4000-8000-000000000001', 'Con categoria di B', '2027-01-01') $$,
  '42501', 'new row violates row-level security policy for table "life_items"', 'A non può creare una scadenza con la categoria personale di B'); -- 12
select throws_ok(
  $$ update public.life_items set category_id = 'b0000000-0000-4000-8000-000000000001' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', 'new row violates row-level security policy for table "life_items"', 'A non può spostare la propria scadenza nella categoria di B'); -- 13
select lives_ok(
  $$ insert into public.life_items (category_id, title, due_date)
     select c.id, 'Con categoria di sistema', '2027-01-01' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  'A può usare una categoria di sistema');                                                                            -- 14

-- Ownership: `owner_id` non è scrivibile dal client ... ---------------------------------------------------------------
select throws_ok(
  $$ insert into public.life_items (owner_id, category_id, title, due_date)
     select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', c.id, 'Per conto di B', '2027-01-01' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '42501', null, 'A non può inserire una scadenza con owner_id di B (privilegio di colonna)');                         -- 15
select throws_ok($$ update public.life_items set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'A non può cedere la propria scadenza a B (privilegio di colonna)');                                  -- 16
select throws_ok($$ insert into public.life_items (category_id, title, due_date, status)
     select c.id, 'x', '2027-01-01', 'completed' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '42501', null, 'status non è inseribile dal client');                                                               -- 17

-- ... e anche se il privilegio venisse concesso per errore, la policy WITH CHECK resta una seconda barriera.
reset role;
grant insert (owner_id) on public.life_items to authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select throws_ok(
  $$ insert into public.life_items (owner_id, category_id, title, due_date)
     select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', c.id, 'Per conto di B', '2027-01-01' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '42501', 'new row violates row-level security policy for table "life_items"', 'seconda barriera: la policy WITH CHECK nega owner_id di B'); -- 18
reset role;
revoke insert (owner_id) on public.life_items from authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- ===== Vincoli di dominio ==========================================================================================
select throws_ok($$ insert into public.life_items (category_id, title, due_date)
     select c.id, '   ', '2027-01-01' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'titolo di soli spazi rifiutato');                                                                   -- 19
select throws_ok($$ insert into public.life_items (category_id, title, due_date)
     select c.id, repeat('x', 121), '2027-01-01' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'titolo oltre 120 caratteri rifiutato');                                                             -- 20
select throws_ok($$ insert into public.life_items (category_id, title, due_date, amount_cents)
     select c.id, 'x', '2027-01-01', -1 from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'importo negativo rifiutato');                                                                       -- 21
select throws_ok($$ insert into public.life_items (category_id, title, due_date, amount_cents)
     select c.id, 'x', '2027-01-01', 100000000001 from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'importo oltre il massimo rifiutato');                                                               -- 22
select throws_ok($$ insert into public.life_items (category_id, title, due_date, notes)
     select c.id, 'x', '2027-01-01', repeat('n', 2001) from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'note oltre 2000 caratteri rifiutate');                                                              -- 23
select throws_ok($$ insert into public.life_items (category_id, title, due_date, reminder_days)
     select c.id, 'x', '2027-01-01', '{7,7}' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'preavvisi duplicati rifiutati');                                                                    -- 24
select throws_ok($$ insert into public.life_items (category_id, title, due_date, reminder_days)
     select c.id, 'x', '2027-01-01', '{1,2,3,4,5,6}' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'più di 5 preavvisi rifiutati');                                                                     -- 25
select throws_ok($$ insert into public.life_items (category_id, title, due_date, reminder_days)
     select c.id, 'x', '2027-01-01', '{366}' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'preavviso oltre 365 giorni rifiutato');                                                             -- 26
select throws_ok($$ insert into public.life_items (category_id, title, due_date, reminder_days)
     select c.id, 'x', '2027-01-01', '{-1}' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'preavviso negativo rifiutato');                                                                     -- 27
select throws_ok($$ insert into public.life_items (category_id, title, due_date, reminder_days)
     select c.id, 'x', '2027-01-01', array[1, null]::smallint[] from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  '23514', null, 'preavviso NULL rifiutato');                                                                         -- 28
select lives_ok($$ insert into public.life_items (category_id, title, due_date, reminder_days)
     select c.id, 'Senza avvisi', '2027-01-01', '{}' from public.categories c where c.slug = 'casa' and c.owner_id is null $$,
  'array di preavvisi vuoto ammesso');                                                                                -- 29

-- Coerenza status / completed_at
select throws_ok($$ update public.life_items set status = 'completed' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'completed senza completed_at rifiutato');                                                           -- 30
select throws_ok($$ update public.life_items set completed_at = now() where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'completed_at con stato active rifiutato');                                                          -- 31
select lives_ok($$ update public.life_items set status = 'completed', completed_at = now() where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'stato e completed_at coerenti accettati');                                                                         -- 32

-- ===== Accesso anonimo ===============================================================================================
reset role;
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.life_items $$, '42501', null, 'anon: lettura scadenze negata');             -- 33
select throws_ok($$ delete from public.life_items $$, '42501', null, 'anon: cancellazione scadenze negata');         -- 34

-- ===== Integrità a livello superutente (indipendente dalla RLS) ====================================================
reset role;
select throws_ok($$ update public.life_items set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'owner_id immutabile anche per il ruolo di servizio (trigger)');                                     -- 35
select throws_ok($$ delete from public.categories where slug = 'auto' and owner_id is null $$,
  '23503', null, 'una categoria in uso non può essere cancellata (ON DELETE RESTRICT)');                              -- 36

-- I dati di B sono rimasti intatti dopo tutti i tentativi di A.
select is((select title from public.life_items where id = 'b1000000-0000-4000-8000-000000000001'), 'Bollo B',
  'la scadenza di B è invariata');                                                                                    -- 37
select is((select count(*) from public.life_items where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint,
  'B ha ancora la sua scadenza');                                                                                     -- 38

-- Cascata alla cancellazione dell'utente
delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*) from public.life_items where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0::bigint,
  'cancellando l''utente le sue scadenze scompaiono (cascade)');                                                      -- 39
select is((select count(*) from public.life_items where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 4::bigint,
  'le scadenze di A non sono toccate');                                                                               -- 40

select * from finish();
rollback;
