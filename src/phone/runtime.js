'use strict';
// adb e scrcpy girano da una copia nella cartella dati di Unico, non dalla cartella di installazione:
// il server adb resta aperto in sottofondo e, se gira da lì, un aggiornamento non riesce a sostituire
// adb.exe (è successo: dopo l'aggiornamento il file mancava). Se manca anche nel pacchetto, lo riscarico.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SCRCPY_VERSION = '5.0.1';
const NEEDED = ['adb.exe', 'scrcpy.exe', 'scrcpy-server', 'AdbWinApi.dll', 'AdbWinUsbApi.dll'];
const complete = (dir) => NEEDED.every((f) => fs.existsSync(path.join(dir, f)));

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const it of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, it.name), b = path.join(dst, it.name);
    if (it.isDirectory()) copyDir(a, b);
    else { try { fs.copyFileSync(a, b); } catch (e) { /* file in uso: resta quello che c'è */ } }
  }
}

// Restituisce subito la cartella da usare; se serve scaricare, onReady viene chiamato a fine download.
function prepare({ bundled, userDir, log, onReady }) {
  const dir = path.join(userDir, 'scrcpy');
  const stamp = path.join(dir, '.versione');
  const want = `${SCRCPY_VERSION}`;
  let have = null;
  try { have = fs.readFileSync(stamp, 'utf8').trim(); } catch (e) {}
  if (complete(dir) && have === want) return dir;
  if (complete(bundled)) {
    try { copyDir(bundled, dir); fs.writeFileSync(stamp, want); log(`telefono: strumenti copiati in ${dir}`); return dir; } catch (e) { log(`telefono: copia non riuscita (${e.message})`); return bundled; }
  }
  if (complete(dir)) return dir; // versione vecchia ma funzionante: meglio di niente
  // nel pacchetto manca qualcosa: scarico scrcpy ufficiale da GitHub
  if (process.platform === 'win32') {
    const zip = path.join(userDir, 'scrcpy.zip');
    const tmp = path.join(userDir, 'scrcpy-tmp');
    const url = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-win64-v${SCRCPY_VERSION}.zip`;
    log('telefono: adb mancante, scarico scrcpy da GitHub');
    fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
      await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { windowsHide: true, timeout: 120000 }, (e) => (e ? rej(e) : res())));
      const inner = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((p) => complete(p)) || tmp;
      copyDir(inner, dir);
      fs.writeFileSync(stamp, want);
      try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip, { force: true }); } catch (e) {}
      log('telefono: scrcpy scaricato e pronto');
      onReady(dir);
    }).catch((e) => log(`telefono: download non riuscito (${e.message})`));
  }
  return dir;
}

module.exports = { prepare, complete, SCRCPY_VERSION };
