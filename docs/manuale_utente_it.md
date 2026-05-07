# PCM-Hub — Manuale utente

Guida pratica all'uso del sito **PCM-Hub** (`hub.parametricomparison.unimore.it`). Questa guida è pensata per chi usa il sito tutti i giorni: linguisti che compilano le lingue assegnate, e amministratori che gestiscono parametri, domande, account e analisi cross-lingua.

> **Trovi quello che cerchi più in fretta** se sai che ruolo hai:
> - **Linguista (User)** → leggi le sezioni 1-7 e salta direttamente alla §6 (Compilare una lingua).
> - **Amministratore (Admin)** → leggi tutto: gli admin vedono tutte le funzionalità degli User più una decina di strumenti aggiuntivi (sezioni 8-15).

---

## Indice

1. [Cos'è il PCM-Hub](#1-cosè-il-pcm-hub)
2. [Accedere al sito](#2-accedere-al-sito)
3. [Orientarsi: sidebar, topbar, breadcrumb](#3-orientarsi-sidebar-topbar-breadcrumb)
4. [La Dashboard](#4-la-dashboard)
5. [Pagine condivise: Glossary, Instructions, How to cite, My Account](#5-pagine-condivise)
6. [La pagina Languages](#6-la-pagina-languages)
7. [Compilare una lingua (linguista o admin)](#7-compilare-una-lingua)
8. [SOLO ADMIN — Parameters](#8-solo-admin--parameters)
9. [SOLO ADMIN — Questions](#9-solo-admin--questions)
10. [SOLO ADMIN — Motivations](#10-solo-admin--motivations)
11. [SOLO ADMIN — Taxonomy](#11-solo-admin--taxonomy)
12. [SOLO ADMIN — Accounts](#12-solo-admin--accounts)
13. [SOLO ADMIN — Table A](#13-solo-admin--table-a)
14. [SOLO ADMIN — Filters (Queries Q1–Q10)](#14-solo-admin--filters-queries-q1q10)
15. [SOLO ADMIN — History & Backups, Migration, Backup Restore, Import Excel, Recompute](#15-solo-admin--history-backups-import-recompute)
16. [Errori comuni e cosa fare](#16-errori-comuni-e-cosa-fare)
17. [Glossario rapido di interfaccia](#17-glossario-rapido-di-interfaccia)

---

## 1. Cos'è il PCM-Hub

Il **Parametric Comparison Method** (PCM, Longobardi & Guardiano 2009) confronta lingue diverse usando un set di **parametri sintattici universali**. Ogni lingua viene "compilata" da un linguista che, per ciascun parametro, risponde a un set di domande (di solito sì/no) e fornisce esempi linguistici a supporto delle risposte.

A partire dai dati raccolti, il sito produce automaticamente:

- valori di parametro consolidati per ogni lingua (`+`, `−`, `0`, `?`);
- matrici comparative tra lingue;
- distanze di Hamming, Jaccard e geografiche;
- dendrogrammi e cluster map;
- analisi PCA, test di Mantel.

Tutto questo permette di studiare relazioni filogenetiche, divergenze e convergenze tra lingue di famiglie diverse.

### I tre ruoli

| Ruolo | Cosa può fare |
|---|---|
| **Public** (visitatore non loggato) | vede solo la home con la mappa interattiva e la pagina How to cite |
| **User** (linguista assegnatario) | compila le lingue che gli sono state assegnate, vede glossario, istruzioni, lista lingue, dashboard personale |
| **Admin** | tutto quello che fa lo User, più: gestione parametri/domande/motivazioni/tassonomia, creazione account, TableA, query Q1-Q10, history/backup, migration, recompute |

---

## 2. Accedere al sito

### Primo accesso

L'amministratore che ti ha creato l'account ti comunica:

- l'**email** del tuo account;
- una **password temporanea** (almeno 8 caratteri).

Vai sull'URL del sito → clicca **Login** dalla home (o vai direttamente a `/login`) → inserisci le credenziali → **Log in**.

![Form di login con i campi Email e Password e il pulsante Log in](img/manuale/login.png)

Al primo login **ti consigliamo di cambiare la password**: in alto a destra clicca **MyAccount** → sezione **Change password**.

---

### Cambiare password

Dalla pagina **My Account** trovi due blocchi:

- **Profilo**: nome, cognome, email (se cambi l'email diventa la nuova credenziale di login).
- **Change password**: serve la password attuale + la nuova due volte. Minimo 8 caratteri.

---

### Dimenticato la password?

Al momento il **reset via email non è ancora attivo** (ci vorrà l'integrazione SMTP dei servizi informatici Unimore). Nel frattempo: contatta un amministratore, che può riassegnarti una password temporanea creando un nuovo account o intervenendo dal pannello.

---

### Sessione scaduta

Il token di accesso dura **30 minuti di inattività**. Dopo, le pagine protette ti rimanderanno automaticamente al login. Niente di rotto, basta fare login di nuovo.

---

### Limite tentativi falliti

Per sicurezza: **dopo 5 tentativi falliti di login dalla stessa connessione in 1 minuto**, il sistema risponde con un errore "Too Many Requests" per qualche secondo. Aspetta un minuto e riprova.

---

## 3. Orientarsi: sidebar, topbar, breadcrumb

Una volta loggato, l'interfaccia ha 3 elementi fissi:

### Sidebar (a sinistra)

Tutte le pagine principali. Le voci che vedi dipendono dal tuo ruolo:

| Voce | User | Admin |
|---|---|---|
| Dashboard | ✓ | ✓ |
| Citation Guidelines | ✓ | ✓ |
| Languages | ✓ | ✓ |
| Parameters | — | ✓ |
| Parameters Graph | — | ✓ |
| Questions | — | ✓ |
| Motivations | — | ✓ |
| Taxonomy | — | ✓ |
| Table A | — | ✓ |
| Filters | — | ✓ |
| Accounts | — | ✓ |
| History & Backups | — | ✓ |
| Migration Import | — | ✓ (danger zone) |
| Backup Restore | — | ✓ |
| Instructions | ✓ | ✓ |
| Glossary | ✓ | ✓ |

Il **bottone in alto della sidebar** la collassa/espande (utile per recuperare spazio orizzontale, soprattutto in TableA). La preferenza viene ricordata.

---

### Topbar (in alto)

- **Breadcrumb** a sinistra: mostra il percorso della pagina (es. `Dashboard / Languages / Italiano / Data`). Le voci cliccabili in **azzurro** sono navigabili; quelle in **grigio** sono solo informative (es. ID dinamici).
- **MyAccount** a destra: shortcut alla pagina del profilo.
- **Toggle tema (Light/Dark)**: cambia il tema visivo. Anche questa preferenza è ricordata.
- **Logout**: termina la sessione e ti riporta alla home pubblica.

---

### Footer

In fondo a ogni pagina:

- citazione del PCM-Hub (CC BY 4.0);
- link a Privacy Policy, Disclaimer, contatto email del laboratorio (`pcm_lab@unimore.it`);
- link al sito istituzionale del progetto PCM Unimore;
- **Role badge** (in basso a destra): dice se sei "Admin Access", "User Access" o "Public View".

---

## 4. La Dashboard

È la prima pagina che vedi dopo il login.

### Dashboard utente (User)

Mostra **le lingue che ti sono state assegnate**. Per ogni lingua:

- ID e nome completo (es. `ITA — Italian`);
- **stato** (`Pending`, `Waiting`, `Approved`, `Rejected`);
- **barra di progresso** (numero di risposte date / totale domande, percentuale);
- pulsante **Fill in** (o **View rejection and reopen** se la lingua è stata rifiutata) che ti porta alla pagina di compilazione.

Se la lingua è in `Rejected`, sotto vedi anche la **nota dell'admin** che spiega perché è stata respinta.

---

### Dashboard admin

![Dashboard amministratore con le quattro card riassuntive](img/manuale/dashboard-admin.png)

Layout a 3+1 card:

- **Waiting for Approval**: numero di lingue in attesa di revisione + click rapidi per aprirle.
- **Languages by Status**: contatori `Pending / Waiting / Approved / Rejected` cliccabili. Cliccando un contatore si espande un menù con la lista delle lingue in quello stato.
- **Flagged/Unsure Parameters**: numero di parametri "rossi" (compilazione parziale o segnati Unsure) raggruppati per lingua, con conteggio.
- **Latest Changes** (a destra): tabella con le ultime modifiche ai parametri (chi, quando, cosa, nota).

Da qui un admin può aprire rapidamente le lingue che richiedono attenzione.

---

## 5. Pagine condivise

### Glossary (`/glossary`)

![Pagina Glossary: campo di ricerca, pulsante Add term e tabella dei termini con Edit/Delete](img/manuale/glossary.png)

Lista alfabetica dei termini tecnici usati nel progetto, con descrizione.

- Tutti gli utenti possono **cercare** (campo di ricerca in alto).
- Solo admin: pulsante **Add term**, **Edit** e **Delete** sulle righe.

---

### Instructions (`/instructions`)

![Pagina Instructions: titolo, pulsante Edit (admin) in alto a destra e contenuto del documento](img/manuale/instructions.png)

Documento HTML editabile (powered by TinyMCE) con le linee guida per la compilazione. La versione di default include:

- regole generali (read → identify → answer YES/NO → save → submit);
- istruzioni specifiche per le **glosse linguistiche** con tabella dei simboli (ACC, NOM, GEN, ecc.);
- esempi di glossing.

Solo admin: pulsante **Edit** in alto a destra → editor WYSIWYG con formattazione, tabelle, codice HTML raw. **Save** persiste il documento per tutti.

---

### How to cite (`/how-to-cite`)

![Pagina How to cite: due card affiancate con il testo della citazione e il pulsante Copy in alto a destra](img/manuale/how-to-cite.png)

Due card:

- **Parameters & Manifestations**: come citare i parametri/domande del PCM Hub (consigliato per User e Admin).
- **Database** (linguistic data): come citare i dati linguistici raccolti.

Sotto ogni card c'è un pulsante **Copy** che copia la stringa di citazione completa nella clipboard del sistema.

Solo admin: pulsante **Edit** che apre l'editor TinyMCE per modificare il testo della citazione.

---

### My Account (`/me`)

![Pagina My Account: card Profile con Save Profile e card Change Password con Update Password](img/manuale/my-account.png)

- **Profile**: nome, cognome, email. Il **Save** scrive direttamente sul tuo profilo.
- **Change password**: vecchia password + nuova due volte. Minimo 8 caratteri. Se le due copie non coincidono il sistema rifiuta.

⚠ Se cambi l'email, la **nuova email diventa la tua credenziale di login**. Memorizzala bene (o usa un password manager).

---

## 6. La pagina Languages

L'elenco di tutte le lingue del progetto. **Sopra** alla tabella c'è una **mappa interattiva** (OpenStreetMap) con un pin per ogni lingua georeferenziata.

### Filtri (sticky in alto)

![Toolbar della pagina Languages con filtri e pulsanti di azione](img/manuale/languages-toolbar.png)

- **Search** testuale globale (ID, nome, family, top family, group, status, rejection note).
- **Top Family / Subfamily / Group**: multi-select gerarchico. Selezionare una top-family ristringe le subfamily disponibili, e così via.
- **Historical**: tutte / solo storiche / solo non storiche.
- **Status**: tutti / Pending / Waiting / Approved / Rejected.

A destra dei filtri: contatore "X di Y lingue", e i pulsanti:

- **Reset**: pulisce i filtri.
- **Clear exclusions** (compare se hai escluso lingue manualmente).
- **Download Data ▾** (admin): apre un menù per esportare i dati delle lingue **attualmente filtrate e non escluse**:
    - **Export language metadata (.xlsx)** — ID, nome, famiglia, coordinate, ecc.
    - **Export backup (.zip)** — bundle completo con tutte le risposte e gli esempi delle lingue selezionate (job asincrono: appare un toast in basso a destra che mostra il progresso).
    - **Map (.png)** — la mappa attuale come immagine.
    - **Geographic distances (.txt)** — matrice GCD in km tra le lingue selezionate.
- **+ Full Languages Backup** (admin): crea uno snapshot in DB di **tutte** le lingue (richiede una nota opzionale). Lo trovi poi in History & Backups → Full backups.
- **Recompute final values** (admin): rilancia il DAG implicazionale per **tutte** le lingue. Job asincrono con barra di progresso. Da usare dopo aver modificato condizioni implicazionali importanti, o dopo un import.
- **Import from Excel** (admin): pagina di import strutturato.
- **Add Language** (admin): crea una nuova lingua a mano.

---

### La tabella

![Tabella delle lingue: colonne principali e pulsanti azione per ogni riga](img/manuale/languages-table.png)

- **Checkbox a sinistra**: toggle "include / esclude" la lingua dal set effettivo (mappa, distanze, export). Spuntando l'header tutte le lingue visibili vengono escluse/incluse insieme.
- **ID, Name, Status, Top family, Subfamily, Group**.
- **Actions**:
    - **Data**: apre la pagina di compilazione (utenti normali e admin).
    - **Duplicate** (admin): duplica la lingua con tutte le risposte e gli esempi (utile come template).
    - **Debug** (admin): apre una pagina che mostra valori `init`/`final` di ogni parametro per la lingua, con possibilità di **Apply implicational condition(s)** (rilancia DAG sulla singola lingua).
    - **Edit** (admin): modifica i metadati della lingua (nome, coordinate, family, ecc.).

---

### Note sulla mappa

I marker sono colorati per **top-family**. La legenda sotto la mappa elenca tutte le top-family con il loro colore: passandoci sopra col mouse, le altre famiglie si attenuano (utile per isolare visivamente una famiglia).

---

## 7. Compilare una lingua

Questo è il **cuore del sito**: dove un linguista entra e risponde alle domande per una lingua. Si arriva qui da:

- Dashboard → click su una lingua assegnata;
- Languages → riga della lingua → pulsante **Data**.

L'URL è `/languages/<id>/data`.

### Header della lingua

![Header e banner di stato della pagina di compilazione: metadati lingua, pulsante Export e (sotto) banner Pending con Apply implicational condition(s) e Change Status](img/manuale/compilation-header.png)

In alto vedi:

- **Nome e ID** della lingua;
- pulsante **Export parametric data (.xlsx)** (admin) o **Export examples (.xlsx)** (user) per scaricare un file Excel con i dati che hai inserito;
- una griglia con i **metadati** della lingua (top-family, family, group, ISO/Glottocode, coordinate, supervisor, informant, source, ecc.). Solo admin vede anche l'utente assegnato.

---

### Banner di stato (sotto l'header)

Mostra lo stato corrente della lingua, una breve descrizione e i pulsanti di workflow disponibili. I 4 stati possibili:

| Stato | Significato | Cosa puoi fare (User assegnato) |
|---|---|---|
| **Pending** | In compilazione, modificabile | scrivi/modifica liberamente; quando hai finito clicca **Submit for approval** |
| **Waiting for approval** | Inviata, aspetta che un admin revisioni | il form è **bloccato**, devi aspettare. L'admin riceverà la lingua nel suo widget Dashboard |
| **Approved** | Approvata, congelata | il form è **bloccato** in sola lettura. La lingua entra a far parte dei dati ufficiali. |
| **Rejected** | Rifiutata, va rivista | leggi la nota dell'admin, clicca **Reopen** per rimettere la lingua in `Pending` e riprendere l'editing |

⚠ **L'admin invece** può sempre editare a prescindere dallo stato (vede un banner viola "Admin override" che lo segnala). Inoltre l'admin ha un dropdown **Change Status ▾** che permette di forzare la lingua a qualsiasi stato (Approve/Reject/Pending/Waiting), saltando il workflow normale.

---

### Wizard dei parametri (i quadratini)

![Wizard dei parametri: griglia di quadratini colorati, uno per ogni parametro attivo](img/manuale/compilation-wizard.png)

Sotto il banner di stato c'è una **fila di quadratini**, uno per ogni parametro attivo. Cliccando un quadratino salti al **blocco di domande di quel parametro**.

I quadratini sono colorati in base al progresso:

- **Grigio (vuoto)** — nessuna risposta ancora.
- **Giallo (in corso)** — alcune domande risposte ma non tutte, oppure parametro segnato come "Unsure".
- **Verde (completo)** — tutte le domande hanno una risposta valida (`yes` o `no`; `unsure` non conta come completata).

Suggerimento: usa il colore dei quadratini come "to-do list" visiva. Tutti verdi = pronto per il submit.

---

### Il blocco di un parametro

![Blocco parametro aperto: header con nome parametro, sezione Admin notes collassata e una domanda con Answer (YES) e i campi degli Examples](img/manuale/compilation-block.png)

Quando clicchi su un quadratino vedi:

- intestazione con **ID e nome** del parametro, più una `short_description`;
- (solo admin) area collassabile **Admin notes** dove l'admin può scrivere una nota libera per questa coppia (lingua, parametro). La nota non è visibile agli User e non viene esportata.
- **una card per ogni domanda** del parametro;
- in basso a destra una **toolbar fluttuante** ("sticky") con due pulsanti di salvataggio: **Confident → Next** (verde) e **Unsure → Next** (rosso). Vedi sotto.

---

### Le domande

Ogni domanda mostra:

- un'intestazione con **ID e testo** della domanda;
- un pulsante **More info** (se c'è un help testuale, espandibile);
- **Instructions**: istruzione generale, sempre visibile;
- **Example YES**: un esempio illustrativo, sempre visibile (è solo decorativo, non lo devi compilare);
- **Instructions (YES)** o **Instructions (NO)**: istruzioni specifiche, mostrate solo dopo che selezioni la risposta corrispondente;
- **Answer** (tendina): `— select —`, `YES`, `NO`, `UNSURE`. Questa è la tua risposta.

A seconda della risposta scelta, la card si espande in modo diverso:

#### Hai selezionato **NO**

Compaiono le **Motivations**: una serie di checkbox con i motivi predefiniti per cui questa domanda è "No" in questa lingua (es. "non c'è una struttura corrispondente", "il fenomeno è marginale"). Spunta una o più motivazioni. Se la domanda non ha motivations associate, vedrai un messaggio in italico.

#### Hai selezionato **YES** o **UNSURE**

Compare il blocco **Examples**: qui devi inserire **almeno 2 esempi linguistici** che illustrano la risposta. Per ogni esempio:

- **Example text**: la frase nella lingua (es. *Mario ha letto il libro nuovo che gli ho consigliato*);
- **Transliteration**: traslitterazione se serve (es. per alfabeti non latini);
- **Gloss**: glossa morfema-per-morfema (es. *book.M.SG.NOM*);
- **English Translation**: traduzione in inglese;
- **Reference**: fonte (es. *Hauser, M. 1992. p. 12*).

Pulsanti utili:

- **+ Add another example**: aggiunge una card vuota per un nuovo esempio.
- **Remove**: cancella un esempio.
- **Copy**: copia l'esempio nella **clipboard interna del sito** (vedi sotto).
- **+ Import example from another answer...**: ricerca server-side nel database degli esempi già scritti per altre domande/lingue. Trova l'esempio cercato (per testo / traduzione / gloss), cliccalo, e viene **copiato come nuovo esempio** in questa domanda. **L'esempio importato è una copia indipendente**: puoi modificarlo liberamente senza toccare l'originale.

⚠ **Regola importante**: se rispondi YES o UNSURE, **devi** fornire **almeno 2 esempi non vuoti**. Se provi a salvare con meno di 2, il sistema blocca il save mostrando un avviso e **evidenziando in rosso** la card incriminata. Stesso vincolo vale per UNSURE.

#### Comments

In fondo a ogni card c'è un campo **Comments** (testo libero) per aggiungere note/spiegazioni/dubbi non strutturati.

---

### La clipboard degli esempi

Pratica utility per non riscrivere a mano lo stesso esempio in più domande della stessa lingua:

1. In una qualsiasi card di esempio, clicca **Copy** in alto a destra → l'esempio finisce nella clipboard interna (banner rosso tratteggiato che appare sotto i tuoi esempi correnti).
2. Sposta su un'altra domanda della stessa lingua → vedi lo stesso banner.
3. Clicca **Paste here** → l'esempio viene aggiunto come **nuovo** esempio in questa domanda. La clipboard rimane piena, quindi puoi incollarlo in altre domande in fila.
4. **Clear** sul banner svuota la clipboard.

⚠ La clipboard è specifica per la **lingua corrente**. Se passi a una lingua diversa, la clipboard si svuota automaticamente per evitare di trascinare un esempio orfano.

---

### Salvare un blocco parametro

In basso a destra del blocco corrente vedi una **toolbar fluttuante** (sticky) con due pulsanti:

| Pulsante | Quando usarlo |
|---|---|
| **Confident → Next** (verde) | I dati sono completi e verificati. Il quadratino del parametro diventa verde. |
| **Unsure → Next** (rosso) | Hai dei dubbi e vuoi salvare per riguardarci più tardi. Il quadratino del parametro resta giallo (flagged). |

Entrambi i pulsanti **salvano tutti i dati del blocco corrente** (risposte + esempi + motivazioni + comments + admin note se sei admin) e poi **avanzano automaticamente al parametro successivo**.

Se il save va a buon fine: nessun feedback particolare, ti ritrovi sul parametro successivo.

Se invece il save fallisce, può essere per uno di questi motivi:

- **400 missing examples**: hai messo YES o UNSURE su una domanda con meno di 2 esempi → vedrai un alert e la card incriminata diventa rossa per qualche secondo.
- **409 stale block**: nel frattempo qualcun altro (di solito un admin) ha modificato lo stesso blocco. Il sistema ti avvisa e ricarica automaticamente la pagina così puoi rivedere le modifiche fatte da altri prima di riprovare.
- **Errore di rete**: alert generico, ritenta più tardi.

---

### Cambiare parametro senza salvare

Se hai modificato qualcosa e clicchi un altro quadratino senza salvare, il sito **ti chiede conferma** prima di scartare le modifiche del blocco corrente. Stessa cosa se chiudi la tab o navighi via con il breadcrumb: protezione automatica.

---

### Submit / Reopen / workflow

Quando tutti i parametri che ti interessavano sono compilati, **e** lo stato è `Pending` o `Rejected`:

- **Submit for approval**: la lingua passa a `Waiting for approval`. Da questo momento il form si **blocca** e l'admin riceve la lingua nella sua dashboard.

Quando lo stato è `Rejected`:

- **Reopen**: la lingua torna a `Pending` (dopo aver letto la nota di rifiuto). Puoi riprendere l'editing.

Ricorda: l'admin può forzare lo stato della lingua in qualsiasi momento e in qualsiasi direzione (vedi §6 del [documentation_it.md](documentation_it.md) per il workflow completo).

---

### Cosa vede l'admin in più

Oltre al banner viola "Admin override" e al dropdown **Change Status ▾**, un admin che apre una lingua ha:

- **Apply implicational condition(s)** (link in alto): apre la pagina **Debug** che mostra tutti i valori init/final dei parametri della lingua, e da lì può rilanciare il DAG implicazionale solo per questa lingua.
- **Admin notes** dentro a ogni blocco parametro: nota libera per (lingua, parametro). Non viene esportata e non è visibile agli User.

---

## 8. SOLO ADMIN — Parameters

Pagina: **Sidebar > Parameters** (`/admin/parameters`).

### Lista parametri

![Pagina Parameter Management: filtri (Search, Schema, Type, Level, Active), pulsanti Reset/Download parameters info (.pdf)/+ Full Parameters Backup/Add Parameter, e tabella con i pulsanti PDF/Backup/Edit per riga](img/manuale/parameters-list.png)

Tabella con: ID, nome, position, schema, type, level of comparison, contatori `questions_count` (domande normali) e `stop_count` (domande di chiusura), stato attivo/disattivo.

In alto: campo di ricerca, pulsante **Add parameter**, **Export PDF (all)** (genera un PDF con tutti i parametri formattati).

Drag & drop per riordinare i parametri (la `position` viene salvata automaticamente).

---

### Edit parametro

![Pagina Edit Parameter: Parameter ID, Position, Name, Schema/Type/Level, Short e Long Description, Implicational Condition, e card laterale "Where Used"](img/manuale/parameter-edit.png)

Click sul pulsante **Edit** della riga → pagina di edit con:

- ID (read-only, non si cambia dopo la creazione);
- Nome, position, schema, type, level of comparison;
- **Short description** (mostrata in compilazione);
- **Long description** (mostrata in PDF);
- **Implicational condition**: stringa con sintassi tipo `+SPK & -DEM` (vedi §8.1);
- **Description of the implicational condition**: descrizione testuale;
- **Active**: toggle attivo/disattivo (un parametro disattivo non è proposto in compilazione né compare in TableA);
- **Change note** (obbligatorio): perché stai facendo questa modifica. Va in History.

A sinistra del form vedi anche:

- la lista delle **domande del parametro** con drag & drop di riordino, e la possibilità di aprire il drawer di edit di una domanda direttamente da qui;
- la cronologia delle **change notes** (ParameterChangeLog) con autore e data.

---

### Disattivare un parametro

Pulsante **Deactivate**: chiede conferma + la **password dell'admin corrente** (safeguard). Una volta disattivato, il parametro non è più proposto in compilazione e non concorre a TableA / DAG / export. Le risposte storiche restano in DB.

---

### Implicational condition (cenni)

Il parametro target è "comparabile" solo se la sua `implicational_condition` è soddisfatta dai parametri "ref" che cita.

- `+P` significa: il parametro `P` ha valore `+` per la lingua;
- `-P`: valore `-`;
- `0P`: valore `0` (neutralizzato);
- `&` = AND, `|` = OR, `~` = NOT, `( )` = raggruppamento.

Esempio: `+SPK & -DEM` significa "il parametro SPK è `+` E il parametro DEM è `-`". Se è falso, il parametro target viene forzato a `0` (con warning).

La condizione viene **validata sintatticamente** al save: se è malformata, il sistema rifiuta con un messaggio di errore. Se cita parametri inesistenti o disattivati, viene **silenziosamente ignorata** dal DAG (ma il save passa).

---

### Parameters Graph (`/admin/parameters/graph`)

![Parameters Graph: filtri (Language, Schema, Type, Level), pulsanti Fit all/Reload, grafo dei parametri al centro e card laterale con dettagli del nodo selezionato](img/manuale/parameters-graph.png)

Visualizzazione del **grafo del DAG implicazionale** in un diagramma interattivo. Utile per capire quali parametri dipendono da quali. Ogni nodo è un parametro, gli archi vanno da `ref → target`.

---

## 9. SOLO ADMIN — Questions

Pagina: **Sidebar > Questions** (`/admin/questions`).

### Lista domande

![Pagina Questions: campo di ricerca, pulsante Add Question, tabella con ID/Text Snippet/Type/Actions e i pulsanti Edit/Delete per riga](img/manuale/questions-list.png)

Tutte le domande del sistema (di tutti i parametri). Filtri per parametro, template_type, stato attivo/inattivo, stop question. Le domande "stop" sono quelle che chiudono il blocco di un parametro.

---

### Edit/Add domanda

Per creare una domanda devi prima sceglierne il **parametro di appartenenza** (ID).

I campi principali:

- **ID** (es. `FGM_01`, convenzione `<param_id>_<NN>`);
- **Text**: il testo della domanda mostrato al linguista;
- **Template type**: classifica la domanda (utile per filtri statistici);
- **Instruction** (sempre visibile in compilazione);
- **Instruction YES** (visibile solo se la risposta è YES o UNSURE);
- **Instruction NO** (visibile solo se la risposta è NO);
- **Example YES**: un esempio illustrativo che il linguista vede sempre come riferimento;
- **Help info**: testo lungo, mostrato dietro un pulsante "More info";
- **Is stop question**: spunta se è una domanda di chiusura del parametro;
- **Active**: spunta per renderla disponibile in compilazione;
- **Allowed motivations**: lista di motivations selezionabili dal linguista quando risponde NO. Solo le motivations qui spuntate compaiono nel checkbox della compilazione.

---

### Modifiche distruttive: l'archivio

⚠ Modificare una domanda può **invalidare** le risposte già date. Esempi tipici:

- cambiare `template_type` da `boolean` a qualcos'altro;
- cancellare la domanda;
- eliminare delle motivations dalla lista delle "allowed";

In questi casi il sistema **non perde** i dati: sposta automaticamente le `Answer`/`Example`/`AnswerMotivation` collegate nell'**archivio domande** ([History → Old questions archive](#15-solo-admin--history-backups-import-recompute)). Lì restano consultabili in sola lettura, con uno snapshot della domanda così com'era prima della modifica.

---

## 10. SOLO ADMIN — Motivations

Pagina: **Sidebar > Motivations** (`/admin/motivations`).

![Pagina Motivations: ricerca, pulsante Add Motivation, tabella con Code/Description/Linked Questions/Actions e Edit/Delete per riga](img/manuale/motivations.png)

Le **motivations** sono i motivi predefiniti che un linguista può spuntare quando risponde NO a una domanda. Esempio: "no corresponding structure", "marginal phenomenon", "phonetically reduced".

### Lista

Ogni motivation ha:

- **Code**: identificativo univoco (es. `NO_STRUCT`);
- **Label**: il testo che appare al linguista (può essere lungo, multilinea).

---

### Modifiche

CRUD standard. Le motivations non si "cancellano" mai del tutto: se sono state usate da qualche risposta, il loro snapshot resta nell'archivio.

Le motivations vengono **collegate alle domande** dalla pagina [Questions](#9-solo-admin--questions) (campo **Allowed motivations**), non da qui.

---

## 11. SOLO ADMIN — Taxonomy

Pagina: **Sidebar > Taxonomy** (`/admin/taxonomy`).

![Pagina Taxonomy: tre colonne (Top-Families con + New, Unassigned Subfamilies, Unassigned Groups) con card per ciascuna famiglia e pulsanti Edit/Delete](img/manuale/taxonomy.png)

Editor della **gerarchia delle famiglie linguistiche**:

```
Top Family (es. Indo-European)
└── Family / Subfamily (es. Romance)
    └── Group (es. Italian-Romance)
```

Drag & drop tra livelli per riordinare. Click su un nome per editarlo, "+" per aggiungere un figlio, cestino per cancellare.

⚠ Le tre stringhe `top_level_family`, `family`, `grp` sulle Languages sono **denormalizzate**: vengono ricopiate dal taxonomy al save di una lingua. Modificare il taxonomy **non** rinomina automaticamente le stringhe sulle lingue esistenti — ti tocca riaprire e risalvare la lingua per propagare il cambio.

---

## 12. SOLO ADMIN — Accounts

Pagina: **Sidebar > Accounts** (`/admin/accounts`).

### Lista account

![Pagina Accounts: ricerca, pulsante Add Account, tre sezioni Administrators/Users/Public Users con i pulsanti Assign Langs e Delete per riga](img/manuale/accounts-list.png)

Tabella con: email, nome, cognome, ruolo (`admin/user/public`), numero di lingue assegnate.

Pulsanti:

- **Add account** (`/admin/accounts/add`): crea un nuovo account.
- **Assign languages** sulla riga: apre un pannello per selezionare il pool di lingue da assegnare a un user (multi-select).
- **Delete** sulla riga.

---

### Add account

![Form Create New Account: campi Name, Surname, Email, Temporary Password, dropdown Role e i pulsanti Cancel / Create Account](img/manuale/account-create.png)

Form con: nome, cognome, email, password temporanea (min 8 char), **role** (tendina: User / Admin / Public).

Dopo la creazione comunica all'utente le credenziali; al primo login lui dovrebbe cambiare la password.

⚠ Validazione email: il sistema rifiuta con errore "Invalid email format" se l'email è malformata (es. dimenticato il `.it`, doppia `@`, spazi). Questo evita la creazione di account che poi non riescono a loggarsi.

---

### Safeguards

- **Non puoi cancellare te stesso** (devi farti cancellare da un altro admin).
- **Non puoi cancellare l'ultimo admin** (rimarrebbe il sito senza amministratore).

---

### Riassegnazione lingue

L'**Assign languages** **sostituisce** il pool corrente: se un user aveva 3 lingue assegnate e tu spunti solo le altre 2 mantenendole nelle 5 nuove, le 3 vecchie tornano "non assegnate" (assegnabili ad un altro utente).

---

## 13. SOLO ADMIN — Table A

Pagina: **Sidebar > Table A** (`/tablea`).

![Pagina Table A: toggle Parameters View / Questions View, Language Filters e Parameters Filters, pulsanti Apply Filters / Reset / Download Data, e l'inizio della matrice valori](img/manuale/tablea.png)

La **TableA** è la matrice fondamentale del progetto: **una lingua per colonna, un parametro (o domanda) per riga**, con il valore consolidato in ogni cella (`+`, `−`, `0`, `?`).

### Modalità

- **Params** (default): righe = parametri.
- **Questions**: righe = singole domande.

Toggle in alto.

---

### Filtri

- **Lingue**: top family / family / group / historical / specifiche (checkbox per lingua nella sezione bassa);
- **Parametri**: schema, type, level of comparison;
- **Domande**: template, stop question (visibili solo in modalità Questions).

Dopo aver scelto i filtri, clicca **Apply** (o equivalente) per ricalcolare la matrice.

---

### Selezioni manuali

Oltre ai filtri, **per ogni riga** della tabella c'è una checkbox: ti permette di restringere ulteriormente l'analisi a un sottoinsieme di parametri/domande.

---

### Export e analisi

Dropdown **Download / Analysis ▾** in alto:

- **XLSX (parameters)** — Excel con header di citazione.
- **CSV (transposed)** — formato analitico standard.
- **Distance matrices (.txt)** — matrici Hamming e Jaccard.
- **Geographic distances (.zip)** — matrice GCD in km.
- **Dendrograms (.png)** — dendrogrammi UPGMA.
- **Cluster map (.html)** — mappa interattiva HTML dei cluster geografici.
- **PCA (.png)** — analisi delle componenti principali.
- **Mantel test (.zip)** — modale con tre checkbox (GCD, Hamming, Jaccard) per scegliere quali matrici correlare. Output: tabelle di correlazione + grafici.

⚠ Le distanze e i cluster sono significativi solo su set sufficientemente grandi e omogenei. Le lingue senza coordinate vengono escluse dalle distanze geografiche e l'header `X-Skipped-Languages` dell'export elenca quali.

---

## 14. SOLO ADMIN — Filters (Queries Q1–Q10)

Pagina: **Sidebar > Filters** (`/queries`).

![Pagina Filters & Queries: a sinistra il menu Queries Configuration con le 10 query elencate, a destra l'area di esecuzione della query selezionata](img/manuale/queries.png)

10 viste predefinite per interrogare il database in modo mirato. Menu a sinistra (collassabile), area principale a destra.

| Query | Domanda |
|---|---|
| **Q1** | Show implicational condition(s) (per parameter) |
| **Q2** | Show parameter values for all languages (per parameter) |
| **Q3** | Show **why** a parameter is neutralized (per language) ⭐ |
| **Q4** | Parameters with value `+` (per language) |
| **Q5** | Parameters with value `−` (per language) |
| **Q6** | Parameters with value `0` (per language) |
| **Q7** | Comparable parameters (per pair of languages) |
| **Q8** | Questions with answer YES (per language) |
| **Q9** | Questions with answer NO (per language) |
| **Q10** | Show answers and examples (per question) |

### Q3 — la più ricca

È la **debug view del DAG**: scegli una lingua e un parametro neutralizzato, e ottieni:

- la condizione implicazionale del parametro;
- per ogni `ref` citato nella condizione, qual è il suo valore (`value_eval` se presente, altrimenti `value_orig`);
- se la condizione è soddisfatta o no;
- la lista delle Answer del linguista che hanno contribuito al `value_orig` di ogni ref.

Utile per capire **perché** un certo parametro non viene confrontato in una certa lingua.

---

### Q10 — risposte ed esempi

Q10 ha 2 filtri opzionali (lingua + parametro) per **restringere il dropdown delle domande** disponibili. Lasciandoli vuoti, il dropdown mostra tutte le ~N centinaia di domande del sistema.

---

## 15. SOLO ADMIN — History, Backups, Migration, Backup Restore, Import Excel, Recompute

Tutto quello che riguarda **audit, snapshot, import/export massivi**.

### History & Backups (`/admin/history`)

Centro di **audit** del sito. La pagina ha **4 tab** in alto: ognuna risponde a una domanda diversa ("chi ha cambiato cosa", "chi ha risposto cosa", "ho uno snapshot completo da qualche parte", "che fine ha fatto la vecchia versione di una domanda?"). Le tab condividono lo stesso layout filtro-tabella ma popolano dati diversi.

#### Tab "Change history"

![Tab Change history: filtri per Entity Type, Entity ID, Operation, Source, User, From/To e Text search; pulsanti Reset / Apply filters; tabella delle modifiche con When/What/Op./Source/Author/Note e pulsante Open per ciascuna riga](img/manuale/history-versions.png)

Tabella di **tutte le modifiche** alle entità *non-Answer* del sistema: `parameter`, `question`, `motivation`, `language`. Pensata per rispondere a "chi ha modificato il parametro FGM e perché", "quando è stata creata la motivation MOT042?", "chi ha cancellato la lingua XYZ il mese scorso?".

Filtri disponibili: **Entity type** (tendina), **Entity ID** (es. `FGM`, `FGM_01`), **Operation** (create / update / delete), **Source** (manual = modifica dal pannello, excel_import = arrivata da un import Excel, system = generata dall'app), **User** (chi l'ha fatta), **From / To** (intervallo di date), **Text search** (cerca nell'ID o nella note). I pulsanti **Reset** azzera tutti i filtri, **Apply filters** rilancia la query.

Click sul pulsante **Open** di una riga (o sulla riga stessa) → si apre un **drawer laterale** con il **diff prima/dopo**: per ogni campo modificato, il valore vecchio in rosso a sinistra e quello nuovo in verde a destra, più uno snapshot completo collassabile in fondo.

#### Tab "Answer changes"

![Tab Answer changes: stessi filtri della tab precedente (senza Entity Type, perché qui sono solo Answer) e tabella con tutte le modifiche alle risposte](img/manuale/history-answers.png)

Versione "focalizzata sulle Answer" della stessa tabella. Ogni volta che un linguista (o un admin) clicca **Confident → Next** o **Unsure → Next** in un blocco parametro, qui compare una riga per ogni risposta toccata. Pensata per rispondere a "quando l'utente X ha messo YES alla domanda FGM_Qb per la lingua Italian?" o "chi ha cambiato la risposta della lingua francese per il parametro SPK il giorno tot?".

Stessa esperienza dell'altra tab: filtri, tabella, click su una riga → drawer con diff. La separazione esiste solo perché le Answer cambiano molto più spesso delle altre entità (ogni save di un blocco) e mescolarle con i parametri/domande renderebbe la tab "Change history" illeggibile.

#### Tab "Full backups (languages & parameters)"

![Tab Full backups: sotto-tab Languages / Parameters, card "Create global languages backup" con Note opzionale e pulsante "+ Create languages backup now", e tabella dei backup salvati](img/manuale/history-backups.png)

Lista degli **snapshot completi** del sistema, raggruppati per timestamp. Sotto-tab **Languages** o **Parameters** (toggle in alto), che selezionano due tipi diversi di snapshot:

- I **backup languages** sono creati da [Languages → + Full Languages Backup](#6-la-pagina-languages) e contengono tutte le lingue con risposte ed esempi al momento dello scatto.
- I **backup parameters** sono creati da [Parameters → + Full Parameters Backup](#8-solo-admin--parameters) e contengono lo stato di tutti i parametri (definizioni, condizioni implicazionali, descrizioni) al momento dello scatto.

Da qui puoi anche **crearne uno nuovo "al volo"**: la card in alto ha un campo **Note (optional)** e il pulsante **+ Create languages backup now** (o **+ Create parameters backup now** sull'altra sotto-tab). Cliccando una riga della tabella si apre il dettaglio del backup, con la possibilità di scaricare un Excel di tutti i dati per audit o restore esterno.

#### Tab "Old questions archive"

![Tab Old questions archive: descrizione del comportamento, ricerca, e tabella con Question ID / Parameter / numero di Archived versions / Latest archive / pulsante Show versions](img/manuale/history-old-questions.png)

Quando una domanda viene modificata in modo distruttivo (vedi §9 — cambio di `template_type`, cancellazione, rimozione di motivations) o cancellata, le sue Answer/Example/AnswerMotivation **non vengono perse**: vengono spostate qui in archivio insieme a uno snapshot del testo della domanda così com'era.

Ogni riga della tabella raggruppa **tutte le versioni archiviate di una stessa domanda** (es. se la domanda FGM_Qa è stata "rotta" 3 volte, qui vedi 3 versioni). Il pulsante **Show versions** apre il dettaglio: per ogni versione vedi il testo originale, le motivations consentite all'epoca, e tutte le risposte storiche di ogni lingua a quella versione della domanda.

Utile per chi deve dimostrare a un revisore "i dati linguistici originali esistono ancora, anche se la domanda nel frattempo è stata modificata".

---

### Migration Import (`/admin/migration-import`) — pericoloso

![Pagina Restore Database (Migration Import): box rosso "Operazione distruttiva" con l'avviso che con `wipe` attivo cancella tutte le tabelle dati, e blocco "Contenuto atteso del bundle" con la struttura del file ZIP](img/manuale/migration.png)

⚠ Voce in **rosso** nella sidebar perché può **cancellare il database**.

Serve a importare il **bundle ZIP del sito vecchio** (Django legacy) durante il go-live. Procedura tipica (vedi `DEPLOY_PROCEDURA.txt`):

1. Scarichi il bundle dal sito vecchio.
2. Vai su Migration Import.
3. Selezioni il file ZIP.
4. Spunti **wipe = true** per pulire il DB prima di importare.
5. Click **Import**.
6. Aspetti (può richiedere minuti, ci sono progress).

A fine import la password admin viene **riportata al valore di `ADMIN_PASSWORD`** delle env di Portainer (cambiala dopo l'import, non prima).

Validazione: cap 200MB sullo ZIP, anti-zip-bomb e check path-traversal sui nomi dei file.

---

### Backup Restore (`/admin/backup-restore`)

![Pagina Backup Restore: descrizione del bundle accettato, file picker "Backup ZIP file", checkbox "Wipe data tables before restore", pulsanti Start restore e "← Need Migration Import instead?"](img/manuale/backup-restore.png)

Restore di un **bundle ZIP esportato** da [Languages → Download Data → Export backup (.zip)](#6-la-pagina-languages). Permette di ripristinare un set di lingue specifiche da uno snapshot precedente, senza wipe del DB.

---

### Import from Excel (`/admin/import-excel`)

![Pagina Import from Excel: blocco Strategy (Schema strict update / Database_model full replace / Cascading errors), file picker File Excel, pulsanti Start Import e Cancel](img/manuale/import-excel.png)

Import strutturato da Excel. Cap 50 MB sul file. Il foglio deve seguire il formato del round-trip ([documentation_it.md](documentation_it.md) §10.4).

---

### Recompute final values

⚠ **Da Languages → Recompute final values**, non c'è una pagina dedicata.

Rilancia il **DAG implicazionale** per **tutte** le lingue del sistema. Da usare:

- dopo aver modificato condizioni implicazionali importanti;
- dopo un import bulk;
- se sospetti che qualche `value_eval` sia stale.

È un job asincrono (può richiedere minuti su dataset grossi). Toast in basso a destra mostra il progresso. Quando finisce: messaggio "Recompute complete" o "Recompute completed with N error(s) over M language(s). See server logs for details" se qualche lingua ha problemi.

---

## 16. Errori comuni e cosa fare

### "Form locked by the current language status"

Stato della lingua è `Waiting for approval` o `Approved`, e tu non sei admin. Aspetta la decisione, oppure (se sei tu l'utente assegnato e la lingua è `Rejected`) clicca **Reopen**.

### "Question X needs at least 2 valid examples when answering YES or UNSURE"

Hai messo YES o UNSURE su una domanda con meno di 2 esempi non vuoti. Aggiungi/completa gli esempi, riprova.

### "This block has been modified by another session..."

Un altro utente (di solito un admin) ha modificato lo stesso blocco mentre lavoravi. La pagina si ricarica automaticamente: rivedi le modifiche fatte da altri prima di riprovare il tuo save.

### "Wrong email or password"

Le credenziali sono errate. Se non ricordi: contatta un admin (il reset via email non è ancora attivo).

### "Too Many Requests" al login

Hai sbagliato password 5 volte di fila in 1 minuto. Aspetta 1 minuto e riprova.

### "Invalid email format"

Stai creando un account o cambiando email con un valore non valido (es. dimenticato il `.it`, spazio, doppia `@`). Correggi.

### "You cannot delete your own account"

Devi farti cancellare da un altro admin.

### "You cannot delete the last remaining administrator"

Crea un secondo admin **prima** di cancellare quello esistente.

### Il pulsante "Submit for approval" non c'è

- Stato della lingua è già `Waiting for approval` o `Approved`: niente da fare.
- Stato è `Rejected`: vedi **Reopen**, non Submit.
- Non sei l'utente assegnato a questa lingua: solo l'utente assegnato può fare Submit.
- Sei admin: gli admin non submittano (passano direttamente da approve/reject).

### Il sito mi ha sloggato all'improvviso

Token scaduto (30 min di inattività). Fai login di nuovo.

### Ho cambiato il taxonomy ma le lingue mostrano ancora i vecchi nomi

Le stringhe `top_family`/`family`/`group` sulle lingue sono denormalizzate. Riapri ogni lingua interessata e fai un Save (anche senza cambiare nulla) per propagare i nuovi nomi. Per fare questo in massa: usa l'export Excel, modifica e ri-importa.

---

## 17. Glossario rapido di interfaccia

| Termine | Significato |
|---|---|
| **Wizard / quadratini** | la fila di pulsantini in alto nella pagina di compilazione, uno per parametro |
| **Block / blocco parametro** | l'insieme di tutte le domande di un parametro per una lingua |
| **Confident / Unsure** | i due pulsanti di salvataggio del blocco. Confident = tutto verificato; Unsure = ho dei dubbi, ricontrollo dopo |
| **Stale block (409)** | un blocco che è stato modificato da un'altra sessione mentre stavi editando |
| **Submit for approval** | l'invio della lingua all'admin per la revisione |
| **Reopen** | riportare a `Pending` una lingua `Rejected` |
| **Approved / Rejected / Pending / Waiting** | i 4 stati di una lingua |
| **Admin override** | il banner viola che ricorda all'admin che sta editando una lingua bloccata |
| **Force status** | il dropdown admin per forzare lo stato di una lingua bypassando il workflow |
| **DAG implicazionale** | il grafo di dipendenze tra parametri (`+SPK & -DEM`) che decide se un valore va neutralizzato |
| **value_orig vs value_eval** | `orig` = aggregato dalle risposte del linguista; `eval` = `orig` post-DAG (può essere `0` se neutralizzato) |
| **Comparable** | un parametro è "comparable" tra due lingue se entrambe hanno un `value_eval` non nullo |
| **Implicational condition** | la stringa tipo `+SPK & -DEM` che scatena la neutralizzazione |
| **Neutralized** | un parametro forzato a `0` perché la sua condizione implicazionale non è soddisfatta |
| **Flagged / Unsure parameter** | parametro segnato come "incerto" dal linguista (quadratino giallo) |
| **Red parameter** | nella Dashboard admin, parametri "rossi" = unsure o incompleti |
| **Hamming / Jaccard distance** | metriche di distanza tra lingue basate sui valori dei parametri |
| **GCD** | Geographic Distance, distanza in km calcolata da lat/lng |
| **Mantel test** | test statistico che misura la correlazione tra matrici di distanza |
| **Top family / Family / Group** | i 3 livelli della tassonomia linguistica |
| **Glossary / Glossario** | dizionario dei termini tecnici |
| **Instructions** | la pagina con le linee guida di compilazione |
| **How to cite** | la pagina con le citazioni bibliografiche del PCM Hub |
| **Bundle ZIP** | l'archivio compresso usato per migration / backup-restore |
| **Recompute** | il job che rilancia il DAG su tutte le lingue |

---

*Per dubbi, suggerimenti o segnalazioni di bug: scrivi a `pcm_lab@unimore.it` (link in fondo a ogni pagina del sito).*
