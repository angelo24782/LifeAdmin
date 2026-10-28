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
- **M3 — Autenticazione**: piano v0.5 approvato; **implementata solo la parte database** (migration `auth_prehijack_guard`, config locale, template email, test pgTAP/integrazione/mutazione, verificati in locale); client auth (M3-a) avviato: **A1** costanti e schemi Zod (`ec364ad`) e **A2** `toAuthAppError` (`ebb8c39`) committati il 2026-10-20; **A3** `useZodForm` (`c7d2b28`) committato il 2026-10-28; A4 service, A5 store, pagine e router **non iniziati** (vedi §20, §23.3/§23.4, §23.12). Non scrivere codice M3 senza il via esplicito.
- Ripartenza e stato condiviso anche in `C:\_ProgettiAGM\_HANDOFF\03f-LIFEADMIN.md`.
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

### Flusso Git (procedurale)

GitHub attualmente **non impone** controlli CI obbligatori su `main` (nessuna protezione di branch né ruleset): le regole di questa sezione sono **procedurali**, non imposte dalla piattaforma.

- **Branch**: `branch-angelo` è l'unico branch di lavoro abituale; `main` è il riferimento stabile (lavoro integrato e verificato). `branch-angelo` va mantenuto come branch di lavoro abituale.
- **PR**: si apre da `branch-angelo` verso `main` quando il lavoro è pronto, con le verifiche della checklist di fine milestone e una descrizione completa. Si unisce solo con la CI verde e, per scelta procedurale, con **Create a merge commit**: GitHub consente anche squash e rebase, ma da evitare perché fanno divergere `branch-angelo` da `main`.
- **Riallineamento dopo il merge** (prima di riprendere a lavorare): working tree pulito e nessun commit locale non pushato, poi `git fetch origin`, `git switch branch-angelo`, `git merge --ff-only origin/main`. Se il comando fallisce **ci si ferma**: niente merge normale, rebase, reset o altro riallineamento automatico; Claude fa solo un'analisi in sola lettura (`git log --left-right --graph origin/main...branch-angelo`, `git merge-base`, `git diff --stat`) e Angelo decide.
- **Dependabot**: i branch `dependabot/*` sono automatici e restano fuori dal flusso quotidiano: nessun checkout, pull o lavoro locale su di essi; si valutano dalle PR su GitHub. Una PR Dependabot si unisce solo se la CI è verde e valida rispetto al `main` corrente e la PR non presenta uno stato obsoleto o ambiguo (ad esempio mergeability `unknown`); la sola data di esecuzione dei controlli non è una garanzia sufficiente. Se non è possibile confermarlo, ci si ferma e si richiede una nuova verifica. Dopo ogni merge `main` cambia: si rivalutano le altre PR, una alla volta. Gli aggiornamenti di versione maggiore si confrontano prima con la matrice di SPECIFICA §14 e con `engines` in `package.json`. Come ottenere una CI aggiornata su una PR lo decide Angelo.
- **Chi fa cosa**: Angelo esegue ogni operazione che scrive o modifica Git o GitHub (fetch, switch, merge, commit, push, apertura/merge/chiusura delle PR, interventi sulle PR Dependabot, impostazioni GitHub, workflow, `dependabot.yml`). Claude può solo verificare in sola lettura e preparare: stato git, file da committare con messaggio convenzionale, descrizione della PR, lettura di stato PR, CI e impostazioni su GitHub, classificazione delle PR Dependabot, analisi di un eventuale fallimento di `--ff-only`, modifiche ai file di documentazione senza commit.

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
- `supabase db query` (CLI 2.120.0) sceglie il formato dell'output in base al rilevamento dell'agente (variabile `AI_AGENT` e simili): con un agente AI risponde con un oggetto JSON con `rows`, senza agente (CI, terminale dello sviluppatore) con una tabella di testo senza JSON. Per rendere deterministica la lettura nei test usare sempre `--agent no --output-format json` (output: array JSON, `[]` o solo un tag di comando) e leggere l'output con `parseDbQueryOutput` (`tests/support/db-query-output.ts`), che lancia su ogni formato inatteso invece di restituire `[]`. Emerso alla prima esecuzione della CI: l'helper `sql()` capiva solo la forma con agente e 5 test di `auth-prehijack` fallivano fuori dalla sessione dell'agente.
- I test pgTAP non devono contare righe globali (restringere ai propri UUID): i test di integrazione possono lasciare utenti. Il cleanup degli integration test va in `try/finally`.
- Non dichiarare "verificato" ciò che è stato provato solo in locale.
- Lezioni sperimentali dal client di verifica A3-0 (valgono per questo caso, non sono regole): controllare il tipo degli argomenti con `typeof` prima di espressioni regolari e coercioni; decodificare le risposte con UTF-8 rigoroso (`TextDecoder` con `fatal: true`); testare anche le funzioni interne chiamate direttamente, non solo il punto d'ingresso. Non sono una certificazione del client.
- Stato di A3-0: client e suite stanno fuori dal repository, nello scratchpad temporaneo dell'ambiente di lavoro (non è un archivio persistente: possono andare persi); esiste anche una copia locale fuori dal repository, non garantita come persistente. Sono stati esercitati solo contro un mock locale; B1, B2 e B3 sull'endpoint reale non sono né eseguiti né autorizzati. Non certificano la sicurezza dell'endpoint `read-only` e non risolvono i punti [S] (§23.12 F).

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
