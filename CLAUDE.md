# Unico — istruzioni per Claude

Unico è un'app Windows (Electron) che sostituisce i programmi dei produttori di periferiche e aggiunge
strumenti di sistema. L'ha creata Hekat con Claude, ed è pensata per le sue periferiche:

- mouse **Razer Basilisk V3 X HyperSpeed** (`src/devices/razer.js`)
- cuffie **Corsair HS80 RGB Wireless** (`src/devices/hs80.js`)
- tastiera **AULA F75 Max** (`src/devices/aula.js`)

Tutto il resto non dipende dalle periferiche e funziona su qualsiasi PC Windows 10/11: audio (uscita,
volume per app, microfono con controllo e riparazione), batterie (pannello dall'icona, anelli sul bordo,
dispositivi Bluetooth e telefono, storico), telefono Android con scrcpy, giochi, strumenti, sistema,
overlay, profili, controllo dal telefono, aggiornamenti automatici.

L'interfaccia e i commenti nel codice sono in **italiano**. Con l'utente si parla in italiano semplice,
senza gergo tecnico: spesso non è uno sviluppatore.

## Struttura

| Percorso | Cosa contiene |
|---|---|
| `src/main.js` | processo principale: impostazioni, stato, IPC (`handle(...)`), icona, finestre |
| `src/devices/*.js` | un driver per periferica, solo HID (`node-hid`) |
| `src/batteries/` | lista unica delle batterie, pannello, anelli sul bordo, storico |
| `src/system/` | `helper.ps1` (un PowerShell sempre aperto), `audio.ps1`, `bt.ps1`, `audiocheck.js`, giochi, profili |
| `src/eq/apo.js` | equalizzatore tramite Equalizer APO |
| `src/phone/` | scrcpy/adb |
| `src/remote/` | controllo dal telefono (server nella rete locale) |
| `src/renderer/` | interfaccia (HTML/CSS/JS senza framework), una pagina per periferica |
| `test/` | test (`npm test`) e simulatori: `fake-hid.js` (periferiche), `fake-system.js` (Windows) |
| `.github/workflows/release.yml` | build e pubblicazione quando cambia la versione in `package.json` |

Un driver espone almeno `status()` e `battery()`, che restituiscono
`{ connected, name, battery (0-100, solo se letto davvero), charging, asleep | off, ... }`.
`main.js` li tiene in `state.mouse`, `state.headset`, `state.keyboard`; le pagine del renderer leggono
questo stato. Se una periferica non c'è, la sua pagina mostra "non trovato" e il resto funziona.

## Adattare Unico a periferiche diverse (es. per un amico)

1. **Fai un fork** del repository nel proprio account GitHub.
2. In `package.json` → `build.publish` metti **owner e repo del fork**. È obbligatorio: altrimenti
   l'app installata si aggiorna dalle release di Hekat e perde le modifiche.
3. Nel fork attiva GitHub Actions (nei fork è spento) e, in Settings → Actions → General → Workflow
   permissions, scegli **Read and write**: serve per pubblicare le release.
4. Fatti dire i modelli esatti e fatti incollare la diagnostica di Unico (Opzioni → Diagnostica →
   Copia diagnostica): contiene VID:PID e usage page di ogni dispositivo HID collegato.
5. Per ogni periferica nuova scegli:
   - **non supportarla**: lascia che la pagina dica "non trovato", oppure nascondi la pagina;
   - **supportarla**: scrivi un driver in `src/devices/` sul modello di quelli esistenti, poi collegalo
     in `main.js` (stato, `refresh`, `refreshBatteries`, IPC) e nella pagina del renderer.
   Le periferiche che non servono più si tolgono da `main.js`, dal renderer e da `fake-hid.js`.
6. Le batterie Bluetooth (controller, auricolari) e quella del telefono funzionano già senza driver.

### Regole per i driver (non negoziabili)

Unico parla con l'hardware: un comando sbagliato può lasciare una periferica bloccata. Con le cuffie di
Hekat è successo davvero (microfono silenziato per ore). Quindi:

- **Protocollo solo da fonti verificate per quel modello esatto**: OpenRazer, OpenRGB, HeadsetControl,
  libratbag/Piper, Solaar (Logitech HID++), OpenPeripheral, documentazione del produttore. Scrivi le
  fonti in testa al file del driver. Niente comandi indovinati o presi da un modello "simile".
- **Prima solo letture** (batteria, stato). Le scritture (DPI, luci, spegnimento automatico) si
  aggiungono dopo, una alla volta, e solo quando le letture funzionano sulla periferica vera.
- Se un comando richiede una "modalità software", si torna **sempre** alla modalità normale: alla
  chiusura, dopo un errore, prima di un aggiornamento e all'avvio (vedi `ensureHardwareMode` in `hs80.js`).
- Se il programma del produttore è aperto (iCUE, Synapse, G HUB…), Unico **si fa da parte**: non manda
  niente a quella periferica (vedi `checkIcue` in `main.js` e `setBlocked` in `hs80.js`).
- Il microfono si gestisce **solo da Windows** (predefinito, volume, silenziamento). Mai mettere
  Equalizer APO sul microfono: l'equalizzatore va solo sull'uscita, indicata col suo GUID (`eq/apo.js`).
- Una batteria non letta si mostra come "Nessun dato", mai 0% e mai un valore vecchio come attuale.

### Lezioni già imparate

- `helper.ps1` è un solo processo PowerShell: un comando lento blocca tutti gli altri. Le cose lente o
  che possono bloccarsi vanno in un processo a parte con un limite di tempo (vedi `bt.ps1`).
- In `main.js` `handle(...)` va registrato dopo la sua definizione (è una `const`): metti il codice
  nuovo sotto la sezione "Comandi dalle finestre", altrimenti l'app non parte.
- Il renderer ha una Content-Security-Policy rigida: niente stili o script inline in `index.html`.
- Le parentesi di `helper.ps1` sono controllate da un test: attenzione alle stringhe con `{`.

## Prove prima di ogni rilascio

```bash
npm ci
npm test                                   # devono passare tutti
UNICO_MOCK=1 npx electron .                # interfaccia con periferiche e Windows simulati
UNICO_MOCK=1 UNICO_SHOT5=/tmp/shots npx electron .   # salva schermate (anche UNICO_SHOT4)
```

Su Linux servono `xvfb-run` e `--no-sandbox`. Ogni periferica nuova va aggiunta al simulatore
(`test/fake-hid.js`) con un test in `test/`, così si prova senza l'hardware. Sull'hardware vero si prova
poi con l'utente, guardando il log (Opzioni → Diagnostica → Copia diagnostica).

## Rilascio

1. Aumenta `version` in `package.json` (es. 2.11.1 → 2.12.0) e scrivi nel commit cosa cambia, in italiano.
2. Fai push su `main`: GitHub Actions prova, costruisce l'installer e lo pubblica nelle Release.
3. L'app installata lo scarica da sola (o subito da Opzioni → Aggiornamenti → Controlla ora).

La prima installazione si fa scaricando `Unico-Setup-<versione>.exe` dalle Release del repository.
Windows SmartScreen avvisa perché l'installer non è firmato: "Ulteriori informazioni" → "Esegui comunque".
