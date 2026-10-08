# LifeAdmin — Specifica Tecnica e di Prodotto (MVP v1)

Stato: **approvata, aggiornata con il requisito multipiattaforma** · Versione 0.2 · Data 2026-10-08
Questo documento è il riferimento per tutto lo sviluppo. Se il codice diverge, si aggiorna prima la specifica.

**Changelog v0.2**: LifeAdmin è un prodotto **Web + iOS + Android** con una sola codebase Vue 3 + TypeScript distribuita sulle app native tramite **Capacitor**. Modificate le sezioni 1, 2 (F1/F2), 3, 4, 14, 15, 16, 17, 18, 20, 21; aggiunta la sezione **22 — Mobile & Store Distribution**. Le sezioni 5, 6 e 11 restano valide e vengono estese in 22.5.

Convenzioni: **[D]** decisione presa · **[I]** ipotesi da validare · **[V]** da verificare con fonte ufficiale prima di implementare.
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

---

## 1. Product Specification

**Cos'è.** LifeAdmin è un prodotto **multipiattaforma, distribuito su Web, iOS (App Store) e Android (Google Play)**, che raccoglie in un posto solo le scadenze amministrative della vita personale, con importo, note e documento allegato, e avvisa via email e, sulle app, con notifiche push in tempo utile.

**Piattaforme e principio di prodotto.** *Stesso prodotto, esperienza nativa per piattaforma*: si condivide tutta la logica (dominio, validazioni, autenticazione, API, database, notifiche, documenti), **non** il layout. Una sola codebase Vue 3 + TypeScript; il Web è la SPA in browser, iOS e Android sono la stessa app impacchettata con **Capacitor** (WebView nativa + plugin nativi), con una **shell di navigazione e componenti touch dedicati** (§4, §22). Un solo backend Supabase per tutte e tre le piattaforme.

| Capacità | Web | iOS | Android |
|---|---|---|---|
| Account, login, Life Item, ricorrenze, dashboard, template | Identici (codice condiviso) | Identici | Identici |
| Navigazione | Sidebar (desktop) / tab bar (schermi piccoli) | Tab bar nativa-like, gesti, safe area | Tab bar, tasto Indietro di sistema |
| Conferma email e reset password | Codice a 6 cifre **o** link | Codice a 6 cifre (+ Universal Link) | Codice a 6 cifre (+ App Link) |
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
| 1 | Registrazione | Email + password + accettazione Privacy/Termini | Account creato, email di conferma inviata |
| 2 | Conferma email | Inserimento del **codice a 6 cifre** ricevuto (o click sul link) → sessione attiva; funziona in modo identico su Web, iOS e Android | `email_confirmed_at` valorizzato |
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
- **Comportamento**: form `/register`; invio → Supabase Auth `signUp` → redirect a `/verify-email`, che chiede il **codice a 6 cifre** inviato per email (`verifyOtp`, tipo `signup`). L'email contiene codice **e** link; il codice è il flusso primario perché non dipende da deep link (funziona uguale su Web, iOS e Android anche se l'email si apre in un'altra app).
- **Input**: email, password (≥ 10 caratteri, max 72), checkbox obbligatoria "Accetto Termini e Privacy" (link). Nome opzionale (display name).
- **Output**: utente in `auth.users`, riga `profiles` creata da trigger con `privacy_accepted_at`, `privacy_version`. Email di conferma.
- **Regole**: email normalizzata (trim, lowercase); conferma email obbligatoria prima del login; messaggio **neutro** se l'email esiste già ("Se l'indirizzo è valido riceverai una email") per non rivelare l'esistenza di account; CAPTCHA (Turnstile) prima della beta.
- **Edge case**: email già registrata; link di conferma scaduto/già usato → `/verify-email` con "Invia di nuovo" (cooldown 60 s); password comune/breve; doppio click sul submit.
- **Loading**: pulsante in stato "Creazione in corso…". **Vuoto**: n/a. **Errore**: validazione inline per campo; errore rete/rate limit → banner "Troppi tentativi, riprova tra qualche minuto".
- **Autorizzazioni**: solo ospiti (utente loggato → redirect `/dashboard`).

### F2 — Login, logout, recupero password
- **Comportamento**: `/login` (email+password), `/forgot-password` (invio codice+link), `/reset-password` (codice a 6 cifre → `verifyOtp` tipo `recovery` → nuova password; in alternativa il link), logout dal menu utente. Sulle app il logout elimina anche il token push del dispositivo (§22.5).
- **Regole**: errore generico "Email o password non corretti"; `redirect` query param ammesso **solo** per path interni (whitelist, no URL assoluti); sessione persistente con refresh token; logout invalida la sessione locale.
- **Edge case**: email non confermata → messaggio con "Invia di nuovo"; link reset scaduto → torna a `/forgot-password`; sessione scaduta durante l'uso → redirect a login preservando la destinazione.
- **Loading/Errore**: come F1.
- **Autorizzazioni**: `/login`, `/forgot-password`: ospiti; `/reset-password`: sessione di recovery.

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
| `/` | Redirect a `/dashboard` o `/login` | – | – | sessione |
| `/login` | Accesso | guestOnly | `AuthCard`, `LoginForm` | – |
| `/register` | Registrazione | guestOnly | `AuthCard`, `RegisterForm`, `ConsentCheckbox` | versione policy |
| `/verify-email` | Istruzioni + reinvio email | pubblica | `AuthCard`, `ResendEmailButton` | email (query/stato) |
| `/forgot-password` | Richiesta reset | guestOnly | `ForgotPasswordForm` | – |
| `/reset-password` | Nuova password | sessione recovery | `ResetPasswordForm` | – |
| `/auth/callback` | Scambio codice Supabase (conferma/recovery) | pubblica | spinner | query params |
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

### Tipi enum
`item_status ('active','completed')` · `recurrence_unit ('day','week','month','year')` · `notification_status ('pending','processing','sent','failed','skipped','cancelled')` · `notification_channel ('email')` (estendibile a `push`).

### `profiles` (1:1 con `auth.users`)
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | – | **PK**, **FK → auth.users(id) on delete cascade** |
| display_name | text | sì | – | check `char_length ≤ 80` |
| timezone | text | no | `'Europe/Rome'` | check: esiste in `pg_timezone_names` (via funzione) |
| locale | text | no | `'it'` | check `in ('it')` (estendibile) |
| email_notifications_enabled | boolean | no | `true` | |
| notification_hour | smallint | no | `9` | check `between 0 and 23` |
| onboarding_completed_at | timestamptz | sì | – | |
| privacy_accepted_at | timestamptz | no | – | impostato dal trigger di signup da metadata |
| privacy_version | text | no | – | es. `'2026-10-01'` |
| created_at / updated_at | timestamptz | no | `now()` | |

Indici: PK. L'email resta solo in `auth.users` (nessuna duplicazione). Creazione: trigger `after insert on auth.users` (`security definer`).

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

Unique: `(slug) where owner_id is null`; `(owner_id, slug) where owner_id is not null`. Indice: `(owner_id)`. Seed di sistema in migrazione (§10). Nell'MVP nessun utente può scrivere in questa tabella.

### `life_items`
| Colonna | Tipo | Null | Default | Note |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| owner_id | uuid | no | `auth.uid()` | FK → auth.users on delete cascade |
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
| owner_id | uuid | no | – | |
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

Indice: `(item_id, completed_at desc)`. Solo scrittura tramite `complete_life_item`.

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

Regole generali: `alter table … enable row level security` su **tutte** le tabelle di `public`; nessuna policy per `anon`; `auth.uid()` sempre incapsulato come `(select auth.uid())` (valutato una volta per query); grant espliciti per colonna dove serve; funzioni `security definer` con `set search_path = ''` e `revoke execute … from public, anon, authenticated` salvo quelle esplicitamente chiamabili.

| Tabella | select | insert | update | delete |
|---|---|---|---|---|
| `profiles` | `id = auth.uid()` | solo trigger (nessuna policy client) | `id = auth.uid()`, **grant update limitato a** `display_name, timezone, email_notifications_enabled, notification_hour, onboarding_completed_at` | nessuna (cancellazione via account) |
| `categories` | `owner_id is null or owner_id = auth.uid()` | nessuna (MVP) | nessuna | nessuna |
| `life_items` | `owner_id = auth.uid()` | `with check owner_id = auth.uid()` | `using/with check owner_id = auth.uid()` | `owner_id = auth.uid()` |
| `recurrence_rules` | `owner_id = auth.uid()` | `with check owner_id = auth.uid()` (+ FK composta garantisce che l'item sia dello stesso owner) | idem | idem |
| `item_completions` | `owner_id = auth.uid()` | **nessuna** (solo `complete_life_item`) | nessuna | nessuna (cascata) |
| `notifications` | `owner_id = auth.uid()` | **nessuna** (solo trigger DB) | **nessuna** (solo `service_role`) | nessuna (cascata) |
| `documents` | `owner_id = auth.uid()` | `with check owner_id = auth.uid()` | `owner_id = auth.uid()`, grant update solo su `uploaded_at` | `owner_id = auth.uid()` |
| `storage_cleanup_queue`, `rate_limits` | nessuna | nessuna | nessuna | nessuna (solo `service_role`) |

Esempio (pattern da riusare):
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

**Test obbligatori RLS (pgTAP, §17)**: utente A non vede/modifica/cancella nulla di B su ogni tabella; non può inserire con `owner_id` di B; non può creare un documento/regola/notifica su un item di B; `anon` non legge nulla; il client non può scrivere su `notifications`; non può cambiare `owner_id`.

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

**Categorie di sistema (seed)**: Auto e mezzi (`auto`), Assicurazioni (`assicurazioni`), Casa (`casa`), Documenti personali (`documenti`), Abbonamenti (`abbonamenti`), Contratti e utenze (`contratti`), Garanzie (`garanzie`), Altro (`altro`). Nessuna categoria "Salute" nell'MVP.

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
| Consenso | Checkbox obbligatoria (non preselezionata) a Termini e Privacy in registrazione; salvati data e versione. **Nessun consenso marketing**, nessuna email promozionale nell'MVP |
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
- **Autorizzazione**: **RLS su tutto** (§6) come unica barriera reale; il client è considerato ostile. Test pgTAP in CI.
- **Isolamento**: FK composte `(item_id, owner_id)`; `owner_id` immutabile (trigger); `default auth.uid()` + `with check`.
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

Stack **[D]**: Vue 3 (`<script setup>`), TypeScript `strict` (+ `noUncheckedIndexedAccess`), Vite, Pinia, Vue Router, Tailwind CSS, `@supabase/supabase-js`, zod + vee-validate, Headless UI Vue, lucide, date-fns (locale `it`), `@fontsource-variable/inter`, Vitest + Vue Test Utils + Testing Library, Playwright + `@axe-core/playwright`, ESLint (flat config, `typescript-eslint`, `eslint-plugin-vue`, `vuejs-accessibility`) + Prettier. Package manager **pnpm**, Node LTS (versione pinnata in `.nvmrc`/`engines`).

**Multipiattaforma [D]**: **Capacitor** (versione corrente 8, requisiti verificati in §22.7) per impacchettare la stessa SPA in app iOS e Android, con plugin `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/keyboard`, `@capacitor/haptics`, `@capacitor/camera`, `@capacitor/browser`, `@capacitor/share`, `@capacitor/network`, un plugin di **secure storage** (Keychain/Keystore) e un plugin **push FCM** (scelta finale nello spike di M18 **[V]**). Nessun framework UI mobile aggiuntivo (no Ionic UI/Quasar): si usa il design system proprio (Tailwind + Headless UI) con due shell (§4). Il progetto è un **singolo package** (niente monorepo): `src/` è condiviso, `ios/` e `android/` sono i progetti nativi generati da Capacitor e committati. Costruiti in M14, ma l'architettura che li rende possibili esiste già da M1.

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
| **PostgreSQL** | Dati, vincoli, **RLS**, quote (trigger), `complete_life_item`, `recurrence_next`, `sync_item_notifications`, `claim_due_notifications`, `handle_new_user`, `set_updated_at`, coda di pulizia, `check_rate_limit`, job `pg_cron` |
| **Supabase Auth** | Registrazione, conferma email e reset con **OTP a 6 cifre + link**, login, sessioni/JWT con refresh, rate limit auth, (futuro) OAuth (Sign in with Apple obbligatorio su iOS se si aggiunge un login social **[V]**) e MFA |
| **Storage** | Bucket privato `documents`, policy RLS, limiti dimensione/MIME, URL firmati |
| **Edge Functions (Deno/TS)** | `send-notifications` (cron, `service_role`; canali email **e push**), `delete-account`, `export-data`, `cleanup-storage` (cron: coda + orfani + log vecchi + token push scaduti). Codice condiviso in `functions/_shared` (client Supabase admin, adapter email `resend`/`mock`, adapter push `fcm`/`mock`, zod, logger, rate limit) |
| **Provider email** | Consegna avvisi (Resend, **[D]** salvo verifica regione UE/DPA) e, via SMTP, email di Auth |
| **Provider push** | **Firebase Cloud Messaging (FCM, HTTP v1)** per Android **e** iOS (FCM inoltra ad APNs con la chiave APNs caricata su Firebase). Un solo adapter server per le due piattaforme (§22.5) |
| **Hosting statico** | Serve la SPA Web e i file `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` e `/app-config.json` (versione minima app) |

**Operazioni che non devono MAI essere eseguite dal client**: usare la `service_role`; scrivere/aggiornare `notifications`, `item_completions`, `storage_cleanup_queue`, `rate_limits`; inviare email o **push** (nessuna chiave FCM/APNs nel client); cancellare l'utente in `auth.users` o gli oggetti Storage in massa; leggere/scrivere dati di un altro utente (impedito da RLS); impostare `owner_id` diverso dal proprio; saltare le quote; chiamare `claim_due_notifications`; calcolare le occorrenze future di una ricorrenza in modo autonomo (si usa la funzione DB).

Supabase locale: CLI `supabase` come **devDependency** (Docker è disponibile in locale; la CLI non è installata globalmente ed è eseguita con `pnpm exec supabase`). Migrazioni, `seed.sql` (solo dati di test locali), `config.toml` versionati.

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
- *Vincoli multipiattaforma*: regola ESLint che vieta `@capacitor/*` fuori da `src/platform/native`; `viewport-fit=cover` e variabili safe-area; router history mode; nessun asset da CDN; test di architettura (bundle Web senza Capacitor).
- *DB*: nessuna. *Test*: smoke test dell'app, test della validazione env, test delle regole di architettura.
- *DoD*: `pnpm dev/lint/typecheck/test/build` funzionano; CI verde; README con setup locale; tema Tailwind con i token del §4; le porte di `platform/` esistono con implementazione web e fake.

**M2 — Fondamenta database e RLS**
- *Obiettivo*: schema base, profili, categorie, RLS, tipi generati.
- *File*: `supabase/migrations/*_foundation.sql`, `seed.sql`, `supabase/tests/*`, `src/shared/types/database.ts`, `src/shared/lib/supabaseClient.ts`.
- *DB*: `profiles`, `categories` (+ seed), enum, trigger `handle_new_user`/`set_updated_at`, policy.
- *Test*: pgTAP su RLS profili/categorie, trigger di signup.
- *Multipiattaforma*: `supabaseClient.ts` crea il client con lo **storage di sessione iniettato** dall'adapter `SecureStorage` (web: `localStorage`).
- *DoD*: `supabase start` + `db reset` + `test db` verdi; tipi generati committati; **azione esterna**: nessuna (Docker locale).

**M3 — Autenticazione**
- *Obiettivo*: registrazione, conferma email, login, logout, reset password, guard.
- *File*: `features/auth/*`, `pages/Login|Register|VerifyEmail|ForgotPassword|ResetPassword|AuthCallback`, `router/guards.ts`, `layouts/AuthLayout`, `shared/ui` (Button, Input, Card, Toast), template email Auth in `supabase/config.toml`/`templates`.
- *DB*: consenso in metadata → profilo.
- *Multipiattaforma*: conferma email e reset con **codice OTP a 6 cifre** (`verifyOtp`) come flusso primario, link come alternativa; template email con codice e link; gestore deep link con whitelist dei path (la parte nativa arriva in M16).
- *Test*: unit (schemi, guard, whitelist redirect e deep link), E2E registrazione/login/reset (Mailpit) sia con codice sia con link, a11y.
- *DoD*: flussi E2E verdi; nessuna enumerazione di account; password policy attiva; `redirect` sicuro; il flusso con codice non dipende da nessun deep link.

**M4 — App shell e design system**
- *Obiettivo*: **`DesktopShell` e `MobileShell`** reali (sidebar / tab bar, safe area, transizioni a stack), componenti base, stati.
- *File*: `layouts/DesktopShell`, `layouts/MobileShell`, `useShell`, `shared/ui/*` (Modal, Badge, Skeleton, EmptyState, ErrorState, Select, DatePicker), `useToast/useConfirm`, `pages/DashboardPage` (placeholder).
- *DB*: nessuna. *Test*: component test dei ui, E2E responsive di navigazione, axe.
- *DoD*: navigazione desktop/mobile, focus visibile, tema coerente, pagina di catalogo componenti solo in dev.

**M5 — Life Items (CRUD)**
- *Obiettivo*: creare, elencare, vedere, modificare, eliminare.
- *File*: `features/items/*`, `domain/itemStatus|money|dates`, `pages/Items*`, `ItemForm`, `ItemList`, `StatusBadge`.
- *DB*: `life_items`, trigger quota e `owner_id`, FK composta, indici, policy.
- *Test*: unit dominio, pgTAP RLS/quota, E2E create/edit/delete e isolamento tra utenti.
- *DoD*: CRUD completo con loading/vuoto/errore; filtri in query param; RLS verificata; avviso data passata.

**M6 — Ricorrenze e completamento**
- *Obiettivo*: regole, `recurrence_next`, "Segna come gestita", storico.
- *File*: `features/recurrence/*`, sezione ricorrenza in `ItemForm`, `CompleteButton`, `CompletionHistory`.
- *DB*: `recurrence_rules`, `item_completions`, funzioni `recurrence_next` e `complete_life_item`.
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
- *Obiettivo*: avvisi push affidabili, una volta sola, con apertura diretta dell'item.
- *File*: `supabase/functions/send-notifications` (driver `fcm`/`mock`), `_shared/push.ts`, `platform/native/push.ts`, `features/reminders/*` (permesso contestuale), `NotificationSettings` (canali), `docs/PUSH.md`.
- *DB*: `push_devices`, `notification_deliveries`, enum `notification_channel` + `'push'`, RPC `register_push_device`, colonna `profiles.push_notifications_enabled`, estensione di `sync_item_notifications` (§22.5).
- *Test*: pgTAP (RLS dispositivi, riassegnazione token, unicità), Deno (fan-out per dispositivo, retry solo sui dispositivi falliti, token non valido rimosso, nessun duplicato), prova manuale su iPhone e Android reali.
- *DoD*: push ricevuta su iOS e Android in staging, una sola volta per avviso; tap apre `/items/:id`; opt-out per canale funziona; nessun dato sensibile nel payload; token rimosso al logout.

**M19 — Resilienza e offline**
- *Obiettivo*: nessuna schermata bianca senza rete; ultimi dati consultabili.
- *File*: cache di sola lettura di lista scadenze/dettagli (storage locale), banner offline, gestione errori di rete, Sentry per le app (scrubbing PII).
- *DB*: nessuna.
- *Test*: unit della cache, E2E con rete assente, prova in modalità aereo su dispositivo.
- *DoD*: offline mostra gli ultimi dati con banner e disabilita le scritture con messaggio chiaro (**nessuna scrittura offline in v1**); nessuna pagina di errore del browser.

**M20 — CI/CD e firma mobile**
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
4. *Plugin push/secure storage di terze parti* → spike in M16/M18 per scegliere plugin attivi e manutenuti; porta `platform/` isola il cambio.
5. *Sviluppo iOS richiede macOS* (oggi si lavora su Windows) → vedi §22.13.

### 21.2 Altre decisioni tecniche

**Decisioni prese (no conferma necessaria)**
| Tema | Scelta | Motivo |
|---|---|---|
| Piattaforme | Web + iOS + Android, una codebase, Capacitor 8 | Riuso massimo, mantiene una vera web app, stack Vue invariato |
| Shell UI | `DesktopShell` + `MobileShell` sullo stesso design system | Esperienza touch reale senza duplicare le pagine |
| Plugin nativi | Dietro porte `platform/`, import dinamico solo in `platform/native` | Bundle Web pulito, testabilità, sostituibilità dei plugin |
| Repo | Singolo package, `ios/` e `android/` committati | Semplicità; nessun monorepo necessario |
| Conferma email/reset | OTP a 6 cifre primario + link | Funziona su tutte le piattaforme senza deep link |
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
| Form | zod + vee-validate | Schema unico riusabile e tipizzato |
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
- App Capacitor (WKWebView) con progetto Xcode in `ios/`, **iOS deployment target 15** (requisito Capacitor 8, *verificato ott. 2026*), Swift Package Manager come default per i plugin.
- Capability: **Push Notifications**, **Associated Domains** (`applinks:app.<dominio>`), Background Modes → solo *Remote notifications* se necessario per la ricezione.
- Stringhe d'uso dei permessi in italiano (fotocamera, libreria foto se usata) e **privacy manifest** (`PrivacyInfo.xcprivacy`) **[V]**.
- Build solo con **Xcode 26+ / SDK iOS 26**: dal 28 aprile 2026 App Store Connect rifiuta i caricamenti con SDK precedenti (*verificato ott. 2026*).
- Distribuzione: **TestFlight** interno (subito), TestFlight esterno per la beta, poi App Store con rilascio a fasi.
- Sviluppo: richiede macOS (§22.13).

### 22.4 Strategia Android
- App Capacitor (WebView di sistema) con progetto Gradle in `android/`; Capacitor 8: **minSdk 24, compileSdk/targetSdk 36, JDK 21** (*verificato ott. 2026*). Dal 31 agosto 2026 le nuove app e gli aggiornamenti devono avere target API 36 (*verificato ott. 2026*; estensione possibile fino al 1 novembre 2026).
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
- Rimozione: al logout (cancellazione riga), alla cancellazione account (cascata), su risposta FCM `UNREGISTERED`/`INVALID_ARGUMENT` (marcato `invalid_token` e disabilitato), pulizia dei dispositivi non visti da > 60 giorni (cron di `cleanup-storage`).

**Permessi e UX**: la richiesta del permesso **non** appare al primo avvio. Appare in modo contestuale dopo la creazione delle prime scadenze (fine onboarding) con una schermata che spiega il valore ("Vuoi ricevere un avviso prima delle scadenze?") e solo dopo mostra la richiesta di sistema (Android 13+ la richiede a runtime). Se negato: stato chiaro in Impostazioni con scorciatoia alle impostazioni di sistema; l'email continua a funzionare.

**Tap sulla notifica**: l'app legge `path`, lo valida con la whitelist dei deep link (§3) e naviga; se la sessione non è attiva passa dal login con `redirect`.

**Provider**: FCM per entrambe le piattaforme (la chiave APNs si carica su Firebase). Plugin client da scegliere in uno spike all'inizio di M18 fra `@capacitor/push-notifications` e un plugin FCM unificato **[V]** (su iOS il plugin ufficiale restituisce di default il token APNs, non FCM, salvo integrazione dell'SDK Firebase).

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
| Dati | seed di test | dati sintetici/tester | dati reali |

Gli appId diversi consentono di installare le tre versioni affiancate. La scelta dell'ambiente avviene a build-time (`CAP_ENV`, modalità Vite), mai a runtime.

### 22.9 Signing, release, compatibilità
- **Android**: *upload key* generata da te (keystore), conservata in un password manager e come secret cifrato in GitHub (base64); **Play App Signing** attivo (la chiave di firma finale la custodisce Google). Mai keystore o password nel repository.
- **iOS**: chiave API di App Store Connect (`.p8`) come secret; certificati e profili gestiti con **fastlane match** (repository privato cifrato) o firma automatica in CI; chiave **APNs** caricata su Firebase.
- **Flusso di rilascio**: tag `mobile-v1.2.0` → CI → build firmate → TestFlight / Play test interno → test manuale con checklist §22.12 → promozione manuale: iOS review + rilascio a fasi; Android test chiuso → produzione con rollout graduale.
- **Cadenza [R]**: Web continuo; app ogni 2–4 settimane (salvo hotfix). Note di rilascio in italiano.
- **Versione minima supportata**: `/app-config.json` (es. `{ "minAppVersion": { "ios": "1.0.0", "android": "1.0.0" } }`) letto all'avvio; sotto la soglia, schermata "Aggiorna l'app" con link allo store. Serve per dismettere API vecchie senza lasciare utenti rotti.
- **Compatibilità API**: ogni migrazione è *expand → migrate → contract* su almeno due versioni mobile; nessuna rimozione di colonne/funzioni usate da versioni supportate.
- **Hotfix**: correzioni critiche lato server immediate; lato app, release d'emergenza con review accelerata se necessario **[V]**. Live update del bundle Web: opzionale, da valutare solo dopo aver verificato le regole degli store **[V]**.

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
