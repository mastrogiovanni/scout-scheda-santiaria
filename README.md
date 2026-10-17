# Scheda sanitaria scout

Frontend responsive in italiano per il modello FSE Roma 21, anno scout 2026–2027. La compilazione, l’importazione ZIP e la generazione dei PDF avvengono nel browser. Il server serve esclusivamente file statici: non riceve né memorizza le risposte.

## Avvio

Con Node.js 18 o successivo:

```sh
npm start
```

Aprire http://127.0.0.1:4173. Per eseguire l’app non occorre installare pacchetti: librerie, font e modello sono inclusi in `public/`. È possibile pubblicare `index.html`, `src/` e `public/` su un hosting statico HTTPS, alla radice del sito. Non aprire `index.html` direttamente con `file://`, perché i moduli e le risorse richiedono HTTP.

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
