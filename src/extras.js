'use strict';
// Funzioni 2.6: luci sincronizzate e automatiche, avviso a schermo (DPI/EQ/profilo), FPS con PresentMon,
// chiamate e cartella condivisa col telefono, pausa di Wallpaper Engine, cache shader, finestra compatta.
const { BrowserWindow, Notification, powerMonitor, screen, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LIGHT_EFFECTS = {
  off: { mouse: 'off', headset: 'off', kb: 0 },
  static: { mouse: 'static', headset: 'static', kb: 1 },
  breathing: { mouse: 'breathing', headset: 'breathing', kb: 7 },
  spectrum: { mouse: 'spectrum', headset: 'rainbow', kb: 8 },
};

function inRange(now, from, to) {
  const m = (t) => { const [h, mm] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
  const n = now.getHours() * 60 + now.getMinutes();
  const a = m(from), b = m(to);
  return a <= b ? n >= a && n < b : n >= a || n < b; // fascia che passa la mezzanotte
}

// CSV di PresentMon (--v1_metrics): FPS dalla media dei tempi tra un frame e l'altro
function makeFpsMeter() {
  let col = -1;
  let samples = [];
  return {
    line(l) {
      const parts = l.split(',');
      if (col < 0) { col = parts.findIndex((p) => /^(MsBetweenPresents|FrameTime|msBetweenPresents)$/.test(p.trim())); return null; }
      const v = parseFloat(parts[col]);
      if (Number.isFinite(v) && v > 0 && v < 1000) samples.push({ t: Date.now(), v });
      return null;
    },
    fps() {
      const now = Date.now();
      samples = samples.filter((x) => now - x.t < 1000);
      if (samples.length < 2) return null;
      const avg = samples.reduce((a, x) => a + x.v, 0) / samples.length;
      return Math.round(1000 / avg);
    },
  };
}

// Elenco "dimensione|data|percorso" dal telefono
function parsePhoneList(out) {
  const m = new Map();
  for (const l of String(out).split(/\r?\n/)) {
    const p = l.trim().split('|');
    if (p.length < 3) continue;
    const rel = p.slice(2).join('|').replace(/^\.\//, '');
    if (!rel || rel.startsWith('.')) continue;
    m.set(rel, { size: +p[0], mtime: +p[1] * 1000 });
  }
  return m;
}
function walkLocal(dir) {
  const m = new Map();
  const walk = (d, base) => {
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      if (it.name.startsWith('.') || it.name === 'desktop.ini') continue;
      const full = path.join(d, it.name);
      const rel = base ? `${base}/${it.name}` : it.name;
      if (it.isDirectory()) walk(full, rel);
      else if (it.isFile()) { try { const st = fs.statSync(full); m.set(rel, { size: st.size, mtime: st.mtimeMs }); } catch (e) {} }
    }
  };
  walk(dir, '');
  return m;
}
// Cosa copiare: i file che mancano da una parte, e quelli cambiati (vince il più recente). Non cancella mai.
function syncPlan(local, phone) {
  const push = [], pull = [];
  for (const [rel, l] of local) {
    const p = phone.get(rel);
    if (!p) push.push(rel);
    else if (p.size !== l.size) (l.mtime >= p.mtime ? push : pull).push(rel);
  }
  for (const rel of phone.keys()) if (!local.has(rel)) pull.push(rel);
  return { push, pull };
}

function parseCall(out) {
  const st = String(out).match(/mCallState=(\d)/);
  const num = String(out).match(/mCallIncomingNumber=([+\d][\d\s]*)/);
  return { ringing: !!st && st[1] === '1', number: num ? num[1].trim() : null };
}

const SHADER_DIRS = (env, steamPath) => [
  ['Cache shader NVIDIA (DirectX)', path.join(env.LOCALAPPDATA || '', 'NVIDIA', 'DXCache')],
  ['Cache shader NVIDIA (OpenGL)', path.join(env.LOCALAPPDATA || '', 'NVIDIA', 'GLCache')],
  ['Cache NVIDIA', path.join(env.LOCALAPPDATA || '', 'NVIDIA Corporation', 'NV_Cache')],
  ['Cache shader DirectX', path.join(env.LOCALAPPDATA || '', 'D3DSCache')],
  ...(steamPath ? [['Cache shader Steam', path.join(steamPath, 'steamapps', 'shadercache')]] : []),
];
function dirSize(d) {
  let total = 0;
  const walk = (x) => { let items = []; try { items = fs.readdirSync(x, { withFileTypes: true }); } catch (e) { return; } for (const it of items) { const f = path.join(x, it.name); if (it.isDirectory()) walk(f); else { try { total += fs.statSync(f).size; } catch (e) {} } } };
  walk(d);
  return total;
}
function clearDir(d) {
  let freed = 0, skipped = 0;
  let items = [];
  try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return { freed, skipped }; }
  for (const it of items) {
    const f = path.join(d, it.name);
    try {
      const size = it.isDirectory() ? dirSize(f) : fs.statSync(f).size;
      fs.rmSync(f, { recursive: true, force: true });
      freed += size;
    } catch (e) { skipped++; } // file in uso da un gioco aperto: resta
  }
  return { freed, skipped };
}

function setup(ctx) {
  const { app, handle, log, MOCK, iconPath } = ctx;
  const S = () => ctx.getSettings();
  const send = (ch, d) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); };
  const notify = (title, body, onClick) => { if (!Notification.isSupported()) return; const n = new Notification({ title, body, icon: iconPath() }); if (onClick) n.on('click', onClick); n.show(); };

  // --- Luci sincronizzate --------------------------------------------------------
  async function lightsAll(effect, color, persist) {
    const e = LIGHT_EFFECTS[effect] || LIGHT_EFFECTS.static;
    const st = S();
    const errors = [];
    const step = async (label, fn) => { try { const r = await fn(); if (r && r.ok === false) errors.push(`${label}: ${r.error}`); } catch (err) { errors.push(`${label}: ${err.message}`); } };
    const scroll = { ...st.mouse.scroll, effect: e.mouse, color };
    await step('mouse', () => ctx.mouse.apply({ scroll }));
    const hl = { ...st.headset.lighting, effect: e.headset, color };
    await step('cuffie', async () => {
      if (ctx.headset.ledTimer) { ctx.headset.updateLighting(hl); return { ok: true }; }
      return ctx.headset.startLighting(hl, ctx.headsetCtx());
    });
    const kb = { ...st.keyboard.lighting, mode: e.kb, color, multicolor: false };
    await step('tastiera', () => ctx.keyboard.applyLighting(kb));
    if (persist) {
      st.mouse.scroll = scroll;
      st.headset.lighting = hl;
      st.headset.customLeds = true;
      st.keyboard.lighting = kb;
      st.syncLights = { effect, color };
      ctx.saveSettings();
      ctx.refresh();
    }
    return errors.length === 3 ? { ok: false, error: 'Nessuna periferica raggiungibile' } : { ok: true, partial: errors };
  }
  async function lightsRestore() {
    const st = S();
    try { await ctx.mouse.apply({ scroll: st.mouse.scroll }); } catch (e) {}
    try {
      if (st.headset.customLeds) { if (ctx.headset.ledTimer) ctx.headset.updateLighting(st.headset.lighting); else await ctx.headset.startLighting(st.headset.lighting, ctx.headsetCtx()); }
      else await ctx.headset.stopLighting(true);
    } catch (e) {}
    try { await ctx.keyboard.applyLighting(st.keyboard.lighting); } catch (e) {}
  }
  handle('lights:sync', async ({ effect, color }) => lightsAll(effect, color, true));

  // Spegnimento automatico: PC inattivo o fascia notturna
  let lightsOff = false;
  setInterval(async () => {
    const A = S().lightsAuto || {};
    if (!A.idle && !A.night) { if (lightsOff) { lightsOff = false; await lightsRestore(); } return; }
    let idle = 0;
    try { idle = powerMonitor.getSystemIdleTime(); } catch (e) {}
    const want = (A.idle && idle >= (A.idleMin || 10) * 60) || (A.night && inRange(new Date(), A.from || '23:00', A.to || '07:00'));
    if (want && !lightsOff) { lightsOff = true; log('luci: spente in automatico'); await lightsAll('off', '#000000', false); }
    else if (!want && lightsOff) { lightsOff = false; log('luci: riaccese'); await lightsRestore(); }
  }, MOCK ? 5000 : 20000);

  // --- Avviso a schermo ------------------------------------------------------------
  let osdWin = null, osdTimer = null;
  function osd(title, sub = '') {
    if (S().osd && S().osd.enabled === false) return;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = 280, h = 92;
    const bounds = { width: w, height: h, x: Math.round(d.x + (d.width - w) / 2), y: Math.round(d.y + d.height - h - 70) };
    if (!osdWin || osdWin.isDestroyed()) {
      osdWin = new BrowserWindow({ ...bounds, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
      osdWin.setAlwaysOnTop(true, 'screen-saver');
      osdWin.setIgnoreMouseEvents(true);
      osdWin.loadFile(path.join(__dirname, 'overlay', 'osd.html'));
      osdWin.webContents.once('did-finish-load', () => { osdWin.webContents.send('osd', { title, sub }); osdWin.showInactive(); });
    } else {
      osdWin.setBounds(bounds);
      osdWin.webContents.send('osd', { title, sub });
      osdWin.showInactive();
    }
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => { if (osdWin && !osdWin.isDestroyed()) osdWin.webContents.send('osd', null); setTimeout(() => osdWin && !osdWin.isDestroyed() && osdWin.hide(), 260); }, 1400);
  }
  ctx.osd = osd;
  // DPI: il tasto sotto la rotella cambia stadio nel mouse, quindi Unico lo legge ogni secondo e mezzo
  let lastDpi = null, dpiBusy = false;
  setInterval(async () => {
    if (MOCK || dpiBusy || (S().osd && S().osd.enabled === false)) return;
    const m = ctx.getState().mouse;
    if (!m || !m.connected || m.asleep) { lastDpi = null; return; }
    dpiBusy = true;
    try {
      const dpi = await ctx.mouse.currentDpi();
      if (dpi && lastDpi && dpi !== lastDpi) { osd(`${dpi} DPI`, 'Mouse'); m.dpi = dpi; ctx.push(); }
      if (dpi) lastDpi = dpi;
    } catch (e) {} finally { dpiBusy = false; }
  }, 1500);
  handle('osd:test', async () => { osd('1600 DPI', 'Prova avviso'); return { ok: true }; });

  // --- FPS con PresentMon ------------------------------------------------------------
  const pmExe = app.isPackaged ? path.join(process.resourcesPath, 'presentmon', 'PresentMon.exe') : path.join(__dirname, '..', 'vendor', 'presentmon', 'PresentMon.exe');
  let pm = null, meter = null, fpsState = { status: 'off' };
  function fpsStart(game) {
    fpsStop();
    if (!S().overlay || !S().overlay.fps || process.platform !== 'win32') return;
    if (!fs.existsSync(pmExe)) { fpsState = { status: 'missing' }; return; }
    meter = makeFpsMeter();
    const exe = /\.exe$/i.test(game) ? game : `${game}.exe`;
    let errText = '';
    pm = spawn(pmExe, ['--process_name', exe, '--output_stdout', '--no_console_stats', '--v1_metrics', '--session_name', 'UnicoFPS', '--stop_existing_session', '--terminate_on_proc_exit', '--no_track_display', '--no_track_input'], { windowsHide: true });
    fpsState = { status: 'starting', game };
    readline.createInterface({ input: pm.stdout }).on('line', (l) => { meter.line(l); if (fpsState.status !== 'on') fpsState = { status: 'on', game }; });
    pm.stderr.on('data', (d) => { errText += String(d); });
    pm.on('error', (e) => { fpsState = { status: 'error', error: e.message }; });
    pm.on('exit', (code) => {
      if (/access|privileg|administrator|Performance Log Users/i.test(errText) || code === 5) fpsState = { status: 'admin' };
      else if (fpsState.status !== 'on') fpsState = { status: 'error', error: errText.trim().split('\n').pop() || `codice ${code}` };
      if (fpsState.status !== 'on') log(`fps: ${fpsState.status} ${fpsState.error || ''}`);
      pm = null;
    });
  }
  function fpsStop() { if (pm) { try { pm.kill(); } catch (e) {} } pm = null; meter = null; if (fpsState.status === 'on' || fpsState.status === 'starting') fpsState = { status: 'off' }; }
  ctx.fpsNow = () => (meter ? meter.fps() : null);
  handle('fps:status', async () => ({ ...fpsState, available: fs.existsSync(pmExe) }));

  // --- Wallpaper Engine in pausa durante i giochi -----------------------------------------
  async function wallpaperCtl(cmd) {
    if (process.platform !== 'win32' || MOCK) return;
    try {
      const procs = await ctx.sys.procs();
      const we = procs.find((p) => /^wallpaper(64|32)$/i.test(p.name) && p.path);
      if (!we) return;
      execFile(we.path, ['-control', cmd], { windowsHide: true }, (e) => { if (e) log(`wallpaper engine ${cmd}: ${e.message}`); else log(`wallpaper engine: ${cmd}`); });
    } catch (e) { log(`wallpaper engine: ${e.message}`); }
  }

  // Chiamato da main quando parte o si chiude un gioco riconosciuto
  ctx.onGameChange = (game) => {
    if (game) {
      if (S().wallpaperPause !== false) wallpaperCtl('pause');
      fpsStart(game);
    } else {
      if (S().wallpaperPause !== false) wallpaperCtl('play');
      fpsStop();
    }
  };

  // --- Cache shader -------------------------------------------------------------------
  handle('shader:scan', async () => {
    const steam = MOCK ? null : await ctx.steamPath();
    if (MOCK) return { total: 2.7e9, items: [{ label: 'Cache shader NVIDIA (DirectX)', size: 1.9e9 }, { label: 'Cache shader DirectX', size: 4.1e8 }, { label: 'Cache shader Steam', size: 3.9e8 }] };
    const items = SHADER_DIRS(process.env, steam).map(([label, dir]) => ({ label, dir, size: dirSize(dir) })).filter((x) => x.size > 0);
    return { total: items.reduce((a, x) => a + x.size, 0), items };
  });
  handle('shader:clean', async () => {
    if (MOCK) return { ok: true, freed: 2.5e9, skipped: 3 };
    const steam = await ctx.steamPath();
    let freed = 0, skipped = 0;
    for (const [, dir] of SHADER_DIRS(process.env, steam)) { const r = clearDir(dir); freed += r.freed; skipped += r.skipped; }
    log(`cache shader: liberati ${Math.round(freed / 1048576)} MB (${skipped} in uso)`);
    return { ok: true, freed, skipped };
  });

  // --- Telefono: chiamate in arrivo --------------------------------------------------------
  let ringing = false;
  const activePhone = async () => {
    const l = await ctx.phone.list();
    const d = (l.devices || []).find((x) => x.state === 'device');
    return d || null;
  };
  setInterval(async () => {
    const P = S().phoneNotif || {};
    if (!P.enabled || P.calls === false || MOCK) return;
    try {
      const d = await activePhone();
      if (!d) return;
      const r = await ctx.phone.adb(['-s', d.serial, 'shell', 'dumpsys', 'telephony.registry'], 6000);
      const c = parseCall(r.out);
      if (c.ringing && !ringing) notify('📞 Chiamata in arrivo', `${c.number || 'Numero sconosciuto'} · clicca per rispondere dal PC (mirroring)`, () => ctx.phone.start(d.serial, S().phone, d.model));
      ringing = c.ringing;
    } catch (e) {}
  }, 3000);

  // --- Telefono: cartella condivisa -----------------------------------------------------------
  const defaultSyncDir = () => path.join(app.getPath('documents'), 'Unico Telefono');
  const PHONE_DIR = '/sdcard/Unico';
  let syncBusy = false, syncState = { last: null, pushed: 0, pulled: 0, error: null };
  async function syncNow(force = false) {
    const P = S().phoneSync || {};
    if ((!P.enabled && !force) || syncBusy) return syncState;
    syncBusy = true;
    try {
      const d = MOCK ? { serial: 'R5CT1234ABC' } : await activePhone();
      if (!d) { syncState = { ...syncState, error: 'Telefono non collegato' }; return syncState; }
      const dir = P.dir || defaultSyncDir();
      fs.mkdirSync(dir, { recursive: true });
      if (MOCK) { syncState = { last: Date.now(), pushed: 2, pulled: 5, error: null }; return syncState; }
      const ls = await ctx.phone.adb(['-s', d.serial, 'shell', `mkdir -p ${PHONE_DIR} && cd ${PHONE_DIR} && find . -type f -exec stat -c '%s|%Y|%n' {} +`], 20000);
      if (!ls.ok) throw new Error(ls.err.split('\n')[0] || 'lettura del telefono non riuscita');
      const plan = syncPlan(walkLocal(dir), parsePhoneList(ls.out));
      let pushed = 0, pulled = 0;
      for (const rel of plan.push.slice(0, 200)) {
        const r = await ctx.phone.adb(['-s', d.serial, 'push', path.join(dir, ...rel.split('/')), `${PHONE_DIR}/${rel}`], 10 * 60000);
        if (r.ok) pushed++;
      }
      for (const rel of plan.pull.slice(0, 200)) {
        const target = path.join(dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const r = await ctx.phone.adb(['-s', d.serial, 'pull', '-a', `${PHONE_DIR}/${rel}`, target], 10 * 60000);
        if (r.ok) pulled++;
      }
      if (pulled) notify('File dal telefono', `${pulled} file arrivati nella cartella condivisa`, () => shell.openPath(dir));
      syncState = { last: Date.now(), pushed, pulled, error: null };
      if (pushed || pulled) log(`cartella condivisa: ${pushed} inviati, ${pulled} ricevuti`);
    } catch (e) { syncState = { ...syncState, error: e.message }; log(`cartella condivisa: ${e.message}`); } finally { syncBusy = false; send('phoneSync', syncState); }
    return syncState;
  }
  setInterval(() => syncNow(false), 60000);
  handle('phoneSync:now', async () => syncNow(true));
  handle('phoneSync:state', async () => ({ ...syncState, dir: (S().phoneSync || {}).dir || defaultSyncDir(), phoneDir: PHONE_DIR }));
  handle('phoneSync:open', async () => { const dir = (S().phoneSync || {}).dir || defaultSyncDir(); fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); return { ok: true }; });

  // --- Finestra compatta -------------------------------------------------------------------
  let miniWin = null;
  function toggleMini(on) {
    const want = on === undefined ? !(miniWin && !miniWin.isDestroyed()) : on;
    if (!want) { if (miniWin && !miniWin.isDestroyed()) miniWin.close(); return { ok: true, open: false }; }
    if (miniWin && !miniWin.isDestroyed()) { miniWin.show(); return { ok: true, open: true }; }
    const wa = screen.getPrimaryDisplay().workArea;
    const saved = S().mini || {};
    miniWin = new BrowserWindow({
      width: 320, height: 470, x: saved.x != null ? saved.x : wa.x + wa.width - 340, y: saved.y != null ? saved.y : wa.y + 20,
      // con frame:false l'acrilico di Windows non disegna il contenuto: serve la cornice nascosta come nella finestra principale
      titleBarStyle: 'hidden', resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: false, alwaysOnTop: saved.top !== false, title: 'Unico mini',
      backgroundColor: ctx.material() === 'none' ? '#16171f' : '#00000000', backgroundMaterial: ctx.material() === 'none' ? 'none' : 'acrylic', icon: iconPath(),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    miniWin.loadFile(path.join(__dirname, 'mini', 'mini.html'));
    ctx.sys.want('mini', true);
    miniWin.on('moved', () => { const [x, y] = miniWin.getPosition(); S().mini = { ...(S().mini || {}), x, y }; ctx.saveSettings(); });
    miniWin.on('closed', () => { miniWin = null; ctx.sys.want('mini', false); });
    return { ok: true, open: true };
  }
  ctx.toggleMini = toggleMini;
  ctx.miniWin = () => miniWin;
  handle('mini:toggle', async (on) => toggleMini(on));
  handle('mini:close', async () => toggleMini(false));
  handle('mini:openMain', async () => { ctx.showWindow(); return { ok: true }; });
}

module.exports = { setup, inRange, makeFpsMeter, parsePhoneList, syncPlan, parseCall };
