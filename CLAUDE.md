# LifeAdmin — istruzioni per Claude

Prodotto: app per gestire scadenze e documenti della vita amministrativa (Italia, lingua italiana).
Distribuita su **Web, iOS e Android** con **una sola codebase** Vue 3 + TypeScript (Capacitor per le app).
Risposte e commenti in **italiano**.

## Fonte di verità

- **`docs/SPECIFICA.md` (v0.5)**: prodotto, architettura, database, sicurezza, UX, roadmap M1–M22.
  Se il codice diverge dalla specifica, si aggiorna prima la specifica.
- `docs/API_CONTRACT.md`: cosa i client possono usare del backend (colonne, privilegi, errori).
- `README.md`: installazione, comandi, test.

Leggi la specifica (almeno le sezioni della milestone in corso, §14, §20, §23) prima di lavorare.

## Stato

- **M1** (setup progetto, livello `platform/`, CI) — chiusa.
- **M2** (schema DB, RLS, client Supabase, service layer, test) — chiusa, CI verde.
- **M3 — Autenticazione**: piano v0.5 approvato; **implementata solo la parte database** (migration `auth_prehijack_guard`, config locale, template email, test pgTAP/integrazione/mutazione, verificati in locale); client, store, pagine e router di auth **non iniziati** (vedi §20, §23.3/§23.4, §23.12). Non scrivere codice M3 senza il via esplicito.
- Fase Web MVP = M1–M13; fase Mobile = M14–M22.

## Manutenzione di questo file (obbligatoria, in ogni chat)

Questo file è la memoria del progetto tra una chat e l'altra: **va tenuto sempre aggiornato**.

- **Fine di ogni milestone** (insieme al report e al gate): aggiorna la sezione **Stato**, i **Comandi** se cambiano, e lo stack se cambiano le versioni.
- **Quando nasce o cambia una regola, una decisione o una lezione appresa** (nuova regola di architettura, convenzione, errore da non ripetere): aggiungila nella sezione giusta nello stesso lavoro, non "dopo".
- **A inizio chat**: se Stato o comandi non corrispondono al repository (`git log`, `package.json`, `docs/SPECIFICA.md`), correggili prima di iniziare e segnalalo.
- Mantienilo **breve** (indice e regole, non cronaca): i dettagli vanno in `docs/SPECIFICA.md`, che resta la fonte di verità. Se una decisione cambia, aggiorna prima la specifica e poi qui.
- Non fare commit: indica all'utente che `CLAUDE.md` è tra i file da committare.

## Metodo di lavoro (obbligatorio)

1. **Prima il piano, poi il codice.** Per ogni milestone: cosa realizzi, quali file crei o modifichi, dipendenze, come verifichi. Per i punti ambigui o che cambiano roadmap/architettura, **fermati e chiedi** prima di decidere.
2. **Non anticipare milestone successive** e non modificare la roadmap per comodità implementativa.
3. **Nessuna nuova decisione architetturale importante senza segnalarla prima.** Le decisioni tecniche ordinarie le prendi tu e le riporti nel report.
4. **Ogni modifica è verificabile**: esegui i controlli previsti (vedi sotto) e riporta risultati reali, anche quelli negativi.
5. **A fine milestone un report finale** con: cosa è stato fatto, struttura file, dipendenze e versioni, test/lint/typecheck con esito, problemi, decisioni prese, file creati/modificati, commit suggerito. Chiudi con un gate (**PASS** o **BLOCKED/FAIL**) e **fermati**: non passare alla milestone successiva.
6. Dopo una milestone: Final Review (git pulito, nessun segreto, CI verde) prima di considerarla chiusa.

## Regole sul repository

- **Non eseguire mai `git commit`, `git push`, né aprire PR/merge**: i commit li fa l'utente. Indica quali file committare e un messaggio convenzionale (`feat:`, `fix:`, `db:`, `test:`, `docs:`, `ci:`, `chore:`).
- **Nessun segreto nel repository**: nessuna chiave, password, token, utente di test con credenziali. `.env.local` è ignorato da git. La `service_role` esiste solo nei test di integrazione (e, in futuro, nelle Edge Function); **mai in `src/`**.
- Le variabili `VITE_*` sono pubbliche.
- **Migration**: solo nuove migration append-only (`pnpm exec supabase migration new <nome>`); una migration già in `main` non si modifica. Nessuna modifica manuale al database fuori dalle migration. Controlla a mano ogni SQL.
- Per testare pagine web (app locale, siti, ClickUp) usa **Claude in Chrome** (`mcp__claude-in-chrome__*`), non il browser integrato dell'app. Se l'estensione non è collegata, dillo.
- La CI GitHub parte su **pull request** e su push a `main`, non su push di un branch: per vederla serve una PR (la apre l'utente).

## Stack e versioni (pinnate, matrice in SPECIFICA §14)

Node 24 · pnpm 10 · Vue 3.5 · Vite 8 · **TypeScript 6.0.x (NON 7.x: `typescript-eslint` non lo supporta)** ·
Pinia 4 · Vue Router 5 · Tailwind 4 (token CSS in `src/styles/tailwind.css`) · zod 4 · Vitest 5 · Playwright ·
ESLint 10 · supabase-js 2.117. Non aggiornare versioni maggiori senza ripassare la matrice.
Previsti ma **non ancora installati**: `@axe-core/playwright` (dev, M3), Capacitor (M14). `@tanstack/vue-form` **non adottato** (form con composable `useZodForm`, §14 e §23.12).

## Lezioni apprese (M3)

- Pre-hijacking: GoTrue non sovrascrive la password di un account non confermato. Mitigazione prevista: password casuale monouso alla registrazione + trigger `BEFORE UPDATE` su `auth.users` che annulla la password alla prima conferma + scelta password dopo la conferma (§23.12). Stato del flusso "password da scegliere" in `profiles.password_setup_pending` (colonna additiva, trigger `AFTER UPDATE` senza `UPDATE OF`, `REVOKE EXECUTE … FROM PUBLIC`). **Verificato solo in locale; beta bloccata finché entrambi i trigger, la persistenza del flag, il fail-closed e l'effetto di `REVOKE EXECUTE` non sono verificati su Supabase hosted (staging).** La revoca delle sessioni al cambio password è un comportamento locale di GoTrue, non una garanzia.
- I messaggi neutri della UI non eliminano l'enumerazione delle email via API; rate limit e CAPTCHA in hosting sono condizioni bloccanti per la beta (§23.12 D).
- Un metadato scritto da un trigger `BEFORE` sul wipe viene riscritto da GoTrue: lo stato persistente va tenuto in `profiles`. Un trigger `AFTER UPDATE OF col` non scatta se la colonna è cambiata da un trigger `BEFORE`.
- Il test "profilo mancante" deve far fallire il flusso, non passare come riuscito.
- `supabase db query --local` esegue UNA istruzione per volta e per il DDL non restituisce JSON; in pgTAP `postgres` non può assumere `supabase_auth_admin` né concedere privilegi su `auth.users`: il firing dei trigger con GoTrue reale si prova solo nei test di integrazione.
- I test pgTAP non devono contare righe globali (restringere ai propri UUID): i test di integrazione possono lasciare utenti. Il cleanup degli integration test va in `try/finally`.
- Non dichiarare "verificato" ciò che è stato provato solo in locale.

## Architettura: regole vincolanti

- Logica di business **fuori** dai componenti: pagina (sottile) → feature (componenti, store, service) → `domain/` (TS puro).
- I componenti non importano Supabase direttamente: passano da `features/*/service.ts`.
- **`src/platform/`** è l'unico punto di contatto con la piattaforma (porte + adapter web/native/fake). I plugin `@capacitor/*` si importano **solo** in `src/platform/native/**` (regola ESLint verificata da test).
- TypeScript `strict`, nessun `any`, nessun codice morto.
- Query con **colonne esplicite** (mai `select *`); nessun filtro per `owner_id` nel client (lo fa la RLS).
- Schema, privilegi di colonna e policy RLS sono **API**: modifiche additive (expand/contract), mai incompatibili.

## Database e sicurezza (lezioni già apprese)

- Funzioni e trigger interni nello schema **`private`** (non esposto). Nessun RPC in `public`.
- Ogni tabella: RLS attiva, `revoke all` a `public/anon/authenticated`, grant minimi anche per colonna, `owner_id` con `default auth.uid()` e non inseribile/aggiornabile dal client, FK composta `(item_id, owner_id)` sulle figlie.
- **I test RLS devono passare anche da PostgREST reale**, non solo da pgTAP: pgTAP può mascherare errori di privilegi (piani già compilati come superutente). Gli helper pgTAP fanno `discard plans` al cambio ruolo.
- Dopo aver scritto policy o grant, fai una **verifica a mutazione** (rompi di proposito una policy e controlla che i test falliscano).

## Comandi

```bash
pnpm install
pnpm dev                 # http://localhost:5173
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:unit           # Vitest
pnpm test:e2e            # Playwright (usa il Chrome installato)
pnpm build && pnpm check:bundle

# Database locale (Docker Desktop acceso)
pnpm supabase:start      # Postgres, Auth, PostgREST, Mailpit
pnpm db:reset            # ricrea il DB dalle migration
pnpm db:lint
pnpm db:test             # pgTAP
pnpm db:types            # rigenera src/shared/types/database.ts
pnpm test:integration    # isolamento A/B e anti pre-hijacking con Auth reale + Mailpit
pnpm test:auth-guard-mutations  # verifica a mutazione di auth_prehijack_guard
pnpm supabase:stop
```

DB locale: API `http://127.0.0.1:54321`, Postgres `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
Ambiente di sviluppo: **Windows** (Git Bash/PowerShell). iOS richiede macOS (build in CI, vedi SPECIFICA §23.9).

## Prima di chiudere una milestone

`lint` · `format:check` · `typecheck` · `test:unit` · `build` · `check:bundle` · (se tocca il DB) `db:reset` + `db:lint` + `db:test` + `test:integration` · e2e · `pnpm audit --audit-level=high` · nessun segreto nei file tracciati · git pulito.
