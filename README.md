# Scheda sanitaria scout

Frontend responsive in italiano per il modello FSE Roma 21, anno scout 2026–2027. La compilazione, l’importazione ZIP e la generazione dei PDF avvengono nel browser. Il server serve esclusivamente file statici: non riceve né memorizza le risposte.

## Avvio

Con Node.js 18 o successivo:

```sh
npm start
```

Aprire http://127.0.0.1:4173. Per eseguire l’app non occorre installare pacchetti: librerie, font e modello sono inclusi in `public/`. È possibile pubblicare `index.html`, `src/`, `public/` e `campo/` su un hosting statico HTTPS, alla radice del sito. Non aprire `index.html` direttamente con `file://`, perché i moduli e le risorse richiedono HTTP.

## Uso

1. Leggere le indicazioni e l’informativa originali, quindi compilare le sezioni. Le risposte non sono preselezionate.
2. Scegliere esplicitamente “No” per le voci sanitarie non pertinenti. Scegliendo “Sì” compaiono i dettagli. Il PDF compatto riassume le risposte negative in una riga e non stampa sezioni vuote.
3. Nel riepilogo scaricare lo ZIP: contiene `scheda.json` e `scheda-compatta.pdf`.
4. Scaricare anche il PDF originale, oppure importare lo ZIP in seguito nella stessa applicazione per ricrearlo dai dati JSON. Il PDF dentro lo ZIP non viene usato come fonte dei dati.
5. Controllare le copie stampate e firmarle. L’originale rimane in sede; la copia compatta accompagna le attività. Prescrizioni mediche e tesserini di esenzione, ove previsti, vanno consegnati separatamente: questa applicazione non acquisisce gli allegati medici.

Le risposte sono mantenute soltanto in memoria. Ricaricare o chiudere la pagina le elimina; il browser avvisa quando ci sono modifiche non esportate. Lo ZIP contiene dati sanitari in chiaro e non è cifrato. Il consenso può essere concesso o negato: entrambe le scelte vengono riportate, senza preselezione.

## PDF e fedeltà del modello

- **Compatto:** impaginazione A4 dinamica con dati, dichiarazioni applicabili, scelta del consenso e firme. Copertina, informazioni preliminari e informativa non vengono stampate. Numero di pagine variabile in base ai contenuti; una scheda semplice occupa circa 1 pagina, una scheda con tutte le sezioni valorizzate circa 2.
- **Originale:** il PDF fornito viene incorporato come base, conservandone tutte le 11 pagine e aggiungendo il testo negli spazi esistenti. Non è una ricostruzione grafica. Le firme rimangono vuote.
- I testi che non entrano negli spazi dell’originale vengono richiamati con `Vedi A1`, `Vedi A2`, ecc. e riportati integralmente in pagine di allegato. Il documento può quindi superare 11 pagine. Anche le informazioni aggiuntive prive di uno spazio dedicato nel modello vengono riportate negli aggiornamenti o nell’allegato.
- I caratteri supportati da Noto Sans, inclusi gli accenti italiani, vengono incorporati. Se un carattere non è disponibile nel font, la generazione si interrompe indicando il campo da correggere; non sostituisce né elimina caratteri senza avvisare.
- Le parti informative sono trascritte dal PDF e mantenute come testo originale, comprese eventuali ripetizioni presenti nella fonte.

## Formato dello ZIP

`scheda.json` contiene `format: "scout-sanitaria"`, `version: 1`, identificativo del modello, SHA-256 del modello di riferimento, data di esportazione e oggetto `data` con chiavi definite in `src/schema.js`. I dettagli delle sezioni non attive non vengono esportati. L’importazione verifica versione, modello, struttura, tipi, lunghezze, risposte e campi obbligatori prima di sostituire lo stato attuale. Se esistono dati in pagina viene richiesta conferma per sostituirli. Il riferimento SHA-256 identifica il modello compatibile; non autentica il contenuto dello ZIP né costituisce una firma digitale.

Il limite di importazione è 12 MB compressi, 10 voci, 16 MB per voce e 256 KB per il JSON. Un archivio non valido non sostituisce la scheda aperta. Conservare questa versione dell’app e il relativo modello per mantenere la compatibilità degli archivi.

## Struttura

- `src/schema.js`: campi, condizioni di visibilità, validazione, normalizzazione delle sezioni attive.
- `src/app.js` e `src/style.css`: interfaccia e riepilogo.
- `src/pdf.js`: impaginazione compatta, coordinate del modello e gestione dei testi lunghi.
- `src/archive.js`: esportazione e importazione ZIP.
- `src/content.json`: informazioni e dichiarazioni estratte dal modello.
- `scripts/serve.mjs`: server statico locale, senza endpoint per dati sanitari.

## Verifiche

Con il server avviato, installare le sole dipendenze di sviluppo e il browser di test:

```sh
npm install
npx playwright install chromium
npm test
```

I test usano esclusivamente dati fittizi e verificano compilazione nell’interfaccia, campi condizionali, PDF compatto e originale, importazione/esportazione senza alterazioni, consenso negato, rappresentante, tutte le modalità di somministrazione, testi lunghi, scarto dei dettagli non pertinenti, archivi non validi, assenza di richieste esterne e larghezza mobile a 390 px. Generano PDF e screenshot sotto `tmp/pdfs/`, esclusa dal controllo versione.

Per verificare il testo e la conservazione delle pagine originali, dopo i test browser:

```sh
python3 -m pip install pypdf
python3 tests/verify_pdfs.py
```

Le dipendenze distribuite con il frontend sono elencate in `public/vendor/THIRD_PARTY_NOTICES.md`.

## Al campo: archivio del gruppo sul telefono

Aprire **http://127.0.0.1:4173/campo/** per l’anteprima locale. L’app del campo è separata dal modulo di compilazione e usa gli stessi pacchetti ZIP. Permette di:

- caricare più ZIP insieme o un backup dell’intero gruppo;
- cercare per nome, cognome, codice fiscale, codice socio o unità, selezionare uno scout e filtrare per unità, allergie, terapie/farmaci o dieta;
- leggere le informazioni in evidenza e la scheda completa, con numeri telefonici chiamabili;
- esportare PDF compatto, originale e pacchetto individuale anche offline;
- salvare e ripristinare un backup ZIP di tutte le schede e del nome del campo;
- rimuovere una singola scheda o svuotare esplicitamente l’archivio del dispositivo.

I dati e gli ZIP originali sono conservati in **IndexedDB**, dopo il completamento della transazione di salvataggio. Il salvataggio sopravvive alla chiusura della pagina e al riavvio del browser. I file dell’app, il modello PDF, i font e le librerie sono precaricati dal **service worker**: lo stato “Pronta offline” appare dopo averne verificato la disponibilità in cache. Nessun dato viene inviato al server. L’app chiede al browser la memoria persistente, ove disponibile, e comunica se la richiesta viene accordata. La concessione dipende dal browser; la cancellazione manuale dei dati del sito elimina comunque le schede.

### Installazione e prova prima del campo

1. Pubblicare l’intero frontend su un hosting statico **HTTPS**, alla radice del dominio. Includere `index.html`, `campo/`, `src/` e `public/`. Il server deve servire `campo/sw.js` come JavaScript, `campo/manifest.webmanifest` come manifest JSON e `campo/` come `campo/index.html`. Lo script `npm start` è un’anteprima locale; non fornisce un indirizzo pubblico HTTPS.
2. Aprire l’indirizzo HTTPS `/campo/` sul telefono, inizialmente con connessione. Su iPhone usare Safari → Condividi → Aggiungi alla schermata Home. Su Android usare il comando Installa app / Aggiungi a schermata Home del browser oppure il pulsante di installazione, quando disponibile.
3. **Aprire l’app dall’icona installata e caricare i pacchetti lì.** Un’app installata può avere una memoria separata dalla scheda del browser, specialmente su iPhone: non presumere che i dati caricati prima dell’installazione siano già nella nuova app.
4. Attendere **Pronta offline**, verificare il numero degli scout e scaricare un backup del gruppo. Attivare la modalità aereo, chiudere e riaprire l’app dall’icona, quindi cercare uno scout e aprire la scheda.

`127.0.0.1` si riferisce al dispositivo su cui si apre il link: l’indirizzo locale del computer non apre l’app sul telefono. I service worker richiedono HTTPS; localhost è l’eccezione per lo sviluppo. Riferimenti: [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [web.dev: installazione delle PWA](https://web.dev/learn/pwa/installation), [MDN: memoria persistente](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

L’archivio resta nel browser/app, sul dispositivo e sul dominio usati per importarlo. Non ci sono sincronizzazione o copia automatica su altri telefoni. La navigazione privata non è adatta alla conservazione dei dati. Un backup permette di trasferire il gruppo a un altro telefono o ripristinarlo dopo la cancellazione della memoria.

### Importazioni e aggiornamenti

Il codice fiscale identifica ogni scout; due nomi uguali con codici fiscali diversi restano due schede distinte. Pacchetti identici vengono saltati. Se un pacchetto ha lo stesso codice fiscale ma dati diversi, l’app mostra le differenze e permette di scegliere esplicitamente la sostituzione; nessun aggiornamento è selezionato automaticamente. Non sceglie in autonomia la scheda “più recente”. Un conflitto arrivato da un’altra finestra durante l’importazione annulla la transazione, evitando sostituzioni involontarie. Gli archivi non validi vengono elencati prima del salvataggio, mentre quelli validi possono essere importati dopo la revisione.

Limiti: 400 schede nel gruppo, 75 MB complessivi di pacchetti salvati; 400 pacchetti e 80 MB per importazione. Restano validi i limiti del pacchetto individuale descritti sopra. Un backup contiene `campo.json` (formato `scout-campo`, versione 1) e i pacchetti individuali in `pacchetti/`. L’app non acquisisce né verifica firme o allegati medici; riporta le dichiarazioni contenute nel JSON.

### Verifica dell’app del campo

Con il server avviato e Playwright installato:

```sh
npm run test:campo
```

La suite verifica importazione multipla, nomi uguali, scarto di file non validi, aggiornamenti espliciti, ricerca e filtri, contatti chiamabili, testo importato trattato come testo, transazioni annullate senza scritture parziali e conflitti fra finestre. Chiude completamente Chromium, lo riapre con lo stesso profilo e rete disabilitata **prima della navigazione**, quindi verifica consultazione, esportazione dei PDF, backup, cancellazione e ripristino offline. Controlla anche il layout a 390 px. I test sono eseguiti in Chromium: la prova sul telefono di destinazione resta parte della preparazione prima del campo.

Per pubblicare aggiornamenti, incrementare `VERSION` in `campo/sw.js` ogni volta che cambiano i file precache. L’app propone il pulsante di aggiornamento e lo applica fuori dalle operazioni di importazione/esportazione; i dati IndexedDB restano separati dalla cache dell’app.

## Pubblicazione su Netlify

Entrambe le app sono predisposte per **un solo progetto Netlify**: il compilatore su `/` (con alias `/compila`) e l’archivio offline su `/campo/`. Il dominio HTTPS del progetto rimane il punto di accesso da usare sui telefoni.

### Build e anteprima

```sh
npm run build
npm run preview
```

La build genera esclusivamente `dist/`, con file frontend, modello PDF vuoto, font, librerie, manifest, pagina 404 e regole Netlify. Esclude test, esempi compilati, documenti di lavoro, backup, credenziali e file Git. Non necessita di dipendenze npm per la compilazione: usa soltanto i moduli inclusi in Node.js.

Il service worker riceve automaticamente una versione derivata dal contenuto dei file pubblicati. Un aggiornamento del sito produce una nuova cache; l’app propone l’aggiornamento conservando IndexedDB. Per i deploy con `npm run build` non occorre modificare manualmente `VERSION`. Il dominio di produzione va mantenuto stabile: un indirizzo di anteprima diverso ha una memoria del browser separata.

### Collegamento del repository

Dopo che i file del progetto sono stati committati e inviati al repository, in Netlify selezionare **Add new project → Import an existing project**, scegliere il provider Git e il repository del progetto. `netlify.toml` imposta:

- Base directory: radice del repository.
- Build command: `npm run build`.
- Publish directory: `dist`.
- Node.js: versione 22.
- Dipendenze di sviluppo escluse dalla build; nessuna funzione server o variabile segreta richiesta dal sito.

Il file di configurazione è pronto nel progetto locale; diventa disponibile a Netlify soltanto dopo il push. Per un progetto già esistente, collegare lo stesso repository e applicare le medesime impostazioni, mantenendone il dominio.

### Pubblicazione manuale

In alternativa, il file `output/scout-sanitaria-netlify.zip` contiene il **sito compilato**: caricarlo con la funzione di deploy manuale di Netlify, oppure trascinare la cartella `dist/`. Le regole `_headers` e `_redirects` sono già incluse e valgono anche per un deploy senza repository. Non caricare la cartella dell’intero progetto o gli ZIP con le schede delle famiglie.

### Regole e verifiche

- Header di sicurezza, Content Security Policy con risorse locali e blocco dell’invio dei moduli.
- Service worker servito come JavaScript con ambito `/campo/`, manifest con tipo corretto e risorse HTTP da rivalidare, senza impedire la cache offline esplicita.
- Nessuna riscrittura globale verso il compilatore: URL inesistenti restituiscono 404, evitando che un asset mancante venga interpretato come HTML.

Le suite browser accettano `TEST_BASE_URL`, per verificare sia la build locale sia il dominio Netlify definitivo:

```sh
TEST_BASE_URL=https://nome-progetto.netlify.app npm test
TEST_BASE_URL=https://nome-progetto.netlify.app npm run test:campo
```

Le prove usano soltanto dati fittizi nel browser; non inviano le risposte a Netlify. Sono state eseguite sulla build pubblicabile con gli header di produzione, includendo il riavvio del browser senza rete.

Riferimenti: [configurazione Netlify](https://docs.netlify.com/build/configure-builds/file-based-configuration/), [header personalizzati](https://docs.netlify.com/manage/routing/headers/), [deploy manuali](https://docs.netlify.com/deploy/create-deploys/).
