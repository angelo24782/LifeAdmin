# LifeAdmin

Il tuo assistente per la vita amministrativa: scadenze, documenti, assicurazioni, abbonamenti e
rinnovi in un posto solo, con avvisi che arrivano quando serve agire.

**Piattaforme**: Web, iOS (App Store) e Android (Google Play), con **una sola codebase** Vue 3 + TypeScript
(le app native arrivano con Capacitor nella fase mobile, M14–M22).

> **Stato**: M1 — base del progetto. Le funzionalità di prodotto arrivano nelle milestone successive.
> Il riferimento completo (prodotto, architettura, database, sicurezza, roadmap) è
> [`docs/SPECIFICA.md`](docs/SPECIFICA.md) (v0.3).

## Obiettivo

Aiutare una persona a non dimenticare scadenze e documenti della propria vita amministrativa
(bollo, RCA, revisione, polizze, abbonamenti, garanzie, contratti), con importo, note e documento
allegato, e con avvisi in tempo utile. Mercato iniziale: Italia, lingua italiana.

## Stack

| Area            | Tecnologia                                                                             |
| --------------- | -------------------------------------------------------------------------------------- |
| Frontend        | Vue 3 (`<script setup>`), TypeScript strict, Vite 8, Pinia, Vue Router, Tailwind CSS 4 |
| Validazione     | zod 4                                                                                  |
| Backend (M2+)   | Supabase (PostgreSQL, Auth, Storage, Edge Functions)                                   |
| Test            | Vitest 5 (unit), Playwright (E2E)                                                      |
| Qualità         | ESLint 10 (type-aware, a11y), Prettier, GitHub Actions                                 |
| Mobile (M14+)   | Capacitor 8                                                                            |
| Package manager | pnpm 10, Node 24                                                                       |

Le versioni sono pinnate (matrice in `docs/SPECIFICA.md` §14). **Non aggiornare TypeScript oltre la 6.0.x**
finché `typescript-eslint` non supporta TS 7.

## Requisiti

- **Node 24** (vedi `.nvmrc`) e **pnpm 10** (`corepack enable` oppure `npm i -g pnpm@10`)
- Docker (dalla milestone M2, per Supabase locale)

## Installazione

```bash
pnpm install
cp .env.example .env.local
```

## Configurazione

Le variabili d'ambiente sono validate all'avvio (`src/shared/lib/env.ts`): se mancano o sono
non valide, l'app mostra un messaggio chiaro. Le variabili `VITE_*` sono **pubbliche** (finiscono nel
browser): non inserirvi mai secret.

| Variabile                 | Obbligatoria | Descrizione                                              |
| ------------------------- | ------------ | -------------------------------------------------------- |
| `VITE_SUPABASE_URL`       | sì           | URL dell'API Supabase (locale: `http://127.0.0.1:54321`) |
| `VITE_SUPABASE_ANON_KEY`  | sì           | Chiave pubblica/anon (locale: da `supabase status`, M2)  |
| `VITE_APP_URL`            | sì           | URL pubblico dell'app                                    |
| `VITE_APP_ENV`            | sì           | `development` \| `staging` \| `production`               |
| `VITE_TURNSTILE_SITE_KEY` | no           | Site key Cloudflare Turnstile                            |
| `VITE_SENTRY_DSN`         | no           | DSN Sentry                                               |

I secret lato server (chiavi email, FCM, `service_role`) vivono solo nelle Edge Function e in
GitHub Secrets, mai nel repository.

## Sviluppo locale

```bash
pnpm dev          # server di sviluppo su http://localhost:5173
pnpm lint         # ESLint
pnpm format       # Prettier (scrive); pnpm format:check per solo verifica
pnpm typecheck    # vue-tsc su app e tooling
```

## Test

```bash
pnpm test:unit       # Vitest
pnpm test:coverage   # Vitest con coverage
pnpm test:e2e        # Playwright (build + preview + browser)
```

In locale gli E2E usano il Google Chrome installato; in CI si usa il Chromium di Playwright
(`pnpm exec playwright install chromium`).

## Build

```bash
pnpm build           # bundle di produzione in dist/
pnpm check:bundle    # verifica che il bundle Web non contenga moduli Capacitor
pnpm preview         # anteprima locale del bundle
```

## Architettura (in breve)

```
src/
├─ app/         bootstrap, router
├─ pages/       una per route, solo composizione
├─ platform/    UNICO punto di contatto tra app e piattaforma (web / native / fake)
├─ shared/      librerie condivise (env, ...)
└─ styles/      token di design (Tailwind 4, CSS-first)
```

Regole chiave (dettagli in `docs/SPECIFICA.md` §14):

- Feature e componenti dipendono solo dalle **porte** di `@/platform`.
- I plugin Capacitor si importano **solo** in `src/platform/native/**` (regola ESLint verificata da test).
- Nessuna logica di business nei componenti UI.

## Deploy

Non ancora configurato: hosting e dominio saranno scelti prima della beta (M13). Il CI
(`.github/workflows/ci.yml`) esegue lint, typecheck, test, build ed E2E.

## Licenza

Vedi [LICENSE](LICENSE).
