# RIEPILOGO MODIFICHE
- [ ] Roberto Romano per problemi con mail, password e https
- [ ] Servizi informatici per espandere disco della vm a 20 GB
- [ ] Federico (191685@studenti.unimore.it) per script della mappa su cui sono visualizzati i risultati del k-means clustering

## LANDING PAGE

## PUBLIC
(ancora non so esattamente cosa sarà visualizzabile per questi utenti)

## DASHBOARD

## HOW TO CITE
- [ ] Quando si modifica la ref con "Edit reference", si può fare in modo che la ref compaia nel riquadro modificabile come nel sito vecchio? 

## LISTA LINGUE
- [ ] Dopo aver applicato i filtri, vorrebbero trovare un modo per deselezionare le lingue che non vogliono ma che sono state identificate dai filtri, es. se seleziono le lingue indoeuropee ma per qualche motivo non voglio l'italiano nella mappa e nelle distanze si dovrebbe poter deselezionare solo l'italiano e mantenere le altre indoeuropee
- [ ] Si può inserire un modo per decidere sulla base di cosa assegnare i colori nella mappa? Se per "top-level family", "subfamily", "group" oppure "historical". I filtri mi sembrano ottimi, solo se seleziono due o più top-family oppure subfamily bisognerebbe che la mappa fosse colorata ancora per top-family/subfamily e non per il livello filogenetico più ristretto, mentre se seleziono solo una top-family/subfamily va bene che la mappa sia colorata per il livello più ristretto, come fa ora
- [ ] Forse vorrebbero che scaricando il png della mappa si vedesse anche la legenda
- [ ] È scomparsa l'intestazione nel file xlsx scaricabile da "Export language metadata": [Name	ID	Top-level family	Family	Group	ISO code	Glottocode	Location	Latitude	Longitude	Supervisor	Informant	Historical	Source  Status] e possiamo aggiungere le colonne [Assigned user Date last change] 
- [ ] Da export parametric data toglierei i fogli Motivations, Parameters, Questions e QuestionAllowedMotivations. Il foglio Database_model è necessario per reimportare una lingua o sono sufficienti gli altri fogli? Database_model riesce a importare anche le motivazioni selezionate per ciascuna lingua e le admin notes? In quel foglio toglierei le colonne [Question	Question_Examples_YES	Question_Intructions_Comments]
- [ ] Scaricare la mappa di Lorenzo e Federico
- [ ] Mettere un pulsante unico che ricalcoli i final values per tutte le lingue
- [ ] Nella tabella inserire la colonna Top family prima di Subfamily e possiamo togliere Geography

## LINGUE DATA
- [ ] Sostituire "Export (.xlsx full)" con "Export parametric data (.xlsx)"
- [ ] Mi dicevano che piaceva molto l'idea di avere due esempi appaiati
- [ ] Possiamo ridurre le dimensioni di default delle celle in cui sono inseriti esempi, glosse, ecc perché nella maggioranza dei casi non ci va molto testo

## DEBUG PARAMETRI
- [x] Fare in modo che se una condizione implicazione è falsa il parametro vada a 0 indipendentemente dalle risposte che sono state date alle sue question. Ora se c’è un’incongruenza tra tra questions e stop-questions giustamente la rileva, mette il warning e lo propaga, mentre vorrebbero che siccome tanto il parametro deve andare a 0 ci fosse un warning “arancione” solo sulle answers/initial value, ma questo non bloccasse lo 0 e i parametri che dipendono da quello

## LISTA PARAMETRI
- [ ] In "Download parameters info (.pdf)" aggiungere le info relative alle questions, come nel download dei singoli parametri (per le allowed motivations toglierei il label, es MOT004, e lascerei solo il testo della motivazione senza parentesi, vedi ad esempio nel pdf di SPK, Qa)

## PARAMETERS EDIT
- [ ] Sia che disattivo una question sia che la riattivo il warning dice sempre "It will disappear from the form"

## LISTA QUESTIONS

## LISTA MOTIVATIONS

## NETWORK
-  [ ] È scomparsa questa pagina

## TABLE A
- [ ] Invertire group e historical e sostituire family con subfamily
- [ ] Visualizzare come rossi/sfondo rosso i valori dei parametri che sono rossi perché non compilati completamente/unsure in lingue data

## FILTERS

## BACKUP
- [ ] L'orario che mostra per i backup è circa due ore indietro
- [ ] Poter scaricare i backup in formato excel (come in Old questions archive)

## ACCOUNTS

## INSTRUCTIONS

## GLOSSARIO