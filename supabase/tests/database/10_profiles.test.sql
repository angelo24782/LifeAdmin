-- profiles: consenso privacy (trigger di signup) e isolamento RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Utenti A e B (UUID fissi, solo per il test): il trigger crea i rispettivi profili. -----------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test', '{"privacy_version":"2026-10-01","display_name":"  Anna  "}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test', '{"privacy_version":"2026-10-01"}');

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

-- ===== Consenso privacy (separazione utente Auth / profilo applicativo) ===============================
select throws_like(
  $$ insert into auth.users (id, email) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'nometa@example.test') $$,
  'privacy_version_missing%', 'metadata assenti: registrazione rifiutata');                                          -- 1
select throws_like(
  $$ insert into auth.users (id, email, raw_user_meta_data) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'empty@example.test', '{}') $$,
  'privacy_version_missing%', 'metadata senza privacy_version: registrazione rifiutata');                             -- 2
select throws_like(
  $$ insert into auth.users (id, email, raw_user_meta_data) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'blank@example.test', '{"privacy_version":"   "}') $$,
  'privacy_version_missing%', 'privacy_version vuota: registrazione rifiutata');                                      -- 3
select throws_like(
  $$ insert into auth.users (id, email, raw_user_meta_data) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'old@example.test', '{"privacy_version":"1999-01-01"}') $$,
  'privacy_version_unsupported%', 'versione non supportata: registrazione rifiutata');                                -- 4
select is(
  (select count(*) from auth.users where email in ('nometa@example.test', 'empty@example.test', 'blank@example.test', 'old@example.test')),
  0::bigint, 'il rifiuto è atomico: nessun utente Auth senza profilo');                                              -- 5

select is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1::bigint,
  'versione supportata: profilo creato');                                                                             -- 6
select is((select privacy_version from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), '2026-10-01',
  'privacy_version salvata dal profilo');                                                                             -- 7
select is((select display_name from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'Anna',
  'display_name dai metadata, ripulito dagli spazi');                                                                 -- 8

-- Il timestamp è generato dal database: quello fornito dal client nei metadata viene ignorato.
insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ts@example.test',
   '{"privacy_version":"2026-10-01","privacy_accepted_at":"2000-01-01T00:00:00Z"}');
select is((select privacy_accepted_at from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), now(),
  'privacy_accepted_at = now() lato DB');                                                                             -- 9
select isnt((select privacy_accepted_at from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  '2000-01-01T00:00:00Z'::timestamptz, 'il timestamp del client è ignorato');                                         -- 10

select is(
  (select count(*) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)),
  0::bigint, 'ogni profilo ha un utente Auth');                                                                       -- 11

-- ===== RLS: utente A =====================================================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select is((select count(*) from public.profiles), 1::bigint, 'A vede esattamente un profilo');                        -- 12
select is((select id from public.profiles), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'il profilo visibile è il proprio'); -- 13
select is_empty($$ select 1 from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  'A non vede il profilo di B');                                                                                      -- 14

select is_empty(
  $$ with u as (update public.profiles set display_name = 'hacked' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning id) select id from u $$,
  'A non può modificare il profilo di B (0 righe)');                                                                  -- 15

select lives_ok($$ update public.profiles set display_name = 'Anna Rossi', notification_hour = 18 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'A modifica le proprie preferenze');                                                                                -- 16
select is((select notification_hour from public.profiles), 18::smallint, 'la modifica è applicata');                  -- 17

select throws_ok($$ update public.profiles set privacy_version = '2026-10-01' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A non può riscrivere privacy_version');                                                             -- 18
select throws_ok($$ update public.profiles set privacy_accepted_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A non può riscrivere privacy_accepted_at');                                                         -- 19
select throws_ok($$ update public.profiles set locale = 'it' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A non può modificare locale');                                                                      -- 20
select throws_ok($$ insert into public.profiles (id, privacy_accepted_at, privacy_version) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', now(), '2026-10-01') $$,
  '42501', null, 'A non può inserire profili');                                                                       -- 21
select throws_ok($$ delete from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A non può cancellare il proprio profilo dal client');                                               -- 22

select throws_ok($$ update public.profiles set timezone = 'Mars/Olympus_Mons' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '23514', null, 'fuso orario non valido rifiutato');                                                                 -- 23
select lives_ok($$ update public.profiles set timezone = 'Europe/Berlin' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'fuso orario valido accettato');                                                                                    -- 24
select throws_ok($$ update public.profiles set notification_hour = 24 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '23514', null, 'notification_hour fuori range rifiutata');                                                          -- 25

-- ===== Accesso anonimo =================================================================================
reset role;
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon: lettura profili negata');               -- 26
select throws_ok($$ update public.profiles set display_name = 'x' $$, '42501', null, 'anon: aggiornamento profili negato'); -- 27

-- ===== Cascata ==========================================================================================
reset role;
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'cancellando l''utente Auth il profilo scompare (cascade)');                                                        -- 28

select * from finish();
rollback;
