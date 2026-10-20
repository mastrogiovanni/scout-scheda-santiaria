# Scheda sanitaria scout

Tre frontend statici in italiano: compilazione `/`, area capi `/capi/`, archivio offline `/campo/`. Supabase fornisce Auth e PostgreSQL/RPC; non occorre un backend applicativo o una Netlify Function. Le schede online sono JSON cifrati nel browser con la chiave pubblica del capo. La chiave privata viene consegnata esclusivamente come QR in un PDF stampabile e non viene inviata a Supabase né scritta in cookie, localStorage, sessionStorage, IndexedDB o cache dell’app.

## Avvio e build

```sh
npm start
# http://127.0.0.1:4173
npm run build
npm run preview
```

Node.js 18+ per sviluppo/build; Node.js 22 su Netlify. Librerie, font, lettore e generatore QR sono inclusi in `public/`: nessun CDN viene contattato durante l’uso. Pubblicare `dist/` alla radice di un dominio HTTPS. Non usare `file://`. HTTPS è necessario per camera, Web Crypto e service worker; localhost è ammesso per sviluppo.

## Configurazione Supabase

1. Applicare `supabase/migrations/202610190001_zero_trust.sql` e poi `supabase/migrations/202610190002_delete_sheet.sql` al progetto Supabase. La prima crea tabelle, RPC e policy con prefisso `scout_secure_`; funziona anche senza le vecchie migrazioni del 18 ottobre. La seconda aggiunge l’eliminazione delle singole consegne da parte del proprietario ed è riapplicabile; crearne la funzione non elimina dati esistenti.
2. In Auth abilitare l’accesso email/password e la registrazione. Configurare Site URL e redirect consentiti per il dominio pubblicato; la conferma email riporta al sito, poi il capo accede con email e password. Verificare la consegna delle email del progetto.
3. Per `npm start`, impostare URL e chiave **pubblicabile/anon** in `src/supabase-config.js`. Per Netlify/build, usare `PUBLIC_SUPABASE_URL` e `PUBLIC_SUPABASE_PUBLISHABLE_KEY` come in `.env.example`: la build genera la configurazione pubblica in `dist/` e aggiorna la CSP per quel progetto.
4. Non usare chiavi `secret` o `service_role`. La build rifiuta quelle chiavi nelle variabili pubbliche. Non serve un segreto server.
5. Pubblicare e provare il percorso con dati fittizi. La configurazione del repository lascia intenzionalmente vuota la chiave pubblicabile.

Auth identifica il capo; le RPC e RLS autorizzano l’accesso soltanto ai suoi gruppi e alle sue consegne. I genitori non creano account: possono leggere il destinatario e inviare una consegna soltanto conoscendo il link del gruppo. I ruoli anonimi non leggono tabelle o schede; le scritture avvengono attraverso RPC con privilegi espliciti. La chiave pubblica del capo non è modificabile dopo il censimento.

Se l’indirizzo è già registrato e confermato, una nuova richiesta di registrazione può restituire una risposta generica senza inviare un’altra email. Usare **Accedi**. Il comando **Password dimenticata o primo accesso con password?** invia un link di recupero su richiesta esplicita, utile anche per gli account che prima usavano un link email. Il link apre il modulo per impostare una password, dopo la verifica della sessione con Supabase; i token vengono rimossi dall’URL e la password non viene salvata dal frontend.

La sessione Auth (token di accesso e rinnovo, senza chiave crittografica privata) è conservata in sessionStorage per la scheda del browser. Logout la elimina; l’account permette di gestire i gruppi ma non sostituisce il QR privato.

### Passaggio dalla raccolta precedente

Le tabelle `scout_*` e il bucket `scout-packages` della vecchia versione restano intatti. Non si copiano automaticamente schede in chiaro nel nuovo archivio e non si cancellano dati esistenti. Il server locale non espone più `/api/raccolta`; Netlify usa la cartella vuota `netlify/static-only`, quindi non distribuisce le vecchie Functions. `server/`, `netlify/functions/` e i vecchi test `collection*` rimangono esclusivamente come sorgenti storiche.

Prima di ritirare un’installazione precedente, gestire la conservazione e la cancellazione delle vecchie raccolte: il nuovo deploy statico non esegue più il vecchio job pianificato. Le vecchie variabili segrete Netlify non sono usate dalla nuova applicazione. I nuovi dati cifrati non hanno una cancellazione automatica per data.

## Area capi

1. Creare un account e confermare l’email, se richiesto dal progetto Supabase.
2. Inserire il nome e scegliere **Genera e scarica il PDF privato**. La coppia ECDH P-256 nasce con Web Crypto nel browser. Il PDF A4 contiene il QR privato e l’impronta della pubblica. Verificarlo, stamparlo, custodirlo e confermare il censimento: sul backend vengono registrati nome, pubblica e impronta.
3. Il PDF scaricato è la copia consegnata all’utente. L’app non ne mantiene una copia persistente; occorre gestire anche il file nei Download e la stampa. Prima del completamento del censimento si può generare un nuovo PDF: sostituisce la coppia appena creata. Non esiste recupero della privata attraverso password, account o backend.
4. Creare un gruppo indicando unità e anno scout, per esempio **Esploratori · 2026-2027**. Il link contiene un token casuale da 256 bit e l’impronta della chiave pubblica, entrambi nel frammento `#`, che non viene inviato all’hosting. Nel database si conserva soltanto SHA-256 del token.
5. Copiare il link e incollarlo su WhatsApp o altro canale. È condiviso da tutte le famiglie del gruppo. Il link completo resta in memoria fino alla chiusura della pagina; dopo è possibile generarne uno nuovo, revocando il precedente. È anche possibile chiudere e riaprire le consegne.
6. Aprire il gruppo per scaricare tutte le buste cifrate (pagine da 20 elementi), oppure esportarle in un JSON cifrato. Il database conserva ciascuna scheda come documento JSON `envelope` associato al gruppo; non viene caricato il PDF o lo ZIP in Storage.
7. Scegliere **Scansiona QR privato** e mostrare il foglio alla camera del computer. Il lettore funziona anche nei browser privi di BarcodeDetector. Una chiave di un altro capo viene rifiutata. La chiave importata non è esportabile e viene rilasciata dopo la decifratura. I risultati rimangono soltanto in memoria della pagina. **Dimentica schede decifrate**, cambio gruppo e logout li eliminano.
8. Se una consegna è danneggiata o non compatibile, viene segnalata separatamente: le schede valide restano utilizzabili. In presenza di più consegne della stessa persona, scegliere esplicitamente una sola versione confrontando i dati. La preparazione rifiuta duplicati dello stesso codice fiscale.
   La lista è raggruppata per scout: ogni versione mostra data e ora di ricezione sul server, inclusi i secondi, nel fuso Europe/Rome. **Dettagli** apre i dati leggibili e la data di compilazione senza cambiare la selezione. **Elimina** rimuove definitivamente una sola consegna dal gruppo, dopo conferma, anche se non è decifrabile. La RPC controlla il proprietario e il gruppo della scheda; anonimi e altri capi non possono eliminare. Conteggi, selezioni ed esportazioni vengono aggiornati dopo la risposta del server. Le copie già stampate, esportate o caricate su un telefono restano indipendenti.
9. Dopo lo sblocco, selezionare gli scout e scegliere **Scarica PDF ridotto del campo**: viene generato localmente un PDF unico, con una nuova pagina per ogni scheda, senza dichiarazioni, consenso o firme. I testi lunghi proseguono su altre pagine senza tagli. La selezione rifiuta duplicati dello stesso codice fiscale. Il pulsante scompare quando si dimenticano le schede o si cambia gruppo.
10. Scegliere **Mostra QRVideo**. Aprire `/campo/` sul telefono, avviare la preparazione e inquadrare lo schermo. Avviare la ripetizione; velocità regolabile da 1 a 5 QR/s, pausa e navigazione manuale fra frammenti.

Limiti: 100 gruppi per capo, 400 consegne per gruppo, 256 KB di JSON per scheda. Non vengono acquisiti documenti firmati, prescrizioni o allegati medici. Una nuova consegna corregge la precedente senza sovrascriverla; il capo sceglie quale versione portare al campo.

## Compilazione e consegna

Il genitore apre il link, controlla gruppo, anno e capo destinatario, compila o importa uno ZIP precedente. L’impronta nel link viene confrontata con la chiave pubblica restituita da Supabase prima di consentire l’invio.

Nel riepilogo sceglie esplicitamente l’invio e preme **Invia scheda cifrata**. Il browser valida i dati e cifra soltanto il JSON con una nuova chiave effimera e nuovi salt/IV. Il backend riceve una busta JSON opaca, associata al gruppo, senza nomi, codici fiscali o informazioni sanitarie in colonne separate. L’identificativo di consegna e il ciphertext vengono riutilizzati se un errore di rete richiede un nuovo tentativo: la RPC restituisce la stessa ricevuta e non crea duplicati. Attendere la ricevuta prima di considerare completata la consegna.

Lo stesso link può essere usato più volte. Dopo la ricevuta, **Compila un’altra scheda** svuota il modulo mantenendo il gruppo, per esempio per un altro figlio. **Correggi questa scheda** conserva le risposte per inviare una nuova versione. Anche modificare, importare o svuotare il modulo riattiva la consegna: ogni nuova compilazione richiede nuovamente la scelta esplicita d’invio e riceve un nuovo UUID, senza sostituire le consegne precedenti. Il capo sceglie quale versione portare al campo. Il link rimane in memoria durante queste operazioni e non occorre ricaricare la pagina.

La compilazione offre il PDF originale e l’invio cifrato al gruppo direttamente dai dati validati del modulo. Non genera ZIP, nemmeno per preparare la consegna, e non offre comandi per scaricarli o condividerli. È ancora possibile importare uno ZIP precedente. Il PDF contiene dati sanitari in chiaro e non viene caricato durante la consegna cifrata. Le risposte del modulo rimangono in memoria fino alla chiusura/ricaricamento. Non viene salvata una bozza automatica.

### Cifratura

`src/crypto.js` usa Web Crypto: ECDH P-256, chiave effimera per consegna, HKDF-SHA-256 con salt casuale di 32 byte e chiave AES-256-GCM con IV casuale di 12 byte e tag da 128 bit. L’AAD vincola formato/versione, gruppo, impronta del destinatario e UUID della consegna. Cambiare questi valori o il ciphertext fa fallire la decifratura. Il JSON privato nel QR usa il formato versionato `SCOUT-KEY-1:`; il backend accetta soltanto i campi previsti della busta e della pubblica.

Il backend non dispone del materiale per decifrare le schede; resta necessario fidarsi del codice frontend distribuito e del dispositivo che lo esegue. La cifratura non autentica l’identità del compilatore: chi possiede il link può inviare una scheda. La perdita del QR privato rende irrecuperabili le consegne già cifrate per quella coppia.

## Al campo: preparazione e uso offline

Installare l’app `/campo/` sul telefono e aprirla dalla sua icona **prima** di caricare i dati. Su iPhone usare Safari → Condividi → Aggiungi alla schermata Home; su Android il menu Installa app. L’app installata può avere memoria separata dalla normale scheda del browser.

- All’avvio, se non ci sono schede, compare soltanto **Sincronizza con QRVideo**. L’app verifica che codice, font, immagini e contenuti siano in cache prima della scansione. Se la cache è incompleta, occorre la connessione; **Riattiva videocamera** riprende dopo averla preparata.
- I frammenti incompleti sono solo in memoria: camera fermata o telefono temporaneamente in background non eliminano quelli ricevuti; ricaricare la pagina richiede ricominciare la scansione. La barra colora i frammenti ricevuti, con contatore e percentuale. Quelli mancanti arrivano ai giri successivi, in qualsiasi ordine.
- Una volta completo, il payload viene verificato, decompresso con limite di dimensione e ogni scheda validata. Solo allora un’unica transazione IndexedDB salva il gruppo e passa alla consultazione. La schermata di sincronizzazione scompare. Un errore non salva un archivio parziale; un identificativo impedisce a trasferimenti superati o cancellati di ricreare le schede.
- In uso si cercano e filtrano gli scout e si leggono schede e recapiti chiamabili. **Non esistono importazione/esportazione ZIP, backup o download PDF in Al campo.** La stampa del gruppo resta nell’Area Capi. L’aggiornamento del database locale elimina anche gli eventuali vecchi blob ZIP conservando le schede consultabili.
- Il link in basso **Impostazioni e uso offline** spiega conservazione e cancellazione. **Cancella la memoria del dispositivo** apre un popup: occorre spuntare la casella obbligatoria e premere **Cancella tutti i dati**. Annullamento o Escape azzerano la casella. Vengono svuotati archivio, nome del campo, stato di preparazione, frammenti ricevuti, videocamera e dati visualizzati; le altre finestre aperte vengono avvisate. I file statici dell’app restano in cache per una nuova sincronizzazione offline.

L’app in uso legge le proprie risorse dalla cache del service worker e i dati da IndexedDB. Non contatta Supabase. Le schede decifrate sono conservate nel browser per la consultazione offline: rimuovere i download non introduce cifratura dell’archivio locale. È utilizzabile in modalità aereo anche dopo chiusura e riapertura. Prima di partire attendere **Pronta offline** e fare questa prova sul telefono effettivo. Richiedere memoria persistente nelle impostazioni quando disponibile. La cancellazione manuale dei dati del sito o la rimozione dell’app può eliminare l’archivio. Eventuali file scaricati con versioni precedenti devono essere eliminati separatamente dai Download.

La ricerca di aggiornamenti applicativi avviene in preparazione. Un aggiornamento disponibile si applica da **Impostazioni e uso offline → Aggiorna app**, conservando i dati e lo stato corrente. Per sostituire il gruppo occorre prima cancellare la memoria con la conferma e la casella obbligatoria. Massimo 400 scout per trasferimento.

### Protocollo QRVideo v1

Payload: un unico oggetto JSON con `format: "scout-qrvideo"`, `version: 1`, `campName` e `sheets`, array di tutte le schede selezionate nel formato già validato dall’app. Viene compresso con gzip quando disponibile e conveniente, poi suddiviso in **400 byte binari per frammento**, codificati in base64url nel QR. Il fallback senza compressione resta interoperabile. Limiti: 2 MiB trasmessi e 8 MiB dopo decompressione.

Ogni QR è una stringa ASCII:

```text
SQV1|payloadSHA256|codec|totalBytes|400|index|segmentBytes|segmentSHA256Prefix|base64url
```

- Indice a partire da zero; `segmentBytes` è la lunghezza effettiva, anche nell’ultimo frammento.
- `payloadSHA256` è SHA-256 completo dei byte trasmessi in base64url, e identifica il trasferimento.
- `codec`: `g` per gzip, `j` per JSON UTF-8 senza compressione.
- `segmentSHA256Prefix`: primi 16 caratteri base64url di SHA-256 del frammento (96 bit), verificati prima di accettarlo.
- Il ricevitore si aggancia al primo trasferimento valido, ignora duplicati e segnala trasferimenti differenti. Valida indici, lunghezze, checksum dei frammenti e SHA-256 completo prima di decodificare.

Un frame pieno occupa circa **650 caratteri ASCII**, con correzione QR di livello M e margine bianco di quattro moduli. Il valore iniziale di **3 QR/s** espone ogni QR per circa **333 ms**, con velocità utile teorica di **1,2 KB/s** prima delle scansioni perse. Un payload già compresso da 60 KB richiede circa 150 QR, quindi 50 secondi per giro; 150 KB circa 125 secondi. Sono stime: riflessi, messa a fuoco, distanza e dispositivo possono richiedere più giri o 1–2 QR/s. Ingrandire il QR sul computer e mantenere tutto il margine nell’inquadratura.

QRVideo trasferisce **schede decifrate**: la verifica SHA-256 rileva errori e frammenti mescolati, non autentica il trasmittente e non cifra il canale ottico. Inquadrare lo schermo solo con dispositivi autorizzati.

## PDF e ZIP

Il ridotto A4 contiene soltanto dati personali, sanitari, farmaci e recapiti, senza dichiarazioni, consenso, firme o pagine informative. Il PDF cumulativo nell’Area Capi è disponibile soltanto dopo la decifratura e usa gruppo e anno correnti; ogni scout inizia su una nuova pagina, anche quando la scheda precedente occupa più pagine. L’originale conserva le 11 pagine del modello FSE Roma 21 e compila gli spazi esistenti. Testi eccedenti vengono riportati in allegato con richiami; le firme restano vuote. Font Noto Sans incorporati, caratteri non supportati segnalati.

La compilazione può importare i vecchi ZIP, ma nessuna pagina produce nuovi ZIP. Il JSON `scheda.json` resta la fonte per questa importazione: formato, versione, modello, campi, tipi, risposte e dimensioni vengono verificati prima di sostituire il modulo. Limiti: 12 MB compressi, 10 voci, 16 MB per voce e 256 KB per il JSON. L’app del campo riceve soltanto QRVideo.


## Verifiche

```sh
npm install
npx playwright install chromium
npm start
# In un secondo terminale:
npm test
npm run test:campo
npm run test:secure
npm run test:qrvideo
npm run test:database
npm run test:auth
npm run test:delivery
```

Le suite browser accettano `TEST_BASE_URL` per provare una build o un dominio diverso. `test:secure` usa solo Node/Web Crypto. `test:database` richiede `initdb`, `pg_ctl` e `psql` nel PATH: crea e arresta un PostgreSQL temporaneo con socket locale, simula soltanto le funzioni minime di Supabase Auth e verifica la migrazione, RLS fra capi, privilegi anonimi, invarianti e idempotenza. Non si collega a Supabase reale.

`test:qrvideo` usa Auth/RPC simulate e QR reali generati e decodificati attraverso un MediaStream sintetico: censimento e PDF, chiave mai inviata/persistita, link, consegna cifrata, retry con stesso UUID, decifratura da camera, ricezione fuori ordine, cancellazione confermata, riapertura offline e assenza di comandi di esportazione sul telefono. `test:campo` verifica anche il riavvio completo del browser con rete disabilitata prima della navigazione, la rimozione dei blob ZIP precedenti, la casella obbligatoria (annullamento, Escape e controllo indipendente dal pulsante disabilitato), la cancellazione nelle altre finestre e il rifiuto di trasferimenti annullati. I test e gli screenshot usano dati fittizi in `tmp/`, esclusa da Git. La lettura delle camere fisiche su Safari/iPhone e Android va provata sui dispositivi di destinazione.

La build verifica che ogni risorsa offline esista e deriva la versione della cache dall’hash dei file pubblicati. Include esclusivamente frontend e asset pubblici; non distribuisce server, test, file di lavoro, chiavi segrete o dati compilati. Le licenze sono in `public/vendor/THIRD_PARTY_NOTICES.md`.

Riferimenti tecnici: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Web Crypto: deriveKey e HKDF](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).
