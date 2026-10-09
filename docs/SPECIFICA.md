# LifeAdmin — Specifica Tecnica e di Prodotto (MVP v1)

Stato: **M1 e M2 implementate; M3: migration `auth_prehijack_guard`, test pgTAP e di integrazione implementati e verificati in locale; client e UI di autenticazione non ancora implementati** · Versione 0.5 · Data 2026-10-09
Questo documento è il riferimento per tutto lo sviluppo. Se il codice diverge, si aggiorna prima la specifica.

**Changelog v0.5 (piano M3 — Autenticazione)**: recepisce le decisioni di M3 **approvate prima dell'implementazione**; nessun codice è ancora stato scritto. Il comportamento descritto è stato verificato **solo in locale con spike** (stack Supabase temporaneo, GoTrue della CLI 2.120): non è implementato né verificato su Supabase in hosting. Decisioni: OTP a **8 cifre** (scadenza 10 minuti); nessuna dipendenza `@tanstack/vue-form` (si usa un composable proprio su zod, §23.12); `@axe-core/playwright` come dev dependency; inizializzazione differita del client tramite opzione additiva (default invariato); conferma email obbligatoria, password ≥ 10, template di conferma e recovery, Mailpit in test e CI; landing `/`; messaggi OTP neutrali; `pendingEmail` solo in memoria; test di scadenza con retrodatazione controllata dei token; nessun test che pretenda un 429 in locale; in caso di inizializzazione bloccata si chiede di ricaricare la pagina (nessun `reload()` in `AppLifecycle`). **Nuovo flusso di registrazione contro il pre-hijacking** degli account non confermati: password casuale monouso alla registrazione, **trigger `BEFORE UPDATE` su `auth.users` che azzera la password alla prima conferma**, scelta della password dopo la conferma (§23.12); **M3 richiede quindi una migration**, che (dopo gli spike finali del 2026-10-09) ha **tre componenti**: trigger `BEFORE UPDATE` di azzeramento password, colonna additiva `profiles.password_setup_pending` (stato server, non solo memoria) e trigger `AFTER UPDATE` che la mantiene, con `REVOKE EXECUTE … FROM PUBLIC` sulle funzioni (l'effetto della revoca sul funzionamento dei trigger è un'ipotesi da verificare con test, non una misura). **Validata solo sullo stack locale; la verifica su Supabase hosted è obbligatoria prima della beta (§23.12).** Nuova §23.12 con la distinzione tra comportamento verificato in locale **[L]**, da verificare in staging **[S]** e condizioni obbligatorie prima della beta **[B]**. Sezioni toccate: 1, 2 (F1, F2), 3, 5 (nuova colonna `profiles.password_setup_pending`), 13, 14, 15, 20 (M3), 21, 23 (23.1, 23.4, 23.11, nuova 23.12). Le sezioni 6 e 12 non sono toccate: policy RLS e grant di `UPDATE` di `profiles` restano quelli di M2.

**Changelog v0.4 (allineamento a M2)**: recepisce le decisioni **effettivamente implementate** in M2, senza introdurre nuove decisioni. Correzioni: validazione di `profiles.timezone` con trigger su `pg_catalog.pg_timezone_names` (non CHECK); nessun `seed.sql` (le 8 categorie di sistema sono nella migration `categories`; nessun utente o credenziale di test nel repository, gli utenti A/B dei test di integrazione sono creati a runtime con `service_role`); `owner_id` con `default auth.uid()`, senza privilegio di INSERT/UPDATE per il client, `WITH CHECK` come seconda barriera, immutabile. Allineamenti: schema `private` per le funzioni interne; `item_completions` in sola lettura dal client; `privacy_version` verificata da una funzione server-side versionata via migration, con rifiuto atomico della registrazione e `privacy_accepted_at = now()` lato database; `life_items` usa solo categorie visibili all'utente; test RLS via PostgREST reale oltre a pgTAP; tabelle `life_items`, `recurrence_rules` e `item_completions` create già in M2 (la logica resta in M5/M6). Sezioni toccate: 2 (F1), 5, 6, 10, 12, 13, 15, 17, 20 (M2, M5, M6), 22.8.

**Changelog v0.3 (Architecture Gate)**: verificati 10 punti (§23). Correzioni: TypeScript pinnato a 6.0.x (TS 7 non supportato da `typescript-eslint`); `vee-validate` sostituito con `@tanstack/vue-form` (incompatibile con zod 4); minimi nativi iOS 16.4 e WebView Android 111; link email verso `/auth/confirm` con pulsante (anti-scanner) e OTP primario; logout con `scope: 'local'` e pulizia Keychain al primo avvio dopo reinstallazione; cancellazione account con coda `account_deletions` e registro anti-ripristino; cache offline cifrata con politica esatta; AASA/assetlinks per ambiente e fallback schema custom; classificazione requisiti store (obbligatori/condizionati/best practice); piano CI iOS da Windows; controllo versione minima già nella prima release e regole di retrocompatibilità; purge token push a 270 giorni (non 60). Milestone M1–M3, M11, M14, M16, M18–M20 aggiornate.

**Changelog v0.2**: LifeAdmin è un prodotto **Web + iOS + Android** con una sola codebase Vue 3 + TypeScript distribuita sulle app native tramite **Capacitor**. Modificate le sezioni 1, 2 (F1/F2), 3, 4, 14, 15, 16, 17, 18, 20, 21; aggiunta la sezione **22 — Mobile & Store Distribution**. Le sezioni 5, 6 e 11 restano valide e vengono estese in 22.5.

Convenzioni: **[D]** decisione presa · **[I]** ipotesi da validare · **[V]** da verificare con fonte ufficiale prima di implementare · **[L]** comportamento verificato in locale (spike o test su Supabase locale) · **[S]** da verificare in staging su Supabase in hosting · **[B]** condizione **obbligatoria prima della beta**.
Terminologia: in UI l'entità si chiama **"Scadenza"**; nel codice e nel DB **`life_item`**.

---

## 0. Indice
1. Product Specification
2. MVP definitivo (funzionalità)
3. Information Architecture (route)
4. UX/UI
5. Database
6. Row Level Security
7. Storage
8. Modello Life Item
9. Ricorrenze
10. Template italiani
11. Architettura notifiche
12. GDPR
13. Sicurezza
14. Architettura frontend
15. Architettura backend (ripartizione responsabilità)
16. Environment
17. Strategia di test
18. CI/CD
19. Strategia Git
20. Roadmap tecnica e Definition of Done
21. Decisioni tecniche, azioni esterne, rischi aperti
22. **Mobile & Store Distribution** (iOS, Android, Web, push, build, signing, release, ambienti, requisiti store)
23. **Architecture Gate v0.3** (verifica dei 10 punti, specifiche vincolanti, esito)

---

## 1. Product Specification

**Cos'è.** LifeAdmin è un prodotto **multipiattaforma, distribuito su Web, iOS (App Store) e Android (Google Play)**, che raccoglie in un posto solo le scadenze amministrative della vita personale, con importo, note e documento allegato, e avvisa via email e, sulle app, con notifiche push in tempo utile.

**Piattaforme e principio di prodotto.** *Stesso prodotto, esperienza nativa per piattaforma*: si condivide tutta la logica (dominio, validazioni, autenticazione, API, database, notifiche, documenti), **non** il layout. Una sola codebase Vue 3 + TypeScript; il Web è la SPA in browser, iOS e Android sono la stessa app impacchettata con **Capacitor** (WebView nativa + plugin nativi), con una **shell di navigazione e componenti touch dedicati** (§4, §22). Un solo backend Supabase per tutte e tre le piattaforme.

| Capacità | Web | iOS | Android |
|---|---|---|---|
| Account, login, Life Item, ricorrenze, dashboard, template | Identici (codice condiviso) | Identici | Identici |
| Navigazione | Sidebar (desktop) / tab bar (schermi piccoli) | Tab bar nativa-like, gesti, safe area | Tab bar, tasto Indietro di sistema |
| Conferma email e reset password | Codice a 8 cifre **o** link | Codice a 8 cifre (+ Universal Link) | Codice a 8 cifre (+ App Link) |
| Avvisi | Email (MVP); web push in P1 | Email + push | Email + push |
| Documenti | Selezione file / drag & drop | Fotocamera + selettore file + condivisione | Fotocamera + selettore file |
| Distribuzione | URL (hosting statico) | App Store (TestFlight in beta) | Google Play (test interni/chiusi in beta) |
| Aggiornamenti | Deploy immediato | Release dello store | Release dello store |

**Ordine di consegna.** Prima il **Web MVP** (M1–M13, beta chiusa), poi il **percorso mobile** (M14–M22). I vincoli architetturali multipiattaforma valgono **già da M1** (§14, §20) in modo che aggiungere le app non richieda di rifare il progetto.

**Problema.** Scadenze (bollo, RCA, revisione, documenti, polizze, abbonamenti, garanzie, contratti) e relativi documenti sono sparsi tra email, carta, WhatsApp e memoria. Dimenticarle costa sanzioni, rinnovi non voluti, garanzie perse. **[I]**

**Utente MVP.** Adulto 28–50 anni in Italia con auto/casa/più contratti, abituato allo smartphone, che oggi usa calendario, note o la memoria. Singolo utente: niente famiglia né aziende.

**Promessa.** *"Non dimenticare più una scadenza. Ti avvisiamo noi, con il documento già pronto."*

**Perché non Google Calendar / Apple Promemoria.** (Tutte **[I]** da validare nelle interviste.)
1. **Scadenza + documento + importo + note nello stesso oggetto**: l'avviso porta a "tutto quello che serve per agire".
2. **Pensato per le scadenze, non per gli appuntamenti**: preavvisi multipli di default (30/7/1 giorni), stato (scaduta/in scadenza/ok), "segna come gestita" che per le scadenze ricorrenti riprogramma la successiva.
3. **Template italiani**: in 2 minuti si hanno bollo, RCA, revisione, patente già impostati.
4. **Colpo d'occhio**: la dashboard dice cosa è scaduto e cosa richiede attenzione. Un calendario mostra solo giorni.

**User journey principale**

| # | Passo | Cosa succede | Esito misurabile |
|---|---|---|---|
| 1 | Registrazione | Email + accettazione Privacy/Termini (la password si sceglie **dopo** la conferma, §23.12) | Account creato, email di conferma inviata |
| 2 | Conferma email e scelta della password | Inserimento del **codice a 8 cifre** ricevuto (o click sul link) → sessione attiva → scelta della password (`/set-password`); funziona in modo identico su Web, iOS e Android | `email_confirmed_at` valorizzato, password impostata |
| 3 | Onboarding | Fuso orario/ora avvisi (precompilati), scelta template, inserimento date | ≥ 3 scadenze create in < 3 minuti |
| 4 | Dashboard | Stato complessivo e prossime scadenze | L'utente capisce lo stato in pochi secondi |
| 5 | Notifica | Email "Scade tra 7 giorni: Assicurazione auto"; sulle app anche **notifica push** | Ogni avviso consegnato una sola volta per canale |
| 6 | Apertura Life Item | Web: "Apri in LifeAdmin" → `/items/:id`. App: **tap sulla push** (o Universal/App Link dall'email) apre direttamente `/items/:id`, anche ad app chiusa; login se serve, poi redirect | Dettaglio visibile in ≤ 2 tap |
| 7 | Documento | Anteprima/scarico della polizza via signed URL (browser; sulle app visualizzatore di sistema) | Documento aperto in ≤ 2 click/tap |
| 8 | Gestione | "Segna come gestita": non ricorrente → completata; ricorrente → prossima scadenza calcolata | Stato aggiornato, nuove notifiche pianificate |

**Metriche beta [I]**: ≥ 5 scadenze per utente entro 7 giorni; ≥ 40% di utenti che aprono un'email di avviso; ritorno a 30 giorni.

---

## 2. MVP definitivo

Regole trasversali: ogni azione che chiama la rete ha **loading** (skeleton per le liste, spinner e pulsante disabilitato per le azioni), **errore** (messaggio in italiano comprensibile + "Riprova"; mai stack/codici grezzi) e **autorizzazione** garantita dalla RLS (la UI è solo cortesia). Tutte le date sono mostrate in formato italiano (`15 dicembre 2026`, forma breve `15/12/2026`).

### F1 — Registrazione
- **Comportamento**: form `/register` (email, nome opzionale, consenso); invio → Supabase Auth `signUp` con una **password casuale monouso** generata dal client (64 caratteri, mai mostrata né salvata, §23.12) e `privacy_version` nei metadata → redirect a `/verify-email`, che chiede il **codice a 8 cifre** inviato per email (`verifyOtp`, tipo `signup`). L'email contiene codice **e** link; il codice è il flusso primario perché non dipende da deep link (funziona uguale su Web, iOS e Android anche se l'email si apre in un'altra app). Alla prima conferma il database **azzera la password** (§23.12) e l'app porta l'utente a `/set-password`, dove sceglie la password con la sessione appena ottenuta (poi `signOut({ scope: 'others' })`). Lo stato "la password va ancora scelta" è **letto dal server** (`profiles.password_setup_pending`) a ogni avvio con sessione: la guardia manda a `/set-password` finché è `true`.
- **Input**: email, checkbox obbligatoria "Accetto Termini e Privacy" (link), nome opzionale (display name). La password (≥ 10 caratteri, max 72 **byte**) si inserisce **dopo la conferma**, in `/set-password`.
- **Output**: utente in `auth.users`, riga `profiles` creata da trigger con `privacy_accepted_at` (`now()` lato database) e `privacy_version`. Email di conferma. Se `privacy_version` manca o non è supportata dal backend, la registrazione è **rifiutata in modo atomico** (nessun utente Auth senza profilo).
- **Regole**: email normalizzata (trim, lowercase); conferma email obbligatoria prima del login; messaggio **neutro** se l'email esiste già ("Se l'indirizzo è valido riceverai una email") per non rivelare l'esistenza di account; CAPTCHA (Turnstile) prima della beta.
- **Edge case**: email già registrata (il server risponde 422 `user_already_exists` per gli account confermati: la UI mostra lo stesso messaggio e la stessa schermata, ma l'API diretta resta distinguibile, §23.12); link di conferma scaduto/già usato → `/verify-email` con "Invia di nuovo" (cooldown 60 s); password comune/breve; doppio click sul submit; **pagina chiusa o browser riavviato dopo la conferma e prima di scegliere la password**: la sessione persiste e `password_setup_pending` resta `true` sul server, quindi al riavvio l'app riporta a `/set-password`; **link aperto su un altro dispositivo**: quel dispositivo ottiene la sessione e imposta la password, il dispositivo che ha registrato non ha sessione e accede poi con la nuova password; **sessione persa** (dati del sito cancellati, refresh token revocato): il login con password fallisce (`invalid_credentials`) e si usa "Password dimenticata", che funziona anche per l'account confermato senza password (§23.12).
- **Loading**: pulsante in stato "Creazione in corso…". **Vuoto**: n/a. **Errore**: validazione inline per campo; errore rete/rate limit → banner "Troppi tentativi, riprova tra qualche minuto".
- **Autorizzazioni**: solo ospiti (utente loggato → redirect `/dashboard`).

### F2 — Login, logout, recupero password
- **Comportamento**: `/login` (email+password), `/forgot-password` (invio codice+link), `/reset-password` (codice a 8 cifre → `verifyOtp` tipo `recovery` → nuova password; in alternativa il link), logout dal menu utente. Sulle app il logout elimina anche il token push del dispositivo (§22.5).
- **Regole**: errore generico "Email o password non corretti"; `redirect` query param ammesso **solo** per path interni (whitelist, no URL assoluti); sessione persistente con refresh token; logout invalida la sessione locale.
- **Edge case**: email non confermata → messaggio con "Invia di nuovo"; link reset scaduto → torna a `/forgot-password`; sessione scaduta durante l'uso → redirect a login preservando la destinazione.
- **Loading/Errore**: come F1.
- **Autorizzazioni**: `/login`, `/forgot-password`: ospiti; `/reset-password`: sessione di recovery; `/set-password`: sessione ottenuta dalla conferma dell'email, con `password_setup_pending = true` (§23.12).

### F3 — Onboarding
- **Comportamento**: 3 passi su `/onboarding`, saltabile solo dopo il passo 1.
  1. **Preferenze**: nome (opzionale), fuso orario (rilevato dal browser, default `Europe/Rome`), ora degli avvisi (default 09:00).
  2. **Cosa vuoi tenere sotto controllo?** Griglia di template multi-selezione (§10) + "Altro / parto da zero".
  3. **Date**: elenco compatto, una riga per template scelto con solo il campo **data scadenza** (obbligatorio per salvare la riga) e importo opzionale.
- **Output**: `profiles.onboarding_completed_at` valorizzato; scadenze create in un'unica operazione batch.
- **Regole**: la data è sempre scelta dall'utente (nessun default); righe senza data non vengono create (con avviso); reminder di default 30/7/1.
- **Edge case**: nessun template scelto → vai alla dashboard vuota con call to action; ricarica a metà → riparte dal passo 1 (nessuno stato parziale lato server); fallimento parziale del batch → mostra quali righe non sono state salvate.
- **Loading**: salvataggio finale con spinner. **Vuoto**: n/a. **Errore**: per riga, con "Riprova".
- **Autorizzazioni**: autenticato; completato → `/onboarding` redirect a `/dashboard`.

### F4 — Crea Life Item
- **Comportamento**: `/items/new` (anche `?template=<key>` per precompilare). Form: titolo, categoria, data scadenza, ricorrenza, importo, note, preavvisi. Dopo il salvataggio: `/items/:id` con toast "Scadenza creata".
- **Input / vincoli**: vedi §8.
- **Output**: riga in `life_items` (+ `recurrence_rules` se ricorrente); notifiche pianificate dal trigger.
- **Regole**: data passata ammessa (si può registrare qualcosa già scaduto) ma con avviso "Questa data è già passata"; importo ≥ 0 con max 2 decimali, in euro; massimo 200 scadenze per utente (quota anti-abuso).
- **Edge case**: titolo di soli spazi; importo con virgola/punto; ricorrenza personalizzata con intervallo non valido; superata la quota; doppio submit (idempotenza lato UI: pulsante disabilitato + id client generato).
- **Loading**: pulsante "Salvataggio…". **Errore**: errori per campo + errore generale.
- **Autorizzazioni**: autenticato, solo proprietario (RLS `owner_id = auth.uid()`).

### F5 — Elenco scadenze `/items`
- **Comportamento**: lista ordinata per data crescente; filtri: stato (Attive / Completate), categoria, ricerca testuale sul titolo. Filtri nei query param (link condivisibile/indietro del browser).
- **Output**: riga con icona categoria, titolo, importo (se presente), data e badge di stato (scaduta / entro 7 gg / entro 30 gg / oltre).
- **Regole**: stato calcolato nel fuso dell'utente (§9); tutto filtrato lato client (max 200 elementi).
- **Edge case**: nessun risultato per i filtri → stato vuoto dedicato con "Azzera filtri".
- **Loading**: 5 skeleton row. **Vuoto**: "Non hai ancora scadenze" + CTA "Aggiungi la prima" + "Parti da un modello". **Errore**: card con "Riprova".
- **Autorizzazioni**: autenticato.

### F6 — Dettaglio e modifica
- **Comportamento**: `/items/:id` mostra tutti i campi, ricorrenza in italiano ("Si ripete ogni anno"), reminder pianificati con il loro stato, documenti, storico completamenti. `/items/:id/edit` usa lo stesso form di F4.
- **Regole**: modificare la data di scadenza **ri-ancora** la ricorrenza (§9) e rigenera i reminder futuri; modificare i preavvisi sostituisce quelli ancora `pending` senza toccare gli inviati; modifiche con concorrenza: ultimo salvataggio vince (check su `updated_at` → se diverso, avviso "modificato altrove, ricarica").
- **Edge case**: id inesistente **o di un altro utente** → stessa pagina "Scadenza non trovata" (nessuna differenza osservabile); item completato → i campi sono modificabili ma i reminder non vengono ricreati.
- **Loading**: skeleton del dettaglio. **Errore**: 404 gentile / errore di rete con "Riprova".
- **Autorizzazioni**: solo proprietario.

### F7 — Elimina
- **Comportamento**: azione "Elimina" nel dettaglio → modal di conferma con nome dell'elemento ("Verranno eliminati anche i documenti allegati. Non si può annullare.") → toast "Scadenza eliminata" → `/items`.
- **Regole**: cancellazione definitiva (hard delete) con cascata su regola, reminder, completamenti e documenti; i file in Storage vengono rimossi (§7).
- **Edge case**: eliminazione già avvenuta altrove → trattata come successo; errore di rimozione file → riga eliminata, file messo in coda di pulizia, nessun errore all'utente.
- **Autorizzazioni**: solo proprietario.

### F8 — Ricorrenza e completamento
- **Comportamento**: nel form si sceglie "Non si ripete / Ogni mese / Ogni anno / Personalizzata (ogni N giorni/settimane/mesi/anni)". Il pulsante **"Segna come gestita"** (dettaglio e riga in lista) chiama la funzione DB `complete_life_item`.
- **Output**: non ricorrente → `status='completed'`, `completed_at`; ricorrente → `due_date` avanza alla prossima occorrenza, riga in `item_completions`, toast "Gestita. Prossima scadenza: 15/12/2027".
- **Regole e calcolo**: §9.
- **Edge case**: completamento di una scadenza già completata (no-op); più click ravvicinati (lock di riga, idempotente); completamento molto in ritardo (salta le occorrenze passate); riattivazione di un item non ricorrente completato ("Riapri") → `status='active'`.
- **Autorizzazioni**: solo proprietario.

### F9 — Dashboard
- **Comportamento**: `/dashboard`, pagina di ingresso.
- **Contenuto**:
  - Riga di 4 indicatori cliccabili (filtrano `/items`): **Scadute**, **Entro 7 giorni**, **Entro 30 giorni**, **Attive totali**.
  - Messaggio di stato: "Tutto sotto controllo" (nessuna scaduta/imminente), oppure "Hai 2 scadenze da gestire".
  - Sezione **Da gestire ora** (scadute + entro 7 giorni), sezione **Prossime** (entro 90 giorni, max 8) con link "Vedi tutte".
- **Regole**: considera solo `status='active'`; ordinamento per data; "oggi" calcolato nel fuso del profilo.
- **Edge case**: più di 200 scadenze impossibile (quota); fuso orario non valido → fallback `Europe/Rome`.
- **Loading**: skeleton per indicatori e liste. **Vuoto**: illustrazione + "Aggiungi la prima scadenza" + "Parti da un modello". **Errore**: card di errore per sezione.
- **Autorizzazioni**: autenticato + onboarding completato.

### F10 — Avvisi email
- **Comportamento**: per ogni scadenza attiva vengono pianificati avvisi ai giorni scelti (default 30, 7, 1 giorni prima) all'ora scelta dall'utente nel suo fuso. Architettura in §11.
- **Input**: `reminder_days` per item; preferenze globali nel profilo (email attive sì/no, ora).
- **Output**: email "Scade tra {n} giorni: {titolo}" con titolo, data, categoria, importo e pulsante "Apri in LifeAdmin".
- **Regole**: nessun contenuto di note o documenti nell'email; un avviso mai inviato due volte; avvisi non inviati per scadenze completate/eliminate/modificate; avvisi già "nel passato" alla creazione non vengono inviati (§11).
- **Edge case**: email disattivate; email non confermata; modifica data dopo la pianificazione; fallimento del provider.
- **Autorizzazioni**: i reminder sono creati solo dal DB; l'utente li legge ma non li scrive.

### F11 — Documenti
- **Comportamento**: nel dettaglio, sezione "Documenti": carica (drag & drop / selezione file / fotocamera su mobile), elenca, apri (anteprima/download), elimina.
- **Input**: PDF, JPG/JPEG, PNG; ≤ 10 MB per file; max 5 file per scadenza; 100 MB totali per utente (§7).
- **Output**: oggetto in bucket privato `documents` + riga in `documents`.
- **Regole**: apertura solo tramite signed URL a breve scadenza; nome file originale solo come metadato (non nel path).
- **Edge case**: file troppo grande/tipo non ammesso (errore prima dell'upload); estensione falsa (controllo magic bytes lato client + MIME lato bucket); upload interrotto (riga senza `uploaded_at` ripulita dopo 1 ora); quota superata; stesso file due volte (ammesso).
- **Loading**: barra di avanzamento per file. **Vuoto**: "Nessun documento. Aggiungi la polizza o la ricevuta." **Errore**: per file, con "Riprova".
- **Autorizzazioni**: solo proprietario.

### F12 — Impostazioni e dati personali
- **Sezioni** (`/settings`): **Profilo** (nome, email in sola lettura, cambio password), **Notifiche** (email on/off, ora, fuso), **Privacy e dati** (esporta i miei dati, versione/data consensi, link policy), **Account** (elimina account).
- **Export**: "Esporta i miei dati" → JSON con profilo, scadenze, regole, avvisi, metadati e link firmati (24 h) ai documenti.
- **Elimina account**: modal con testo chiaro, richiede la password e la digitazione di "ELIMINA"; cancellazione immediata e definitiva di dati e file (§12).
- **Regole**: rate limit export (1/ora) ed eliminazione (3/ora).
- **Autorizzazioni**: autenticato; operazioni distruttive tramite Edge Function con verifica password recente.

**Fuori MVP (non implementare)**: calendario, push, condivisione familiare, categorie personalizzate, OCR/AI, pagamenti, OAuth, dark mode, multi-lingua, analisi spese, digest, app nativa, integrazioni, allegati multipli oltre il limite, ricerca full-text sui documenti.

---

## 3. Information Architecture

Route in inglese (stabili), etichette in italiano. Guard di navigazione: `guestOnly`, `requiresAuth`, `requiresOnboarding`.

| Route | Scopo | Accesso | Componenti principali | Dati necessari |
|---|---|---|---|---|
| `/` | Redirect a `/dashboard` o `/login` (**fino a M7, `/dashboard` non esiste: `/` è la landing protetta**, con utente e "Esci") | auth | `HomePage` | sessione |
| `/login` | Accesso | guestOnly | `AuthCard`, `LoginForm` | – |
| `/register` | Registrazione | guestOnly | `AuthCard`, `RegisterForm`, `ConsentCheckbox` | versione policy |
| `/verify-email` | Istruzioni + reinvio email | pubblica | `AuthCard`, `ResendEmailButton` | email (query/stato) |
| `/forgot-password` | Richiesta reset | guestOnly | `ForgotPasswordForm` | – |
| `/reset-password` | Nuova password | sessione recovery | `ResetPasswordForm` | – |
| `/set-password` | Scelta della password dopo la conferma dell'email (§23.12) | auth, finché `profiles.password_setup_pending = true` (stato letto dal server, §23.12) | `SetPasswordForm` | – |
| `/auth/confirm` | Atterraggio del **link** email (conferma/recovery): mostra un pulsante "Conferma" e solo al click chiama `verifyOtp({ token_hash, type })` (nessuna verifica automatica al caricamento, §23.4) | pubblica | `ConfirmCard` | `token_hash`, `type` |
| `/onboarding` | Setup iniziale | auth, onboarding incompleto | `OnboardingStepper`, `PreferencesStep`, `TemplatePicker`, `QuickDatesStep` | profilo, template statici, categorie |
| `/dashboard` | Stato generale | auth + onboarding | `StatusSummary`, `UrgentList`, `UpcomingList`, `EmptyState` | scadenze attive, profilo |
| `/items` | Elenco e filtri | auth + onboarding | `ItemFilters`, `ItemList`, `ItemRow`, `StatusBadge` | scadenze, categorie |
| `/items/new` | Creazione | auth + onboarding | `ItemForm`, `TemplatePicker` (modal) | categorie, template |
| `/items/:id` | Dettaglio | auth + onboarding | `ItemHeader`, `ItemFacts`, `RemindersList`, `DocumentsPanel`, `CompletionHistory`, `CompleteButton` | item, regola, notifiche, documenti, completamenti |
| `/items/:id/edit` | Modifica | auth + onboarding | `ItemForm` | item, regola, categorie |
| `/settings` | Profilo, notifiche, privacy, account (sezioni con ancore/tab) | auth | `ProfileSection`, `NotificationSettings`, `DataPrivacySection`, `DangerZone` | profilo |
| `/privacy`, `/terms` | Testi legali | pubbliche | `LegalPage` | contenuto statico versionato |
| `/*` | 404 | pubblica | `NotFoundView` | – |

Navigazione primaria: **Dashboard · Scadenze · Impostazioni**; azione primaria sempre visibile: **+ Nuova scadenza**.

**Deep link (Web, iOS, Android).** Le stesse route sono gli indirizzi dei deep link: `https://<dominio-app>/items/:id` apre il dettaglio; sulle app lo stesso URL viene gestito via **Universal Links (iOS) / App Links (Android)**, e il payload delle push contiene solo il path (`/items/<uuid>`). I path accettati dal gestore di deep link sono una **whitelist** (`/items/:uuid`, `/dashboard`, `/items`, `/settings`); qualsiasi altro valore è ignorato. Se l'utente non è autenticato: `/login?redirect=<path>`.

---

## 4. UX/UI

Principi: calma e fiducia (si gestiscono documenti personali), densità bassa, un'azione primaria per schermata, testo in italiano semplice, mai solo colore per comunicare lo stato.

**Due shell, un solo design system.** L'app ha due *shell* di navigazione che condividono tutti i componenti, i token e le pagine:
- **`DesktopShell`** (Web ≥ 1024 px): sidebar fissa 256 px (logo, pulsante primario "+ Nuova scadenza", nav, menu utente in basso) + area contenuto con `max-w-5xl`, header di pagina (titolo + azioni).
- **`MobileShell`** (app iOS/Android **sempre**; Web sotto 1024 px): header compatto con titolo di pagina; **tab bar inferiore** (Dashboard, Scadenze, Impostazioni) con pulsante centrale "+"; contenuto a colonna singola; transizioni di pagina a stack (entra da destra / torna indietro); modal e menu come **bottom sheet**; padding per **safe area** (notch, home indicator, edge-to-edge Android).
La scelta della shell è un composable (`useShell`) basato su `isNative` oppure sulla larghezza; le pagine non sanno in quale shell girano.

**Esperienza mobile realmente touch (non una web app ristretta)**
- **Target touch** ≥ 44 pt (iOS) / 48 dp (Android); nessuna funzione solo-hover; spaziatura tra elementi toccabili ≥ 8 px.
- **Gesti**: *swipe* sulla riga scadenza (destra = "Segna come gestita", sinistra = azioni con "Elimina" dietro conferma), **pull-to-refresh** su dashboard e lista, tasto/gesto **Indietro** nativo (Android back button, swipe-back iOS dove disponibile).
- **Controlli nativi**: `<input type="date">` e tastiere appropriate (`inputmode="decimal"` per l'importo, `autocomplete` corretti per il gestore password), selettore file/fotocamera di sistema, foglio di condivisione di sistema.
- **Feedback**: *haptics* leggeri su completamento/eliminazione, toast sopra la tab bar, stato offline visibile.
- **Tastiera**: i campi focalizzati restano visibili (scroll automatico), pulsante di invio sticky sopra la tastiera nei form lunghi.
- **Aspetti di sistema**: barra di stato e splash coerenti con il tema, orientamento verticale su telefono **[R]**, rispetto della dimensione testo di sistema (font in `rem`, verifica a 200%), nessun ritardo di tap, nessun rimbalzo del contenuto che sposti la tab bar.
- **Prestazioni**: bundle di route piccoli (lazy loading), asset impacchettati nell'app (nessun caricamento remoto del codice), liste senza animazioni costose, obiettivo avvio a freddo < 2 s su telefono di fascia media **[I]**.
- La checklist completa per la review mobile è in §22.12.

Il Web desktop resta una vera web app: layout a sidebar, scorciatoie da tastiera, hover, drag & drop.

**Design tokens (Tailwind `theme.extend`, CSS variables per un futuro dark mode)**
- **Colori**: primario `indigo-600` (hover `700`, soft `indigo-50`); neutri `slate` (testo `slate-900`, secondario `slate-600`, bordi `slate-200`, sfondo app `slate-50`, superfici `white`); semantici: pericolo `red-600`/`red-50`, attenzione `amber-600`/`amber-50`, ok `emerald-600`/`emerald-50`, info `sky-600`/`sky-50`. Tutte le combinazioni testo/sfondo ≥ WCAG AA (4.5:1), verificate nei test di accessibilità.
- **Tipografia**: Inter (self-hosted con `@fontsource-variable/inter`, nessun font da CDN: GDPR e performance). Scala: titolo pagina 24/32 semibold, sezione 18/28 semibold, corpo 16/24 (14/20 per meta), micro 12/16. Numeri con `tabular-nums`.
- **Spaziatura**: griglia da 4 px; padding card 16 (mobile) / 24 (desktop); gap tra sezioni 24–32.
- **Forme**: raggio `rounded-xl` per card, `rounded-lg` per input/pulsanti; ombra `shadow-sm`, bordo 1 px `slate-200`; focus ring 2 px `indigo-500` con offset (sempre visibile da tastiera).
- **Icone**: `lucide-vue-next`, decorative con `aria-hidden`.

**Componenti chiave**
- **Card scadenza (riga)**: chip icona categoria · titolo (1 riga, troncato) · meta (categoria · importo) · a destra data breve + `StatusBadge` con icona e testo ("Scaduta da 3 giorni", "Scade tra 5 giorni", "Scade il 12/03/2027").
- **StatusBadge**: Scaduta (rosso, icona alert), Entro 7 gg (ambra, icona orologio), Entro 30 gg (azzurro), Oltre (neutro), Completata (verde, check).
- **Indicatori dashboard**: 4 stat card cliccabili con numero grande e etichetta; "Scadute" evidenziata solo se > 0.
- **Form**: etichetta sempre visibile sopra il campo, aiuto sotto, errore sotto in rosso con icona e `aria-describedby`; validazione al blur e al submit; campi raggruppati in sezioni ("Cosa", "Quando", "Dettagli", "Avvisi"); su mobile date picker nativo (`<input type="date">`).
- **Toast**: in alto a destra (desktop) / sopra la tab bar (mobile), 4 s (6 s per errori), `role="status"`/`aria-live="polite"` (errori `assertive`), massimo 3 impilati, azione opzionale.
- **Modal**: Headless UI `Dialog` (focus trap, Esc, ritorno del focus); conferme distruttive con pulsante rosso e testo esplicito sulle conseguenze.
- **Empty state**: icona/illustrazione semplice, frase che spiega il valore, **una** CTA primaria e una secondaria.
- **Loading**: skeleton con la forma del contenuto, mai spinner a pagina intera per le liste; pulsanti con spinner e `aria-busy`.
- **Errori**: banner inline o card con messaggio + "Riprova"; errori imprevisti catturati da un error boundary di route con ID di riferimento per il supporto.
- **Accessibilità**: HTML semantico, skip link, landmark (`nav`, `main`), ordine di focus corretto, `prefers-reduced-motion` rispettato, test automatici con axe nei test E2E.

**Wireframe testuale — Dashboard**
```
[Sidebar]  Buongiorno, Marco                         [+ Nuova scadenza]
           ┌ Scadute ┐ ┌ Entro 7 gg ┐ ┌ Entro 30 gg ┐ ┌ Attive ┐
           │   1     │ │    2       │ │     4       │ │   12   │
           └─────────┘ └────────────┘ └─────────────┘ └────────┘
           Hai 3 scadenze da gestire
           DA GESTIRE ORA
           ▸ Bollo auto           ⚠ Scaduta da 3 giorni      [Gestisci]
           ▸ Assicurazione casa   ⏱ Scade tra 5 giorni
           PROSSIME
           ▸ Revisione Panda      Scade il 20/11/2026
           [Vedi tutte le scadenze]
```

---

## 5. Database (PostgreSQL / Supabase)

Principi: tutte le tabelle in `public`, **RLS abilitata ovunque**, PK `uuid` (`gen_random_uuid()`), `created_at`/`updated_at` `timestamptz not null default now()` (trigger `set_updated_at`), nomi `snake_case`, tutte le FK con `on delete` esplicito. Importi in **centesimi interi**. Le date di scadenza sono `date` (valore "fluttuante", senza fuso). Migrazioni solo tramite `supabase/migrations/*.sql`, mai modifiche manuali in produzione.

Per garantire integrità del proprietario, `life_items` ha `unique (id, owner_id)` e le tabelle figlie usano **FK composta `(item_id, owner_id) → life_items(id, owner_id)`**: un figlio non può mai appartenere a un utente diverso dal suo item.

Le funzioni e i trigger interni vivono nello schema **`private`**, non esposto da PostgREST; in `public` non esiste nessuna funzione applicativa (nessun RPC esposto). Ogni migration revoca tutti i privilegi sulle proprie tabelle a `public`, `anon` e `authenticated` e concede solo il minimo necessario, anche per colonna.

### Tipi enum
`item_status ('active','completed')` · `recurrence_unit ('day','week','month','year')` · `notification_status ('pending','processing','sent','failed','skipped','cancelled')` · `notification_channel ('email')` (estendibile a `push`).

### `profiles` (1:1 con `auth.users`)
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | – | **PK**, **FK → auth.users(id) on delete cascade** |
| display_name | text | sì | – | check `char_length ≤ 80` |
| timezone | text | no | `'Europe/Rome'` | validato da **trigger** (before insert/update) che verifica l'esistenza in `pg_catalog.pg_timezone_names` (un CHECK non può dipendere da un catalogo) |
| locale | text | no | `'it'` | check `in ('it')` (estendibile) |
| email_notifications_enabled | boolean | no | `true` | |
| notification_hour | smallint | no | `9` | check `between 0 and 23` |
| onboarding_completed_at | timestamptz | sì | – | |
| privacy_accepted_at | timestamptz | no | – | `now()` lato database al momento della creazione del profilo; un timestamp fornito dal client è ignorato |
| privacy_version | text | no | – | formato `YYYY-MM-DD`; letta dai metadata del signup e verificata contro le versioni supportate (es. `'2026-10-01'`) |
| password_setup_pending | boolean | no | `false` | **Aggiunta in M3 (additiva, v0.5)**. `true` dal trigger quando la password viene azzerata alla prima conferma, `false` quando la password torna valorizzata. Il client la **legge** (La lettura discende dal grant `SELECT` **sull'intera tabella** `profiles` già concesso a `authenticated` da M2 (`20261008144123_profiles.sql`); la colonna **non** entra nella lista dei privilegi di `UPDATE` (né di `INSERT`)) e **non può scriverla**; vale `false` per i profili esistenti e per gli utenti creati da amministratore |
| created_at / updated_at | timestamptz | no | `now()` | |

Indici: PK. L'email resta solo in `auth.users` (nessuna duplicazione). Creazione: trigger `after insert on auth.users` (`private.handle_new_user`, `security definer`), che delega a `private.create_profile_for_user`: la creazione dell'utente è di Supabase Auth, l'attivazione del profilo applicativo avviene solo con un consenso privacy valido. La versione supportata è definita dalla funzione server-side `private.supported_privacy_versions()`, modificabile solo con una nuova migration. Se `privacy_version` manca o non è supportata, l'intera registrazione è rifiutata in modo atomico (nessun utente Auth senza profilo).

### `categories`
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| owner_id | uuid | sì | – | FK → auth.users on delete cascade. **NULL = categoria di sistema**. Riservata alle categorie personalizzate future |
| slug | text | no | – | check `~ '^[a-z0-9-]+$'` |
| name | text | no | – | check `1..60` |
| icon | text | no | – | nome icona lucide |
| sort_order | smallint | no | `100` | |
| created_at / updated_at | timestamptz | no | `now()` | |

Unique: `(slug) where owner_id is null`; `(owner_id, slug) where owner_id is not null`. Indice: `(owner_id)`. Le 8 categorie di sistema (§10) sono inserite direttamente dalla migration `categories` (idempotente per slug); **nessun `seed.sql`**. Nell'MVP nessun utente può scrivere in questa tabella.

### `life_items`
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| owner_id | uuid | no | `auth.uid()` | FK → auth.users on delete cascade; non inseribile né aggiornabile dal client (§6) |
| category_id | uuid | no | – | FK → categories(id) on delete restrict |
| title | text | no | – | check `char_length(btrim(title)) between 1 and 120` |
| due_date | date | no | – | |
| amount_cents | bigint | sì | – | check `>= 0 and <= 100000000000` |
| notes | text | sì | – | check `char_length ≤ 2000` |
| reminder_days | smallint[] | no | `'{30,7,1}'` | check: ≤ 5 elementi, valori 0..365, senza duplicati (funzione `valid_reminder_days`) |
| status | item_status | no | `'active'` | |
| completed_at | timestamptz | sì | – | check coerente con `status` |
| created_at / updated_at | timestamptz | no | `now()` | |

Unique: `(id, owner_id)`. Indici: `(owner_id, status, due_date)` (query dashboard/lista), `(category_id)`. Trigger: quota max 200 per owner, immutabilità di `owner_id`, `sync_item_notifications` dopo insert/update di `due_date, reminder_days, status`.
Valuta: solo EUR nell'MVP, nessuna colonna `currency` (si aggiungerà con migrazione `default 'EUR'`).

### `recurrence_rules`
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| item_id | uuid | no | – | **unique**; FK composta `(item_id, owner_id)` → life_items on delete cascade |
| owner_id | uuid | no | `auth.uid()` | non inseribile né aggiornabile dal client (§6) |
| interval_unit | recurrence_unit | no | – | |
| interval_count | smallint | no | `1` | check `between 1 and 120` |
| anchor_date | date | no | – | data di riferimento da cui si calcolano le occorrenze (§9) |
| created_at / updated_at | timestamptz | no | `now()` | |

Mensile = (`month`,1); annuale = (`year`,1); personalizzata = qualsiasi combinazione. Indice: `(owner_id)`.

### `item_completions`
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| item_id | uuid | no | – | FK composta → life_items on delete cascade |
| owner_id | uuid | no | – | |
| due_date | date | no | – | scadenza che è stata gestita |
| completed_at | timestamptz | no | `now()` | |

Indici: `(item_id, completed_at desc)`, `(owner_id)`. **Sola lettura per il client** (nessun privilegio né policy di INSERT/UPDATE/DELETE); la scrittura avverrà solo tramite `complete_life_item` (M6).

### `notifications` (avvisi pianificati e loro stato)
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK (usato come idempotency key) |
| item_id | uuid | no | – | FK composta → life_items on delete cascade |
| owner_id | uuid | no | – | |
| channel | notification_channel | no | `'email'` | |
| due_date | date | no | – | snapshot della scadenza a cui si riferisce |
| days_before | smallint | no | – | |
| scheduled_for | timestamptz | no | – | istante UTC di invio previsto |
| next_attempt_at | timestamptz | no | – | = `scheduled_for` all'inizio; avanza con il backoff |
| status | notification_status | no | `'pending'` | |
| attempts | smallint | no | `0` | |
| locked_at | timestamptz | sì | – | per il recupero di invii bloccati |
| sent_at | timestamptz | sì | – | |
| provider_message_id | text | sì | – | |
| last_error | text | sì | – | troncato a 500 caratteri, mai dati personali |
| created_at / updated_at | timestamptz | no | `now()` | |

**Unique `(item_id, due_date, days_before, channel)`** → impossibile pianificare due volte lo stesso avviso. Indici: parziale `(next_attempt_at) where status in ('pending','processing')`; `(owner_id, scheduled_for desc)`; `(item_id)`.

### `documents`
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK; coincide con il nome file nello Storage |
| item_id | uuid | no | – | FK composta → life_items on delete cascade |
| owner_id | uuid | no | – | |
| storage_path | text | no | – | **unique**; `{owner_id}/{item_id}/{id}.{ext}`; check coerente con owner |
| file_name | text | no | – | nome originale sanificato, `1..200` |
| mime_type | text | no | – | check `in ('application/pdf','image/jpeg','image/png')` |
| size_bytes | integer | no | – | check `> 0 and <= 10485760` |
| uploaded_at | timestamptz | sì | – | NULL finché l'upload non è confermato |
| created_at / updated_at | timestamptz | no | `now()` | |

Indici: `(item_id)`, `(owner_id)`. Trigger quota: ≤ 5 documenti per item, ≤ 100 MB totali per owner. Trigger `after delete` → inserisce il path in `storage_cleanup_queue`.

### `storage_cleanup_queue` (interna)
`id uuid pk`, `bucket text not null default 'documents'`, `storage_path text not null`, `created_at timestamptz`, `attempts smallint default 0`. Nessun accesso client (RLS attiva, nessuna policy; solo `service_role`).

### `rate_limits` (interna, per le Edge Function)
`key text`, `window_start timestamptz`, `count integer`, PK `(key, window_start)`. Nessun accesso client. Funzione `check_rate_limit(key, max, window)` per `service_role`.

### Cosa NON creo e perché
- Nessuna tabella `reminders` separata dalle `notifications`: le due cose coincidono (la regola è `reminder_days` sull'item, l'istanza è la riga `notifications`).
- Nessuna tabella `templates`: sono dati statici versionati nel codice (cambiano con le release, non per utente).
- Nessun `subscriptions`/`plans`: i pagamenti non sono nell'MVP.
- Nessuna tabella di consensi separata: bastano `privacy_accepted_at` e `privacy_version` nel profilo (da separarle quando esisterà il consenso marketing).

### Estendibilità
- **Family**: aggiunta di `households(id)`, `household_members(household_id, user_id, role)` e `household_id uuid null` su `life_items`; le policy passano da `owner_id = auth.uid()` a `owner_id = auth.uid() or is_household_member(household_id)`. Nessuna riscrittura di tabelle.
- **Push**: nuovo valore dell'enum `notification_channel` + tabella `push_subscriptions`.
- **OCR/AI**: tabella `document_extractions(document_id, …)` collegata a `documents`.
- **Categorie personalizzate**: `categories.owner_id` è già pronto, mancano solo le policy di scrittura.
- **Piani**: tabella `subscriptions` + vista `entitlements`; le quote oggi in trigger diventano parametriche.

---

## 6. Row Level Security

Regole generali: `alter table … enable row level security` su **tutte** le tabelle di `public`; nessuna policy per `anon`; `auth.uid()` sempre incapsulato come `(select auth.uid())` (valutato una volta per query); grant espliciti per colonna dove serve (ogni migration fa `revoke all` a `public`, `anon`, `authenticated` e riconcede il minimo); funzioni `security definer` con `set search_path = ''` e `revoke execute … from public, anon, authenticated` salvo quelle esplicitamente chiamabili. Le funzioni interne stanno nello schema `private` (non esposto da PostgREST).

| Tabella | select | insert | update | delete |
|---|---|---|---|---|
| `profiles` | `id = auth.uid()` | solo trigger (nessuna policy né privilegio client) | `id = auth.uid()`, **grant update limitato a** `display_name, timezone, email_notifications_enabled, notification_hour, onboarding_completed_at` | nessuna (cancellazione via account) |
| `categories` | `owner_id is null or owner_id = auth.uid()` | nessuna (MVP) | nessuna | nessuna |
| `life_items` | `owner_id = auth.uid()` | `with check owner_id = auth.uid()` **e categoria visibile all'utente** (di sistema o propria); `owner_id` non inseribile | `using/with check owner_id = auth.uid()` e categoria visibile; `owner_id` non aggiornabile | `owner_id = auth.uid()` |
| `recurrence_rules` | `owner_id = auth.uid()` | `with check owner_id = auth.uid()` (+ FK composta garantisce che l'item sia dello stesso owner); `owner_id` non inseribile | idem; `item_id` e `owner_id` non aggiornabili | idem |
| `item_completions` | `owner_id = auth.uid()` | **nessuna** (nessun privilegio client; solo `complete_life_item`, M6) | nessuna | nessuna (cascata) |
| `notifications` | `owner_id = auth.uid()` | **nessuna** (solo trigger DB) | **nessuna** (solo `service_role`) | nessuna (cascata) |
| `documents` | `owner_id = auth.uid()` | `with check owner_id = auth.uid()` | `owner_id = auth.uid()`, grant update solo su `uploaded_at` | `owner_id = auth.uid()` |
| `storage_cleanup_queue`, `rate_limits` | nessuna | nessuna | nessuna | nessuna (solo `service_role`) |

**`owner_id`** (tabelle private): è valorizzato da `default auth.uid()`; il client **non ha il privilegio** di INSERT né di UPDATE sulla colonna `owner_id` (privilegi di colonna), quindi non può né indicarlo né cambiarlo; la `WITH CHECK` della RLS resta comunque come **seconda barriera** di sicurezza; l'owner è **immutabile** (trigger `private.prevent_owner_change`, valido anche per il ruolo di servizio). La visibilità della categoria in `life_items` è verificata con una subquery su `categories` soggetta alla RLS dell'utente: una categoria personale di un altro utente non è referenziabile.

Esempio (pattern da riusare, semplificato):
```sql
create policy life_items_select_own on public.life_items
  for select to authenticated using (owner_id = (select auth.uid()));
create policy life_items_insert_own on public.life_items
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy life_items_update_own on public.life_items
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy life_items_delete_own on public.life_items
  for delete to authenticated using (owner_id = (select auth.uid()));
```

**Storage (`storage.objects`, bucket `documents`)**
- `select`: `bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text`
- `insert`: stessa condizione **più** `exists (select 1 from public.documents d where d.storage_path = name and d.owner_id = (select auth.uid()))` → si può caricare solo un oggetto già "registrato" (e quindi già validato dalle quote).
- `update`: nessuna (i file sono immutabili: sostituire = eliminare + ricaricare).
- `delete`: stessa condizione del select. (La rimozione degli oggetti a cascata è fatta dalla coda di pulizia con `service_role`.)

**Predisposizione Family**: l'accesso passa sempre dalla colonna `owner_id` e da funzioni/policy centralizzate; per condividere si estenderanno le policy con `is_household_member(...)` e la policy di Storage passerà dal prefisso cartella alla verifica sulla tabella `documents` (che avrà già l'informazione di appartenenza). Nessuna dipendenza del codice client dalla struttura dei path.

**Test obbligatori RLS (pgTAP e integrazione via PostgREST reale, §17)**: utente A non vede/modifica/cancella nulla di B su ogni tabella; non può inserire con `owner_id` di B; non può creare un documento/regola/notifica su un item di B; non può usare la categoria personale di B (può usare quelle di sistema); `anon` non legge nulla; il client non può scrivere su `notifications` né su `item_completions`; non può cambiare `owner_id`. I test via PostgREST (supabase-js reale, utenti A/B creati a runtime) sono obbligatori perché i soli test pgTAP possono mascherare problemi di privilegi.

---

## 7. Storage (allegati)

- **Bucket** `documents`: `public = false`, `file_size_limit = 10485760` (10 MB), `allowed_mime_types = {application/pdf, image/jpeg, image/png}`.
- **Path**: `{owner_id}/{item_id}/{document_id}.{ext}` (UUID, nessun nome utente nel path). Il nome originale vive solo in `documents.file_name`, mostrato con escaping e mai usato come path.
- **Limiti**: 10 MB per file, 5 file per scadenza, 100 MB per utente **[D]** (valori ragionevoli per beta, parametrizzabili in seguito per i piani).
- **Flusso di upload** (garantisce quota e consistenza):
  1. Client valida: estensione, MIME dichiarato, dimensione, **magic bytes** (`%PDF-`, `FF D8 FF`, `89 50 4E 47`).
  2. Client inserisce la riga `documents` (id generato dal client) → i trigger verificano quote; fallisce qui se oltre i limiti.
  3. Client carica l'oggetto in `storage_path` (la policy lo consente solo se la riga esiste).
  4. Client imposta `uploaded_at = now()`. In caso di errore al passo 3 elimina la riga.
  5. Un job di pulizia (Edge Function schedulata, ogni ora) elimina righe con `uploaded_at is null` più vecchie di 1 ora e oggetti senza riga corrispondente.
- **Lettura**: nessun URL pubblico. Il client chiede `createSignedUrl(path, 60)` (60 secondi) al momento del click; l'URL non viene mai salvato né loggato. Anteprima immagini con `<img>` sull'URL firmato; PDF aperti in una nuova scheda (`rel="noopener"`), nessun `<iframe>`.
- **Eliminazione**: eliminando un documento il client chiama `storage.remove`; in ogni caso il trigger `after delete` su `documents` accoda il path in `storage_cleanup_queue`, svuotata dalla Edge Function di pulizia con `service_role` (copre eliminazione item, cascate e account). Eliminazione account: la Edge Function rimuove prima tutto il prefisso `{owner_id}/`.
- **Sicurezza file**: servito dal dominio Supabase (origine diversa dall'app, nessuna esecuzione nel contesto dell'app); header `Content-Type` ammesso solo tra i tre consentiti; nessuna antivirus-scansione nell'MVP (rischio accettato, solo il proprietario può aprire i propri file; da rivalutare con la condivisione familiare).
- **iPhone [I]**: `accept="application/pdf,image/jpeg,image/png"` fa convertire le foto HEIC in JPEG da Safari; da verificare in test manuale.

---

## 8. Modello Life Item

| Campo | Tipo | Obbl. | Regole | Esempio |
|---|---|---|---|---|
| `title` | testo 1–120 | sì | trim; niente solo spazi | "Assicurazione auto" |
| `category_id` | FK | sì | una delle 8 categorie di sistema | "Assicurazioni" |
| `due_date` | data | sì | anche passata (con avviso) | 15/12/2026 |
| `recurrence` | regola | no | nessuna / mensile / annuale / ogni N unità | annuale |
| `amount_cents` | intero | no | ≥ 0; UI in euro, 2 decimali | €650 → 65000 |
| `notes` | testo ≤ 2000 | no | testo semplice (nessun HTML); avviso "non inserire dati sanitari o password" | "Polizza n. …" |
| `reminder_days` | lista 0–5 valori | sì (può essere vuota) | valori 0..365, unici | 30, 7, 1 |
| documenti | 0–5 | no | §7 | polizza.pdf |
| `status` | active/completed | sistema | | active |
| `completed_at` | timestamp | sistema | | – |

Campi **volutamente esclusi** dall'MVP: fornitore, numero polizza/contratto, link, tag, priorità, sottocategorie, valuta, persone collegate (minimizzazione dei dati e semplicità del form; l'utente può usare le note).

---

## 9. Ricorrenze

**Modello.** Una regola = (`interval_unit`, `interval_count`, `anchor_date`). Le occorrenze sono `anchor_date + k × intervallo` per k = 0, 1, 2… **calcolate sempre dall'ancora** e non dall'occorrenza precedente, per evitare la deriva delle date.

**Un'unica implementazione.** Il calcolo vive **solo in PostgreSQL** (funzione `recurrence_next(anchor, unit, count, after)`), perché la completa l'operazione atomica `complete_life_item`; il frontend non ricalcola date (mostra il risultato restituito). Così non esistono due implementazioni da mantenere allineate.

**`recurrence_next(anchor, unit, count, after)`** restituisce la più piccola occorrenza **strettamente maggiore di `after`**. Per `day`/`week` l'aritmetica è diretta; per `month`/`year` si usa l'aritmetica degli intervalli di PostgreSQL applicata all'ancora (`anchor + (k*count) * interval '1 month'`), che **limita al fine mese**.

| Caso | Risultato |
|---|---|
| Ancora 31 gennaio, mensile | 28 feb → 31 mar → 30 apr → 31 mag (nessuna deriva, perché si parte sempre dall'ancora) |
| Ancora 29 febbraio 2028, annuale | 28 feb 2029, 28 feb 2030, 28 feb 2031, **29 feb 2032** |
| Ancora 30 gennaio, ogni 3 mesi | 30 apr, 30 lug, 30 ott |
| Ogni 2 anni da 15/12/2026 | 15/12/2028 |

**Completamento (`complete_life_item(item_id)`, atomico, `security invoker`, lock di riga)**
1. Se non ricorrente: `status='completed'`, `completed_at=now()`; i reminder `pending` diventano `cancelled`.
2. Se ricorrente: `after = max(due_date, oggi_nel_fuso_utente)`; `due_date = recurrence_next(anchor, unit, count, after)`; registra una riga in `item_completions`; `status` resta `active`; il trigger rigenera i reminder per la nuova data.
   - Completata **in anticipo** (due 15/12, oggi 10/12): prossima = 15/12 dell'anno dopo.
   - Completata **in ritardo** (mensile, due 15/01, oggi 20/04): le occorrenze mancate vengono saltate, prossima = 15/05.
3. Una seconda chiamata ravvicinata non produce un doppio avanzamento (lock e controllo `due_date`).

**Modifica della scadenza.** Se l'utente cambia manualmente `due_date` di un item ricorrente, `anchor_date` diventa la nuova data (l'utente sta dichiarando la nuova "data reale"). Se cambia solo intervallo/unità, l'ancora resta `due_date` corrente. Se rimuove la ricorrenza, la regola viene eliminata.

**Fuso orario.** Le scadenze sono date senza fuso. "Oggi", lo stato (scaduta/entro 7 gg…) e l'ora di invio sono calcolati nel fuso `profiles.timezone` (default `Europe/Rome`) usando `Intl`/`AT TIME ZONE`, quindi corretti anche con ora legale. Cambiare il fuso rigenera l'orario dei reminder `pending`.

**Date passate alla creazione.** Ammesse. Una scadenza ricorrente con data passata viene salvata così com'è (appare "scaduta"); al primo "Segna come gestita" avanza alla prossima occorrenza futura.

**Test di riferimento (pgTAP + Vitest per l'etichetta in italiano)**: tutti i casi della tabella, anno bisestile, cambio ora legale, completamento in anticipo/in ritardo/doppio click, ancora che cambia.

---

## 10. Template italiani

I template sono **dati statici** in `src/features/templates/templates.ts` (chiave, nome, categoria, titolo, ricorrenza suggerita, preavvisi, avvertenza). Selezionarli **non imposta mai una data**: l'utente la inserisce sempre, e ogni avvertenza è visibile accanto al campo. Nessuna regola normativa è calcolata o codificata: i suggerimenti di ricorrenza sono modificabili e vanno **[V]** controllati con fonti ufficiali (ACI, Motorizzazione, Ministero dell'Interno, Polizia di Stato) prima del rilascio.

**Categorie di sistema (inserite dalla migration `categories`)**: Auto e mezzi (`auto`), Assicurazioni (`assicurazioni`), Casa (`casa`), Documenti personali (`documenti`), Abbonamenti (`abbonamenti`), Contratti e utenze (`contratti`), Garanzie (`garanzie`), Altro (`altro`). Nessuna categoria "Salute" nell'MVP.

| Template | Categoria | Precompilati | Ricorrenza suggerita | Avvertenza mostrata |
|---|---|---|---|---|
| Bollo auto | Auto e mezzi | titolo "Bollo auto", preavvisi 30/7/1 | annuale | "La scadenza dipende dalla regione e dal mese di immatricolazione: controlla sul sito ACI o della tua Regione." |
| Assicurazione RC auto | Assicurazioni | "Assicurazione auto (RCA)", 30/7/1 | annuale | "Controlla la data di scadenza sul contratto. Alcune polizze hanno durata diversa." |
| Revisione auto | Auto e mezzi | "Revisione auto", 60/30/7 | ogni 2 anni | "La prima revisione e quelle successive hanno scadenze diverse: usa la data indicata sul libretto o sull'ultimo tagliando." |
| Patente di guida | Documenti personali | "Patente di guida", 90/30/7 | nessuna | "Usa la data di scadenza riportata sulla patente." |
| Carta d'identità | Documenti personali | "Carta d'identità", 90/30/7 | nessuna | "Usa la data riportata sul documento." |
| Passaporto | Documenti personali | "Passaporto", 180/60/30 | nessuna | "Usa la data riportata sul passaporto: alcuni Paesi richiedono una validità residua minima per entrare." |
| Assicurazione casa | Assicurazioni | "Assicurazione casa", 30/7/1 | annuale | "Controlla la data di scadenza e le condizioni di disdetta sul contratto." |
| Abbonamento (streaming, software…) | Abbonamenti | titolo vuoto (chiede il nome), importo, 7/1 | mensile | "Inserisci la data del prossimo addebito." |
| Garanzia elettrodomestico/dispositivo | Garanzie | "Garanzia …", 30/7 | nessuna | "Conserva scontrino/fattura: allegali alla scadenza." |
| Contratto luce/gas/internet | Contratti e utenze | "Contratto …", 60/30/7 | nessuna | "Inserisci la data di fine offerta o di rinnovo indicata sul contratto." |

"Altro / parto da zero" apre il form vuoto. Test automatico: ogni template ha categoria esistente, preavvisi validi e nessuna data precompilata.

---

## 11. Architettura notifiche (email)

```
 life_items (insert/update)
        │  trigger sync_item_notifications()
        ▼
 notifications (pending, scheduled_for UTC)   ◄── profiles (tz/hour) trigger: ripianifica pending
        ▲
        │ claim_due_notifications(batch) — FOR UPDATE SKIP LOCKED
 pg_cron ogni 5 min ──pg_net──► Edge Function send-notifications ──► Resend (Idempotency-Key = notification.id)
                                      │ esito
                                      ▼
                         status = sent | pending(backoff) | failed
```

**Pianificazione (`sync_item_notifications`, DB)**
- `scheduled_for = ((due_date - days_before) + notification_hour:00) AT TIME ZONE profiles.timezone` → UTC, corretto con l'ora legale.
- Alla creazione/modifica: i `pending` non più coerenti (data, preavvisi o stato cambiati) diventano `cancelled`; i mancanti vengono inseriti con `on conflict (item_id, due_date, days_before, channel) do nothing`.
- Se `scheduled_for` cade in un **giorno locale già passato**, la riga viene creata come `skipped` (traccia visibile, nessun invio). Se cade **oggi ma l'ora è già trascorsa**, resta `pending` e viene inviata al prossimo ciclo (es. item creato alle 15 con avviso 1 giorno prima delle 09:00 di oggi).
- Item completato/eliminato → `pending` → `cancelled` (o cascata).
- Esempio: scadenza 15/12/2026, preavvisi 30/7/1, ora 09:00 Europe/Rome → invii il 15/11, 8/12, 14/12 alle 09:00.

**Scheduler.** `pg_cron` ogni 5 minuti invoca la Edge Function via `pg_net`, con header `Authorization: Bearer <CRON_SECRET>` (secret salvato in Supabase Vault). La funzione rifiuta le chiamate senza il secret.

**Invio e idempotenza**
1. `claim_due_notifications(batch := 50)` (solo `service_role`): in una transazione seleziona `status='pending' and next_attempt_at <= now()` **oppure** `processing` con `locked_at < now() - 10 min` (recupero crash), con `FOR UPDATE SKIP LOCKED`; imposta `processing`, `locked_at=now()`, `attempts+1`; restituisce dati minimi (titolo, data, categoria, importo, email, `timezone`, preferenze). Due esecuzioni concorrenti non ricevono mai la stessa riga.
2. **Controlli prima dell'invio**: item ancora `active` e con la stessa `due_date`; `email_notifications_enabled`; email confermata. Altrimenti → `cancelled`/`skipped`.
3. Invio con l'header **`Idempotency-Key: <notification.id>`** (supportato dal provider **[V]**). Anche in caso di crash dopo l'invio e prima del salvataggio dell'esito, il nuovo tentativo riusa la stessa chiave.
4. Esito: successo → `status='sent'`, `sent_at`, `provider_message_id`; errore temporaneo (5xx, timeout, 429) → `pending` con backoff (`next_attempt_at` = +5 min, +30 min, +2 h, +6 h); errore permanente (4xx di validazione) o 5 tentativi esauriti → `failed` con `last_error` troncato.
5. Garanzia: **al più un invio per riga** (stato + lock + idempotency key + unique di pianificazione). Compromesso dichiarato: un'email per avviso (nessun raggruppamento) per mantenere l'idempotenza semplice; il digest è P1.

**Log e osservabilità.** Log JSON strutturati dalla funzione (`notification_id`, `status`, `attempt`, `duration_ms`, senza email né titolo); stato visibile nella tabella; allarme Sentry se `failed` > 0 o se esistono `pending` con `next_attempt_at` più vecchio di 30 minuti (query di controllo giornaliera). Pulizia: `sent/failed/skipped/cancelled` più vecchie di 90 giorni eliminate da cron settimanale.

**Contenuto email (minimizzazione).** Oggetto "Scade tra 7 giorni: Assicurazione auto" (oggi: "Scade oggi: …"); corpo con titolo, data, categoria, importo (se presente), pulsante "Apri in LifeAdmin" verso `APP_URL/items/:id`, link "Gestisci le notifiche" verso `/settings`. Niente note, niente allegati, niente link firmati a documenti. Template HTML + testo semplice, mittente su dominio con SPF/DKIM/DMARC.

**Email di autenticazione** (conferma, reset): inviate da Supabase Auth con **SMTP personalizzato** (stesso provider) e template italiani; il servizio SMTP predefinito di Supabase è limitato e non adatto alla produzione.

---

## 12. GDPR (requisiti MVP)

| Tema | Cosa deve esistere nell'MVP |
|---|---|
| Base giuridica | Esecuzione del servizio richiesto (account, scadenze, avvisi); gli avvisi sono comunicazioni di servizio, non marketing |
| Privacy Policy e Termini | Pagine `/privacy` e `/terms` in italiano, versionate (`privacy_version`); contenuto da far **revisionare da un professionista** prima della beta |
| Consenso | Checkbox obbligatoria (non preselezionata) a Termini e Privacy in registrazione; salvati data (generata dal database) e versione (verificata lato server). **Nessun consenso marketing**, nessuna email promozionale nell'MVP |
| Cookie | Solo storage tecnico (sessione). Nessun analytics di terze parti nell'MVP, quindi nessun banner cookie; eventuale analytics futuro privacy-friendly e senza cookie |
| Export | "Esporta i miei dati" (JSON con profilo, scadenze, regole, avvisi, metadati documenti e link firmati 24 h ai file) |
| Cancellazione account | Immediata e definitiva: file in Storage → righe DB (cascata) → utente Auth; conferma con password; email di conferma dell'avvenuta cancellazione |
| Cancellazione documenti | Per singolo documento (rimozione oggetto + riga) e a cascata |
| Retention | Dati conservati finché l'account esiste; log avvisi 90 giorni; backup del provider fino a ~30 giorni (da dichiarare in policy); account inattivi: policy di avviso e cancellazione da definire prima del lancio pubblico |
| Gestione email | Email usata solo per accesso e avvisi; non condivisa; possibilità di disattivare gli avvisi dalle impostazioni |
| Minimizzazione | Nessun dato sanitario (avviso nel form note e nei Termini), nessun codice fiscale/IBAN/numero documento come campi; nessun contenuto sensibile nelle email; log senza dati personali |
| Responsabili del trattamento | Supabase (regione **UE**), provider email (verificare regione UE/DPA/SCC), Sentry (regione UE, scrubbing PII), hosting statico (nessun dato personale). Elenco pubblicato in policy |
| Diritti | Accesso/portabilità (export), cancellazione (account), rettifica (modifica), opposizione/limitazione tramite contatto privacy (email di contatto da definire) |
| Sicurezza | §13; procedura di data breach documentata (notifica entro 72 h) |

**Azione esterna futura**: nominare un contatto privacy e far validare i testi legali.

---

## 13. Sicurezza

- **Autenticazione**: Supabase Auth, email+password, conferma email obbligatoria, password ≥ 10 caratteri, protezione password compromesse (HIBP) se disponibile nel piano **[V]**, JWT con scadenza breve (1 h) + refresh token con rotazione, `redirect URLs` in allow-list. OAuth rimandato.
- **Pre-hijacking degli account non confermati**: chi registra l'email altrui con una password nota resterebbe in possesso dell'account dopo la conferma della vittima. Mitigazione: password monouso alla registrazione, azzeramento della password **nel database alla prima conferma** e scelta della password dopo la conferma (§23.12). Comportamento verificato in locale **[L]**; compatibilità con Supabase in hosting da verificare in staging **[S]** e **[B]**.
- **Enumerazione e anti-abuso (rischi residui)**: le risposte dell'API di Supabase distinguono ancora alcuni casi (422 `user_already_exists`, tempi di login e reset diversi). I messaggi neutri della UI **non** eliminano l'enumerazione tramite API diretta. In locale non esiste alcun rate limit per IP. **[B]** prima della beta: rate limit effettivo su OTP e login verificato in hosting, CAPTCHA su registrazione, login e reset, lunghezza OTP verificata in hosting (§23.12).
- **Autorizzazione**: **RLS su tutto** (§6) come unica barriera reale; il client è considerato ostile. Test pgTAP in CI.
- **Isolamento**: FK composte `(item_id, owner_id)`; `owner_id` immutabile (trigger); `default auth.uid()` senza privilegio di INSERT/UPDATE per il client, con `with check` come seconda barriera.
- **Validazione input**: doppia: **zod** nel client (UX) e **check constraint/trigger** nel DB (sicurezza); le Edge Function validano il body con zod. Testo reso sempre come testo (Vue escapa); mai `v-html` su dati utente.
- **Secrets**: nessun secret nel repository; `.env.local` ignorato da git; secret server in `supabase secrets` / Vault; la `service_role key` esiste **solo** nelle Edge Function e in CI come secret, **mai** nel frontend. Chiavi `VITE_*` sono pubbliche per definizione (solo anon/publishable key). Scansione secrets in CI (gitleaks).
- **Rate limiting**: limiti Auth di Supabase (login, signup, reset, invio email) configurati restrittivi; Turnstile su signup/login/reset prima della beta; Edge Function sensibili con `check_rate_limit` (export 1/h, delete 3/h, reinvio email gestito da Auth); quote DB (item, documenti, byte) come difesa da abusi di scrittura; CDN/WAF davanti all'app quando si sceglie l'hosting.
- **Upload**: §7 (bucket privato, MIME e dimensione, magic bytes, path UUID, quota via riga preventiva, URL firmati 60 s, pulizia orfani).
- **API**: nessuna `service_role` nel client; funzioni `security definer` con `search_path` fisso e permessi minimi; PostgREST espone solo ciò che la RLS consente; SQL injection esclusa perché si usano client/RPC parametrizzati e mai SQL costruito da stringhe; CORS delle Edge Function limitato a `APP_URL`.
- **XSS / CSRF / header**: CSP restrittiva (`default-src 'self'; script-src 'self'; connect-src 'self' <SUPABASE_URL>; img-src 'self' data: blob: <SUPABASE_URL>; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimale, HSTS. CSRF: le API usano header `Authorization` Bearer (non cookie) → non applicabile; il token in localStorage è mitigato da CSP e dall'assenza di script di terze parti.
- **Logging**: log applicativi senza dati personali (solo ID); log delle Edge Function su Supabase; Sentry (UE) con `beforeSend` che rimuove email, titoli, note, URL firmati; audit minimo degli eventi sensibili (export, cancellazione account) tramite log strutturati.
- **Gestione errori**: messaggi utente generici e in italiano; dettagli solo nei log; risposte uniformi che non rivelano l'esistenza di risorse altrui o di account (404 identico per "non esiste" e "non è tuo").
- **Dipendenze**: lockfile, Dependabot/Renovate, `pnpm audit` in CI (non bloccante all'inizio, bloccante per severità alta).
- **Backup**: backup giornalieri del piano Supabase (PITR valutare dalla beta in poi **[I]**); test di ripristino documentato prima del lancio.

---

## 14. Architettura frontend

Stack **[D]**: Vue 3 (`<script setup>`), TypeScript `strict` (+ `noUncheckedIndexedAccess`) **pinnato a 6.0.x (non 7.x, §23.1)**, Vite, Pinia, Vue Router, Tailwind CSS, `@supabase/supabase-js`, **zod 4 + composable di form proprio `useZodForm` (nessun `vee-validate` né `@tanstack/vue-form`, §23.1 e §23.12)**, Headless UI Vue, lucide, date-fns (locale `it`), `@fontsource-variable/inter`, Vitest + Vue Test Utils + Testing Library, Playwright + `@axe-core/playwright`, ESLint (flat config, `typescript-eslint`, `eslint-plugin-vue`, `vuejs-accessibility`) + Prettier. Package manager **pnpm**, **Node 24 LTS** (pinnato in `.nvmrc`/`engines`; minimo richiesto dallo stack: Node 22.12).

**Matrice di compatibilità verificata il 2026-10-08 (npm registry)** — M1 installa **queste** versioni (range `~`/`^` entro la minor, lockfile obbligatorio):
| Pacchetto | Versione | Vincolo che l'ha determinata |
|---|---|---|
| Node | 24.x (ora 24.20) | Vite 8 `^20.19‖≥22.12`, Vitest 5 `^22.12‖^24‖≥26`, Capacitor CLI `≥22`, supabase-js `≥22`, ESLint 10 `≥24` o 22.13 |
| vue | 3.5.x (3.5.43) | vue-router 5 richiede `^3.5.34`; pinia 4 `^3.5.11` |
| vite / @vitejs/plugin-vue | 8.3.x / 6.0.x | plugin-vue 6 supporta Vite 5–8; vue-router 5 richiede Vite `^7.3‖^8`; Vitest 5 `^6.4‖^7‖^8` |
| **typescript** | **6.0.x (6.0.3)** — **NON 7.0.2** | `typescript-eslint` 8.71 dichiara `typescript <6.1.0`; TS 7 (port nativo) è `latest` su npm ma non ancora supportato dall'ecosistema lint |
| vue-tsc | 3.3.x | peer `typescript ≥5` |
| pinia / vue-router | 4.0.x / 5.4.x | pinia peer `typescript ≥5.6` |
| tailwindcss + @tailwindcss/vite | 4.3.x | Tailwind 4 richiede Chrome 111 / Safari 16.4 / Firefox 128 → vincola i target mobile (§23.1) |
| vitest | 5.0.x | |
| eslint / typescript-eslint / eslint-plugin-vue / eslint-plugin-vuejs-accessibility | 10.x / 8.71.x / 10.x / 2.6.x | tutti compatibili con ESLint 10 |
| zod | 4.x | **`@vee-validate/zod` richiede zod ^3.24 → incompatibile**; sostituito |
| ~~@tanstack/vue-form~~ | **non adottato** (v0.5) | Spike di M3: compatibile con zod 4 ma non applica le trasformazioni di zod; sostituibile da un composable proprio (§23.12) |
| @axe-core/playwright | 4.13.x (dev) | peer `playwright-core ≥ 1`; solo devDependency per i test e2e di accessibilità (da M3) |
| @supabase/supabase-js | 2.x (2.117) | Node ≥ 22 |
| @playwright/test | 1.64.x | |
| @capacitor/core, cli, ios, android | **8.5.x** | CLI Node ≥ 22 |
| Plugin Capacitor 8 | app 8.1, browser 8.0, camera 8.2, preferences 8.0, haptics 8.0, keyboard 8.0, network 8.0, share 8.0, status-bar 8.0, assets 3.0 | tutti disponibili per Capacitor 8 |
| `@capacitor-firebase/messaging` | 8.5.x (peer `firebase ^12.6`, solo parte web) | scelta push, §23.2 |
| `@aparajita/capacitor-secure-storage` | 8.0.x | candidato secure storage **[V]** in M16 |
| `@sentry/capacitor` | 4.4.x (peer `@sentry/vue` 10.69 esatto) | allineare le due versioni |
Regola: nessun aggiornamento maggiore (es. TS 7) senza ripassare questa tabella; Renovate/Dependabot raggruppa gli aggiornamenti di `typescript`, `typescript-eslint` e `vue-tsc`.

**Target browser/WebView [D]**: `build.target` **esplicito** = default di Vite 8 `baseline-widely-available` (Chrome 111, Safari 16.4, iOS 16.4). Per questo i minimi nativi sono **iOS 16.4** e **WebView Android ≥ 111** (§22.3, §22.4), non i minimi di Capacitor (iOS 15, WebView 60).

**Multipiattaforma [D]**: **Capacitor** (versione corrente 8, requisiti verificati in §22.7) per impacchettare la stessa SPA in app iOS e Android, con plugin `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/keyboard`, `@capacitor/haptics`, `@capacitor/camera`, `@capacitor/browser`, `@capacitor/share`, `@capacitor/network`, un plugin di **secure storage** (Keychain/Keystore) e **`@capacitor-firebase/messaging`** per le push FCM **[D]** (restituisce il token FCM su entrambe le piattaforme; il plugin ufficiale `@capacitor/push-notifications` su iOS fornisce il token APNs, §23.2). Nessun framework UI mobile aggiuntivo (no Ionic UI/Quasar): si usa il design system proprio (Tailwind + Headless UI) con due shell (§4). Il progetto è un **singolo package** (niente monorepo): `src/` è condiviso, `ios/` e `android/` sono i progetti nativi generati da Capacitor e committati. Costruiti in M14, ma l'architettura che li rende possibili esiste già da M1.

Organizzazione **per funzionalità**, con tre livelli netti: *pagina (route, sottile) → feature (componenti + store + service) → domain (logica pura, senza Vue né Supabase)*. La logica di business non sta mai nei componenti UI.

```
lifeadmin/
├─ src/
│  ├─ app/                    # bootstrap
│  │  ├─ main.ts  App.vue
│  │  ├─ router/ (index.ts, guards.ts, routes.ts)
│  │  └─ providers/ (supabase client, sentry, error boundary)
│  ├─ layouts/                # DesktopShell, MobileShell (+ useShell), AuthLayout, PublicLayout
│  ├─ platform/               # UNICO punto di contatto con web/native (porte + adapter)
│  │  ├─ index.ts             # sceglie web|native a runtime (Capacitor.isNativePlatform)
│  │  ├─ ports.ts             # interfacce: SecureStorage, Push, Camera/FilePicker, DocumentViewer, DeepLinks, Haptics, AppLifecycle, Share, Network
│  │  ├─ web/                 # implementazioni browser (localStorage, <input type=file>, window.open, no-op)
│  │  ├─ native/              # implementazioni Capacitor, importate in modo dinamico
│  │  └─ fake/                # implementazioni per i test
│  ├─ pages/                  # una per route, solo composizione
│  ├─ features/
│  │  ├─ auth/        (components/, store.ts, service.ts, schemas.ts)
│  │  ├─ onboarding/
│  │  ├─ dashboard/
│  │  ├─ items/       (components/, store.ts, service.ts, schemas.ts, mappers.ts)
│  │  ├─ recurrence/  (labels it, form helpers; il calcolo è nel DB)
│  │  ├─ reminders/
│  │  ├─ documents/   (upload.ts, validators.ts, components/)
│  │  ├─ templates/   (templates.ts, TemplatePicker.vue)
│  │  └─ settings/
│  ├─ domain/                 # TS puro, 100% testabile
│  │  ├─ itemStatus.ts        # scaduta / entro 7 / 30 / oltre
│  │  ├─ money.ts             # euro <-> centesimi, formattazione it-IT
│  │  ├─ dates.ts             # "oggi" nel fuso, formattazione, differenze in giorni
│  │  └─ constants.ts         # limiti (200 item, 10 MB, …) condivisi con la UI
│  ├─ shared/
│  │  ├─ ui/                  # design system: Button, Input, Select, DatePicker, Modal, Toast, Badge, Card, Skeleton, EmptyState, ErrorState
│  │  ├─ composables/         # useToast, useAsyncState, useConfirm, useMediaQuery
│  │  ├─ lib/                 # supabaseClient.ts, errors.ts (mapping errori → messaggi it), logger.ts
│  │  └─ types/               # database.ts (generato da supabase), app.ts
│  ├─ assets/ styles/         # tailwind.css, tokens
│  └─ env.d.ts
├─ supabase/                  # vedi §15
├─ ios/  android/             # progetti nativi Capacitor (aggiunti in M14, committati)
├─ resources/                 # icona e splash sorgente (generazione asset nativi)
├─ capacitor.config.ts        # appId/appName per ambiente (aggiunto in M14)
├─ fastlane/                  # lane di build/release mobile (M20)
├─ e2e/                       # Playwright (fixtures, pages, specs)
├─ docs/                      # SPECIFICA.md, ADR/, privacy
├─ .github/workflows/ci.yml
├─ .env.example  .nvmrc  eslint.config.js  prettier.config.js
├─ tailwind.config.ts  tsconfig*.json  vite.config.ts  vitest.config.ts  playwright.config.ts
└─ package.json  pnpm-lock.yaml  README.md
```

Regole: i componenti non importano `supabase` direttamente (passano da `service.ts`); gli store Pinia (setup-store) tengono stato e orchestrano, i service sono funzioni pure `async` che restituiscono dati tipizzati o lanciano errori applicativi; i tipi DB sono **generati** (`supabase gen types`) e mappati a tipi di dominio in `mappers.ts` (es. `amount_cents → amountEuro`); route con lazy loading; nessun `any` (regola ESLint `no-explicit-any` in errore).

**Regole vincolanti per il multipiattaforma (valgono da M1)**
1. **Un solo codice, tre target**: nessun fork per piattaforma. Le differenze vivono in `platform/` (adapter) e nelle due shell di `layouts/`.
2. **Porte e adapter**: feature, store e componenti dipendono **solo** dalle interfacce di `@/platform` (storage sicuro, push, fotocamera/file, apertura documenti, deep link, haptics, ciclo di vita app, condivisione, rete). Nessun `window.open`, `localStorage` diretto o `navigator.*` fuori da `platform/web`.
3. **Import dei plugin confinati**: `@capacitor/*` si importa **solo** in `src/platform/native/**`, in modo dinamico, così il bundle Web non li contiene. Regola ESLint `no-restricted-imports` + test che fallisce se il bundle Web include moduli Capacitor.
4. **Il client Supabase riceve lo storage della sessione dall'adapter** (`SecureStorage`): `localStorage` sul Web, Keychain/Keystore sulle app. Nessun token nel `localStorage` nativo.
5. **Rilevamento runtime** (`isNative`, `platform`) in un solo composable; mai `if (ios)` dentro le pagine di business.
6. **Router in `history` mode** con `base: '/'`, asset locali (nessuna risorsa o font da CDN), nessun uso di API del DOM a livello di modulo (testabilità e compatibilità WebView).
7. **Stato di connessione e ciclo di vita** (`resume`, offline) esposti come eventi di dominio: al *resume* dell'app si rinnovano sessione e dati.
8. **Layout "safe by default"**: `viewport-fit=cover`, variabili CSS `env(safe-area-inset-*)` nei layout, nessuna dimensione fissa che dipenda dallo schermo.
9. **Contratti stabili con il backend**: i client mobile non si aggiornano subito → migrazioni DB e API **retrocompatibili** (expand/contract) e controllo della **versione minima supportata** dell'app (§22.9).

---

## 15. Architettura backend (chi fa cosa)

| Livello | Responsabilità |
|---|---|
| **Frontend (SPA condivisa Web/iOS/Android)** | UI e shell, validazione per UX, formattazione, calcolo di "oggi"/stato in base al fuso, chiamate CRUD verso PostgREST (con RLS), upload verso Storage, richiesta signed URL, orchestrazione degli stati. Identico sui tre target: il backend **non distingue** la piattaforma, salvo per la registrazione del dispositivo push |
| **Livello nativo (solo iOS/Android, via `platform/native`)** | Archiviazione sicura del token, registrazione push e ricezione tap, fotocamera/selettore file, visualizzatore documenti, condivisione, deep link, haptics, stato rete. **Nessuna logica di business** |
| **PostgreSQL** | Dati, vincoli, **RLS**, quote (trigger), `complete_life_item`, `recurrence_next`, `sync_item_notifications`, `claim_due_notifications`, `handle_new_user`, `set_updated_at` (le funzioni interne nello schema `private`), coda di pulizia, `check_rate_limit`, job `pg_cron` |
| **Supabase Auth** | Registrazione, conferma email e reset con **OTP a 8 cifre + link**, trigger anti pre-hijacking su `auth.users` (§23.12), login, sessioni/JWT con refresh, rate limit auth, (futuro) OAuth (Sign in with Apple obbligatorio su iOS se si aggiunge un login social **[V]**) e MFA |
| **Storage** | Bucket privato `documents`, policy RLS, limiti dimensione/MIME, URL firmati |
| **Edge Functions (Deno/TS)** | `send-notifications` (cron, `service_role`; canali email **e push**), `delete-account`, `export-data`, `cleanup-storage` (cron: coda + orfani + log vecchi + token push scaduti). Codice condiviso in `functions/_shared` (client Supabase admin, adapter email `resend`/`mock`, adapter push `fcm`/`mock`, zod, logger, rate limit) |
| **Provider email** | Consegna avvisi (Resend, **[D]** salvo verifica regione UE/DPA) e, via SMTP, email di Auth |
| **Provider push** | **Firebase Cloud Messaging (FCM, HTTP v1)** per Android **e** iOS (FCM inoltra ad APNs con la chiave APNs caricata su Firebase). Un solo adapter server per le due piattaforme (§22.5) |
| **Hosting statico** | Serve la SPA Web e i file `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` e `/app-config.json` (versione minima app) |

**Operazioni che non devono MAI essere eseguite dal client**: usare la `service_role`; scrivere/aggiornare `notifications`, `item_completions`, `storage_cleanup_queue`, `rate_limits`; inviare email o **push** (nessuna chiave FCM/APNs nel client); cancellare l'utente in `auth.users` o gli oggetti Storage in massa; leggere/scrivere dati di un altro utente (impedito da RLS); impostare `owner_id` diverso dal proprio; saltare le quote; chiamare `claim_due_notifications`; calcolare le occorrenze future di una ricorrenza in modo autonomo (si usa la funzione DB).

Supabase locale: CLI `supabase` come **devDependency** (Docker è disponibile in locale; la CLI non è installata globalmente ed è eseguita con `pnpm exec supabase`). Migrazioni e `config.toml` versionati; **nessun `seed.sql`**: i dati di sistema stanno nelle migrazioni e nessun utente o credenziale di test è nel repository (gli utenti dei test sono creati a runtime, solo nei test di integrazione, con `service_role`).

---

## 16. Environment

`.env.example` (root, committato, **senza valori reali**):
```
# --- Frontend (esposte al browser: SOLO valori pubblici) ---
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<copia da `pnpm exec supabase status`>
VITE_APP_URL=http://localhost:5173
VITE_TURNSTILE_SITE_KEY=            # vuoto in locale
VITE_SENTRY_DSN=                    # vuoto in locale
VITE_APP_ENV=development            # development | staging | production
```
`supabase/functions/.env.example` (secret server, mai `VITE_*`):
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<fornita da supabase status in locale / secret in produzione>
CRON_SECRET=<stringa casuale lunga>
EMAIL_DRIVER=mock                   # mock | resend
RESEND_API_KEY=                     # solo staging/produzione
EMAIL_FROM="LifeAdmin <avvisi@dominio-da-definire>"
APP_URL=http://localhost:5173
SENTRY_DSN=
PUSH_DRIVER=mock                    # mock | fcm  (fase mobile)
FCM_PROJECT_ID=                     # solo staging/produzione
FCM_SERVICE_ACCOUNT_JSON=           # secret; JSON dell'account di servizio Firebase (mai nel repo)
```
Variabili **build mobile** (non sono secret applicativi; i secret di firma vivono solo in GitHub Secrets, §22.9):
```
CAP_ENV=development                 # development | staging | production -> appId, nome, schema dell'app
CAP_APP_ID=                         # es. <reverse-domain>.lifeadmin(.staging|.dev)
APP_ASSOCIATED_DOMAIN=              # dominio per Universal/App Links, es. app.<dominio>
```
Test/CI: `.env.test` generato dal job con i valori di `supabase status` (chiavi demo locali, non segreti) ; i secret di produzione stanno solo in GitHub Secrets e Supabase. `.gitignore` copre `.env`, `.env.*` (eccetto `*.example`), `supabase/.temp`. In `src/shared/lib/env.ts` le variabili sono validate con zod all'avvio (l'app fallisce con messaggio chiaro se mancano).

---

## 17. Strategia di test

**Unit (Vitest)** — `domain/` e logica pura
- Stato scadenza (limiti 0/7/30 giorni, scaduta, completata, fusi e cambio ora legale), `dates`, `money` (virgola/punto, arrotondamento, centesimi), schemi zod (titolo, importo, preavvisi, upload), validatori file (magic bytes, MIME, dimensione), mapping errori → messaggi, integrità dei template (categoria esistente, preavvisi validi, nessuna data), etichette ricorrenza in italiano, guard del router (redirect, whitelist `redirect`), store con service mockati.
- Componenti (Testing Library): form (errori, submit, doppio click), `StatusBadge`, `EmptyState`, `DocumentsPanel` (stati loading/empty/error).

**Integration (Supabase locale)**
- **pgTAP** (`supabase test db`): RLS su ogni tabella (A vs B, `anon`), `owner_id` immutabile, FK composte, quote (200 item, 5 doc/item, 100 MB), `recurrence_next` (31 gen, 29 feb, ogni N mesi, bisestili), `complete_life_item` (non ricorrente, anticipo, ritardo, doppia chiamata), `sync_item_notifications` (creazione, cambio data/preavvisi, ora legale, "oggi già passata", cancellazione), `claim_due_notifications` (concorrenza `SKIP LOCKED`, recupero `processing` orfane), unicità anti-duplicati, trigger di signup/profili, policy Storage.
- **Integrazione via PostgREST reale** (`pnpm test:integration`, Vitest + supabase-js sullo stack locale): isolamento A/B attraverso il percorso API vero (lettura, modifica, cancellazione, relazioni cross-user, categoria personale di un altro utente, `anon`), consenso privacy con Supabase Auth reale. Gli utenti di test sono creati a runtime con `service_role` (usata solo qui) e password casuali.
- **Edge Function** (Deno test con adapter email `mock`): invio ok, errore temporaneo → backoff, errore permanente → `failed`, secret mancante → 401, doppia invocazione simultanea → un solo invio, item modificato dopo il claim → non inviato; `delete-account` (file+dati rimossi), `export-data` (solo dati del chiamante), rate limit.

**E2E (Playwright)** su Supabase locale + `EMAIL_DRIVER=mock`; conferma email letta da Inbucket/Mailpit di Supabase locale; controllo accessibilità con axe su ogni pagina.
| Flusso | Verifica |
|---|---|
| Registrazione | Form → email di conferma → link → onboarding |
| Login/logout/reset | Credenziali errate (messaggio generico), reset password, redirect post-login |
| Onboarding | Scelta template, date, atterraggio in dashboard con dati |
| Creazione Life Item | Campi validi/invalidi, comparsa in lista e dashboard |
| Modifica | Cambio titolo/data/preavvisi, reminder rigenerati |
| Eliminazione | Modal di conferma, scomparsa da lista e file |
| Ricorrenza | Annuale/mensile: "Segna come gestita" → nuova data corretta |
| Dashboard | Contatori e sezioni corrette con dataset noto (data "congelata" nel test) |
| Notifiche | Item con avviso dovuto → esecuzione funzione → `status=sent` e una sola email; seconda esecuzione → nessun duplicato |
| Upload documento | PDF/PNG ok; file > 10 MB e tipo non ammesso rifiutati; apertura via signed URL; eliminazione |
| Isolamento tra utenti | Utente B apre `/items/<id di A>` → "non trovata"; richiesta API diretta con token di B → 0 righe; accesso diretto al path Storage di A → negato |
| Responsive | Viewport mobile: tab bar, creazione item, nessuno scroll orizzontale |
| GDPR | Export contiene solo i propri dati; eliminazione account rimuove tutto e impedisce il login |

Soglie: coverage unit su `domain/` ≥ 90%; nessun test E2E flaky ammesso in main.

**Test multipiattaforma**
- **Unit/componenti**: `platform/fake` permette di testare feature e shell simulando `isNative`, offline, resume, push ricevuta, deep link, permessi negati. Test di architettura: il bundle Web non contiene `@capacitor/*`; nessun import di `@capacitor/*` fuori da `platform/native`.
- **E2E Playwright**: progetti desktop e **mobile viewport** (con `MobileShell`); gesti touch emulati dove possibile.
- **Contratto push** (Deno, `PUSH_DRIVER=mock`): una riga `notifications` push → un invio per dispositivo, nessun duplicato al retry, token non valido rimosso, nessun contenuto sensibile nel payload.
- **Nativo**: matrice manuale per release su dispositivi reali (1 iPhone recente, 1 iPhone con schermo piccolo, 1 Android recente, 1 Android economico/vecchio) con checklist §22.12; smoke automatico su emulatore Android in CI notturna (opzionale, strumento da scegliere in M14 **[V]**). Le push reali si verificano manualmente a ogni release candidate.

---

## 18. CI/CD (GitHub Actions)

`.github/workflows/ci.yml` su `pull_request` e push su `main`; `concurrency` per annullare run obsoleti; permessi minimi (`contents: read`).

| Job | Passi |
|---|---|
| **quality** | checkout → setup pnpm + Node (da `.nvmrc`, cache) → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` (`vue-tsc --noEmit`) → `pnpm test:unit` (con coverage) |
| **build** | `pnpm build` con variabili fittizie → artefatto `dist/` |
| **database** | `supabase start` → `supabase db lint` → `supabase test db` (pgTAP) → verifica che i tipi generati siano aggiornati (`gen types` + `git diff --exit-code`) → test Edge Function (Deno) |
| **e2e** | dipende da quality+database: `supabase start`, serve `dist`/preview, Playwright (browser Chromium + mobile viewport), upload report/trace in caso di errore |
| **security** | gitleaks, `pnpm audit --audit-level=high`, Dependabot attivo |
| **mobile-android** (da M14) | ubuntu, JDK 21: `pnpm build` → `cap sync android` → `./gradlew assembleDebug` (+ `lint`); su PR che toccano `android/`, `capacitor.config.ts`, dipendenze o `src/platform/**`, e ogni notte |
| **mobile-ios** (da M14) | **macOS**, Xcode 26+: `pnpm build` → `cap sync ios` → `xcodebuild` per simulatore senza firma; solo notturna e su tag (i runner macOS costano molto di più) |
| **cap-sync-check** (da M14) | `cap sync` non deve produrre differenze rispetto ai progetti nativi committati |

**Pipeline di rilascio mobile** (`mobile-release.yml`, da M20): si attiva su tag `mobile-v<semver>[-beta.N]`; build firmata → upload automatico a **TestFlight** (iOS, `fastlane pilot`) e **traccia di test interno di Google Play** (Android, `fastlane supply`); promozione a produzione **sempre manuale** con approvazione. Dettagli di signing, secret e versioni in §22.9. Il rilascio Web resta indipendente e continuo.

**Deploy**: non automatico nell'MVP. Quando scelti hosting e dominio: preview per PR, staging da `main` con `supabase db push` (migrazioni) e deploy funzioni, produzione con approvazione manuale. Le migrazioni non vengono applicate in produzione senza passare da staging.

---

## 19. Strategia Git

- Branch protetto `main`; lavoro su branch di milestone `m<N>-<nome>` (es. `m3-auth`) e merge in `main` quando la Definition of Done è soddisfatta. Si parte dall'attuale `branch-angelo`.
- **Conventional Commits** in inglese, piccoli e atomici: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:`, `db:` (migrazioni), es. `chore: initialize Vue application`, `db: add profiles and categories`, `feat: add authentication`, `feat: add life items`, `feat: add recurring items`, `feat: add notifications`.
- Una migrazione per commit logico; mai modificare una migrazione già in `main` (se ne crea una nuova).
- Si aggiornano README/specifica nello stesso commit della funzionalità che li cambia.
- **Regola operativa di questo progetto**: Claude **non esegue** `git commit`/`push` né apre PR (istruzione dell'utente). Al termine di ogni milestone Claude elenca i file modificati, raggruppati per commit consigliato con il messaggio proposto, e li committa l'utente.

---

## 20. Roadmap tecnica e Definition of Done

**Due fasi**: **Fase Web MVP = M1–M13** (include i vincoli multipiattaforma, senza codice nativo) e **Fase Mobile = M14–M22** (app iOS/Android, push, store). La Fase Mobile può iniziare in parallelo alla beta Web, una volta chiuso M12.

Ogni milestone è piccola, verificabile e committabile. **DoD comune a tutte**: lint, typecheck, test pertinenti e build verdi in locale e in CI; nessun `any`/codice morto/segreto; README/specifica aggiornati se cambia qualcosa; stati loading/vuoto/errore presenti dove ci sono dati; verifica nel browser (Claude in Chrome) dei flussi toccati, desktop e mobile.

**M1 — Setup progetto**
- *Obiettivo*: scheletro eseguibile e qualità automatica.
- *File*: `package.json`, `vite/ts/eslint/prettier/tailwind/vitest/playwright config`, `src/app/*`, `src/pages/HomePage`, **`src/platform/` (ports.ts, index.ts, web/, fake/)**, `.nvmrc`, `.env.example`, `.github/workflows/ci.yml`, `README.md`, `supabase init`.
- *Gate v0.3*: installare **esattamente** la matrice di §14 (TypeScript 6.0.x, Vite 8, Tailwind 4, Vitest 5, ESLint 10; niente vee-validate); `build.target` esplicito (Chrome 111/Safari 16.4); test CI che fallisce se `typescript` ≥ 6.1 senza aggiornare `typescript-eslint`.
- *Vincoli multipiattaforma*: regola ESLint che vieta `@capacitor/*` fuori da `src/platform/native`; `viewport-fit=cover` e variabili safe-area; router history mode; nessun asset da CDN; test di architettura (bundle Web senza Capacitor).
- *DB*: nessuna. *Test*: smoke test dell'app, test della validazione env, test delle regole di architettura.
- *DoD*: `pnpm dev/lint/typecheck/test/build` funzionano; CI verde; README con setup locale; tema Tailwind con i token del §4; le porte di `platform/` esistono con implementazione web e fake.

**M2 — Fondamenta database e RLS**
- *Obiettivo*: schema base, profili, categorie, RLS, tipi generati.
- *File*: `supabase/migrations/*` (5 migration: funzioni di supporto, `profiles`, `categories`, `life_items`, `recurrence_rules` e `item_completions`), `supabase/tests/*`, `tests/integration/*`, `src/shared/types/database.ts`, `src/shared/lib/supabaseClient.ts`, `docs/API_CONTRACT.md`. **Nessun `seed.sql`.**
- *DB*: `profiles`, `categories` (8 categorie di sistema inserite dalla migration), `life_items`, `recurrence_rules`, `item_completions` (solo schema, FK composte e RLS; logica in M5/M6), enum, schema `private`, trigger `handle_new_user`/`set_updated_at`/validazione fuso/immutabilità di `owner_id`, funzione server-side delle versioni privacy supportate, policy.
- *Test*: pgTAP su schema, vincoli, FK composte, RLS di tutte le tabelle e trigger di signup (consenso assente → rifiuto, versione non supportata → rifiuto, versione supportata → profilo, timestamp generato dal database); integrazione via PostgREST reale (isolamento A/B, categoria personale di un altro utente, `anon`, consenso con Auth reale).
- *Multipiattaforma*: `supabaseClient.ts` crea il client con lo **storage di sessione iniettato** dall'adapter `SecureStorage` (web: `localStorage`), `flowType: 'pkce'`, `detectSessionInUrl: false`, `autoRefreshToken: true` e header globali **`x-app-version`** e **`x-app-platform`** (§23.10).
- *Gate v0.3*: tutte le query usano **colonne esplicite** (mai `select *`); le funzioni RPC pubbliche sono parte del contratto API (§23.10).
- *DoD*: `supabase start` + `db reset` + `test db` verdi; tipi generati committati; **azione esterna**: nessuna (Docker locale).

**M3 — Autenticazione** *(piano v0.5 approvato; implementati e verificati in locale: migration, configurazione locale, template email, test pgTAP e di integrazione, verifica a mutazione; client, store, pagine e router di auth non ancora implementati)*
- *Fuori perimetro e non verificati in M3*: inviti amministrativi (`inviteUserByEmail`), provider esterni (OAuth) e telefono. Il trigger non li copre per costruzione e il loro comportamento con `confirmation_sent_at` e `encrypted_password` non è stato provato (§23.12 A).
- *Obiettivo*: registrazione senza password iniziale, conferma (codice a 8 cifre e link), scelta della password, login, logout locale, reset password, ripristino e refresh della sessione, guard, deep link (solo logica web), mappatura errori.
- *File da creare*:
  - `src/features/auth/`: `constants.ts` (`PRIVACY_POLICY_VERSION`, `OTP_LENGTH=8`, cooldown reinvio), `schemas.ts` (zod: email, password in byte, OTP `^\d{8}$`, consenso), `errors.ts` (`toAuthAppError`), `service.ts` (funzioni pure su `AppSupabaseClient`), `store.ts` (Pinia: sessione, `ready`, `signingOut`, `endReason`, `pendingEmail`, `passwordSetupPending` derivato da `profiles.password_setup_pending` letto dal server, `recoveryPending`), `redirect.ts` (`safeRedirect`), `deepLinks.ts` (`resolveDeepLink`, `installDeepLinks`), `lifecycle.ts` (start/stop auto-refresh su resume/pause, solo native), `sanitizeSession.ts`, `components/` (`AuthCard`, `OtpField`, `ConsentField`, `ResendButton`, `SetPasswordForm`).
  - `src/shared/composables/useZodForm.ts` (§23.12), `src/shared/ui/{Button,TextField,InlineAlert}.vue`, schermata di caricamento dell'app, `src/layouts/AuthLayout.vue`.
  - `src/pages/{Login,Register,VerifyEmail,AuthConfirm,ForgotPassword,ResetPassword,SetPassword}Page.vue`, `src/app/router/guards.ts`.
  - `supabase/templates/{confirmation,recovery}.html`, `supabase/migrations/<timestamp>_auth_prehijack_guard.sql`, `supabase/tests/database/50_auth_prehijack.test.sql`.
  - Test: `tests/integration/{auth-signup-confirm,auth-login-session,auth-recovery,auth-prehijack,auth-enumeration,auth-privacy}.int.test.ts` (**implementato finora: solo `auth-prehijack.int.test.ts`**; gli altri accompagnano le funzioni di app), helper `tests/integration/{mail,db}.ts` (Mailpit via `fetch`; SQL locale via `supabase db query`, una istruzione per chiamata; retrodatazione controllata dei token), `scripts/verify-auth-guard-mutations.mjs` (`pnpm test:auth-guard-mutations`), `e2e/auth.spec.ts`, `scripts/run-e2e.mjs`.
- *File da modificare*: `src/app/{main.ts,App.vue}`, `src/app/router/{index,routes}.ts`, `src/pages/HomePage.vue` (utente e "Esci"), `src/shared/types/database.ts` (rigenerato: solo la nuova colonna), `src/features/profile/` (lettura di `password_setup_pending`, solo se necessaria), `src/shared/lib/{errors,supabaseClient}.ts` (+ test; nuova opzione additiva `deferInitialization`, **default invariato**), `tests/integration/support.ts`, `scripts/run-integration.mjs` (passa `MAILPIT_URL`), `supabase/config.toml`, `package.json` e `pnpm-lock.yaml` (script `supabase:start` con Mailpit, `test:e2e`, devDependency `@axe-core/playwright`), `playwright.config.ts`, `.github/workflows/ci.yml`, `docs/SPECIFICA.md`, `docs/API_CONTRACT.md`, `README.md`, `CLAUDE.md`. **Eliminare**: nessun file.
- *Migration*: **una** (`auth_prehijack_guard`, append-only), con tre componenti, tutte **verificate solo in locale [L]**:
  1. `private.wipe_password_on_first_confirmation()` (`SECURITY INVOKER`, `search_path = ''`) e trigger `BEFORE UPDATE` su `auth.users`: condizione `OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL AND OLD.confirmation_sent_at IS NOT NULL` → `NEW.encrypted_password := NULL`.
  2. Colonna additiva `public.profiles.password_setup_pending boolean NOT NULL DEFAULT false` **senza** `GRANT SELECT (colonna)`: la lettura discende dal grant `SELECT` **sull'intera tabella** `profiles` già concesso a `authenticated` da M2 (`20261008144123_profiles.sql`); la colonna **non** entra nella lista dei privilegi di `UPDATE` (né di `INSERT`); **nessun** privilegio di INSERT/UPDATE sulla colonna per `authenticated` e nessun accesso per `anon`. Un `GRANT SELECT (colonna)` aggiuntivo è considerato ridondante (**ipotesi PostgreSQL basata sul grant di tabella, non misurata**: negli spike la colonna aveva anche un grant di colonna, quindi la lettura senza di esso non è stata provata); non va aggiunto senza che il test (f) dimostri che serve. Il client non deve mai ricevere privilegi di scrittura sulla colonna.
  3. `private.track_password_setup()` (`SECURITY DEFINER`, `search_path = ''`, solo `UPDATE public.profiles SET password_setup_pending = … WHERE id = NEW.id`) e trigger **`AFTER UPDATE`** su `auth.users` con `WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)`: `true` se la password passa da valorizzata a NULL, `false` se da NULL a valorizzata. **Non** si usa `UPDATE OF encrypted_password`, perché non scatta quando la colonna è modificata da un trigger `BEFORE` (osservato).
  - `REVOKE EXECUTE … FROM PUBLIC` su entrambe le funzioni (in PostgreSQL `EXECUTE` è concesso a `PUBLIC` per default). **Misurato negli spike**: `EXECUTE` è concesso a `PUBLIC`, lo schema `private` non ha `USAGE` per `anon`/`authenticated`, i trigger hanno funzionato **senza** la revoca. **Ipotesi PostgreSQL** (EXECUTE controllato solo alla `CREATE TRIGGER`, non quando il trigger scatta): **verificata in locale** dal test di integrazione (j) con GoTrue reale, che esegue l'UPDATE come `supabase_auth_admin` senza `EXECUTE` né `USAGE`. **Non verificata su Supabase hosted [S].** Le funzioni di M2 in `private` non hanno `REVOKE EXECUTE` (M2 revoca solo l'accesso allo schema): la revoca di M3 non le modifica.
  - **Non modifica** `on_auth_user_created` (AFTER INSERT) né `private.create_profile_for_user`: la creazione atomica di utente, profilo e consenso privacy resta invariata. Modifica **solo in modo additivo** una tabella di M2 (`profiles`): vanno aggiornati `docs/API_CONTRACT.md`, `src/shared/types/database.ts` e il test pgTAP dei privilegi di colonna.
- *Configurazione locale* (`supabase/config.toml`): `[auth.email] enable_confirmations = true`, `otp_length = 8`, `otp_expiry = 600`, `max_frequency = "1s"` (in produzione 60 s **[B]**); `[auth] minimum_password_length = 10`, `site_url = "http://localhost:5173"`, `additional_redirect_urls = ["http://localhost:4173"]`; template `confirmation` e `recovery`; `email_sent` invariato. **Mailpit** attivo in `supabase:start`, nel job CI `database` e nel job `e2e` (che avvia Supabase reale e ricava URL e chiavi con `supabase status -o env`, senza `ci-placeholder`).
- *Dipendenze*: solo `@axe-core/playwright` (dev). Nessuna dipendenza di runtime.
- *Test di regressione M1/M2 (devono restare verdi senza modifiche)*: 55 unit, 33 integrazione, 157 pgTAP, e2e smoke; `createSupabaseClient` senza `deferInitialization` identico (test esistenti); utenti creati con admin `email_confirm` mantengono la password (suite RLS A/B); rifiuto atomico del consenso privacy invariato; `on_auth_user_created` ancora presente e unico sull'INSERT; i grant di colonna di `profiles` esistenti invariati (solo `password_setup_pending` si aggiunge in sola lettura).
- *Test di sicurezza e caratterizzazione (Supabase Auth reale, nessun mock)*: pre-hijacking V1 (attaccante per primo, vittima dopo), V2 (link non richiesto), V3 (polling del login durante la conferma) e **V4** (recovery su account non confermato) con password azzerata, `invalid_credentials` per l'attaccante, scelta password della vittima; utenti admin, utenti confermati, email change e recovery non azzerati o azzerati come previsto; `updateUser({password})` senza sessione rifiutato; login prima della conferma `email_not_confirmed`; privacy mancante/non supportata/malformata → 500 atomico senza righe; timestamp del client ignorato; replay di codice e link; codice errato/scaduto (retrodatazione di **entrambe** le colonne `*_sent_at` e `one_time_tokens.created_at`); reinvio entro 1 s → 429 `over_email_send_rate_limit`; enumerazione (422, tempi: caratterizzati e documentati, non promessi); logout offline con `fetch` che fallisce; refresh in volo + logout; 10 `getSession()` paralleli → 1 refresh; sessione isolata tra due utenti. **Nessun test pretende un 429 per tentativi OTP in locale** (limitatore per IP assente).
- *Test della migration (pgTAP e integrazione)*: (a) V1–V4 con 0 sessioni per l'attaccante nella gara di polling; (b) flag `true` dopo la conferma (OTP, link e recovery su account non confermato) e `false` dopo `updateUser({password})`; (c) **atomicità**: se il trigger `AFTER` fallisce la conferma fallisce in blocco (HTTP 500 `Error confirming user`), l'account resta non confermato con la password invariata e flag `false`, e lo **stesso codice** riesce dopo il ripristino (fail-closed); un rollback lascia conferma, password e flag come prima; (d) password rifiutata (`weak_password`) → flag invariato; (e) **profilo mancante**: il test deve far **fallire** il flusso o segnalare la violazione dell'invariante di M2 (profilo sempre creato con l'utente); non deve passare come flusso riuscito (il trigger da solo non lo rileva: `UPDATE` su 0 righe); (f) il client non può scrivere la colonna (`42501`), `anon` non la legge, ogni utente vede solo la propria riga; (g) `EXECUTE` revocato a `PUBLIC` sulle due funzioni e schema `private` non utilizzabile da `anon`/`authenticated`; (h) **sessioni**: test esplicito che dopo il cambio password le altre sessioni siano revocate (comportamento osservato in locale, **dipendente dalla versione di GoTrue**) e, a prescindere, `signOut({ scope: 'others' })` eseguito dall'app come difesa aggiuntiva; (i) **mutazioni**: la suite deve **fallire** senza trigger `BEFORE`, con condizione invertita (`confirmation_sent_at IS NULL`, che riapre l'attacco **e** azzera le password degli utenti creati da amministratore), con condizione mai vera e con condizione troppo larga (azzera le password dopo la conferma); senza trigger `AFTER` (flag mai `true`) o con `UPDATE OF encrypted_password` (flag mai `true`); (j) **revoche applicate** (test di integrazione **da scrivere, non ancora eseguito**): con `REVOKE EXECUTE … FROM PUBLIC` applicato a **entrambe** le funzioni, conferma (OTP, link, recovery) e aggiornamento del flag continuano a funzionare e `PUBLIC` non ha `EXECUTE` su nessuna delle due; se non funzionano, la revoca va riconsiderata prima di procedere.
- *Criteri di accettazione verificabili*: (1) registrazione → email con codice a 8 cifre e link; (2) conferma con codice e con link riuscite, sessione attiva, `/set-password` obbligatorio; (3) password dell'attaccante azzerata alla conferma in V1, V2, V3 e **V4**; (4) utenti admin e confermati mantengono la password; (5) nessun utente Auth senza profilo; consenso mancante o non supportato rifiutato; (6) login, logout locale (storage vuoto anche offline), reset password funzionanti; (7) sessione ripristinata al riavvio; avvio offline senza blocco; (8) refresh concorrente = una richiesta; nessuna sessione risorta dopo il logout; (9) guard senza loop, `redirect` e deep link in whitelist; (10) codice/link monouso, parametri rimossi dall'URL; (11) `axe` senza violazioni sulle pagine di auth; (12) nessun segreto nei file tracciati; (13) documentazione che distingue **[L]**, **[S]** e **[B]**; (14) `profiles.password_setup_pending` è `true` dopo la conferma e `false` dopo la scelta della password, anche dopo chiusura della scheda, riavvio con access token scaduto e link aperto su un altro dispositivo; (15) il client non scrive la colonna; (16) conferma fail-closed e atomica se il trigger `AFTER` fallisce; (17) la suite fallisce con ciascuna delle mutazioni elencate (compreso V4 e il caso con revoche applicate, test (j)); (18) **profilo mancante**: il test fa fallire il flusso o segnala la violazione dell'invariante di M2; non è mai trattato come flusso riuscito; (19) **revoca delle sessioni**: dopo il cambio password le altre sessioni risultano revocate (test esplicito) **in locale**; è un comportamento **dipendente dalla versione di GoTrue**, non una garanzia e **non può essere considerato valido in hosted sulla sola base degli spike locali** (verifica in staging); `signOut({ scope: 'others' })` resta in ogni caso.
- *M3 Final Gate*: `lint` · `format:check` · `typecheck` · `test:unit` · `test:coverage` · `db:reset` + `db:lint` + `db:test` · `test:integration` (auth, sicurezza, regressione) · e2e di auth con axe · `build` + `check:bundle` · `pnpm audit` · tipi generati aggiornati **solo** per `profiles.password_setup_pending` · CI verde su PR (job `database` ed `e2e` con Supabase e Mailpit) · branch `branch-angelo` e working tree · conformità allo scope (nessun onboarding, dashboard, notifiche, Capacitor nativo, shell mobile) · documentazione coerente · **elenco esplicito delle verifiche in staging ancora aperte ([S]) e delle condizioni bloccanti per la beta ([B], §23.12)**.

**M4 — App shell e design system**
- *Obiettivo*: **`DesktopShell` e `MobileShell`** reali (sidebar / tab bar, safe area, transizioni a stack), componenti base, stati.
- *File*: `layouts/DesktopShell`, `layouts/MobileShell`, `useShell`, `shared/ui/*` (Modal, Badge, Skeleton, EmptyState, ErrorState, Select, DatePicker), `useToast/useConfirm`, `pages/DashboardPage` (placeholder).
- *DB*: nessuna. *Test*: component test dei ui, E2E responsive di navigazione, axe.
- *DoD*: navigazione desktop/mobile, focus visibile, tema coerente, pagina di catalogo componenti solo in dev.

**M5 — Life Items (CRUD)**
- *Obiettivo*: creare, elencare, vedere, modificare, eliminare.
- *File*: `features/items/*`, `domain/itemStatus|money|dates`, `pages/Items*`, `ItemForm`, `ItemList`, `StatusBadge`.
- *DB*: tabella `life_items`, `owner_id` immutabile, FK composta, indici e policy **già creati in M2**; resta il trigger di quota.
- *Test*: unit dominio, pgTAP RLS/quota, E2E create/edit/delete e isolamento tra utenti.
- *DoD*: CRUD completo con loading/vuoto/errore; filtri in query param; RLS verificata; avviso data passata.

**M6 — Ricorrenze e completamento**
- *Obiettivo*: regole, `recurrence_next`, "Segna come gestita", storico.
- *File*: `features/recurrence/*`, sezione ricorrenza in `ItemForm`, `CompleteButton`, `CompletionHistory`.
- *DB*: tabelle `recurrence_rules` e `item_completions` **già create in M2**; qui le funzioni `recurrence_next` e `complete_life_item`.
- *Test*: pgTAP su tutti i casi del §9; E2E annuale/mensile.
- *DoD*: nessuna deriva di date, 29 febbraio corretto, doppio click idempotente, etichette in italiano.

**M7 — Dashboard**
- *Obiettivo*: stato in pochi secondi.
- *File*: `features/dashboard/*`, `pages/DashboardPage`.
- *DB*: nessuna (query esistenti, indice già creato).
- *Test*: unit aggregazioni, E2E con dataset noto e data fissata, axe, mobile.
- *DoD*: contatori cliccabili che filtrano `/items`; stati vuoto/errore; < 1 s con 200 item in locale.

**M8 — Template e onboarding**
- *Obiettivo*: primo valore in < 3 minuti.
- *File*: `features/templates/*`, `features/onboarding/*`, `pages/OnboardingPage`, guard `requiresOnboarding`, `?template=` in `/items/new`.
- *DB*: nessuna (usa `onboarding_completed_at`).
- *Test*: unit integrità template; E2E onboarding completo/saltato/parziale.
- *DoD*: nessuna data precompilata; avvertenze visibili; batch con gestione errori per riga.

**M9 — Avvisi email**
- *Obiettivo*: pianificazione, invio idempotente, stato.
- *File*: `supabase/functions/send-notifications`, `_shared/*` (adapter `mock`/`resend`), `features/reminders/*` (elenco nel dettaglio), `NotificationSettings`.
- *DB*: `notifications`, `sync_item_notifications` + trigger (anche su profilo), `claim_due_notifications`, `pg_cron`/`pg_net`, `rate_limits` se serve.
- *Test*: pgTAP pianificazione/ora legale/concorrenza; Deno test funzione; E2E invio senza duplicati.
- *DoD*: nessun duplicato in test di concorrenza; backoff e stato `failed` verificati; log senza dati personali; **azione esterna per staging**: account provider email + dominio mittente (da concordare con l'utente).

**M10 — Documenti**
- *Obiettivo*: allegati privati.
- *File*: `features/documents/*`, `DocumentsPanel`, `supabase/functions/cleanup-storage`.
- *DB*: `documents`, `storage_cleanup_queue`, bucket + policy Storage, trigger quote.
- *Test*: unit validatori/magic bytes; pgTAP policy Storage e quote; E2E upload/apertura/eliminazione, file non valido, accesso incrociato negato.
- *DoD*: nessun URL pubblico; signed URL 60 s; orfani ripuliti; progress e errori per file.

**M11 — Impostazioni e GDPR**
- *Gate v0.3*: `delete-account` come processo ripristinabile con tabella `account_deletions`, blocco immediato dell'utente, rimozione Storage per prefisso, verifica finale e registro anti-ripristino (§23.5); pagina pubblica `/account-deletion` (richiesta da Google Play, §23.8).
- *Obiettivo*: profilo, preferenze, export, cancellazione, pagine legali.
- *File*: `features/settings/*`, `pages/Settings|Privacy|Terms`, `supabase/functions/export-data|delete-account`.
- *DB*: nessuna o piccole (rate limit).
- *Test*: Deno test export/cancellazione; E2E export e cancellazione account.
- *DoD*: cancellazione completa verificata (DB + Storage + Auth); export solo dati propri; testi legali versionati (bozza da far revisionare).

**M12 — Hardening e qualità**
- *Obiettivo*: sicurezza, accessibilità, osservabilità.
- *File*: header/CSP di hosting (config), Sentry con scrubbing, error boundary, `docs/SECURITY.md`, completamento suite E2E.
- *DB*: revisione indici/advisor (`db lint`, security advisor).
- *Test*: suite E2E completa (§17), axe su tutte le pagine, test di carico leggero sulle query principali.
- *DoD*: nessun problema critico/alto aperto; coverage `domain/` ≥ 90%; checklist sicurezza §13 verificata punto per punto.

**M13 — Readiness beta (azioni esterne)**
- *Obiettivo*: ambienti reali e lancio beta chiusa.
- *File*: workflow di deploy, `docs/DEPLOY.md`, README finale, pagina d'attesa/feedback.
- *Azioni esterne richieste (da concordare, nessuna eseguita senza il tuo ok)*: progetto Supabase in regione UE, dominio, provider email con SPF/DKIM/DMARC e SMTP per Auth, hosting frontend, Cloudflare Turnstile, Sentry, contatto privacy e revisione legale.
- *DoD*: staging e produzione separati; backup e ripristino provati; checklist beta completata; validazione con utenti reali già avviata in parallelo. Il dominio scelto deve supportare i file `/.well-known/*` e `/app-config.json` (§22.9), perché servirà alle app.

### Fase Mobile (M14–M22)

Prerequisiti esterni comuni (da concordare, nessuno eseguito senza il tuo ok): vedi §22.13. In sintesi: **un Mac o un servizio cloud con macOS** per iOS (il PC attuale è Windows), account Apple Developer, account Google Play Console, progetto Firebase, dominio.

**M14 — Integrazione Capacitor e shell nativa**
- *Gate v0.3*: iOS deployment target **16.4**, `minWebViewVersion` **111** + schermata di WebView non supportata; **client `app-config.json` già in questa milestone** (fail-open, §23.10); header `x-app-version`/`x-app-platform` attivi; verifica se `cap add ios` si può eseguire da Windows (**[V]**, altrimenti nella prima "finestra Mac", §23.9).
- *Obiettivo*: la SPA gira come app su simulatore iOS ed emulatore Android.
- *File*: `capacitor.config.ts` (per `CAP_ENV`), `ios/`, `android/`, `resources/`, `src/platform/native/{app,statusBar,keyboard,network}.ts`, script `pnpm cap:sync|ios|android`, `docs/MOBILE.md`.
- *DB*: nessuna.
- *Test*: smoke manuale su emulatore e simulatore; job CI `mobile-android`, `mobile-ios`, `cap-sync-check`; test che la build Web non contenga Capacitor.
- *DoD*: login e dashboard funzionano su iOS Simulator e su Android; tasto Indietro Android corretto; app ID e nome distinti per dev/staging/prod; WebView debugging disattivo in release; nessuna regressione Web.

**M15 — UX mobile nativa**
- *Obiettivo*: esperienza touch reale, non una web app ristretta.
- *File*: `layouts/MobileShell` rifinita, `shared/ui` (BottomSheet, ActionSheet, SwipeRow, PullToRefresh), `platform/native/haptics.ts`, gestione tastiera, date picker nativo, transizioni a stack.
- *DB*: nessuna.
- *Test*: component test dei gesti, E2E con viewport mobile, matrice manuale su dispositivi reali con la checklist §22.12.
- *DoD*: checklist §22.12 superata su 4 dispositivi; target touch conformi; scroll fluido su Android economico **[I]**; test con dimensione testo al 200%.

**M16 — Autenticazione nativa e deep link**
- *Gate v0.3*: politica token/Keychain/logout/reinstallazione di §23.3; AASA e `assetlinks.json` per ambiente, route ammesse e fallback schema custom di §23.7; hosting senza rewrite SPA su `/.well-known/*`. **Richiede Apple Team ID** (Apple Developer attivo) → avviare l'iscrizione entro M12.
- *Obiettivo*: sessione sicura sul dispositivo e link che aprono l'app.
- *File*: `platform/native/secureStorage.ts`, `platform/native/deepLinks.ts`, file `apple-app-site-association` e `assetlinks.json`, intent-filter Android, Associated Domains iOS, template email Auth finali.
- *DB*: nessuna.
- *Test*: unit del gestore deep link (whitelist, utente non loggato), prove su dispositivo di link da email, app chiusa/in background, sessione dopo riavvio, logout.
- *DoD*: registrazione→conferma con codice su iOS e Android; link a `/items/:id` apre l'app (se installata) o il Web (se non installata); token solo in Keychain/Keystore; account eliminabile dall'app (§22.10/22.11).

**M17 — Documenti nativi**
- *Obiettivo*: allegare e aprire documenti da telefono.
- *File*: `platform/native/{camera,filePicker,documentViewer,share}.ts`, compressione immagini lato client, stringhe d'uso dei permessi (iOS) e permessi minimi (Android), integrazione in `DocumentsPanel`.
- *DB*: nessuna.
- *Test*: unit validatori su file da fotocamera (JPEG/HEIC convertito), prove su dispositivo di scatto, selezione PDF, apertura, permesso negato.
- *DoD*: foto e PDF caricabili entro i limiti di §7; apertura via signed URL nel visualizzatore di sistema; nessun URL salvato; nessun permesso di archiviazione ampio.

**M18 — Notifiche push**
- *Gate v0.3*: plugin `@capacitor-firebase/messaging`; gestione errori FCM, TTL, canale Android, revoca/refresh token, RPC `unregister_push_device` e coda di rimozione offline di §23.2; il client **ignora/filtra canali sconosciuti** nelle liste di avvisi (compat con versioni precedenti, §23.10).
- *Obiettivo*: avvisi push affidabili, una volta sola, con apertura diretta dell'item.
- *File*: `supabase/functions/send-notifications` (driver `fcm`/`mock`), `_shared/push.ts`, `platform/native/push.ts`, `features/reminders/*` (permesso contestuale), `NotificationSettings` (canali), `docs/PUSH.md`.
- *DB*: `push_devices`, `notification_deliveries`, enum `notification_channel` + `'push'`, RPC `register_push_device`, colonna `profiles.push_notifications_enabled`, estensione di `sync_item_notifications` (§22.5).
- *Test*: pgTAP (RLS dispositivi, riassegnazione token, unicità), Deno (fan-out per dispositivo, retry solo sui dispositivi falliti, token non valido rimosso, nessun duplicato), prova manuale su iPhone e Android reali.
- *DoD*: push ricevuta su iOS e Android in staging, una sola volta per avviso; tap apre `/items/:id`; opt-out per canale funziona; nessun dato sensibile nel payload; token rimosso al logout.

**M19 — Resilienza e offline**
- *Gate v0.3*: implementare **esattamente** la politica di cache di §23.6 (contenuto, cifratura AES-GCM con chiave in SecureStorage, TTL 7/30 giorni, invalidazione, wipe al logout); la cache esiste **solo sulle app native**.
- *Obiettivo*: nessuna schermata bianca senza rete; ultimi dati consultabili.
- *File*: cache di sola lettura di lista scadenze/dettagli (storage locale), banner offline, gestione errori di rete, Sentry per le app (scrubbing PII).
- *DB*: nessuna.
- *Test*: unit della cache, E2E con rete assente, prova in modalità aereo su dispositivo.
- *DoD*: offline mostra gli ultimi dati con banner e disabilita le scritture con messaggio chiaro (**nessuna scrittura offline in v1**); nessuna pagina di errore del browser.

**M20 — CI/CD e firma mobile**
- *Gate v0.3*: piano CI iOS da Windows di §23.9 (runner macOS in GitHub Actions + fastlane + chiave API App Store Connect; workflow manuale una tantum per creare certificati con `match`); lint delle migrazioni e suite di contratto "client N-1" in CI (§23.10).
- *Obiettivo*: build firmate e distribuite automaticamente ai tester.
- *File*: `fastlane/*`, `.github/workflows/mobile-release.yml`, `docs/RELEASE.md`, gestione versioni, `app-config.json` (versione minima).
- *DB*: nessuna.
- *Test*: esecuzione della pipeline su tag di prova (`mobile-v0.1.0-beta.1`).
- *DoD*: un tag produce build installabili da **TestFlight** e dal **test interno Google Play** senza passaggi manuali locali; secret solo in GitHub Secrets; versione incrementale garantita.

**M21 — Preparazione agli store e beta chiusa mobile**
- *Obiettivo*: tutto il materiale e le conformità richieste dagli store.
- *File*: `docs/STORE.md` (schede, testi italiani, screenshot, risposte ai questionari), privacy manifest iOS, dichiarazioni privacy/Data safety, account demo per il revisore, URL di cancellazione account.
- *DB*: nessuna.
- *Test*: checklist §22.10 e §22.11 completate; installazione da TestFlight e Play su dispositivi reali.
- *DoD*: nessun requisito aperto; **se l'account Google è personale, test chiuso con ≥ 12 tester per 14 giorni consecutivi già completato** **[V]**; TestFlight esterno in corso.

**M22 — Pubblicazione 1.0 sugli store**
- *Obiettivo*: app pubbliche su App Store e Google Play.
- *File*: nessun codice nuovo previsto, solo configurazione e note di rilascio.
- *Test*: smoke test post-release, monitoraggio crash e funzioni.
- *DoD*: invio a review iOS approvato; Android con **rollout graduale** (es. 10% → 50% → 100%) e iOS con rilascio a fasi; runbook di hotfix e rollback; monitoraggio attivo (Sentry, log funzioni, coda notifiche).

---

## 21. Decisioni tecniche, azioni esterne, rischi aperti

### 21.1 Strategia multipiattaforma: valutazione e scelta

**Scelta [D]: Vue 3 + TypeScript + Capacitor**, una sola codebase per Web, iOS e Android, con shell mobile dedicata, plugin nativi dietro porte (`platform/`) e backend Supabase unico.

Valutazione **[R]** (giudizio mio, basato su requisiti e fonti verificate dove indicato; Alto = soddisfa bene il criterio):

| Criterio | **Vue 3 + Capacitor** (scelta) | PWA + wrapper (TWA / WebView minimale) | React Native (Expo) | Flutter |
|---|---|---|---|---|
| Riuso del codice con il Web | **Altissimo**: stessa SPA, stessi store/validazioni/servizi | Altissimo | Medio: logica TS riusabile, UI da riscrivere in React | Basso: Dart, nessun riuso con Vue/TS |
| Una vera web app resta possibile | **Sì** (è la stessa app) | Sì | Debole (react-native-web è un compromesso) | Debole (web Flutter non è HTML nativo) |
| Notifiche push native | Sì (plugin FCM/APNs) | Android sì; iOS solo come web app aggiunta alla Home **[V]**; un wrapper che offre solo questo rischia il rifiuto Apple | Sì | Sì |
| Deep link (Universal/App Links) | Sì (`@capacitor/app`) | Android sì; iOS limitato | Sì | Sì |
| Autenticazione / token | Supabase JS + secure storage nativo | Solo storage browser | Supabase JS + secure store | Supabase Dart |
| Upload documenti, fotocamera, file | Plugin ufficiali (Camera, picker, Share, Browser) | Solo funzioni web | Sì | Sì |
| Background tasks | **Limitati** (nessun supporto di prima classe): non servono, perché gli avvisi sono generati dal server e consegnati via push | No | Sì | Sì |
| Prestazioni | Buone per app a form/liste (WebView); non adatta a grafica pesante | Buone | Ottime | Ottime |
| Accesso a funzioni native future (biometria, scanner documenti, widget) | Plugin esistenti o plugin nativi propri | Quasi nulla | Ottimo | Ottimo |
| Pubblicazione App Store | Sì, **purché l'app non sembri un sito reimpacchettato** (Guideline 4.2) **[V]**: mitigato da shell nativa, push, fotocamera, share, offline in lettura | **Alto rischio** di rifiuto 4.2 **[V]** | Sì | Sì |
| Pubblicazione Google Play | Sì (AAB, target API 36 **[V]**) | Sì | Sì | Sì |
| Manutenzione futura | Un team, un linguaggio, un test suite; plugin da tenere aggiornati con le versioni di Xcode/Android | Minima ma limitata | Due codebase UI (Vue sul Web, React su mobile) | Tre codebase |

Esito:
- **PWA + wrapper**: scartata come soluzione finale. Su iOS le push web funzionano solo per web app aggiunte alla Home **[V]** e un wrapper senza funzioni native rischia il rifiuto 4.2 **[V]**. La PWA installabile resta un'estensione Web (P1), non la strategia mobile.
- **React Native/Expo e Flutter**: migliori in prestazioni grezze e funzioni native, ma obbligherebbero a una seconda codebase UI e romperebbero lo stack Vue già scelto e il requisito "una vera web app". Il costo di manutenzione per un team piccolo è sproporzionato rispetto ai benefici per un'app fatta di form, liste, documenti e notifiche.
- **Ionic Vue / Quasar** (anch'essi basati su Capacitor): scartati come framework UI perché imporrebbero un proprio sistema di componenti e routing in conflitto con Tailwind + Headless UI e con il design system già definito. Si usa Capacitor *direttamente*.
- **Tauri 2 mobile** e **NativeScript-Vue**: ecosistema mobile più giovane/di nicchia (plugin push e distribuzione meno consolidati) → rischio di manutenzione.

**Valvola di sicurezza**: dominio (`domain/`), servizi e tipi sono TypeScript puro e il backend è Supabase. Se in futuro la WebView non bastasse, si potrebbe riscrivere solo il livello UI in un'altra tecnologia senza toccare backend, database e logica. Per questo i vincoli di §14 (porte e adapter) sono non negoziabili.

**Rischi propri di Capacitor, e come li gestiamo**
1. *Percezione "sito dentro un'app" e rifiuto Apple 4.2* → shell nativa, gesti, push, fotocamera, share, offline in lettura (M15, M17–M19), review con account demo.
2. *Prestazioni su Android economici* → bundle piccoli, liste leggere, test su dispositivo di fascia bassa a ogni release (§22.12).
3. *Dipendenza dalle versioni di Xcode/Android Studio* (Capacitor 8 richiede Xcode 26+, Android Studio Otter 2025.2.1+, JDK 21, Node 22+, target API 36 **[V]**) → aggiornamento pianificato ogni 6–12 mesi, CI mobile notturna che rileva rotture.
4. *Plugin push/secure storage di terze parti* → push deciso (`@capacitor-firebase/messaging`), secure storage da confermare con prova su dispositivo in M16; la porta `platform/` isola il cambio.
5. *Sviluppo iOS richiede macOS* (oggi si lavora su Windows) → vedi §22.13.

### 21.2 Altre decisioni tecniche

**Decisioni prese (no conferma necessaria)**
| Tema | Scelta | Motivo |
|---|---|---|
| Piattaforme | Web + iOS + Android, una codebase, Capacitor 8 | Riuso massimo, mantiene una vera web app, stack Vue invariato |
| Shell UI | `DesktopShell` + `MobileShell` sullo stesso design system | Esperienza touch reale senza duplicare le pagine |
| Plugin nativi | Dietro porte `platform/`, import dinamico solo in `platform/native` | Bundle Web pulito, testabilità, sostituibilità dei plugin |
| Repo | Singolo package, `ios/` e `android/` committati | Semplicità; nessun monorepo necessario |
| Conferma email/reset | OTP a 8 cifre primario + link (la lunghezza va verificata anche in hosting **[B]**) | Funziona su tutte le piattaforme senza deep link; 8 cifre riducono il rischio di brute force ma non lo eliminano (§23.12) |
| Deep link | Universal Links / App Links su dominio proprio (no solo schema custom) | Più robusto; evita problemi noti dei redirect con solo schema **[V]** |
| Push | FCM (HTTP v1) per Android e iOS, fan-out per dispositivo con tabella `notification_deliveries` | Un solo provider server; idempotenza per dispositivo |
| Sessione sulle app | Keychain/Keystore tramite `SecureStorage` | Il token non resta in `localStorage` nativo |
| Offline | Sola lettura in cache (M19), nessuna scrittura offline in v1 | Evita conflitti di sincronizzazione; soddisfa 4.2 |
| Background tasks | Non necessari in v1 (avvisi generati dal server, consegnati via push) | Riduce complessità e rischi su iOS/Android |
| Aggiornamenti | Release store come canale principale; live update del bundle Web solo se serve, dopo verifica delle regole degli store **[V]** | Conformità e prevedibilità |
| Compatibilità API | Migrazioni retrocompatibili (expand/contract) + `min_app_version` in `/app-config.json` | Le app installate si aggiornano con ritardo |
| Pagamenti futuri | Entitlements indipendenti dal provider; sulle app gli abbonamenti digitali vanno acquistati con acquisto in-app **[V]** (StoreKit/Play Billing, eventualmente tramite RevenueCat) | Evita rifiuti e rifacimenti quando si monetizza |
| Ambienti | dev / staging / production con appId distinti (`.dev`, `.staging`) | Installazione affiancata, test sicuri |

**Altre decisioni (invariate)**
| Tema | Scelta | Motivo |
|---|---|---|
| Package manager | pnpm | Veloce, lockfile affidabile, già installato |
| Struttura FE | Per feature + `domain/` puro | Manutenibilità e test; logica fuori dai componenti |
| Ricorrenza | Calcolo solo in PostgreSQL, ancora + intervallo | Una sola implementazione, nessuna deriva, atomicità col completamento |
| Notifiche | Tabella + pg_cron + Edge Function + idempotency key | Niente code esterne, costi bassi, nessun duplicato |
| Reminder | `reminder_days` sull'item, istanze in `notifications` | Niente tabella ridondante |
| Template | Statici nel codice | Versionati con le release, nessun costo DB |
| Form | zod 4 + composable proprio `useZodForm` (v0.5) | `@vee-validate/zod` è incompatibile con zod 4; `@tanstack/vue-form` è compatibile ma non indispensabile per 5 form piccoli (da rivalutare in M5); schema unico per validazione e normalizzazione (§23.12) |
| Registrazione | Password monouso + azzeramento alla prima conferma (trigger) + scelta della password dopo la conferma | Chiude il pre-hijacking degli account non confermati; richiede una migration su `auth.users` e la verifica in staging (§23.12) |
| TypeScript | 6.0.x pinnato (non 7.x) | `typescript-eslint` non supporta ancora TS ≥ 6.1 |
| Target minimi nativi | iOS 16.4, WebView Android 111 | Baseline di Vite 8 e Tailwind 4 |
| UI headless | Headless UI Vue + Tailwind | Accessibilità di modal/menu senza reinventare |
| E2E email | Mailpit/Inbucket locale + driver `mock` | Test deterministici senza provider |
| Email provider | Resend (da verificare regione UE/DPA) | Semplice, idempotency key, ottimo per transazionali |
| Valuta | Solo EUR, centesimi interi | Mercato Italia, niente float |

**Azioni esterne** (ti chiederò conferma al momento): nessuna fino a M8 incluso (basta Docker, già presente). Da M9 per staging/M13: Supabase, provider email, dominio, hosting, Turnstile, Sentry. Fase mobile (M14–M22): Mac/macOS cloud, account Apple Developer, account Google Play Console, progetto Firebase (FCM), chiave APNs (vedi §22.13).

**Rischi aperti**
1. Regole italiane dei template: verifica con fonti ufficiali **[V]** prima del rilascio.
2. Testi legali: revisione professionale.
3. Deliverability delle email (dominio, SPF/DKIM/DMARC) — critica per la promessa del prodotto.
4. Limiti dei piani Supabase (storage, backup/PITR, protezione password) **[V]** da controllare al momento della scelta del piano.
5. Valore reale rispetto al calendario: dipende dalla validazione con utenti **[I]**.
6. Nessuna scansione antivirus sugli allegati nell'MVP (rischio accettato e documentato).
7. Un'email per avviso: se emergono troppi invii nello stesso giorno, anticipare un digest (P1).
8. **Rifiuto Apple per Guideline 4.2** (app percepita come sito reimpacchettato): mitigazione in §21.1 e §22.10.
9. **iOS richiede macOS**: il PC è Windows; senza un Mac (o servizio cloud) l'iterazione su iOS è lenta (§22.13).
10. **Account Google personale**: test chiuso obbligatorio con ≥ 12 tester per 14 giorni prima della produzione **[V]**; pianificarlo con anticipo o usare un account organizzazione.
11. **CAPTCHA (Turnstile) dentro la WebView** e domini consentiti da verificare **[V]**; fallback: limiti più stretti lato Auth per le app.
12. **Acquisti in-app** obbligatori sugli store per abbonamenti digitali **[V]**: impattano prezzi e margini (commissioni) quando si monetizza.
13. **Costi e tempi** di manutenzione delle dipendenze native (Xcode, Android Studio, API target) a ogni ciclo annuale degli store.

---

## 22. Mobile & Store Distribution

Legenda: **[V]** = requisito esterno da riverificare sulle fonti ufficiali al momento della pubblicazione (le regole degli store cambiano ogni anno). Dove ho già trovato conferma in questa sessione lo indico come *verificato (ott. 2026)*.

### 22.1 Principi
1. Una codebase, tre target; le differenze solo in `platform/` e nelle shell.
2. Il Web resta una vera web app, deployata in modo indipendente e continuo.
3. Le app native non contengono logica di business né segreti; tutto passa da Supabase con RLS.
4. L'app deve **giustificare l'esistenza come app** (non è un sito reimpacchettato): push, fotocamera, condivisione, offline in lettura, gesti, deep link.
5. Backend sempre retrocompatibile con le versioni mobile ancora in circolazione.

### 22.2 Strategia Web
- SPA statica su hosting con header di sicurezza (CSP, HSTS, ecc. §13), deploy per PR (preview), staging e produzione.
- Serve anche: `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` (con `Content-Type` corretto, senza redirect), `/app-config.json` (versione minima app).
- P1: manifest PWA + service worker minimale (installabile) e **web push** (VAPID). `platform = 'web'` è già previsto nell'enum dei dispositivi.
- Il Web funziona nel browser anche per chi non scarica l'app; i link nelle email aprono l'app se installata, altrimenti il Web.

### 22.3 Strategia iOS
- App Capacitor (WKWebView) con progetto Xcode in `ios/`, **iOS deployment target 16.4** (il minimo di Capacitor 8 è 15, *verificato ott. 2026*, ma Vite 8 e Tailwind 4 richiedono Safari 16.4: su iOS 15–16.3 gli stili si romperebbero), Swift Package Manager come default per i plugin.
- Capability: **Push Notifications**, **Associated Domains** (`applinks:app.<dominio>`), Background Modes → solo *Remote notifications* se necessario per la ricezione.
- Stringhe d'uso dei permessi in italiano (fotocamera, libreria foto se usata) e **privacy manifest** (`PrivacyInfo.xcprivacy`) **[V]**.
- Build solo con **Xcode 26+ / SDK iOS 26**: dal 28 aprile 2026 App Store Connect rifiuta i caricamenti con SDK precedenti (*verificato ott. 2026*).
- Distribuzione: **TestFlight** interno (subito), TestFlight esterno per la beta, poi App Store con rilascio a fasi.
- Sviluppo: richiede macOS (§22.13).

### 22.4 Strategia Android
- App Capacitor (WebView di sistema) con progetto Gradle in `android/`; Capacitor 8: **minSdk 24, compileSdk/targetSdk 36, JDK 21** (*verificato ott. 2026*). **`android.minWebViewVersion = 111`** in `capacitor.config.ts` (il default di Capacitor è 60, che lascerebbe passare WebView incompatibili con Tailwind 4/Vite 8; sotto la soglia Capacitor scrive solo un errore nel log) + `server.errorPath` e controllo all'avvio con schermata "Aggiorna Android System WebView" (§23.1). Dal 31 agosto 2026 le nuove app e gli aggiornamenti devono avere target API 36 (*verificato ott. 2026*; estensione possibile fino al 1 novembre 2026).
- **Edge-to-edge** obbligatorio sulle versioni recenti di Android **[V]**: gestire gli inset di sistema (safe area) in `MobileShell`.
- Permessi minimi: `POST_NOTIFICATIONS` (runtime da Android 13), fotocamera solo se si usa l'acquisizione diretta; **nessun** permesso di archiviazione ampio (si usa il selettore di sistema).
- Tasto/gesto **Indietro** gestito con `@capacitor/app` (navigazione a stack, uscita solo dalla radice).
- `android:allowBackup="false"` per non copiare sessione/cache nei backup **[R]**; `usesCleartextTraffic=false` in release.
- Distribuzione: **AAB** con **Play App Signing**; tracce: test interno → test chiuso → produzione con rollout graduale.

### 22.5 Notifiche push

**Obiettivo**: stessa promessa dell'email ("ti avvisiamo noi"), consegnata sul telefono, **una sola volta per avviso e per dispositivo**, aprendo l'item giusto.

**Architettura** (estende §11; l'email resta invariata)
```
life_items ──trigger sync_item_notifications──► notifications (una riga per item/data/preavviso/CANALE: email, push)
pg_cron ─► Edge Function send-notifications
              ├─ canale email → provider email (come §11)
              └─ canale push  → claim → per ogni dispositivo attivo dell'utente → FCM HTTP v1
                                  esito per dispositivo in notification_deliveries
```

**Nuove tabelle e modifiche** (migrazione in M18)
- **`push_devices`**: `id uuid pk`, `owner_id uuid → auth.users on delete cascade`, `installation_id uuid not null` (generato dall'app, stabile per installazione), `platform` enum (`ios`,`android`,`web`), `push_token text not null`, `app_version text`, `enabled boolean default true`, `last_seen_at timestamptz`, `created_at`, `updated_at`. **Unique** `(installation_id)` e `(push_token)`; indice `(owner_id)`.
- **`notification_deliveries`**: PK `(notification_id, device_id)`, FK a `notifications` e `push_devices` con `on delete cascade`, `status` (`pending`,`sent`,`failed`,`invalid_token`), `attempts smallint`, `provider_message_id`, `last_error`, `sent_at`. Nessun accesso client.
- **`notification_channel`**: aggiunta del valore `'push'`. La chiave unica `(item_id, due_date, days_before, channel)` garantisce già un solo avviso per canale.
- **`profiles.push_notifications_enabled boolean default true`** (preferenza per canale; email invariata).
- **`sync_item_notifications`**: crea una riga per ogni canale abilitato. Se l'utente non ha dispositivi attivi l'invio push finisce `skipped` (motivo `no_devices`) senza errore.
- **RPC `register_push_device(installation_id, platform, token, app_version)`** (`security definer`): upsert del dispositivo **riassegnandolo all'utente chiamante** (se su quel dispositivo accede un altro account, la riga passa al nuovo utente e il precedente non riceve più push). Il client non può inserire direttamente token con `owner_id` arbitrario.
- **RLS**: `push_devices` visibile e cancellabile solo dal proprietario (`owner_id = auth.uid()`); insert/update solo via RPC; `notification_deliveries` solo `service_role`.

**Flusso di invio**: `claim_due_notifications` (come §11) → per le righe `push` la funzione legge i dispositivi `enabled` → invia a FCM un messaggio per dispositivo → registra l'esito in `notification_deliveries` → la riga `notifications` diventa `sent` quando almeno un dispositivo è `sent` e nessuno è `pending`; i retry (backoff come §11) riguardano **solo i dispositivi non ancora consegnati**. `tag` Android e `apns-collapse-id` = `notification.id`: un eventuale doppio invio si fonde in un'unica notifica visibile.

**Payload (minimizzazione)**: titolo "Scade tra 7 giorni", testo "Assicurazione auto · 15/12/2026", dati `{ "path": "/items/<uuid>", "notification_id": "<uuid>" }`. Niente note, importi, documenti. P1: opzione "nascondi dettagli in schermata di blocco".

**Ciclo di vita dei token**
- Registrazione: al login e a ogni avvio dell'app (e quando il sistema rinnova il token).
- Rimozione: al logout (cancellazione riga), alla cancellazione account (cascata), su risposta FCM `UNREGISTERED` (o `INVALID_ARGUMENT` imputabile al token) → `invalid_token` e disabilitato; **pulizia dei dispositivi non visti da > 270 giorni** (scadenza dei token Android secondo FCM **[V]**) — *non* a 60 giorni: chi non apre l'app da mesi è proprio chi ha più bisogno delle push. Dettagli completi (errori FCM, retry, TTL, canali Android, revoca) in §23.2.

**Permessi e UX**: la richiesta del permesso **non** appare al primo avvio. Appare in modo contestuale dopo la creazione delle prime scadenze (fine onboarding) con una schermata che spiega il valore ("Vuoi ricevere un avviso prima delle scadenze?") e solo dopo mostra la richiesta di sistema (Android 13+ la richiede a runtime). Se negato: stato chiaro in Impostazioni con scorciatoia alle impostazioni di sistema; l'email continua a funzionare.

**Tap sulla notifica**: l'app legge `path`, lo valida con la whitelist dei deep link (§3) e naviga; se la sessione non è attiva passa dal login con `redirect`.

**Provider**: FCM per entrambe le piattaforme (la chiave APNs `.p8` si carica su Firebase). Plugin client **deciso**: `@capacitor-firebase/messaging` (token FCM su iOS e Android); verifica su dispositivo reale in M18 (§23.2).

### 22.6 Livello nativo: porte e adapter

| Porta (`@/platform`) | Web | iOS / Android (Capacitor) | Usata da |
|---|---|---|---|
| `PlatformInfo` | `isNative=false` | `isNative=true`, piattaforma, safe area | shell, feature |
| `SecureStorage` | `localStorage` | Keychain / Keystore | client Supabase |
| `Push` | no-op (P1: web push) | registrazione, permesso, evento tap | reminders, settings |
| `Camera` / `FilePicker` | `<input type=file>` | scatto + selettore di sistema | documenti |
| `DocumentViewer` | `window.open(signedUrl)` | Browser in-app / foglio di condivisione | documenti |
| `DeepLinks` | router diretto | `appUrlOpen` → router (whitelist) | router |
| `AppLifecycle` | `visibilitychange` | `resume/pause`, tasto Indietro | auth, dati |
| `Haptics` / `Share` / `Network` | no-op / Web Share / `navigator.onLine` | plugin nativi | UI |

Test e CI usano `platform/fake`.

### 22.7 Build
- **Toolchain (Capacitor 8, *verificato ott. 2026*)**: Node ≥ 22 (progetto su Node 24), Xcode ≥ 26, Android Studio Otter 2025.2.1+, JDK 21. Le versioni esatte si pinnano in M14.
- **Comandi previsti** (script npm): `pnpm build:web` → `pnpm cap:sync` → `pnpm cap:android` / `pnpm cap:ios` (apre l'IDE) → build da IDE o da CI (`gradlew bundleRelease`, `xcodebuild archive` via fastlane).
- **Sviluppo**: live reload su dispositivo/emulatore con `server.url` verso la rete locale (solo in `development`, mai in release); `webContentsDebuggingEnabled` solo in dev.
- **Asset**: icone e splash generate da `resources/` con un tool di generazione (scelta in M14).
- **Versioning**: `versionName`/`CFBundleShortVersionString` = versione semantica da `package.json`; `versionCode`/`CFBundleVersion` = numero crescente generato da CI (mai riusato).

### 22.8 Ambienti

| | **Development** | **Staging** | **Production** |
|---|---|---|---|
| Backend | Supabase locale (Docker) | Progetto Supabase staging | Progetto Supabase produzione (UE) |
| Web | `localhost:5173` | `staging.<dominio>` | `app.<dominio>` |
| appId / nome app | `<reverse-domain>.lifeadmin.dev` / "LifeAdmin Dev" | `….lifeadmin.staging` / "LifeAdmin Staging" | `<reverse-domain>.lifeadmin` / "LifeAdmin" |
| Distribuzione mobile | Build di debug su dispositivo/emulatore | TestFlight + test interno/chiuso Play | App Store + Google Play |
| Email / Push | `mock` (Mailpit locale) | provider reale + FCM (progetto Firebase staging) | provider reale + FCM produzione |
| Associated domain | – (schema custom solo per debug) | `staging.<dominio>` | `app.<dominio>` |
| Dati | dati sintetici creati dai test (nessun utente o credenziale nel repository) | dati sintetici/tester | dati reali |

Gli appId diversi consentono di installare le tre versioni affiancate. La scelta dell'ambiente avviene a build-time (`CAP_ENV`, modalità Vite), mai a runtime.

### 22.9 Signing, release, compatibilità
- **Android**: *upload key* generata da te (keystore), conservata in un password manager e come secret cifrato in GitHub (base64); **Play App Signing** attivo (la chiave di firma finale la custodisce Google). Mai keystore o password nel repository.
- **iOS**: chiave API di App Store Connect (`.p8`) come secret; certificati e profili gestiti con **fastlane match** (repository privato cifrato) o firma automatica in CI; chiave **APNs** caricata su Firebase.
- **Flusso di rilascio**: tag `mobile-v1.2.0` → CI → build firmate → TestFlight / Play test interno → test manuale con checklist §22.12 → promozione manuale: iOS review + rilascio a fasi; Android test chiuso → produzione con rollout graduale.
- **Cadenza [R]**: Web continuo; app ogni 2–4 settimane (salvo hotfix). Note di rilascio in italiano.
- **Versione minima supportata**: `/app-config.json` letto all'avvio; sotto la soglia, schermata "Aggiorna l'app" con link allo store. **Il controllo deve essere già presente nella prima versione pubblicata** (non si può forzare l'aggiornamento di una versione che non lo contiene): è un requisito di M14, non di M20. Schema, cache e regole in §23.10.
- **Compatibilità API**: ogni migrazione è *expand → migrate → contract* su almeno due versioni mobile; nessuna rimozione di colonne/funzioni usate da versioni supportate.
- **Hotfix**: correzioni critiche lato server immediate; lato app, release d'emergenza con review accelerata se necessario **[V]**. Live update del bundle Web: opzionale, da valutare solo dopo aver verificato le regole degli store **[V]**.

> **Nota v0.3**: le checklist 22.10 e 22.11 restano come elenco operativo, ma la **classificazione ufficiale** (obbligatori / condizionati / best practice, con `[V]`) è in §23.8.

### 22.10 Requisiti futuri App Store (iOS)
- [ ] **Apple Developer Program** attivo (individuale o organizzazione; l'organizzazione richiede un D-U-N-S) **[V]** e accesso ad App Store Connect.
- [ ] Build con **Xcode 26+ / SDK iOS 26** (*verificato ott. 2026*).
- [ ] **Guideline 4.2 – Minimum Functionality**: l'app deve offrire più di un sito reimpacchettato; la revisione è manuale (*verificato ott. 2026*). Presidi: shell nativa e gesti, push, fotocamera/share, offline in lettura (nessuna pagina di errore del browser), navigazione coerente.
- [ ] **Guideline 5.1.1(v) – cancellazione account in-app**: eliminazione vera dei dati dall'interno dell'app, non solo disattivazione (*verificato ott. 2026*): coperta da F12.
- [ ] **Privacy**: URL privacy policy, **App Privacy** ("nutrition labels"), **privacy manifest** e motivi delle API richieste **[V]**.
- [ ] Stringhe d'uso dei permessi (fotocamera/foto) e capability Push/Associated Domains.
- [ ] **Sign in with Apple**: obbligatoria solo se si aggiunge un login con provider terzi **[V]**.
- [ ] **Acquisti in-app** per abbonamenti digitali venduti nell'app **[V]**: da decidere prima della monetizzazione.
- [ ] Per la review: **account demo** con email già verificata, note per il revisore, URL di supporto, classificazione per età, dichiarazione crittografia (solo HTTPS) **[V]**, screenshot nelle dimensioni richieste **[V]**.

### 22.11 Requisiti futuri Google Play (Android)
- [ ] **Play Console** (costo una tantum) e verifica dell'identità dello sviluppatore **[V]**.
- [ ] **Account personale**: test chiuso con **≥ 12 tester iscritti da almeno 14 giorni consecutivi** prima di poter richiedere l'accesso alla produzione; gli account organizzazione ne sono esenti (*verificato ott. 2026*).
- [ ] **Target API 36** per nuove app e aggiornamenti dal 31 agosto 2026 (*verificato ott. 2026*).
- [ ] Formato **AAB** + **Play App Signing** **[V]**.
- [ ] **Scheda "Sicurezza dei dati" (Data safety)**, URL privacy policy, questionario sulla classificazione dei contenuti, istruzioni di accesso per il revisore (account demo) **[V]**.
- [ ] **Cancellazione account**: funzione in-app **e** URL web per richiederla, dichiarato nella scheda **[V]** (la pagina web può essere la sezione `/settings` dopo il login più una pagina informativa pubblica).
- [ ] Permessi minimi e giustificati (`POST_NOTIFICATIONS`, eventuale fotocamera).
- [ ] Gestione edge-to-edge e compatibilità con le versioni recenti di Android **[V]**.

### 22.12 Checklist UX mobile (da superare a ogni release candidate)
- [ ] Nessuno scroll orizzontale; safe area rispettate (notch, home indicator, edge-to-edge) in verticale e con tastiera aperta.
- [ ] Target touch ≥ 44 pt / 48 dp; nessuna azione solo-hover.
- [ ] Tab bar e tasto Indietro coerenti; da qualunque schermata si torna indietro senza perdere dati inseriti nei form.
- [ ] Tastiera: campo focalizzato visibile; tipo di tastiera corretto per data/importo/email; gestore password funzionante.
- [ ] Swipe, pull-to-refresh e haptics funzionano e hanno alternative accessibili (pulsanti).
- [ ] Testo di sistema al 200% senza troncamenti critici; VoiceOver/TalkBack navigano le schermate principali.
- [ ] Avvio a freddo < 2 s su dispositivo di fascia media; scroll fluido su Android economico **[I]**.
- [ ] Offline (modalità aereo): ultimi dati visibili, banner chiaro, scritture bloccate con messaggio.
- [ ] Push: permesso contestuale, ricezione, tap che apre l'item corretto da app chiusa/in background/in primo piano.
- [ ] Link da email: apre l'app se installata, altrimenti il Web.
- [ ] Documenti: foto, PDF, apertura, eliminazione; permesso negato gestito.
- [ ] Logout e cancellazione account funzionano e rimuovono il token push.

### 22.13 Prerequisiti, azioni esterne e costi (nessuna eseguita senza il tuo ok)
| Quando | Cosa | Note |
|---|---|---|
| M14 | **macOS** per iOS: Mac proprio/usato, oppure Mac cloud a noleggio e/o runner macOS in CI | Il PC è Windows: **Android e Web si sviluppano in locale**, iOS richiede macOS per Xcode e simulatore. Strategia [R]: sviluppo quotidiano su Windows (Web + Android), build iOS in CI, noleggio Mac solo per sessioni di debug iOS |
| M14 | Android Studio, JDK 21, emulatori | Gratuiti |
| M16 | Dominio e hosting con `/.well-known/*` | Già previsto in M13 |
| M18 | Progetto **Firebase** (FCM) e account di servizio | Gratuito per FCM **[V]** |
| M18 | **Chiave APNs** (richiede Apple Developer Program) | |
| M20–M21 | **Apple Developer Program** (costo annuale **[V]**) | Individuale o organizzazione |
| M20–M21 | **Google Play Console** (costo una tantum **[V]**) | Individuale (con regola dei 12 tester) o organizzazione |
| M21 | Revisione legale di privacy/termini aggiornati per le app; contatto privacy; URL di supporto | |
| M21 | Reclutamento di ≥ 12 tester per il test chiuso Google (se account personale) | Va pianificato presto: 14 giorni consecutivi |

### 22.14 Cosa NON si fa nell'MVP mobile
Scrittura offline e sincronizzazione, task in background, widget, Apple Watch/Wear OS, biometria, scanner documenti con ritaglio, condivisione verso l'app da altre app (share target), login social, acquisti in-app, notifiche rich, tablet ottimizzati, dark mode. Restano P1/P2 e il design (porte, shell, token CSS) non li preclude.

---

## 23. Architecture Gate v0.3

Verifica eseguita il 2026-10-08 con controlli sul registro npm (versioni, `engines`, peer dependency) e su documentazione ufficiale/fonti pubbliche. **[V]** = dato sensibile al tempo o non confermato da fonte ufficiale: va ricontrollato alla milestone indicata. Stato: **OK** / **DA CORREGGERE** / **DA VERIFICARE**. Nella colonna "Stato" indico la situazione *trovata* e, tra parentesi, l'esito dopo le modifiche di questa versione.

| # | Punto | Stato trovato | Rischio se ignorato | Modifica alla specifica | Milestone |
|---|---|---|---|---|---|
| 1 | Compatibilità Vue/Vite/Capacitor/TS | **DA CORREGGERE** (corretto) | Build lint rotta (TS 7), dipendenze con peer conflittuali (vee-validate/zod), app con stili rotti su iOS < 16.4 e WebView vecchie | Matrice versioni pinnata (§14), TS 6.0.x, composable di form su zod (v0.5, al posto di TanStack Form), iOS 16.4, WebView 111 | M1, M3, M14 |
| 2 | Push FCM/APNs | **DA CORREGGERE** (corretto) + **DA VERIFICARE** su dispositivi | Push mai consegnate su iOS (token APNs inviato a FCM), token validi cancellati dopo 60 giorni, duplicati/avvisi persi, push a un utente dopo il logout | Plugin deciso, errori/retry/TTL/canale Android, revoca, purge a 270 giorni (§23.2) | M18 |
| 3 | Auth + Keychain/Keystore | **DA CORREGGERE** (corretto) | Logout che espelle l'utente da tutti i dispositivi, sessione "fantasma" dopo reinstallazione su iOS, refresh bloccato in background | Politica token e logout `scope: 'local'`, flag primo avvio (§23.3) | M2, M16 |
| 4 | OTP 8 cifre + link (v0.5; era 6) | **DA CORREGGERE** (corretto; vedi §23.12) | Link consumato dagli scanner antivirus delle email, flussi duplicati confusi, brute force dell'OTP | `/auth/confirm` con pulsante, scadenza 10 min, regole di duplicazione (§23.4) | M3 |
| 5 | Cancellazione account | **DA CORREGGERE** (corretto) | Cancellazione bloccata o a metà (utente con file in Storage), dati residui, ripristino da backup che resuscita l'account | Processo ripristinabile, inventario dati, registro anti-ripristino (§23.5) | M11 |
| 6 | Offline sola lettura | **DA CORREGGERE** (era non definito; ora definito) | Dati personali in chiaro sul telefono, cache che sopravvive al logout, dati vecchi spacciati per aggiornati | Politica di cache esatta (§23.6) | M19 |
| 7 | Universal/App Links | **DA CORREGGERE** (corretto) + **DA VERIFICARE** su dispositivi | Link che aprono il browser invece dell'app, verifica fallita per rewrite SPA o per firma Play, route non whitelisted | Config per ambiente, whitelist, fallback schema custom (§23.7) | M13, M16 |
| 8 | Requisiti store | **DA VERIFICARE** (classificati) | Rifiuti in review, blocco in EU per DSA, ritardi di 14+ giorni per Google | Classificazione obbligatori/condizionati/best practice con `[V]` (§23.8) | M21, M22 |
| 9 | CI iOS da Windows | **DA VERIFICARE** (piano definito) | iOS non compilabile/firmabile, costi macOS imprevisti, nessun debug WKWebView | Piano GitHub Actions macOS + fastlane, "finestre Mac" (§23.9) | M14–M20 |
| 10 | Retrocompatibilità | **DA CORREGGERE** (corretto) | App installate rotte da una migrazione; impossibile forzare l'aggiornamento della prima release; cambio di dominio backend che rompe tutte le app | Contratto API, lint migrazioni, `app-config.json` dalla prima release, finestra di supporto (§23.10) | M2, M9, M14, M18, M20 |

### 23.1 Compatibilità dello stack (punto 1)

**Verificato (registro npm, 2026-10-08)**: Vite 8.3 + `@vitejs/plugin-vue` 6.0 + Vue 3.5.43 + Pinia 4 + Vue Router 5.4 + Tailwind 4.3 + Vitest 5 + ESLint 10 + Capacitor 8.5 convivono con **Node 24**; tutti i plugin Capacitor necessari hanno una release 8.x. Matrice completa in §14.

**Problemi trovati e corretti**
1. **TypeScript**: `latest` su npm è **7.0.2**, ma `typescript-eslint` 8.71 dichiara `typescript <6.1.0`. → pin a **6.0.x**; aggiornare a TS 7 solo quando lint e `vue-tsc` lo supportano ufficialmente.
2. **vee-validate**: `@vee-validate/zod` richiede zod ^3.24; il progetto usa zod 4. → **`@tanstack/vue-form` + zod 4 (Standard Schema)**; spike eseguito in M3 (v0.5): compatibile, ma **non adottato**; si usa un composable proprio su zod (§23.12).
3. **Baseline browser**: Vite 8 imposta `build.target = baseline-widely-available` (Chrome 111, Safari 16.4, iOS 16.4) e Tailwind 4 richiede Chrome 111/Safari 16.4. I minimi di Capacitor (iOS 15, WebView 60 di default) sono più bassi → rischio di **app che si apre ma con layout rotto**. → **iOS 16.4** e **`minWebViewVersion` 111**. Poiché Capacitor su Android si limita a loggare l'errore sotto la soglia, il controllo di avvio mostra "Aggiorna Android System WebView" (UA `Chrome/<n>` < 111) o la pagina di `server.errorPath`.
4. Controllo automatico in CI: fallisce se `typescript` supera la 6.0.x senza `typescript-eslint` compatibile e se manca `build.target` esplicito.

### 23.2 Push FCM / APNs (punto 2)

- **Token per dispositivo**: una riga `push_devices` per installazione (`installation_id` generato dall'app). iOS: capability Push Notifications, **chiave APNs `.p8`** (Key ID + Team ID) caricata in Firebase, `GoogleService-Info.plist`; Android: `google-services.json`. File Firebase **separati per ambiente** (progetti staging e produzione) — non sono secret ma sono specifici dell'ambiente e vanno selezionati per flavor/scheme **[V]**. Il plugin `@capacitor-firebase/messaging` restituisce il **token FCM** su entrambe le piattaforme (con il plugin ufficiale su iOS si otterrebbe il token APNs, non valido per FCM).
- **Permessi**: stato `granted/denied/prompt` letto a ogni avvio e al *resume*; richiesta contestuale (§22.5). Android 13+: permesso runtime `POST_NOTIFICATIONS`. Se negato o revocato dalle impostazioni di sistema → `push_devices.enabled = false` alla prima occasione online; se concesso di nuovo → `true`.
- **Refresh**: evento di rinnovo token del plugin → `register_push_device`; a ogni avvio a freddo si rilegge il token e si aggiorna `last_seen_at` (al massimo una volta al giorno).
- **Revoca**: al logout si chiama `unregister_push_device(installation_id)` **prima** di `signOut` (timeout 3 s) e poi `deleteToken()` locale. Se si è offline, la rimozione resta in coda locale e viene ritentata al prossimo avvio online; rischio residuo accettato e documentato: fino ad allora le push dell'utente precedente possono comparire sul dispositivo (contenuto minimo: titolo e data). `register_push_device` riassegna sempre il token al nuovo utente.
- **Gestione errori FCM (server)**
| Risposta FCM | Azione |
|---|---|
| `UNREGISTERED` (404) | Dispositivo `invalid_token`, disabilitato; nessun retry |
| `INVALID_ARGUMENT` (400) imputabile al token | Come sopra; se imputabile al payload → `failed` permanente + allarme (bug) |
| `SENDER_ID_MISMATCH` (403) | Token di un altro progetto Firebase → `invalid_token` |
| `THIRD_PARTY_AUTH_ERROR` (401, chiave APNs/web push) | Errore **sistemico**: canale push in pausa, allarme; le righe tornano `pending` |
| `QUOTA_EXCEEDED` (429) | Retry con backoff esponenziale, ritardo iniziale ≥ 1 minuto **[V]** |
| `UNAVAILABLE` (503) / `INTERNAL` (500) | Retry con backoff, rispettando `Retry-After` se presente |
| Token OAuth del service account scaduto/rifiutato | Rinnovo e un solo nuovo tentativo, poi errore sistemico |
Backoff come §11 (5 min, 30 min, 2 h, 6 h; max 5 tentativi), applicato **per dispositivo** in `notification_deliveries`.
- **Consegna**: messaggi *notification* (non data-only, nessun background task); `time_to_live`/`apns-expiration` = 12 h (un promemoria vecchio perde valore) **[R]**; priorità alta (`apns-priority: 10`, `apns-push-type: alert`); `apns-collapse-id` e `tag` Android = `notification.id`.
- **Android**: canale di notifica `reminders` (importanza alta) creato al primo avvio, `android.notification.channel_id` esplicito, icona `ic_stat_notify` monocromatica.
- **App in primo piano**: la push non mostra il banner di sistema; l'app mostra un toast interno con azione "Apri".
- **Token vecchi**: purge a **270 giorni** senza `last_seen_at` (scadenza Android secondo FCM) **[V]**; su iOS la durata dipende da APNs.
- **Test**: solo su **dispositivi reali** (iPhone con build TestFlight, Android); contract test Deno con `PUSH_DRIVER=mock`; checklist manuale a ogni release candidate.
- **Secret**: service account JSON solo come secret delle Edge Function; token OAuth in memoria per invocazione.

### 23.3 Supabase Auth e Keychain/Keystore (punto 3)

- **Cosa viene salvato** (sessione di supabase-js, un solo valore JSON): `access_token` (JWT, ~1 h), `refresh_token` (opaco, ruotato a ogni rinnovo), `expires_at`, `user` (id, email, metadata). **Non** viene mai salvato: password, OTP, service role key, URL firmati, chiavi FCM.
- **Dove**: Web → `localStorage` (default di supabase-js, mitigato da CSP). App → `SecureStorage` (Keychain iOS con accessibilità *after first unlock, this device only*, così non finisce in iCloud né nei backup; Keystore Android) **[V]** sul plugin scelto (`@aparajita/capacitor-secure-storage` o equivalente, prova su dispositivo in M16). Il client è creato con `storage` iniettato e `detectSessionInUrl: false`.
- **Refresh**: `autoRefreshToken: true`; sulle app, `stopAutoRefresh()` quando l'app va in background e `startAutoRefresh()` + `getSession()` al *resume* **[V]**. Un errore di **rete** durante il refresh **non** è un logout (l'app resta autenticata offline); solo un refresh token invalido/revocato porta al logout con pulizia.
- **Configurazione server**: rotazione dei refresh token attiva (default), JWT 3600 s; timeout di sessione/inattività dipendono dal piano **[V]**.
- **Logout**: `signOut()` di default usa scope **globale** (revoca *tutte* le sessioni dell'utente). → il logout dell'app usa **`signOut({ scope: 'local' })`**; "Esci da tutti i dispositivi" (Impostazioni) usa `global`; dopo il cambio/reset password si usa `scope: 'others'`. A ogni logout: rimozione token push, wipe della cache offline (§23.6), reset degli store, annullamento delle richieste in corso.
- **Reinstallazione**: su iOS gli elementi Keychain **possono sopravvivere alla disinstallazione** (comportamento non garantito da Apple) → al **primo avvio** dopo l'installazione (marker in `Preferences`, che l'OS cancella con l'app) si **elimina sempre** la sessione dal Keychain e la chiave della cache, poi si imposta il marker. Su Android le chiavi Keystore vengono rimosse con l'app; se i dati cifrati sono illeggibili si tratta come "nessuna sessione"; `allowBackup=false` e regole di esclusione dal trasferimento dispositivo. **Esito deterministico**: dopo reinstallazione l'utente è sempre disconnesso. I refresh token della vecchia installazione restano validi lato server fino a scadenza/revoca (gestibile con "Esci da tutti i dispositivi").
- **Test**: unit del wrapper storage (set/get/remove, errore di decifratura), prova su dispositivo di reinstallazione iOS/Android, logout locale non influente sul Web, refresh in background/resume.

### 23.4 OTP a 8 cifre + link (punto 4)

> **v0.5**: la lunghezza passa da 6 a **8 cifre** (`otp_length = 8`) dopo la misura del brute force in locale (§23.12). Il dettaglio dei rischi e dei gate è in §23.12; qui restano le regole di funzionamento.

- **Configurazione**: codice a **8 cifre** (`otp_length = 8`) **[L]**; **scadenza 600 s** (default Supabase 3600, massimo 86400) **[R]**; invio massimo 1 ogni 60 s per utente (default) e limiti orari/IP configurati con SMTP personalizzato **[V]**; Turnstile prima della beta.
- **Link**: il template Auth usa `https://app.<dominio>/auth/confirm?token_hash={{ .TokenHash }}&type=<signup|recovery>` e **non** `{{ .ConfirmationURL }}`. La pagina mostra un pulsante "Conferma" e chiama `verifyOtp({ token_hash, type })` **solo al click** (gli scanner antivirus/Safe Links caricano i link e consumerebbero un token a uso singolo; un GET non consuma nulla). `type` ammesso solo tra i valori attesi **[V]** (verificare in M3 se per la conferma registrazione serve `signup` o `email`).
- **Uso per piattaforma**: Web → codice o link nello stesso browser. iOS/Android → il **codice** è il flusso primario (digitato nell'app); il link, se l'app è installata, apre `/auth/confirm` nell'app tramite Universal/App Link (§23.7), altrimenti nel browser.
- **Duplicazione**: codice e link derivano dallo stesso token monouso; il primo che viene usato lo consuma, l'altro risponde "scaduto". Gestione UX: se esiste già una sessione valida → procedi; altrimenti "Codice già usato o scaduto → Invia di nuovo". Se la conferma avviene su un altro dispositivo, la schermata `/verify-email` offre "Ho già confermato → Accedi".
- **Sicurezza**: spazio di 10⁸ codici. **La stima precedente (≈ 60 tentativi per IP, 6·10⁻⁵) era sbagliata**: in locale non c'è alcun limite per IP (`GOTRUE_RATE_LIMIT_HEADER` non impostato) e sono stati misurati **~430 richieste al secondo senza alcun 429**, cioè ~258.000 tentativi in 10 minuti: 25,8 % di successo con 6 cifre, 0,26 % con 8 (limite superiore, senza latenza di rete) **[L]**. Otto cifre **riducono** il rischio ma **non lo risolvono**: il rate limit di produzione deve essere verificato **[B]**. Nessun blocco per singolo token (sei codici errati e poi quello giusto funziona) **[L]**. Nessun token nei log; messaggi neutri nella UI (non eliminano l'enumerazione via API, §23.12).
- **Recovery**: `verifyOtp` (recovery) → sessione → `updateUser({ password })` → `signOut({ scope: 'others' })`.
- **Email**: template in italiano (codice ben visibile, pulsante, scadenza 10 min, "se non sei stato tu ignora l'email"), HTML + testo, **senza tracciamento dei click**; invio via SMTP personalizzato.
- **Test**: E2E codice e link; link prefetchato (richiesta GET senza click) che non consuma il token; codice errato/scaduto/riusato; doppio flusso su due dispositivi; rate limit **sulle email** (il limite per IP non esiste in locale: nessun test pretende un 429 sui tentativi OTP, §23.12).

### 23.5 Cancellazione account (punto 5)

**Inventario dei dati e rimozione**
| Dove | Cosa | Come viene rimosso | Verifica |
|---|---|---|---|
| `auth.users` (+ identità, sessioni, refresh token) | Account | `auth.admin.deleteUser(id, false)` (hard delete) | Utente assente |
| `public.*` con `owner_id` (profili, scadenze, regole, completamenti, avvisi, consegne, dispositivi push, documenti) | Dati applicativi | Cascata FK da `auth.users` | **Test meta pgTAP**: ogni tabella con `owner_id` ha FK `on delete cascade` verso `auth.users`; conteggio zero dopo la cancellazione |
| Storage `documents/{uid}/…` | File | **Prima** di `deleteUser`: rimozione del prefisso via Storage API (`service_role`, paginata finché vuoto). Supabase **blocca** la cancellazione di un utente che possiede oggetti in Storage (documentazione ufficiale) | Listing del prefisso vuoto |
| `storage_cleanup_queue`, `rate_limits` | Percorsi/chiavi con l'ID utente | Cancellazione esplicita nel passo finale | Nessuna riga |
| Token FCM | Registrazione dispositivo | Righe `push_devices` eliminate; `deleteToken()` lato app prima della richiesta | – |
| Provider email (Resend) | Log con destinatario | Retention minima/cancellazione via API **[V]** da verificare in M9/M11; dichiarato in privacy policy | Documentato |
| Sentry / log Supabase | Solo ID, nessuna email (scrubbing) | Retention del servizio (≤ 90 giorni) | Documentato |
| Backup Supabase | Copie complete | Scadono con la retention (da dichiarare, es. ~30 giorni **[V]**) | Policy + registro sotto |
| Dispositivo | Sessione e cache | Wipe locale al primo 401/logout | Test su dispositivo |

**Processo ripristinabile** (tabella `account_deletions(user_id uuid pk, requested_at, completed_at, status, last_error)`, solo `service_role`, **senza FK** e senza email)
1. Riautenticazione (password) + digitazione "ELIMINA"; offerta di export prima della cancellazione.
2. Riga `requested`; **blocco immediato** dell'utente (`ban`) e `signOut` globale.
3. Rimozione righe `push_devices`.
4. Rimozione del prefisso Storage.
5. `deleteUser` (cascata).
6. Verifica: nessuna riga residua in nessuna tabella, nessun oggetto Storage.
7. `completed`; pulizia di `rate_limits` e coda; email di conferma all'indirizzo letto al passo 1 (mantenuto solo in memoria).
8. Un cron ogni 15 minuti riprende le richieste `requested` rimaste a metà (la funzione è **idempotente**: ogni passo può essere ripetuto).
**Registro anti-ripristino**: `account_deletions` (solo UUID e date, nessun dato personale) è conservato per la durata dei backup; dopo un ripristino da backup lo script di restore **riapplica** le cancellazioni elencate.
- **Store**: Apple richiede cancellazione in-app (coperta); Google richiede anche un **URL web** → pagina pubblica `/account-deletion` (spiega i passi, link al login/Impostazioni, contatto privacy per chi non riesce ad accedere) **[V]**.
- **Test**: E2E (cancellazione completa, login impossibile dopo), pgTAP (meta test FK), Deno (interruzione dopo ogni passo e ripresa, nessun duplicato di email).

### 23.6 Offline in sola lettura (punto 6)

| Aspetto | Decisione |
|---|---|
| Dove | **Solo app native**. Il Web non persiste dati (solo memoria); PWA offline è P1 |
| Cosa viene salvato | Snapshot per utente: categorie di sistema; dal profilo solo `timezone`; scadenze (`id, title, due_date, amount_cents, category_id, status, completed_at, reminder_days, updated_at`); riepilogo ricorrenza (`unit, count`); **numero** di documenti per scadenza |
| Cosa NON viene salvato | Note, nome e contenuto dei documenti, URL firmati, avvisi, email, token, cronologia di ricerca |
| Formato e cifratura | JSON cifrato con **AES-GCM (WebCrypto)**; chiave a 256 bit generata al primo snapshot e conservata in `SecureStorage` (`cache.key.<userId>`); busta `{schemaVersion, userIdHash, fetchedAt, iv, ciphertext}` |
| Dove sta | `@capacitor/preferences`, chiave `cache.v1.<sha256(userId)>`; dimensione massima 1 MB (oltre: si tiene l'insieme più vicino a oggi, max 200 voci). Si sceglie Preferences invece di IndexedDB perché la WebView può svuotare IndexedDB **[V]**; perdere la cache è comunque innocuo |
| TTL | **Morbido 7 giorni**: banner "Dati di N giorni fa, potrebbero non essere aggiornati". **Duro 30 giorni**: la cache viene scartata. Offline si mostra sempre "Aggiornato il …" |
| Aggiornamento | Lo snapshot viene **sostituito per intero e in modo atomico** dopo ogni caricamento online riuscito della lista e dopo ogni scrittura riuscita (si invalida e si ricarica) |
| Invalidazione | Scadenza TTL duro; `schemaVersion` diverso (scartata, non migrata); `userIdHash` diverso (cambio utente: la cache precedente viene eliminata, non conservata); logout; cancellazione account; refresh token revocato/invalido; richiesta manuale "Svuota dati offline" nelle Impostazioni |
| Dopo il logout | Si elimina la chiave (**crypto-shredding**) e il blob, si azzerano gli store; nessun dato resta leggibile |
| Avvio a freddo senza rete | La sessione viene letta da `SecureStorage`; gli errori di rete **non** causano logout; si mostra la cache in sola lettura. Dashboard e stati sono ricalcolati **in locale** con data e fuso correnti (funzioni di `domain/`) |
| Scritture | Disabilitate offline con messaggio chiaro e pulsante "Riprova"; **nessuna coda di scrittura** in v1 |
| Dettaglio offline | Mostra i campi in cache; per note e documenti "Disponibili solo online" |
| Tap su una push offline | Apre l'elemento dalla cache se presente, altrimenti la dashboard con banner |
| Backup | `allowBackup=false` (Android); su iOS la cifratura rende inutile l'eventuale copia |
| Test | Cifratura/decifratura, TTL ai limiti (6 gg 23 h, 7 gg, 30 gg), cambio utente, `schemaVersion`, wipe al logout, dimensione massima, prova in modalità aereo su dispositivo |

### 23.7 Universal Links e Android App Links (punto 7)

- **Domini**: produzione `app.<dominio>`, staging `staging.<dominio>`; **ciascun host serve i propri file** `/.well-known/…`. Il sito/landing sull'apex non è coperto, così non si "rubano" le pagine pubbliche.
- **iOS**: `/.well-known/apple-app-site-association` **senza estensione**, `Content-Type: application/json`, risposta `200` diretta (nessun redirect, nessuna autenticazione), pubblico, ≤ 128 KB **[V]**; `appIDs`/`components` = `<TEAMID>.<bundleId>` con percorsi `/items/*` e `/auth/confirm`. Staging elenca solo il bundle staging. Apple consegna il file tramite il proprio CDN: le modifiche non sono immediate (per lo sviluppo `?mode=developer` **[V]**). Capability Associated Domains `applinks:<host>`.
- **Android**: `/.well-known/assetlinks.json` con `delegate_permission/common.handle_all_urls`, `package_name` e **SHA-256 del certificato di firma di Play App Signing** (da Play Console) **più** quello della upload key e, solo per staging/dev, quello di debug. Intent-filter con `android:autoVerify="true"`, schema `https`, host dell'ambiente, `pathPrefix` `/items` e `/auth/confirm`. Verifica con `adb shell pm get-app-links <package>` e Statement List Tester **[V]**.
- **Hosting**: regola esplicita che serve `/.well-known/*` come **file statici prima del fallback SPA** (un `index.html` restituito con 200 al posto del file è il guasto più comune), header corretti, nessun redirect `www`/apex su quei percorsi, nessun WAF o `robots.txt` che blocchi i crawler di Apple/Google. Job CI/monitor `well-known-check` che fa `curl -I` su staging.
- **Link nelle email**: URL HTTPS diretti `app.<dominio>/items/:id` e `/auth/confirm…`; **tracciamento di click/aperture disabilitato** sulle email transazionali (un redirect di tracking rompe i Universal Links) **[V]**.
- **Whitelist** (gestore `platform/native/deepLinks.ts`, ascolta `appUrlOpen` e l'URL di avvio a freddo): host uguale a quello dell'ambiente; percorsi ammessi: `^/items/<uuid>$`, `/items`, `/dashboard`, `/settings`, `/auth/confirm` (solo con `token_hash` e `type` ammessi); query ignorata altrove. Percorso sconosciuto → **apre `/dashboard`** e registra il caso (non ignora in silenzio). Non autenticato → `/login?redirect=<path>`.
- **Limiti noti** **[V]**: iOS non apre l'app se il link è nella stessa pagina dello stesso dominio o digitato nella barra di Safari; alcuni client di posta aprono i link in un browser interno. **Fallback**: sulla pagina web `/items/:id` un pulsante "Apri nell'app" usa lo schema personalizzato (`lifeadmin://` prod, `lifeadmin-staging://` staging) sottoposto alla stessa whitelist; mai token negli URL di schema.
- **App non installata**: il link apre il Web (login → redirect → elemento).
- **Notifiche push**: il payload contiene solo `path`, validato dalla stessa whitelist.
- **Matrice di prova**: Mail iOS, Gmail iOS/Android, Outlook, client Samsung, Safari/Chrome; app installata/non installata; avvio a freddo/in memoria; utente disconnesso → login → redirect.

### 23.8 Requisiti App Store / Google Play (punto 8)

Tutte le righe **[V]** vanno riverificate in M21 e a ogni release: le regole cambiano ogni anno. *Verificato (ott. 2026)* = confermato in questa sessione.

**Obbligatori**
| Requisito | Piattaforma | Note |
|---|---|---|
| Account Apple Developer / Play Console attivi, con verifica identità | iOS/Android | Costi e tempi **[V]**; Apple può richiedere D-U-N-S per organizzazioni |
| Build con Xcode 26 / SDK iOS 26 | iOS | *Verificato ott. 2026*; l'obbligo sale tipicamente ogni primavera **[V]** |
| Target API 36 per nuove app e aggiornamenti | Android | *Verificato ott. 2026* (estensione possibile fino al 1 novembre 2026) |
| AAB + Play App Signing | Android | **[V]** |
| URL privacy policy; privacy labels (Apple) / Data safety (Google) | entrambe | **[V]** |
| Cancellazione account in-app; Google anche URL web | entrambe | Apple *verificato ott. 2026*; Google **[V]** (§23.5) |
| Guideline 4.2 (non essere un sito reimpacchettato) | iOS | *Verificato ott. 2026*; presidi in §21.1 |
| Questionario età con le nuove domande (obbligatorio per invii dal settembre 2026) | iOS | Fonte secondaria **[V]** |
| **Dichiarazione "trader" DSA** (indirizzo, telefono, email mostrati pubblicamente) per distribuire nell'UE | iOS (e Google **[V]**) | Rilevante: lanciando in Italia con un'attività commerciale va dichiarata; valutare indirizzo/recapiti aziendali invece di personali **[V]** |
| Account demo e note per il revisore (l'app richiede login) | entrambe | **[V]** |
| Dichiarazione crittografia (solo HTTPS → esente) | iOS | **[V]** |
| Privacy manifest (`PrivacyInfo.xcprivacy`) per API "required reason" e SDK (Capacitor, Firebase) | iOS | In pratica obbligatorio per noi **[V]** |
| Dichiarazioni "App content" (pubblico, annunci, classificazione contenuti) | Android | **[V]** |
| Gestione edge-to-edge (conseguenza del target API 36) | Android | **[V]** |

**Condizionati**
| Requisito | Condizione |
|---|---|
| Test chiuso con ≥ 12 tester per 14 giorni consecutivi | Solo **account personale** Play (esenti le organizzazioni) — *verificato ott. 2026* |
| Sign in with Apple | Solo se si aggiunge un login con provider terzi **[V]** |
| Acquisto in-app (StoreKit / Play Billing) | Solo se si vendono abbonamenti digitali nell'app **[V]** |
| Capability Push / Associated Domains | Solo se si usano push e deep link (sì) |
| Stringhe d'uso fotocamera/foto; permesso fotocamera Android | Solo se si usa l'acquisizione diretta |
| `POST_NOTIFICATIONS` | Android 13+, se si usano push |
| D-U-N-S | Solo per account organizzazione Apple **[V]** |

**Best practice (non obbligatorie)**: TestFlight esterno prima della review; test interno/chiuso Play con *pre-launch report*; rollout graduale (Android) e rilascio a fasi (iOS); monitoraggio crash (Sentry, Android vitals); schede store localizzate e screenshot per tutte le dimensioni; etichette di accessibilità; audit delle privacy label a ogni nuovo SDK; risposta rapida al feedback di review.

### 23.9 CI iOS da Windows (punto 9)

**Principio**: Windows basta per Web e Android; **iOS si compila, firma e carica su runner macOS in CI**. Un Mac serve solo per debug interattivo.

| Attività | Serve macOS? | Quando | Come |
|---|---|---|---|
| Modifica di `ios/` (Info.plist, entitlements, config) come testo | No | M14+ | Editor su Windows, validazione in CI |
| `cap add ios` / `cap sync ios` | **[V]** probabilmente no (progetto SPM), altrimenti sì | M14 | Prova su Windows; in caso contrario nella prima "finestra Mac" o via workflow manuale |
| Compilazione per simulatore | Sì (runner) | Da M14, notturna | GitHub Actions macOS, Xcode 26 |
| Firma (certificati, profili) | **No Mac locale**: serve macOS *in CI* | M20 | Chiave API App Store Connect (`.p8`) + **fastlane `match`** (repo privato cifrato); workflow manuale una tantum `ios-bootstrap-signing` |
| Upload su TestFlight | Sì (runner) | M20 | `fastlane pilot` su tag `mobile-v*` |
| Simulatore, Safari Web Inspector sulla WKWebView, Instruments | **Sì, un Mac** | M15, M16, M18, M21 | "Finestre Mac" a ore (Mac cloud) o Mac mini usato |
| Prova su iPhone reale | No Mac (basta TestFlight) + un iPhone | M15+ | Build da CI installata via TestFlight |

- **Scelta [D]**: **GitHub Actions + fastlane** (un solo sistema di CI). **Alternativa [R]** se la firma risulta onerosa: **Codemagic** (firma gestita dalla chiave API, runner Mac M-series). Xcode Cloud scartato: la configurazione iniziale è meno adatta a un flusso da Windows **[V]**.
- **Costi**: i minuti macOS costano circa 10× quelli Linux (≈ 0,062 $/min nel gennaio 2026 **[V]**) → job iOS solo notturno, su tag e con filtri di percorso; cache di SPM/DerivedData.
- **Versione Xcode**: pin esplicito (etichetta runner e `xcode-select`); le immagini mantengono solo alcune versioni di Xcode **[V]**.
- **Secret** (solo da M20): `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_PASSWORD`, accesso al repo certificati.
- **Percorso critico**: l'iscrizione ad Apple Developer richiede giorni/settimane **[V]** e fornisce Team ID (AASA, M16) e chiave APNs (M18) → **avviarla entro M12**. Se bloccata: Web e Android procedono, iOS slitta senza modifiche all'architettura.

### 23.10 Compatibilità retroattiva (punto 10)

**Finestra di supporto [D]**: ogni versione mobile resta supportata per **almeno N-2 release e 90 giorni** dopo la successiva. Con rollout graduale convivono sempre N e N-1. **Ordine obbligato**: *expand* (migrazione additiva) → rilascio app → attesa finestra → *contract*.

**Contratto API versionato** (`docs/API_CONTRACT.md`, creato in M2, aggiornato a ogni milestone): tabelle e colonne lette/scritte dai client, firme RPC, richieste/risposte delle Edge Function, percorsi Storage, payload push (`path`), percorsi dei deep link, schema di `/app-config.json`, **grant per colonna e policy RLS** (anch'essi API).

**Regole**
1. Query client con **colonne esplicite** (mai `select *`).
2. RPC: mai cambiare la firma; nuove versioni come `<nome>_v2`; nuovi parametri con default.
3. Edge Function: risposte solo additive; i client **ignorano campi sconosciuti** (schemi non-strict) e **valori enum sconosciuti** (fallback).
4. Enum solo additivi. Esempio reale: in M18 si aggiunge `'push'` a `notification_channel`; le versioni precedenti che elencano gli avvisi di una scadenza non devono rompersi → già dal M9 il client mostra un'etichetta generica per i canali non riconosciuti.
5. Nuove colonne `NOT NULL` solo con default; nessun `DROP`/`RENAME`/cambio di tipo nella fase *expand*.
6. **CI**: lint delle migrazioni (strumento tipo `squawk` **[V]** o controllo proprio) che fallisce su `DROP COLUMN/TABLE`, `RENAME`, `ALTER COLUMN TYPE`, rimozione di valori enum e restrizioni di grant/policy, salvo etichetta `contract:` approvata; **suite di contratto "client N-1"** con fixture di richieste/risposte registrate per ogni release mobile pubblicata, rieseguite sulle migrazioni correnti (pgTAP + Deno).
7. **Deep link e push**: il server emette solo percorsi supportati da `minAppVersion` (`/items/:id` è stabile per sempre); percorso sconosciuto lato client → `/dashboard` (§23.7).
8. **Rollback**: migrazioni solo *forward* (correzione con nuova migrazione); Edge Function ridistribuite da tag precedente; app: stop del rollout Android / pausa del rilascio a fasi iOS **[V]**.
9. **Header di versione**: tutte le chiamate Supabase inviano `x-app-version` e `x-app-platform` (client factory di M2) → i log API permettono di misurare l'adozione per versione **[V]** e di decidere quando fare *contract*.
10. **Dominio backend stabile**: le app installate contengono l'URL Supabase; cambiare progetto/URL romperebbe tutte le installazioni. → valutare prima di M13 un **dominio personalizzato per l'API** (`api.<dominio>`, funzione a pagamento **[V]**) e non migrare mai il progetto di produzione senza questa indirezione.

**`/app-config.json`** (servito da `https://<host-ambiente>/app-config.json`, un file per ambiente)
```json
{
  "schema": 1,
  "minAppVersion":         { "ios": "1.0.0", "android": "1.0.0" },
  "recommendedAppVersion": { "ios": "1.0.0", "android": "1.0.0" },
  "blockedVersions":       { "ios": [], "android": [] },
  "storeUrls":             { "ios": "<url>", "android": "<url>" },
  "message":               { "it": "" },
  "maintenance":           { "active": false, "message": "" }
}
```
- **Client** (da M14, presente **nella primissima release**): lettura all'avvio a freddo e al *resume* (al massimo ogni 6 h), `fetch` con `cache: 'no-store'` e timeout 3 s; **fail-open**: errore di rete/parse → si continua con l'ultima copia valida salvata in `Preferences`. Confronto semver. Versione `< minAppVersion` o in `blockedVersions` → schermata bloccante con link allo store; `< recommendedAppVersion` → banner chiudibile (al massimo ogni 7 giorni); `maintenance.active` → solo banner (le letture restano possibili). `schema` sconosciuto → ignorato.
- **Hosting**: `Cache-Control: no-cache`; **header CORS `Access-Control-Allow-Origin: *`** (file pubblico senza segreti), perché l'origine delle app native è `capacitor://localhost` / `https://localhost`.
- **Governance**: `minAppVersion` non supera mai l'ultima versione pubblicata **al 100%**; si alza solo dopo adozione ≥ 90% **[R]** della versione corrente e dopo la finestra di supporto; ogni modifica passa da PR e da un test di validazione dello schema in CI.

### 23.11 Esito dell'Architecture Gate

**Architecture Gate: PASS** — *dopo l'applicazione delle correzioni di questa versione 0.3.*

Prima delle correzioni l'esito sarebbe stato **BLOCKED** per tre motivi, tutti riguardanti M1–M3, e per due lacune che avrebbero imposto rifacimenti:
1. TypeScript 7 (`latest`) incompatibile con `typescript-eslint` → pin a 6.0.x.
2. `vee-validate` incompatibile con zod 4 → `@tanstack/vue-form` (v0.5: sostituito da un composable proprio su zod, §23.12).
3. Minimi nativi (iOS 15, WebView 60) incompatibili con Vite 8/Tailwind 4 → iOS 16.4, WebView 111.
4. `app-config.json` previsto troppo tardi: una prima release senza il controllo non può più essere forzata ad aggiornarsi → spostato a M14.
5. Cancellazione account non ripristinabile e senza registro anti-ripristino → processo e tabella `account_deletions` (M11).

**Nessun blocco residuo prima di M1.** Restano elementi **DA VERIFICARE** programmati, non bloccanti per M1:
| Elemento | Quando | Come |
|---|---|---|
| Standard Schema di TanStack Form con zod 4 | Inizio M3 | **Eseguito (v0.5)**: compatibile; non adottato, si usa un composable proprio (§23.12) |
| `type` di `verifyOtp` per la conferma registrazione, limiti di rate/SMTP | M3 | Lettura docs correnti e prova locale |
| Plugin secure storage su Keychain/Keystore reali | M16 | Prova su dispositivi |
| AASA/assetlinks, apertura dei link da client di posta | M16 | Matrice di prova §23.7 |
| Push iOS/Android reali, canale Android, TTL | M18 | Dispositivi reali |
| `cap add ios` da Windows | M14 | Prova; altrimenti finestra Mac |
| Requisiti store contrassegnati **[V]** (DSA trader, età, privacy manifest, costi) | M21 | Riverifica sulle fonti ufficiali |
| Dominio API personalizzato | Prima di M13 | Valutazione costi/benefici |
| Iscrizione Apple Developer | Entro M12 | Azione esterna da concordare |

Fonti consultate: [Vite – build options](https://vite.dev/config/build-options), [Tailwind – compatibilità browser](https://tailwindcss.com/docs/compatibility), [Capacitor – configurazione](https://capacitorjs.com/docs/config), [Capacitor 8 – aggiornamento](https://capacitorjs.com/docs/updating/8-0), [Supabase – rate limit Auth](https://supabase.com/docs/guides/auth/rate-limits), [Supabase – template email](https://www.supabase.com/docs/guides/auth/auth-email-templates), [Supabase – gestione utenti](https://supabase.com/docs/guides/auth/auth-user-management), [Firebase – codici di errore FCM](https://firebase.google.com/docs/cloud-messaging/error-codes), [Firebase – gestione token](https://firebase.google.com/docs/cloud-messaging/manage-tokens), [Apple – DSA trader](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-eu-digital-services-act-compliance-information), [Google Play – test chiuso](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB), [Android – target API](https://developer.android.com/google/play/requirements/target-sdk), [Apple – requisiti SDK](https://www.developer.apple.com/news/upcoming-requirements/).

### 23.12 Autenticazione M3 (v0.5): stato della verifica, pre-hijacking, form, sessione, rischi e gate beta

**Come leggere questa sezione.** **[L]** = osservato in spike su uno stack Supabase locale temporaneo (CLI 2.120, GoTrue incluso, OTP a 8 cifre, conferma email attiva, template e Mailpit); **[S]** = da verificare in staging su Supabase in hosting; **[B]** = condizione obbligatoria prima della beta. **Nulla di quanto segue è ancora implementato nel repository**: gli spike erano script temporanei fuori dal repository e lo stack di spike è stato eliminato.

#### A. Pre-hijacking degli account non confermati

**Attacco (riprodotto senza mitigazioni) [L].** Se esiste già un account non confermato per l'email, GoTrue **non sovrascrive la password** alla registrazione successiva e invia un nuovo codice (il precedente viene invalidato).

| Variante | Scenario | Esito senza mitigazione |
|---|---|---|
| **V1** | L'attaccante registra l'email della vittima con la password A; la vittima si registra dopo (la sua password è ignorata) e conferma con l'ultimo codice | Login con A **riesce**; quello della vittima no |
| **V2** | L'attaccante registra l'email; la vittima clicca il link dell'email non richiesta | Login con A **riesce** |
| **V3** | L'attaccante prova il login con A in continuo mentre la vittima conferma | L'attaccante ottiene una sessione **durante** la conferma |
| **V4** | L'attaccante registra l'email con la password A; la vittima non si registra ma usa "Password dimenticata" e completa il **recovery su un account non confermato** (il recovery conferma l'email) | Login con A **riesce** prima che la vittima scelga la password |

**Soluzione adottata** (approvata come direzione, **condizionata alla verifica in staging [S][B]**):

1. `/register` (email, nome opzionale, consenso): il client chiama `signUp` con una **password casuale monouso** di 64 caratteri (≤ 72 byte, mai mostrata né salvata) e `privacy_version` nei metadata.
2. Conferma con codice a 8 cifre o link (`verifyOtp`): nell'UPDATE di conferma un trigger `BEFORE UPDATE` su `auth.users` imposta `encrypted_password = NULL` quando `OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL AND OLD.confirmation_sent_at IS NOT NULL`.
3. Un trigger `AFTER UPDATE` imposta `profiles.password_setup_pending = true` quando la password passa da valorizzata a NULL.
4. L'app porta l'utente a `/set-password` con la sessione appena ottenuta (e, a ogni avvio con sessione, finché il flag server è `true`): `updateUser({ password })`; il flag torna `false` quando la password è valorizzata; poi `signOut({ scope: 'others' })`.
5. Il recovery resta invariato e copre anche gli account non confermati.

**Perché il trigger intercetta V1, V2, V3 e V4 [L].** Con un trigger di audit temporaneo sono stati registrati gli UPDATE di GoTrue su `auth.users` per ogni scenario. La conferma dell'email passa da un unico UPDATE in cui `email_confirmed_at` passa da `NULL` a un valore e `confirmation_sent_at` è già valorizzato (la conferma viene emessa dopo l'INSERT). Ogni via che conferma l'email (codice, link, recovery su account non confermato) attraversa quell'UPDATE. La password dell'attaccante è nella riga dalla creazione e il `BEFORE UPDATE` la rimuove **nello stesso UPDATE**, prima che esista una sessione per l'account: lo stato "confermato con una password nota ad altri" non esiste mai. Quindi V1 (la vittima conferma), V2 (link non richiesto), V3 (polling: nessuna finestra) e V4 (il recovery su account non confermato passa dallo stesso UPDATE) sono chiusi. Prima della conferma il login è impossibile (`email_not_confirmed`), quindi non esistono sessioni preesistenti. Con la mitigazione attiva il login dell'attaccante dà `invalid_credentials` e la vittima imposta la propria password e accede.

**Perché non azzera la password di altri utenti [L]**

| Caso | Cosa fa GoTrue (audit) | Azzeramento |
|---|---|---|
| Utente creato da amministratore con `email_confirm: true` | `INSERT`, poi `UPDATE email_confirmed_at` con `confirmation_sent_at` **NULL** (nessuna email di conferma emessa) | **No** (condizione falsa); login con password riuscito |
| Utente già confermato: login, metadati, cambio password, richiesta reset, cambio email | Aggiornamenti con `email_confirmed_at` già valorizzato | **No**; login con password riuscito |
| Conferma amministrativa di un utente registrato con `signUp` | UPDATE con `confirmation_sent_at` valorizzato | **Sì (atteso)**: password da reimpostare col recovery |
| Recovery su un account non confermato | Conferma l'email e crea la sessione | **Sì**, poi si imposta la nuova password |

L'esclusione degli utenti creati dall'amministratore dipende dal fatto che GoTrue non emette per loro l'email di conferma: assunzione verificata in locale e coperta da test di regressione.

**Come la nuova password è impostata solo da una sessione legittima [L]**

- Dopo l'azzeramento l'account non ha password: il login con password dà `invalid_credentials` (nessun errore 500).
- `updateUser({ password })` senza sessione è rifiutato.
- Le uniche sessioni ottenibili sono quella restituita da `verifyOtp` a chi presenta codice o link (possesso della casella email) e quella del recovery.
- Dopo la scelta della password si esegue `signOut({ scope: 'others' })`.
- **Limite**: chi indovina l'OTP ottiene la sessione; dipende dal rate limit (**[B]**, sezione D).

**Chi chiude la pagina dopo la conferma e riprende dopo [L]**

- Una bandiera nei `raw_user_meta_data` scritta dal trigger `BEFORE` **non sopravvive**: GoTrue riscrive i metadata nell'UPDATE successivo (assente nel database, nella risposta di `verifyOtp` e in `getUser`). Soluzione scartata, con evidenza.
- Soluzione adottata: colonna `profiles.password_setup_pending`, stato **del server**. Osservato: la sessione persistita viene ripristinata dopo chiusura della scheda e riavvio (anche con access token scaduto e refresh token valido); lo stato applicativo in memoria va perso; il flag letto dal server resta `true`; `updateUser({ password })` dalla sessione ripristinata riesce e il flag torna `false`.
- **Link su un altro dispositivo**: il dispositivo B ottiene la sessione e vede il flag `true`; il dispositivo A, che ha registrato, non ha sessione; lo stesso codice su A dopo l'uso del link dà `otp_expired`; dopo la scelta della password su B, A accede con la nuova password.
- **Sessione persa** (storage vuoto): il login con password fallisce, `updateUser` senza sessione dà `AuthSessionMissing`; "Password dimenticata" invia il recovery anche per l'account confermato senza password, la verifica dà la sessione, il flag resta `true` fino alla scelta e poi diventa `false`. Una copia della vecchia sessione risulta revocata (`refresh_token_not_found`) dopo `signOut({ scope: 'others' })`.
- La colonna non è scrivibile dal client (`42501`) e non è leggibile da `anon`; ogni utente vede solo la propria riga. **Nota**: negli spike la colonna aveva anche un `GRANT SELECT` di colonna; la lettura deriva in ogni caso dal grant di tabella di M2 e l'utilità del grant di colonna non è stata verificata (§20, punto 2 della migration).

**Atomicità, privilegi e sessioni (spike finali) [L]**

- **Fail-closed**: se il trigger `AFTER` fallisce, `verifyOtp` dà HTTP 500 (`Error confirming user`), l'account resta non confermato con password invariata e flag `false`; dopo il ripristino **lo stesso codice** riesce e porta a conferma, password NULL e flag `true`. Un guasto del trigger blocca quindi le conferme invece di lasciare account senza flag: in staging va monitorato l'errore `Error confirming user` **[S]**. Il solo test di rollback con transazione annullata ha confermato lo stato finale (conferma NULL, password intatta, flag `false`) ma **non** dimostra lo stato intermedio: l'atomicità interna è provata dal caso fail-closed.
- **Password rifiutata** (`weak_password`): flag invariato; con password valida il flag diventa `false` e il login riesce.
- **Profilo mancante**: se il profilo è stato cancellato a mano, la conferma passa, la password è NULL e il flag non può essere impostato (`UPDATE` su 0 righe, nessun errore). **Limite reale del trigger.** Con M2 il caso non dovrebbe esistere (profilo creato atomicamente con l'utente, nessuna cancellazione per il client): l'invariante va protetta da un test (§20), senza scambiare l'assenza del profilo per un flusso riuscito.
- **Privilegi**: `EXECUTE` è concesso a `PUBLIC` di default; lo schema `private` non ha `USAGE` per `anon` e `authenticated`, quindi le funzioni non sono raggiungibili da PostgREST. La migration revoca comunque `EXECUTE` da `PUBLIC` su entrambe le funzioni. **Misurato**: privilegi di default e funzionamento dei trigger **senza** la revoca. **Verificato in locale** dopo l'implementazione: il funzionamento con la revoca applicata (test di integrazione (j) di §20, con GoTrue reale). **Da verificare in staging [S].** Le funzioni di M2 in `private` non hanno `REVOKE EXECUTE`.
- **Sessioni**: in locale GoTrue revoca le altre sessioni quando cambia la password (le sessioni passano da 2 a 1 e il refresh token dell'altra sessione dà 400). È un comportamento **della versione locale**, non una garanzia: è coperto da un test esplicito e `signOut({ scope: 'others' })` resta come difesa aggiuntiva. Prima della conferma non esiste alcuna sessione, quindi non ce ne sono da revocare al momento del wipe.

**Trigger di M2 e creazione atomica di utente, profilo e consenso**

- M2: `on_auth_user_created` (**AFTER INSERT**) → `private.handle_new_user` → `private.create_profile_for_user`: se `privacy_version` manca o non è supportata l'INSERT dell'utente fallisce (rollback atomico).
- M3 aggiunge due trigger **separati** su `auth.users` (`BEFORE UPDATE` per il wipe, `AFTER UPDATE` per il flag), con funzioni proprie, che non scattano sull'INSERT. **Trigger e funzioni di M2 non vengono modificati**; `profiles` riceve solo una colonna additiva. La password casuale monouso non tocca i metadata, quindi il consenso privacy resta invariato.
- Test: i test di consenso esistenti (pgTAP e integrazione) restano verdi; un nuovo test pgTAP verifica che esistano tutti i trigger con evento e momento corretti (M2: AFTER INSERT; M3: BEFORE UPDATE e AFTER UPDATE).

**Compatibilità con aggiornamenti di GoTrue e Supabase (rischi)**

1. GoTrue potrebbe cambiare le colonne aggiornate alla conferma (ad esempio azzerare `confirmation_sent_at` prima) o non usare più `UPDATE auth.users`: la protezione cadrebbe **in silenzio**.
2. Nuovi percorsi di conferma (telefono, provider esterni) non sono coperti.
3. Gli aggiornamenti dello schema `auth` gestiti da Supabase potrebbero alterare trigger personalizzati.

Mitigazioni: test di integrazione che riproducono V1, V2, V3 e V4 in CI con versione della CLI pinnata e **falliscono se la protezione sparisce**; riesecuzione a ogni aggiornamento di `supabase`; in staging, smoke periodico che ripete l'attacco **[S]**.

**Verifica in hosting e alternativa**

- **[S][B]** In staging: (i) il trigger `BEFORE UPDATE` su `auth.users` è creabile con la migration e resta attivo dopo gli aggiornamenti della piattaforma; (ii) V1, V2, V3 e V4 danno lo stesso esito che in locale. Il solo test locale **non** basta a dichiarare la compatibilità con l'hosting. In staging va verificato anche il trigger `AFTER UPDATE` (installabile, `SECURITY DEFINER` con scrittura su `public.profiles`) e il comportamento fail-closed. **La beta resta bloccata finché questa verifica non è eseguita e documentata.**
- **Inviti amministrativi, provider esterni, telefono**: **fuori perimetro M3**. `inviteUserByEmail` crea l'utente con `encrypted_password` a stringa vuota (non NULL) e `confirmation_sent_at` valorizzato; l'accettazione dell'invito e il linking OAuth su un'email non confermata **non sono stati provati** e il trigger non li copre per costruzione: vanno rivalutati prima di introdurli.
- **Alternativa** se il trigger non è utilizzabile o affidabile: **Edge Function di registrazione** con `service_role` e `enable_signup = false` (la `signUp` diretta con chiave pubblica non è più possibile), creazione utente senza password con API di amministrazione, invio OTP con SMTP e template propri, rate limit proprio. Costi: Edge Function anticipate (da M9), gestione dei segreti, più superficie di attacco. **Non implementata; decisione da prendere prima della beta.**
- **Alternative scartate dopo gli spike [L]**: registrazione con `signInWithOtp` (non impedisce la `signUp` diretta dell'attaccante; per email già confermate invia un link di accesso); solo passo di scelta password lato client (non copre pagina chiusa, link su altro dispositivo né la finestra V3); cancellazione periodica degli account non confermati (riduce la finestra, non la chiude); hook `before_user_created` (agisce solo alla creazione).

#### B. Composable di form `useZodForm` (al posto di `@tanstack/vue-form`)

- **Contratto**: riceve uno schema zod; espone valori reattivi, errori per campo, `touched`, `field(name)` con `id`, `name`, `aria-invalid`, `aria-describedby` (verso un elemento `role="alert"`), `onInput`, `onBlur`, e `handleSubmit(cb)` che valida tutto, **mette il focus sul primo campo non valido**, passa a `cb` i dati **normalizzati** da `schema.parse` (trim, minuscole), impedisce il doppio invio e imposta `submitting`/`aria-busy`; più `setFieldError` e `setFormError` per gli errori del server.
- **Verifica**: `@tanstack/form-core` accetta lo schema zod 4 ma **non applica le trasformazioni** (serve comunque `schema.parse`) [L]; per 5 form piccoli non è indispensabile. Si rivaluta in M5 con il form delle scadenze. L'adeguatezza del composable (focus, trasformazioni, doppio invio, axe in jsdom) è **criterio di accettazione di M3** e sarà verificata dai test unitari e dagli e2e con `@axe-core/playwright` (il contrasto non è calcolabile in jsdom).

#### C. Inizializzazione e ripristino della sessione

- Il costruttore di `GoTrueClient` avvia `initialize()` da solo; l'opzione `skipAutoInitialize` è raggiungibile da `createClient`; `initialize()` è idempotente; `getSession()` attende l'inizializzazione; `onAuthStateChange` emette `INITIAL_SESSION` per ogni sottoscrizione, anche tardiva [L]. L'ordine degli eventi **non è fisso**: lo store deve essere idempotente e considerare `ready` il primo `INITIAL_SESSION`.
- Refresh token invalido → `SIGNED_OUT` e storage ripulito; **JSON corrotto nello storage → il valore resta** (serve `sanitizeStoredSession`) [L].
- **Avvio offline con access token scaduto**: l'inizializzazione termina con `INITIAL_SESSION(null)` pur conservando la sessione nello storage e **quell'istanza di client resta bloccata** anche quando la rete torna; un client nuovo sullo stesso storage la recupera. Con inizializzazione differita (`deferInitialization`, additiva, default invariato) e `initialize()` chiamato solo con rete presente: un solo refresh, nessun blocco [L].
- `useSupabase()` dentro uno store Pinia funziona fuori dai componenti solo se `app.use(pinia)` è stato chiamato; funziona in `app.runWithContext` [L].
- **Sequenza di avvio decisa**: (1) env, piattaforma, `sanitizeStoredSession`, client con `deferInitialization`; (2) `createApp`, `provide` di platform e client, `app.use(pinia)`; (3) store creato in `app.runWithContext` (una sola sottoscrizione a `onAuthStateChange`); (4) se online `initialize()`, altrimenti attesa dell'evento "online"; (5) l'app si monta subito e mostra la schermata di caricamento finché `auth.ready` è falso; (6) la guardia del router attende `auth.ready`; (7) `ready` al primo `INITIAL_SESSION`; (8) se l'inizializzazione fallisce con rete presente (client bloccato) la UI mostra "Impossibile verificare la sessione: ricarica la pagina". **Nessun `reload()` in `AppLifecycle` in M3.**
- **Logout**: `signOut({ scope: 'local' })` offline restituisce un errore di rete ma rimuove la sessione locale ed emette `SIGNED_OUT`; con un refresh in volo il risultato finale è storage vuoto (lo store usa `signingOut` per lo stato transitorio); più `getSession()` paralleli con token scaduto producono un solo refresh [L]. **Limite**: dopo un logout offline la sessione resta valida sul server.

#### D. Rischi residui e gate

| Rischio | Evidenza | Mitigazione in M3 | Residuo | In M3 | Gate prima della beta |
|---|---|---|---|---|---|
| **Enumerazione delle email** | Signup su email confermata → 422 `user_already_exists`; login e reset hanno tempi di risposta diversi [L] | Messaggi e schermate neutri nella UI. **Questo non elimina l'enumerazione tramite API diretta** | L'API distingue i casi per stato e tempo | **Accettabile, documentato** | **[B]** Rate limit e CAPTCHA su registrazione, login, reset; decidere se tollerare il 422 o usare la Edge Function |
| **Logout offline** | Sessione server ancora valida [L] | Storage locale sempre ripulito; la UI segnala la mancata revoca | Refresh token copiato valido fino alla scadenza | **Accettabile, documentato** | "Esci da tutti i dispositivi" (M11), consigliato, non bloccante |
| **Rate limiting OTP e login** | In locale non c'è limite per IP: centinaia di tentativi errati senza 429 (~430 richieste/s) [L] | OTP a 8 cifre, scadenza 600 s, trigger anti pre-hijacking, test di caratterizzazione | Brute force non limitato in locale | Accettabile **solo in locale** | **[B] Verificare in hosting il rate limit su OTP e login (prova che ottenga 429)** |
| **Lunghezza OTP effettiva** | `otp_length = 8` verificato in locale [L] | Costante unica nell'app | In hosting potrebbe essere diversa | – | **[B] Verificare in hosting la lunghezza OTP** |
| **Anti-abuso (registrazione, login, recupero)** | Nessun CAPTCHA in locale | Nessuno in M3 | Tentativi automatizzati | Accettabile solo in locale | **[B] Protezione anti-abuso incluso CAPTCHA (Turnstile)** |
| **Trigger anti pre-hijacking in hosting** | Verificato solo in locale [L] | Test di regressione V1–V4 in CI | Trigger non creabile/affidabile in hosting | – | **[B][S] Verifica in staging oppure alternativa Edge Function** |

**Condizioni bloccanti prima della beta ([B])**: (1) rate limiting effettivo su OTP e login verificato in hosting; (2) lunghezza OTP configurata in hosting; (3) protezioni anti-abuso (CAPTCHA) per registrazione, login e recupero; (4) **entrambi i trigger** (`BEFORE UPDATE` e `AFTER UPDATE` su `auth.users`) verificati in staging, inclusi la **persistenza del flag** `password_setup_pending` (chiusura scheda, riavvio, altro dispositivo), il comportamento **fail-closed** (§23.12 A) e il funzionamento con `REVOKE EXECUTE … FROM PUBLIC` applicato, **oppure** alternativa architetturale attivata; la **revoca delle sessioni** al cambio password non va considerata garantita in hosting senza verifica (resta `signOut({ scope: 'others' })`). Impostazioni di produzione da replicare e verificare: `max_frequency` 60 s, `otp_expiry` 600, `otp_length` 8, password minima 10.

#### E. Prospetto di stato per comportamento

Stato **dopo l'implementazione della migration**: i test elencati sono stati scritti ed eseguiti **solo in locale** (pgTAP `50_auth_prehijack.test.sql`: 76 test; integrazione `auth-prehijack.int.test.ts`: 18 test con Supabase Auth, Mailpit e PostgREST reali; verifica a mutazione `pnpm test:auth-guard-mutations`: 12 mutazioni su 12 rilevate). **Nessuna verifica è stata eseguita su Supabase hosted**: la colonna "Verifica hosted" resta tutta aperta. Le colonne "Evidenza negli spike" restano come documentazione storica degli spike manuali.

| Comportamento | Evidenza negli spike locali [L] | Test automatico | Verifica hosted |
|---|---|---|---|
| Azzeramento password alla prima conferma (V1–V4) | Osservato, con mutazioni (nessun trigger, condizione invertita, mai vera, troppo larga) | Implementato ed eseguito in locale (§20 (a), (i)) | **[S][B]** |
| Admin-created, utenti confermati ed email change non azzerati | Osservato | Implementato ed eseguito in locale (regressione, §20) | **[S]** |
| Flag `true` dopo la conferma e `false` dopo la scelta; persistenza (chiusura scheda, riavvio, access token scaduto, altro dispositivo, sessione persa con recovery) | Osservato | Implementato ed eseguito in locale (§20 (b), criterio 14) | **[S][B]** persistenza del flag |
| Conferma fail-closed se il trigger `AFTER` fallisce; codice riutilizzabile dopo il ripristino | Osservato (caso fail-closed); il rollback ha confermato solo lo stato finale | Implementato ed eseguito in locale (§20 (c), criterio 16) | **[S][B]** |
| Password rifiutata (`weak_password`) lascia il flag invariato | Osservato | Implementato ed eseguito in locale (§20 (d)) | – |
| Profilo mancante: flag non impostabile, nessun errore | Osservato (limite del trigger) | Implementato ed eseguito in locale: deve far fallire il flusso (§20 (e), criterio 18) | – |
| Flag non scrivibile dal client, `anon` senza accesso, solo propria riga | Osservato (con grant di colonna aggiuntivo) | Implementato ed eseguito in locale (§20 (f), criterio 15) | **[S]** grant effettivi |
| `REVOKE EXECUTE … FROM PUBLIC` e funzionamento dei trigger con la revoca | Spike: privilegi di default misurati, trigger provati solo senza revoca. **Ora misurato in locale** dal test di integrazione (j): con la revoca applicata, `supabase_auth_admin` (il ruolo con cui GoTrue esegue l'UPDATE) non ha né `EXECUTE` né `USAGE` su `private` e i due trigger scattano comunque (wipe e flag verificati con GoTrue reale). Non riproducibile in pgTAP (`postgres` non può assumere quel ruolo) | Implementato ed eseguito in locale (§20 (g), (j)) | **[S][B]** in hosting |
| Revoca delle altre sessioni al cambio password | Osservato in locale; **dipende dalla versione di GoTrue** | Implementato ed eseguito in locale (§20 (h), criterio 19) | **[S][B]** non garantita senza verifica |
| Rate limiting OTP e login, lunghezza OTP, CAPTCHA | Assente in locale (nessun 429); `otp_length = 8` verificato in locale | Nessun test pretende un 429 in locale | **[B]** |
| Inviti amministrativi, provider esterni, telefono | Non provati (inviti: solo creazione) | Nessuno | Fuori perimetro M3 |
