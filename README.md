# Unico

Un solo programma per Windows al posto di iCUE, Razer Synapse e del driver AULA, con in più monitor di sistema, mirroring del telefono, mixer audio, libreria giochi e qualche strumento utile.

## Cosa fa

- **Mouse** Razer Basilisk V3 X HyperSpeed (anche dal ricevitore): DPI e stadi, polling, luce della rotella, standby e batteria.
- **Cuffie** Corsair HS80 RGB Wireless: equalizzatore (Equalizer APO), luci, spegnimento automatico, microfono, batteria.
- **Tastiera** AULA F75 Max: effetti luce, schermo (immagini e GIF), orologio, tasti e risparmio energetico.
- **Telefono** (Android, con scrcpy): mirroring, file, foto, batteria, notifiche sul PC, scrivere sul telefono dal PC.
- **Audio**: dispositivo di uscita, volume per app con livelli in tempo reale, prova del microfono.
- **Giochi**: libreria da Steam, Epic, Riot e Prism Launcher, avvio con il profilo Gioco, storico delle sessioni.
- **Strumenti**: cronologia appunti, timer e promemoria, screenshot (`Ctrl+Alt+S`) e registrazione dello schermo (`Ctrl+Alt+R`).
- **Sistema**: risorse, processi, app all'avvio, pulizia, diagnosi rete, overlay in gioco (`Ctrl+Maiusc+O`), profili automatici.
- **Impostazioni**: tema Mica, avvisi, backup e ripristino, aggiornamenti automatici.

## Installazione

Scarica `Unico-Setup-x.y.z.exe` dalla pagina [Releases](https://github.com/Hekatisback/unico/releases/latest) e aprilo. Windows può mostrare "PC protetto da Windows" perché il programma non è firmato: clicca **Ulteriori informazioni → Esegui comunque**. Serve solo la prima volta.

Da lì in poi Unico si aggiorna da solo: controlla ogni 6 ore, scarica in silenzio e installa alla chiusura (o subito da Impostazioni → Aggiornamenti).

## Come esce una nuova versione

1. Cambia `version` in `package.json`.
2. Crea un tag con lo stesso numero e caricalo: `git tag v2.2.0 && git push --tags`.
3. GitHub Actions (`.github/workflows/release.yml`) esegue i test, scarica scrcpy, costruisce l'installer su Windows e lo pubblica nelle Release.

## Sviluppo

```
npm install
npm test                 # protocolli dei dispositivi, parser e simulatori
UNICO_MOCK=1 npm start   # interfaccia con dispositivi e sistema simulati
```

Per il mirroring in locale serve scrcpy in `vendor/scrcpy` (lo scarica la build automatica).
