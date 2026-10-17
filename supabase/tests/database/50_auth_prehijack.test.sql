-- M3 · auth_prehijack_guard: azzeramento della password alla prima conferma, flag
-- `profiles.password_setup_pending`, privilegi, fail-closed e rollback.
-- Gli UPDATE su auth.users riproducono la sequenza osservata di GoTrue (SPECIFICA §23.12 A): INSERT con
-- la password, `confirmation_sent_at` valorizzato dopo la creazione, poi UPDATE di `email_confirmed_at`.
-- Gli scenari con GoTrue reale (V1–V4, gara di polling) sono nei test di integrazione.
begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

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

create function pg_temp.pw_is_null(p_id uuid) returns boolean language sql as
  $$ select encrypted_password is null from auth.users where id = p_id $$;
create function pg_temp.pending(p_id uuid) returns boolean language sql as
  $$ select password_setup_pending from public.profiles where id = p_id $$;

-- ===== 1. Struttura: trigger, funzioni, colonna ========================================================
select is((select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'wipe_password_on_first_confirmation'
           and tgtype & 2 = 2 and tgtype & 16 = 16 and tgtype & 1 = 1), 1::bigint,
  'trigger wipe: BEFORE UPDATE FOR EACH ROW');                                                                        -- 1
select is((select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'track_password_setup'
           and tgtype & 2 = 0 and tgtype & 16 = 16 and tgtype & 1 = 1 and tgqual is not null), 1::bigint,
  'trigger flag: AFTER UPDATE FOR EACH ROW con clausola WHEN');                                                       -- 2
select ok((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'track_password_setup' and tgrelid = 'auth.users'::regclass)
          like '%IS DISTINCT FROM%', 'trigger flag: la WHEN confronta encrypted_password (IS DISTINCT FROM)');         -- 3
select ok((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'track_password_setup' and tgrelid = 'auth.users'::regclass)
          not like '%UPDATE OF%', 'trigger flag: niente UPDATE OF (non scatterebbe con il wipe di un trigger BEFORE)'); -- 4
select is((select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal and tgtype & 4 = 4), 1::bigint,
  'M2: un solo trigger su INSERT di auth.users');                                                                     -- 5
select is((select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'
           and tgtype & 2 = 0 and tgtype & 4 = 4), 1::bigint, 'M2: on_auth_user_created è AFTER INSERT');              -- 6

select is((select prosecdef from pg_proc where oid = 'private.wipe_password_on_first_confirmation()'::regprocedure), false,
  'funzione wipe: SECURITY INVOKER');                                                                                 -- 7
select is((select prosecdef from pg_proc where oid = 'private.track_password_setup()'::regprocedure), true,
  'funzione flag: SECURITY DEFINER');                                                                                 -- 8
select is((select proconfig from pg_proc where oid = 'private.wipe_password_on_first_confirmation()'::regprocedure),
  array['search_path=""'], 'funzione wipe: search_path vuoto');                                                       -- 9
select is((select proconfig from pg_proc where oid = 'private.track_password_setup()'::regprocedure),
  array['search_path=""'], 'funzione flag: search_path vuoto');                                                       -- 10

select col_type_is('public', 'profiles', 'password_setup_pending', 'boolean', 'password_setup_pending è boolean');     -- 11
select col_not_null('public', 'profiles', 'password_setup_pending', 'password_setup_pending NOT NULL');               -- 12
select col_default_is('public', 'profiles', 'password_setup_pending', 'false', 'password_setup_pending default false'); -- 13

-- ===== 2. Privilegi ====================================================================================
select is(has_function_privilege('public', 'private.wipe_password_on_first_confirmation()', 'execute'), false,
  'wipe: EXECUTE revocato a PUBLIC');                                                                                 -- 14
select is(has_function_privilege('public', 'private.track_password_setup()', 'execute'), false,
  'flag: EXECUTE revocato a PUBLIC');                                                                                 -- 15
select is(has_function_privilege('anon', 'private.wipe_password_on_first_confirmation()', 'execute'), false, 'wipe: anon senza EXECUTE');   -- 16
select is(has_function_privilege('authenticated', 'private.wipe_password_on_first_confirmation()', 'execute'), false, 'wipe: authenticated senza EXECUTE'); -- 17
select is(has_function_privilege('anon', 'private.track_password_setup()', 'execute'), false, 'flag: anon senza EXECUTE');                  -- 18
select is(has_function_privilege('authenticated', 'private.track_password_setup()', 'execute'), false, 'flag: authenticated senza EXECUTE'); -- 19
select is(has_schema_privilege('anon', 'private', 'usage'), false, 'schema private: anon senza USAGE');               -- 20
select is(has_schema_privilege('authenticated', 'private', 'usage'), false, 'schema private: authenticated senza USAGE'); -- 21

select is(has_column_privilege('authenticated', 'public.profiles', 'password_setup_pending', 'select'), true,
  'authenticated legge la colonna (grant di tabella di M2)');                                                         -- 22
select is(has_column_privilege('authenticated', 'public.profiles', 'password_setup_pending', 'update'), false,
  'authenticated NON può aggiornare la colonna');                                                                     -- 23
select is(has_column_privilege('authenticated', 'public.profiles', 'password_setup_pending', 'insert'), false,
  'authenticated NON può inserire la colonna');                                                                       -- 24
select is(has_column_privilege('anon', 'public.profiles', 'password_setup_pending', 'select'), false, 'anon NON legge la colonna'); -- 25
select is(has_column_privilege('anon', 'public.profiles', 'password_setup_pending', 'update'), false, 'anon NON aggiorna la colonna'); -- 26

-- ===== 3. Prima conferma: la password viene azzerata (V1, V2, V3) ======================================
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a1000000-0000-4000-8000-000000000001', 'attacker-target@example.test', '{"privacy_version":"2026-10-01"}', 'hash-attaccante');
update auth.users set confirmation_sent_at = now() where id = 'a1000000-0000-4000-8000-000000000001';   -- confirmation_sent_at dopo l'INSERT

select is(pg_temp.pw_is_null('a1000000-0000-4000-8000-000000000001'), false, 'prima della conferma la password c''è');   -- 27
select is(pg_temp.pending('a1000000-0000-4000-8000-000000000001'), false, 'prima della conferma il flag è false');       -- 28

update auth.users set email_confirmed_at = now() where id = 'a1000000-0000-4000-8000-000000000001';   -- la vittima conferma

select is(pg_temp.pw_is_null('a1000000-0000-4000-8000-000000000001'), true, 'alla prima conferma la password è azzerata');  -- 29
select is(pg_temp.pending('a1000000-0000-4000-8000-000000000001'), true, 'il flag diventa true');                           -- 30

-- Gli UPDATE successivi di GoTrue (confirmed_at, last_sign_in_at, ...) non cambiano nulla.
update auth.users set last_sign_in_at = now() where id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.pw_is_null('a1000000-0000-4000-8000-000000000001'), true, 'UPDATE successivi: password ancora NULL');     -- 31
select is(pg_temp.pending('a1000000-0000-4000-8000-000000000001'), true, 'UPDATE successivi: flag ancora true');            -- 32

-- La vittima sceglie la password: il flag torna false.
update auth.users set encrypted_password = 'hash-scelta-dalla-vittima' where id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.pw_is_null('a1000000-0000-4000-8000-000000000001'), false, 'dopo la scelta la password è valorizzata');    -- 33
select is(pg_temp.pending('a1000000-0000-4000-8000-000000000001'), false, 'dopo la scelta il flag torna false');             -- 34

-- Una nuova "prima conferma" non esiste: aggiornare email_confirmed_at di un utente già confermato non azzera nulla.
update auth.users set email_confirmed_at = now() + interval '1 second' where id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.pw_is_null('a1000000-0000-4000-8000-000000000001'), false, 'ri-conferma: password intatta');               -- 35
select is(pg_temp.pending('a1000000-0000-4000-8000-000000000001'), false, 'ri-conferma: flag invariato');                    -- 36

-- ===== 4. V4: recovery su account non confermato ========================================================
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a2000000-0000-4000-8000-000000000002', 'recovery-target@example.test', '{"privacy_version":"2026-10-01"}', 'hash-attaccante-v4');
update auth.users set confirmation_sent_at = now() where id = 'a2000000-0000-4000-8000-000000000002';
update auth.users set recovery_sent_at = now() where id = 'a2000000-0000-4000-8000-000000000002';     -- "Password dimenticata"
update auth.users set email_confirmed_at = now(), recovery_token = '' where id = 'a2000000-0000-4000-8000-000000000002';  -- il recovery conferma l'email

select is(pg_temp.pw_is_null('a2000000-0000-4000-8000-000000000002'), true, 'V4: il recovery su account non confermato azzera la password'); -- 37
select is(pg_temp.pending('a2000000-0000-4000-8000-000000000002'), true, 'V4: flag true fino alla scelta della password');                  -- 38

-- ===== 5. Nessuna regressione per utenti legittimi ======================================================
-- Utente creato dall'amministratore con email già confermata: INSERT, poi UPDATE email_confirmed_at con confirmation_sent_at NULL.
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a3000000-0000-4000-8000-000000000003', 'admin-created@example.test', '{"privacy_version":"2026-10-01"}', 'hash-admin');
update auth.users set email_confirmed_at = now() where id = 'a3000000-0000-4000-8000-000000000003';
select is(pg_temp.pw_is_null('a3000000-0000-4000-8000-000000000003'), false, 'utente admin con email confermata: password intatta');  -- 39
select is(pg_temp.pending('a3000000-0000-4000-8000-000000000003'), false, 'utente admin: flag false');                                -- 40

-- Utente inserito già confermato (nessun UPDATE di conferma).
insert into auth.users (id, email, raw_user_meta_data, encrypted_password, email_confirmed_at) values
  ('a4000000-0000-4000-8000-000000000004', 'inserted-confirmed@example.test', '{"privacy_version":"2026-10-01"}', 'hash-ins', now());
select is(pg_temp.pw_is_null('a4000000-0000-4000-8000-000000000004'), false, 'utente inserito già confermato: password intatta');      -- 41

-- Utente confermato che cambia password, metadati ed email.
update auth.users set encrypted_password = 'hash-nuova' where id = 'a3000000-0000-4000-8000-000000000003';
update auth.users set raw_user_meta_data = '{"privacy_version":"2026-10-01","display_name":"X"}' where id = 'a3000000-0000-4000-8000-000000000003';
update auth.users set email_change = 'nuova@example.test', email_change_sent_at = now() where id = 'a3000000-0000-4000-8000-000000000003';
update auth.users set email = 'nuova@example.test', email_change = '' where id = 'a3000000-0000-4000-8000-000000000003';
select is(pg_temp.pw_is_null('a3000000-0000-4000-8000-000000000003'), false, 'cambio password/metadati/email: password valorizzata');   -- 42
select is(pg_temp.pending('a3000000-0000-4000-8000-000000000003'), false, 'cambio password/metadati/email: flag false');                -- 43
select is((select encrypted_password from auth.users where id = 'a3000000-0000-4000-8000-000000000003'), 'hash-nuova',
  'la nuova password è quella impostata');                                                                                              -- 44

-- I profili esistenti e gli utenti admin hanno il flag a false (default).
select is((select count(*) from public.profiles where password_setup_pending and id::text like 'a_000000-0000-4000-8000-%'), 1::bigint,
  'solo l''utente in attesa di scegliere la password (V4) ha il flag true');                                                            -- 45

-- Nota: il funzionamento dei trigger con le revoche applicate, eseguito dal ruolo reale di GoTrue (supabase_auth_admin,
-- senza USAGE su private né EXECUTE sulle funzioni), non è verificabile in pgTAP: `postgres` non può assumere quel ruolo
-- né concedere privilegi su auth.users. È coperto dai test di integrazione con Supabase Auth reale.

-- ===== 6. Fail-closed: se il trigger del flag fallisce, fallisce la conferma ==============================
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a6000000-0000-4000-8000-000000000006', 'fail-closed@example.test', '{"privacy_version":"2026-10-01"}', 'hash-fc');
update auth.users set confirmation_sent_at = now() where id = 'a6000000-0000-4000-8000-000000000006';
alter table public.profiles add constraint spike_block_flag check (password_setup_pending = false) not valid;

select throws_ok($$ update auth.users set email_confirmed_at = now() where id = 'a6000000-0000-4000-8000-000000000006' $$,
  '23514', null, 'se l''UPDATE del flag fallisce, la conferma fallisce');                                                              -- 46
select is((select email_confirmed_at is null from auth.users where id = 'a6000000-0000-4000-8000-000000000006'), true,
  'fail-closed: l''account resta non confermato');                                                                                      -- 47
select is(pg_temp.pw_is_null('a6000000-0000-4000-8000-000000000006'), false, 'fail-closed: password invariata');                         -- 48
select is(pg_temp.pending('a6000000-0000-4000-8000-000000000006'), false, 'fail-closed: flag invariato (false)');                        -- 49

alter table public.profiles drop constraint spike_block_flag;
select lives_ok($$ update auth.users set email_confirmed_at = now() where id = 'a6000000-0000-4000-8000-000000000006' $$,
  'rimossa la causa, la stessa conferma riesce');                                                                                       -- 50
select is(pg_temp.pw_is_null('a6000000-0000-4000-8000-000000000006'), true, 'dopo il ripristino: password azzerata');                    -- 51
select is(pg_temp.pending('a6000000-0000-4000-8000-000000000006'), true, 'dopo il ripristino: flag true');                               -- 52

-- ===== 7. Rollback: stato intermedio nella transazione e stato finale dopo l'annullamento ====================
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a7000000-0000-4000-8000-000000000007', 'rollback@example.test', '{"privacy_version":"2026-10-01"}', 'hash-rb');
update auth.users set confirmation_sent_at = now() where id = 'a7000000-0000-4000-8000-000000000007';

select throws_ok($$ do $d$ begin
    update auth.users set email_confirmed_at = now() where id = 'a7000000-0000-4000-8000-000000000007';
    raise exception 'intermedio pw_null=% flag=%', pg_temp.pw_is_null('a7000000-0000-4000-8000-000000000007'), pg_temp.pending('a7000000-0000-4000-8000-000000000007');
  end $d$ $$, 'P0001', 'intermedio pw_null=t flag=t', 'dentro la transazione password azzerata e flag true');                  -- 53
select is((select email_confirmed_at is null from auth.users where id = 'a7000000-0000-4000-8000-000000000007'), true,
  'dopo il rollback: email non confermata');                                                                                            -- 54
select is(pg_temp.pw_is_null('a7000000-0000-4000-8000-000000000007'), false, 'dopo il rollback: password intatta');                      -- 55
select is(pg_temp.pending('a7000000-0000-4000-8000-000000000007'), false, 'dopo il rollback: flag false');                               -- 56

-- ===== 8. Profilo mancante: limite del trigger, invariante di M2 da proteggere ==============================
select is((select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)), 0::bigint,
  'invariante M2: ogni utente Auth ha un profilo');                                                                                     -- 57
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a8000000-0000-4000-8000-000000000008', 'no-profile@example.test', '{"privacy_version":"2026-10-01"}', 'hash-np');
update auth.users set confirmation_sent_at = now() where id = 'a8000000-0000-4000-8000-000000000008';
delete from public.profiles where id = 'a8000000-0000-4000-8000-000000000008';                        -- violazione dell'invariante
select lives_ok($$ update auth.users set email_confirmed_at = now() where id = 'a8000000-0000-4000-8000-000000000008' $$,
  'senza profilo la conferma passa (il trigger non lo rileva)');                                                                        -- 58
select is(pg_temp.pw_is_null('a8000000-0000-4000-8000-000000000008'), true, 'senza profilo: la password è comunque azzerata');         -- 59
select is((select count(*) from public.profiles where id = 'a8000000-0000-4000-8000-000000000008'), 0::bigint,
  'senza profilo il flag non esiste: lo stato "password da scegliere" non è leggibile');                                                -- 60
select is((select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)), 1::bigint,
  'il controllo dell''invariante SEGNALA la violazione (non è un flusso riuscito)');                                                   -- 61
delete from auth.users where id = 'a8000000-0000-4000-8000-000000000008';
select is((select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)), 0::bigint,
  'rimosso l''utente senza profilo l''invariante è ripristinata');                                                                      -- 62

-- ===== 9. RLS e privilegi lato client ==================================================================
select pg_temp.act_as('a2000000-0000-4000-8000-000000000002');          -- V4: flag true
select is((select count(*) from public.profiles), 1::bigint, 'l''utente vede solo il proprio profilo');                                 -- 63
select is((select password_setup_pending from public.profiles), true, 'l''utente legge il proprio flag (true)');                         -- 64
select is_empty($$ select 1 from public.profiles where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'non vede il profilo di un altro utente (e quindi il suo flag)');                                                                     -- 65
select throws_ok($$ update public.profiles set password_setup_pending = false where id = 'a2000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'il client non può azzerare il proprio flag');                                                                         -- 66
select throws_ok($$ update public.profiles set password_setup_pending = true where id = 'a2000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'il client non può impostare il flag a true');                                                                         -- 67
select throws_ok($$ insert into public.profiles (id, privacy_accepted_at, privacy_version, password_setup_pending)
                    values ('a9000000-0000-4000-8000-000000000009', now(), '2026-10-01', false) $$,
  '42501', null, 'il client non può inserire profili con il flag');                                                                     -- 68
select throws_ok($$ select private.track_password_setup() $$, '42501', null, 'il client non può chiamare la funzione del flag');         -- 69
select throws_ok($$ select private.wipe_password_on_first_confirmation() $$, '42501', null, 'il client non può chiamare la funzione di wipe'); -- 70
select is((select password_setup_pending from public.profiles), true, 'il flag è invariato dopo i tentativi di scrittura');              -- 71

reset role;
select pg_temp.act_as_anon();
select throws_ok($$ select password_setup_pending from public.profiles $$, '42501', null, 'anon: lettura della colonna negata');         -- 72
select throws_ok($$ update public.profiles set password_setup_pending = false $$, '42501', null, 'anon: scrittura della colonna negata'); -- 73
reset role;

-- ===== 10. Cascata e M2 invariato =========================================================================
select is((select count(*) from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal), 2::bigint,
  'profiles: invariati i trigger di M2 (updated_at, timezone)');                                                                        -- 74
delete from auth.users where id = 'a2000000-0000-4000-8000-000000000002';
select is((select count(*) from public.profiles where id = 'a2000000-0000-4000-8000-000000000002'), 0::bigint,
  'cancellando l''utente il profilo scompare (cascade, con flag)');                                                                     -- 75
select is((select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)), 0::bigint,
  'fine test: nessun utente Auth senza profilo');                                                                                       -- 76

select * from finish();
rollback;
