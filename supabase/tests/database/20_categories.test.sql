-- categories: dati di sistema, categorie personali predisposte e isolamento RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test', '{"privacy_version":"2026-10-01"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test', '{"privacy_version":"2026-10-01"}');

-- Categorie personali (inserite dal ruolo di servizio: nell'MVP nessun client può crearle).
insert into public.categories (id, owner_id, slug, name, icon) values
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mia', 'Categoria di B', 'folder'),
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mia', 'Categoria di A', 'folder');

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

-- ===== Dati di sistema =====================================================================================
select results_eq(
  $$ select slug from public.categories where owner_id is null order by sort_order $$,
  $$ values ('auto'), ('assicurazioni'), ('casa'), ('documenti'), ('abbonamenti'), ('contratti'), ('garanzie'), ('altro') $$,
  'esistono le 8 categorie di sistema, nell''ordine previsto');                                                       -- 1
select is((select count(*) from public.categories where owner_id is null and slug = 'salute'), 0::bigint,
  'nessuna categoria "salute" nell''MVP');                                                                            -- 2

-- La migration è idempotente: riapplicare il seed non duplica né altera il conteggio.
insert into public.categories (slug, name, icon, sort_order) values ('auto', 'Auto e mezzi', 'car', 10)
  on conflict (slug) where owner_id is null do update set name = excluded.name;
select is((select count(*) from public.categories where owner_id is null), 8::bigint, 'seed idempotente');          -- 3

-- Vincoli --------------------------------------------------------------------------------------------------------
select throws_ok($$ insert into public.categories (slug, name, icon) values ('auto', 'Duplicata', 'car') $$,
  '23505', null, 'slug di sistema duplicato rifiutato');                                                              -- 4
select throws_ok($$ insert into public.categories (owner_id, slug, name, icon) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mia', 'Doppia', 'folder') $$,
  '23505', null, 'slug duplicato per lo stesso utente rifiutato');                                                    -- 5
select throws_ok($$ insert into public.categories (slug, name, icon) values ('Slug Non Valido', 'X', 'car') $$,
  '23514', null, 'slug con formato non valido rifiutato');                                                            -- 6
select throws_ok($$ update public.categories set owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'owner_id di una categoria è immutabile');                                                           -- 7

-- updated_at è mantenuto dal trigger (riga creata con updated_at nel passato).
insert into public.categories (id, slug, name, icon, updated_at) values
  ('c0000000-0000-4000-8000-000000000001', 'tmp-ts', 'Temp', 'folder', '2000-01-01');
update public.categories set name = 'Temp 2' where id = 'c0000000-0000-4000-8000-000000000001';
select is((select updated_at from public.categories where id = 'c0000000-0000-4000-8000-000000000001'), now(),
  'updated_at aggiornato dal trigger');                                                                               -- 8

-- ===== RLS: utente A =======================================================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select is((select count(*) from public.categories where owner_id is null), 9::bigint,
  'A vede le categorie di sistema (8 + la temporanea del test)');                                                     -- 9
select is((select count(*) from public.categories where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1::bigint,
  'A vede la propria categoria personale');                                                                           -- 10
select is_empty($$ select 1 from public.categories where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'A NON vede la categoria personale di B');                                                                          -- 11
select is_empty($$ select 1 from public.categories where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  'nessuna categoria di B è visibile ad A');                                                                          -- 12

select throws_ok($$ insert into public.categories (slug, name, icon) values ('nuova', 'Nuova', 'folder') $$,
  '42501', null, 'A non può creare categorie');                                                                       -- 13
select throws_ok($$ update public.categories set name = 'hacked' where owner_id is null $$,
  '42501', null, 'A non può modificare categorie di sistema');                                                        -- 14
select throws_ok($$ delete from public.categories where owner_id is null $$,
  '42501', null, 'A non può cancellare categorie');                                                                   -- 15

-- ===== RLS: utente B ========================================================================================
reset role;
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select is((select count(*) from public.categories where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint,
  'B vede la propria categoria personale');                                                                           -- 16
select is_empty($$ select 1 from public.categories where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'B NON vede la categoria personale di A');                                                                          -- 17

-- ===== Accesso anonimo ===========================================================================================
reset role;
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.categories $$, '42501', null, 'anon: lettura categorie negata');            -- 18
select throws_ok($$ insert into public.categories (slug, name, icon) values ('x', 'X', 'folder') $$,
  '42501', null, 'anon: inserimento categorie negato');                                                               -- 19

-- ===== Integrità ====================================================================================================
reset role;
delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*) from public.categories where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0::bigint,
  'cancellando l''utente le sue categorie personali scompaiono (cascade)');                                           -- 20
select is((select count(*) from public.categories where owner_id is null), 9::bigint,
  'le categorie di sistema non sono toccate');                                                                        -- 21

select * from finish();
rollback;
