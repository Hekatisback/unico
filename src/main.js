'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, Notification, shell, clipboard, dialog, globalShortcut, screen } = require('electron');
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
// UNICO_MOCK=1 usa il simulatore dei dispositivi (solo per sviluppo, non incluso nel pacchetto)
const HID = process.env.UNICO_MOCK ? require('../test/fake-hid').createFakeHid() : require('node-hid');
const { RazerMouse } = require('./devices/razer');
const { Hs80 } = require('./devices/hs80');
const { AulaKeyboard, MODES, SLEEP } = require('./devices/aula');
const apo = require('./eq/apo');
const { Phone, FakePhone } = require('./phone/scrcpy');
const sysmod = require('./system');
const { DEFAULT_PROFILES, DEFAULT_AUTO, applyProfile, detectGame } = require('./system/profiles');
const MOCK = !!process.env.UNICO_MOCK;

if (!app.requestSingleInstanceLock()) {
  // Se a tenere il blocco è una vecchia copia portatile (un altro Unico.exe in un'altra cartella),
  // la chiudo e riparto: così l'installer sostituisce davvero la versione zip.
  if (process.platform === 'win32' && app.isPackaged && !process.argv.includes('--unico-retry') && closeOldCopies() > 0) {
    app.relaunch({ args: [...process.argv.slice(1), '--unico-retry'] });
  }
  app.exit(0);
  process.exit(0);
}
function closeOldCopies() {
  try {
    const mine = path.dirname(process.execPath).replace(/'/g, "''");
    const ps = `$n = 0; Get-CimInstance Win32_Process -Filter "Name='Unico.exe'" | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetDirectoryName($_.ExecutablePath) -ne '${mine}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; Start-Sleep -Milliseconds 800; $n`;
    const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15000 });
    return parseInt(String(out).trim(), 10) || 0;
  } catch (e) { return 0; }
}

const userDir = app.getPath('userData');
const logFile = path.join(userDir, 'unico.log');
const settingsFile = path.join(userDir, 'settings.json');

function log(msg) {
  try {
    fs.mkdirSync(userDir, { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
  } catch (e) { /* il log non deve mai bloccare l'app */ }
}

const DEFAULTS = {
  startWithWindows: true,
  startHidden: true,
  appearance: { background: 'acrylic', theme: 'system', v: 2 },
  alerts: { enabled: true, gpuTemp: 87, ram: 92, diskGB: 10 },
  overlay: { enabled: false, corner: 'tl', shortcut: 'CommandOrControl+Shift+O' },
  capture: { audio: true, shotKey: 'Control+Alt+S', recKey: 'Control+Alt+R' },
  clipboard: { enabled: true },
  reminders: [],
  customGames: [],
  lastPlayed: {},
  gamesProfile: true,
  phoneNotif: { enabled: false, serial: null, muted: [] },
  profiles: DEFAULT_PROFILES,
  autoProfile: DEFAULT_AUTO,
  activeProfile: null,
  notifyBelow: 15,
  eq: { enabled: false, preset: 'Piatto', gains: apo.PRESETS.Piatto },
  headset: {
    customLeds: false,
    color: '#7c5cff',
    lighting: { effect: 'static', color: '#7c5cff', color2: '#00d0ff', speed: 3, brightness: 100, status: 'battery', statusColor: '#ffffff', mic: 'mute', micColor: '#ff0000' },
    wheelEq: true,
  },
  keyboard: {
    lighting: { mode: 8, color: '#7c5cff', brightness: 4, speed: 3, direction: 0, multicolor: false },
    settings: { sleep: 2, responseLevel: 1, fnSwitch: false, gameMode: false, disableWin: false, disableAltTab: false, disableAltF4: false },
  },
  phone: { maxSize: 1920, bitrate: 8, maxFps: 60, audio: true, control: true, turnScreenOff: false, stayAwake: true, alwaysOnTop: false, fullscreen: false, realKeyboard: true, powerOffOnClose: false, record: false },
  mouse: { scroll: { effect: 'static', color: '#00ff66', color2: '#0066ff', speed: 2, brightness: 255 } },
};

function loadSettings() {
  try { return deepMerge(structuredClone(DEFAULTS), JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); }
  catch (e) { return structuredClone(DEFAULTS); }
}
function saveSettings() {
  try { fs.mkdirSync(userDir, { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch (e) { log(`settings: ${e.message}`); }
}
function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}

let settings = loadSettings();
// 2.2: il vecchio predefinito Mica diventa Acrilico, che lascia vedere lo sfondo animato
if (!settings.appearance.v) { if (settings.appearance.background === 'mica') settings.appearance.background = 'acrylic'; settings.appearance.v = 2; }
// i profili salvati sostituiscono quelli predefiniti solo se presenti
for (const k of Object.keys(DEFAULT_PROFILES)) if (!settings.profiles[k]) settings.profiles[k] = DEFAULT_PROFILES[k];
const mouse = new RazerMouse(HID, log);
const headset = new Hs80(HID, log);
const keyboard = new AulaKeyboard(HID, log);
const phone = new (process.env.UNICO_MOCK ? FakePhone : Phone)({
  binDir: app.isPackaged ? path.join(process.resourcesPath, 'scrcpy') : path.join(__dirname, '..', 'vendor', 'scrcpy'),
  videosDir: app.getPath('videos'),
  log,
  onChange: (e) => { if (win && !win.isDestroyed()) win.webContents.send('phone', e); },
});
// --- Sistema -----------------------------------------------------------------
const helperScript = path.join(__dirname, 'system', 'helper.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const tools = MOCK ? require('../test/fake-system').fakeTools : sysmod;
const sys = MOCK
  ? new (require('../test/fake-system').FakeSystem)({ onTick: (s) => onStats(s) })
  : new sysmod.SystemService({ scriptPath: helperScript, log, onTick: (s) => onStats(s) });
let overlayWin = null;

function onStats(s) {
  feat.onSample && feat.onSample(s);
  if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send('stats', { ...s, history: sys.history });
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('stats', s);
}

function overlayBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 210, h = 128, m = 12;
  const c = settings.overlay.corner || 'tl';
  return { width: w, height: h, x: c.endsWith('l') ? wa.x + m : wa.x + wa.width - w - m, y: c.startsWith('t') ? wa.y + m : wa.y + wa.height - h - m };
}
function setOverlay(on) {
  settings.overlay.enabled = !!on;
  saveSettings();
  if (on && (!overlayWin || overlayWin.isDestroyed())) {
    overlayWin = new BrowserWindow({
      ...overlayBounds(), frame: false, transparent: true, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    overlayWin.setIgnoreMouseEvents(true);
    overlayWin.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
    overlayWin.once('ready-to-show', () => overlayWin && overlayWin.showInactive());
    sys.want('overlay', true);
  } else if (!on && overlayWin) {
    try { overlayWin.destroy(); } catch (e) {}
    overlayWin = null;
    sys.want('overlay', false);
  } else if (on && overlayWin) overlayWin.setBounds(overlayBounds());
  state.overlay = settings.overlay.enabled;
  if (win && !win.isDestroyed()) win.webContents.send('overlay', settings.overlay);
  return { ok: true, enabled: settings.overlay.enabled };
}
function registerShortcut() {
  try { globalShortcut.unregisterAll(); globalShortcut.register(settings.overlay.shortcut, () => setOverlay(!settings.overlay.enabled)); } catch (e) { log(`scorciatoia: ${e.message}`); }
  if (feat.registerToolShortcuts) feat.registerToolShortcuts();
}

// Avvisi leggeri ogni 30 s (non tengono acceso il campionamento completo).
const alertAt = {};
function notifyOnce(key, title, body, everyMs) {
  if (alertAt[key] && Date.now() - alertAt[key] < everyMs) return;
  alertAt[key] = Date.now();
  if (Notification.isSupported()) new Notification({ title, body, icon: iconPath() }).show();
}
function gpuTempOnce() {
  return new Promise((resolve) => {
    if (MOCK || process.platform !== 'win32') return resolve(sys.last && sys.last.gpu ? sys.last.gpu.temp : null);
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
    if (!fs.existsSync(exe)) return resolve(null);
    execFile(exe, ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true }, (e, out) => resolve(e ? null : parseFloat(out)));
  });
}
async function checkAlerts() {
  const A = settings.alerts;
  if (!A.enabled) return;
  const ramPct = Math.round(100 * (1 - os.freemem() / os.totalmem()));
  if (ramPct >= A.ram) notifyOnce('ram', `RAM al ${ramPct}%`, 'Chiudi qualche programma: apri Unico → Sistema → Processi.', 15 * 60000);
  try {
    const st = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    const freeGB = (st.bavail * st.bsize) / 1073741824;
    if (freeGB < A.diskGB) notifyOnce('disk', `Disco C quasi pieno: ${freeGB.toFixed(1)} GB liberi`, 'Unico → Sistema → Pulizia ti aiuta a liberare spazio.', 6 * 3600000);
  } catch (e) {}
  const t = await gpuTempOnce();
  if (t != null && t >= A.gpuTemp) notifyOnce('gpu', `GPU a ${Math.round(t)} °C`, 'Temperatura alta: controlla che le prese d\'aria siano libere.', 10 * 60000);
}

// Profili
const profileDeps = {
  power: (m) => tools.powerSet(m),
  mouseDpi: async (dpi) => mouse.apply({ dpi }),
  eq: async (name) => {
    const gains = apo.PRESETS[name];
    if (!gains) return { ok: false, error: 'preset sconosciuto' };
    if (!apo.status().installed) return { ok: true };
    const r = apo.apply(gains, true);
    if (r.ok) { settings.eq = { enabled: true, preset: name, gains }; state.eq = { ...apo.status(), ...settings.eq }; }
    return r;
  },
  keyboard: async ({ mode, brightness }) => {
    if (!state.keyboard.connected) return { ok: true };
    const cfg = { ...settings.keyboard.lighting };
    if (mode != null) cfg.mode = mode;
    if (brightness != null) cfg.brightness = brightness;
    const r = await keyboard.applyLighting(cfg);
    if (r.ok) settings.keyboard.lighting = cfg;
    return r;
  },
  headset: async (mode) => {
    if (!state.headset.connected || state.headset.off) return { ok: true };
    if (mode === 'factory') { settings.headset.customLeds = false; return headset.stopLighting(true); }
    const lighting = mode === 'off' ? { ...settings.headset.lighting, effect: 'off', status: 'off', mic: 'mute' } : settings.headset.lighting;
    settings.headset.customLeds = true;
    if (headset.ledTimer) { headset.updateLighting(lighting); return { ok: true }; }
    return headset.startLighting(lighting, headsetCtx());
  },
  closeApps: (names) => sys.closeNames(names),
  overlay: async (on) => setOverlay(on),
};
async function activateProfile(id, { auto = false } = {}) {
  const p = settings.profiles[id];
  if (!p) return { ok: false, error: 'profilo sconosciuto' };
  log(`profilo: ${id}${auto ? ' (automatico)' : ''}`);
  const r = await applyProfile(p, profileDeps);
  settings.activeProfile = id;
  state.activeProfile = id;
  saveSettings();
  push();
  if (auto && Notification.isSupported()) new Notification({ title: `Profilo ${p.name} attivato`, body: auto === true ? 'Gioco rilevato' : String(auto), silent: true, icon: iconPath() }).show();
  if (!r.ok) log(`profilo ${id}: ${r.errors.join('; ')}`);
  return r.ok ? { ok: true } : { ok: false, error: `Applicato in parte: ${r.errors.join('; ')}` };
}
let autoState = { game: null, previous: null };
async function watchGames() {
  const A = settings.autoProfile;
  let names = [];
  try { names = await sys.procNames(); } catch (e) { return; }
  const game = detectGame(names, A.games);
  if (feat.onGame) feat.onGame(game);
  if (!A.enabled) return;
  if (game && !autoState.game) {
    autoState = { game, previous: settings.activeProfile && settings.activeProfile !== 'gioco' ? settings.activeProfile : null };
    if (settings.activeProfile !== 'gioco') await activateProfile('gioco', { auto: `${game} rilevato` });
  } else if (!game && autoState.game) {
    const back = autoState.previous || 'lavoro';
    autoState = { game: null, previous: null };
    await activateProfile(back, { auto: 'Gioco chiuso' });
  }
}

const state = { mouse: { connected: false }, headset: { connected: false }, keyboard: { connected: false }, eq: {}, updated: null, activeProfile: settings.activeProfile, overlay: !!settings.overlay.enabled, shutdownAt: null };
const warned = { mouse: false, headset: false, keyboard: false };

let win = null;
let tray = null;
let quitting = false;

function push() {
  state.updated = Date.now();
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
  updateTray();
}

async function refresh(which = ['mouse', 'headset', 'keyboard']) {
  const jobs = {
    mouse: () => mouse.status(),
    headset: () => headset.status(),
    keyboard: () => keyboard.status(),
  };
  await Promise.all(which.map(async (k) => {
    try { state[k] = await jobs[k](); } catch (e) { log(`${k}: ${e.stack || e.message}`); state[k] = { connected: false, error: e.message }; }
  }));
  try { state.eq = { ...apo.status(), ...settings.eq }; } catch (e) { state.eq = { installed: false }; }
  checkBatteries();
  push();
  return state;
}

async function refreshBatteries() {
  for (const [k, dev] of [['mouse', mouse], ['headset', headset], ['keyboard', keyboard]]) {
    try {
      const b = await dev.battery();
      if (!b.connected) state[k] = { connected: false };
      else state[k] = { ...state[k], ...b };
    } catch (e) { log(`${k} batteria: ${e.message}`); }
  }
  checkBatteries();
  push();
}

function checkBatteries() {
  const names = { mouse: 'Mouse', headset: 'Cuffie', keyboard: 'Tastiera' };
  for (const k of Object.keys(names)) {
    const s = state[k];
    if (!s || !s.connected || typeof s.battery !== 'number') continue;
    const charging = s.charging === 'charging';
    if (s.battery <= settings.notifyBelow && !charging && !warned[k]) {
      warned[k] = true;
      if (Notification.isSupported()) new Notification({ title: `${names[k]}: batteria al ${s.battery}%`, body: 'È ora di ricaricare (o cambiare le pile).', icon: iconPath() }).show();
    }
    if (s.battery > settings.notifyBelow + 5 || charging) warned[k] = false;
  }
}

function iconPath() { return path.join(__dirname, '..', 'assets', 'icon.png'); }

function updateTray() {
  if (!tray) return;
  const part = (label, s) => {
    if (!s || !s.connected) return `${label}: —`;
    if (s.asleep) return `${label}: in standby`;
    if (s.off) return `${label}: spente`;
    return typeof s.battery === 'number' ? `${label}: ${s.battery}%${s.charging === 'charging' ? ' (in carica)' : ''}` : `${label}: collegato`;
  };
  tray.setToolTip(['Unico', part('Mouse', state.mouse), part('Cuffie', state.headset), part('Tastiera', state.keyboard)].join('\n'));
}

// Mica richiede Windows 11 (build 22000 o successiva).
const micaSupported = process.platform === 'win32' && Number((os.release().split('.')[2]) || 0) >= 22000;

// "acrylic" sfoca quello che c'è davvero dietro la finestra (anche Wallpaper Engine e altre finestre);
// "mica" usa solo i colori dello sfondo statico del desktop.
function material() {
  if (!micaSupported) return 'none';
  const b = settings.appearance.background;
  return b === 'acrylic' || b === 'mica' ? b : 'none';
}

function applyTheme() {
  nativeTheme.themeSource = settings.appearance.theme || 'system';
  if (win && !win.isDestroyed() && process.platform === 'win32') {
    const dark = nativeTheme.shouldUseDarkColors;
    try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f3f4fa' : '#15161c', height: 46 }); } catch (e) {}
    if (micaSupported) {
      const m = material();
      try { win.setBackgroundColor(m === 'none' ? (dark ? '#101119' : '#e9ecf6') : '#00000000'); win.setBackgroundMaterial(m); } catch (e) {}
    }
  }
}

function createWindow(show = true) {
  nativeTheme.themeSource = settings.appearance.theme || 'system';
  const dark = nativeTheme.shouldUseDarkColors;
  const mat = material();
  const mica = mat !== 'none';
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 940, minHeight: 640,
    show: false,
    title: 'Unico',
    icon: iconPath(),
    autoHideMenuBar: true,
    backgroundColor: mica ? '#00000000' : dark ? '#101119' : '#e9ecf6',
    backgroundMaterial: mat,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f3f4fa' : '#15161c', height: 46 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu();
  if (MOCK) win.webContents.on('console-message', (...a) => { const m = a[0] && a[0].message ? a[0] : { level: a[1], message: a[2], lineNumber: a[3], sourceId: a[4] }; log(`console[${m.level}] ${m.message} (${m.sourceId || ''}:${m.lineNumber || ''})`); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
}
nativeTheme.on('updated', () => applyTheme());

function showWindow() {
  if (!win || win.isDestroyed()) createWindow(true);
  else { win.show(); win.focus(); }
  refresh();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri Unico', click: showWindow },
    { label: 'Aggiorna batterie', click: () => refreshBatteries() },
    { type: 'separator' },
    { label: 'Esci', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
  updateTray();
}

function applyLoginItem() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ['--hidden'] });
  } catch (e) { log(`login item: ${e.message}`); }
}

function headsetCtx() {
  return {
    getBattery: () => state.headset.battery,
    getMuted: () => state.headset.micMuted,
    onMic: (m) => { if (state.headset.micMuted !== m) { state.headset.micMuted = m; push(); } },
    onBattery: (b) => { if (b > 0 && b <= 100 && state.headset.battery !== b) { state.headset.battery = b; push(); } },
    onWheel: () => { if (settings.headset.wheelEq) cycleEqPreset(); },
  };
}

// Pressione della rotella del volume: passa al preset EQ successivo (come in iCUE).
function cycleEqPreset() {
  const names = Object.keys(apo.PRESETS);
  const cur = names.indexOf(settings.eq.preset);
  const next = names[(cur + 1) % names.length];
  const r = apo.apply(apo.PRESETS[next], true);
  if (!r.ok) { log(`eq rotella: ${r.error}`); return; }
  settings.eq = { enabled: true, preset: next, gains: apo.PRESETS[next] };
  saveSettings();
  state.eq = { ...apo.status(), ...settings.eq };
  push();
  if (Notification.isSupported()) new Notification({ title: `EQ: ${next}`, body: 'Preset cambiato dalla rotella delle cuffie', silent: true, icon: iconPath() }).show();
}

async function restoreHeadsetLeds() {
  if (settings.headset.customLeds && state.headset.connected && !state.headset.off) {
    const r = await headset.startLighting(settings.headset.lighting, headsetCtx());
    state.headset.customLeds = r.ok;
  }
}

// --- IPC ----------------------------------------------------------------------
const handle = (name, fn) => ipcMain.handle(name, async (_e, arg) => {
  try { return await fn(arg); } catch (e) { log(`${name}: ${e.stack || e.message}`); return { ok: false, error: e.message }; }
});

handle('state:get', async () => ({ state, settings, meta: { modes: MODES, sleep: SLEEP, eqBands: apo.BANDS, eqPresets: apo.PRESETS, version: app.getVersion(), micaSupported, platform: process.platform } }));
handle('state:refresh', async (which) => refresh(which));

handle('mouse:apply', async (change) => {
  const r = await mouse.apply(change);
  if (r.ok && change.scroll) { settings.mouse.scroll = { ...settings.mouse.scroll, ...change.scroll }; saveSettings(); }
  await refresh(['mouse']);
  return r;
});

handle('headset:sleep', async (minutes) => {
  const r = await headset.setSleep(minutes);
  await refresh(['headset']);
  return r;
});

handle('headset:lighting', async ({ enabled, lighting, wheelEq }) => {
  if (lighting) settings.headset.lighting = { ...settings.headset.lighting, ...lighting };
  if (wheelEq !== undefined) settings.headset.wheelEq = !!wheelEq;
  settings.headset.customLeds = !!enabled;
  saveSettings();
  let r;
  if (!enabled) r = await headset.stopLighting(true);
  else if (headset.ledTimer) { headset.updateLighting(settings.headset.lighting); r = { ok: true }; }
  else r = await headset.startLighting(settings.headset.lighting, headsetCtx());
  state.headset.customLeds = !!enabled && r.ok;
  push();
  return r;
});

handle('keyboard:lighting', async (cfg) => {
  const r = await keyboard.applyLighting(cfg);
  if (r.ok) { settings.keyboard.lighting = cfg; saveSettings(); }
  return r;
});
handle('keyboard:settings', async (cfg) => {
  const r = await keyboard.applySettings(cfg);
  if (r.ok) { settings.keyboard.settings = cfg; saveSettings(); }
  return r;
});
handle('keyboard:clock', async () => keyboard.syncClock());
handle('keyboard:screen', async (frames) => {
  if (!Array.isArray(frames) || !frames.length) return { ok: false, error: 'Nessuna immagine' };
  return keyboard.uploadScreen(frames, (p) => { if (win && !win.isDestroyed()) win.webContents.send('progress', { what: 'screen', p }); });
});

handle('phone:list', async () => phone.list());
handle('phone:start', async ({ serial, model, opts }) => {
  if (opts) { settings.phone = { ...settings.phone, ...opts }; saveSettings(); }
  return phone.start(serial, settings.phone, `Unico · ${model || 'Telefono'}`);
});
handle('phone:stop', async (serial) => phone.stop(serial));
handle('phone:pair', async ({ address, code }) => phone.pair(address, code));
handle('phone:connect', async (address) => phone.connect(address));
handle('phone:wifi', async (serial) => phone.switchToWifi(serial));
handle('phone:disconnect', async (address) => phone.disconnect(address));
handle('phone:openVideos', async () => { shell.openPath(app.getPath('videos')); return { ok: true }; });

// --- Sistema ---
handle('sys:watch', async (on) => { sys.want('window', !!on); return { ok: true, history: sys.history, last: sys.last }; });
handle('sys:procs', async () => sys.procs());
handle('sys:kill', async ({ pids, name }) => sys.kill(pids, name));
handle('sys:startup', async () => tools.startupList());
handle('sys:startupSet', async ({ item, enabled }) => tools.startupSet(item, enabled));
handle('sys:cleanupScan', async () => sys.cleanupScan(app.getPath('downloads')));
handle('sys:clearTemp', async () => sys.clearTemp());
handle('sys:emptyRecycle', async () => { await sys.emptyRecycle(); return { ok: true }; });
handle('sys:trash', async (p) => {
  const dl = app.getPath('downloads');
  if (typeof p !== 'string' || !path.resolve(p).toLowerCase().startsWith(path.resolve(dl).toLowerCase())) return { ok: false, error: 'Solo file della cartella Download' };
  if (MOCK) return { ok: true };
  await shell.trashItem(p);
  return { ok: true };
});
handle('sys:showFile', async (p) => { if (typeof p === 'string') shell.showItemInFolder(p); return { ok: true }; });
handle('sys:network', async (host) => sys.network(host));
handle('sys:power', async (mode) => (mode ? tools.powerSet(mode) : { ok: true, mode: await tools.powerGet() }));
handle('sys:lock', async () => tools.lock());
handle('sys:suspend', async () => { await sys.suspend(); return { ok: true }; });
handle('sys:shutdownIn', async (min) => { const r = await tools.shutdownIn(min); if (r.ok) { state.shutdownAt = r.at; push(); } return r; });
handle('sys:shutdownCancel', async () => { const r = await tools.shutdownCancel(); state.shutdownAt = null; push(); return r; });
handle('sys:media', async () => sys.media().catch(() => null));
handle('sys:mediaKey', async (k) => { await sys.mediaKey(k); return { ok: true }; });
handle('sys:brightness', async () => sys.brightness());
handle('sys:setBrightness', async ({ id, value }) => { await sys.setBrightness(id, value); return { ok: true }; });
handle('overlay:set', async (patch) => {
  if (patch && patch.corner) settings.overlay.corner = patch.corner;
  return setOverlay(patch && patch.enabled !== undefined ? patch.enabled : settings.overlay.enabled);
});
handle('profile:activate', async (id) => activateProfile(id));
handle('phone:battery', async (serial) => phone.battery(serial));
handle('phone:push', async ({ serial, files }) => {
  let list = Array.isArray(files) ? files : [];
  if (!list.length) {
    const r = await dialog.showOpenDialog(win, { title: 'Scegli i file da inviare al telefono', properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return { ok: true, sent: 0 };
    list = r.filePaths;
  }
  return phone.pushFiles(serial, list);
});
handle('phone:import', async ({ serial, count }) => {
  const r = await phone.importPhotos(serial, count || 20, app.getPath('pictures'));
  if (r.ok && r.dir && !MOCK) shell.openPath(r.dir);
  return r;
});

handle('eq:apply', async ({ enabled, preset, gains }) => {
  const r = apo.apply(gains, enabled);
  if (r.ok) { settings.eq = { enabled, preset, gains }; saveSettings(); }
  state.eq = { ...apo.status(), ...settings.eq };
  push();
  return r;
});

handle('app:settings', async (patch) => {
  settings = deepMerge(settings, patch);
  saveSettings();
  applyLoginItem();
  if (patch && patch.appearance) applyTheme();
  if (patch && patch.overlay && patch.overlay.shortcut) registerShortcut();
  return { ok: true, settings };
});

handle('diag:devices', async () => {
  const all = await HID.devicesAsync();
  const known = all.filter((d) => [0x1532, 0x1b1c, 0x0c45].includes(d.vendorId) || (d.vendorId === 0x05ac && d.productId === 0x024f));
  return known.map((d) => ({
    id: `${hex(d.vendorId)}:${hex(d.productId)}`, product: d.product || '', manufacturer: d.manufacturer || '',
    usage: `${hex(d.usagePage)}:${hex(d.usage)}`, interface: d.interface,
  }));
});
handle('diag:copy', async () => {
  const devs = await HID.devicesAsync();
  const lines = devs.map((d) => `${hex(d.vendorId)}:${hex(d.productId)} if${d.interface} ${hex(d.usagePage)}:${hex(d.usage)} ${d.product || ''}`);
  let tail = '';
  try { tail = fs.readFileSync(logFile, 'utf8').split('\n').slice(-80).join('\n'); } catch (e) {}
  clipboard.writeText(`Unico ${app.getVersion()}\n\n${lines.join('\n')}\n\n--- log ---\n${tail}`);
  return { ok: true };
});
handle('diag:openLog', async () => { shell.openPath(userDir); return { ok: true }; });
handle('link:open', async (url) => {
  if (/^https:\/\/(sourceforge\.net|github\.com)\//.test(url)) await shell.openExternal(url);
  return { ok: true };
});

// --- Funzioni 2.1 (audio, giochi, strumenti, notifiche telefono, backup, aggiornamenti) ---
const feat = {
  app, handle, log, sys, phone, MOCK, iconPath,
  getSettings: () => settings,
  saveSettings,
  getWin: () => win,
  showWindow: () => showWindow(),
  activateProfile: (id) => activateProfile(id),
  prepareQuit: () => { quitting = true; },
  replaceSettings: (s) => {
    settings = deepMerge(structuredClone(DEFAULTS), s);
    saveSettings();
    applyLoginItem();
    applyTheme();
    registerShortcut();
    if (win && !win.isDestroyed()) win.webContents.reload();
  },
};

const hex = (v) => (v || 0).toString(16).padStart(4, '0');

// --- Avvio --------------------------------------------------------------------
app.on('second-instance', showWindow);
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => { phone.stopAll(); sys.stop(); try { globalShortcut.unregisterAll(); } catch (e) {} });
app.on('before-quit', async (e) => {
  if (headset.ledTimer) {
    e.preventDefault();
    quitting = true;
    await headset.stopLighting(true).catch(() => {});
    headset.ledTimer = null;
    app.quit();
  }
});

app.whenReady().then(async () => {
  require('./features').setup(feat);
  app.setAppUserModelId('it.hekat.unico');
  log(`--- avvio Unico ${app.getVersion()} (electron ${process.versions.electron}, hidapi ${safe(() => HID.getHidapiVersion())})`);
  applyLoginItem();
  createTray();
  const hidden = process.argv.includes('--hidden') && settings.startHidden;
  createWindow(!hidden);
  await refresh();
  await restoreHeadsetLeds();
  setInterval(refreshBatteries, 60 * 1000);
  registerShortcut();
  if (settings.overlay.enabled) setOverlay(true);
  setInterval(checkAlerts, 30 * 1000);
  setInterval(watchGames, 5000);
  // avvia PowerShell in anticipo: la prima apertura di Sistema e Audio è subito pronta
  if (!MOCK && sys.helper) setTimeout(() => { try { sys.helper.start(); } catch (e) {} }, 3000);
  if (process.env.UNICO_DEBUGJS) setTimeout(async () => { try { log('debugjs: ' + await win.webContents.executeJavaScript(process.env.UNICO_DEBUGJS)); } catch (e) { log('debugjs errore: ' + e.message); } quitting = true; app.quit(); }, 4000);
  if (process.env.UNICO_SHOT2) captureDemo(process.env.UNICO_SHOT2);
  if (process.env.UNICO_SHOTS) captureScreens(process.env.UNICO_SHOTS);
  if (process.env.UNICO_SHOT3) captureNew(process.env.UNICO_SHOT3);
});

// Solo sviluppo: overlay e lettore musicale.
async function captureDemo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.show();
  setOverlay(true);
  await wait(4500);
  fs.writeFileSync(path.join(dir, 'overlay.png'), (await overlayWin.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#view').scrollTop = 520`);
  await wait(3500);
  fs.writeFileSync(path.join(dir, 'home-media.png'), (await win.webContents.capturePage()).toPNG());
  quitting = true;
  app.quit();
}

// Solo sviluppo: salva uno screenshot di ogni pagina e chiude.
// Solo sviluppo: pagine della 2.1.
async function captureNew(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.show();
  await wait(1800);
  const shots = [['audio', 'out'], ['audio', 'apps'], ['audio', 'mic'], ['games', 'lib'], ['games', 'sessions'], ['tools', 'clip'], ['tools', 'rem'], ['tools', 'cap'], ['phone', 'notif'], ['settings', 'general'], ['home', null]];
  for (const [page, tab] of shots) {
    await win.webContents.executeJavaScript(`document.querySelector('nav button[data-page="${page}"]').click(); ${tab ? `setTimeout(() => document.querySelector('[data-tabs="${page}"] button[data-tab="${tab}"]').click(), 200);` : ''}
      ${page === 'tools' && tab === 'rem' ? "setTimeout(() => { document.querySelector('#timer-quick button[data-v=\"25\"]').click(); document.querySelector('#timer-label').value = 'Pausa'; document.querySelector('#timer-add').click(); }, 500);" : ''}
      ${page === 'phone' ? "setTimeout(() => { const e = document.querySelector('#pn-on'); if (!e.checked) { e.checked = true; e.dispatchEvent(new Event('change')); } }, 400);" : ''}`);
    await wait(page === 'phone' ? 9000 : 1600);
    fs.writeFileSync(path.join(dir, `${page}${tab ? '-' + tab : ''}.png`), (await win.webContents.capturePage()).toPNG());
  }
  quitting = true;
  app.quit();
}

async function captureScreens(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.show();
  await wait(1500);
  await win.webContents.executeJavaScript(`document.querySelector('nav button[data-page="system"]').click()`);
  await wait(3500);
  for (const page of ['home', 'mouse', 'headset', 'keyboard', 'phone', 'system', 'settings']) {
    await win.webContents.executeJavaScript(`document.querySelector('nav button[data-page="${page}"]').click()`);
    await wait(700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${page}.png`), img.toPNG());
  }
  // Prova delle interazioni: modifica dei controlli e lettura dello stato di salvataggio
  const results = [];
  const run = async (label, page, js, ms = 1500) => {
    await win.webContents.executeJavaScript(`document.querySelector('nav button[data-page="${page}"]').click(); ${js}`);
    await wait(ms);
    results.push(`${label}: ${await win.webContents.executeJavaScript("document.querySelector('#sync').textContent + ' | ' + document.querySelector('#toast').className + ' ' + document.querySelector('#toast').textContent")}`);
  };
  const change = (sel, v) => `(() => { const e = document.querySelector('${sel}'); ${v === undefined ? 'e.checked = !e.checked' : `e.value = '${v}'`}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`;
  await run('stadi DPI', 'mouse', "document.querySelector('#stages-save').click()");
  await run('polling', 'mouse', "document.querySelector('#poll button[data-v=\"500\"]').click()");
  await run('luce rotella', 'mouse', "document.querySelector('#scroll-effect button[data-v=\"reactive\"]').click()");
  await run('standby mouse', 'mouse', change('#idle', 600));
  await run('spegnimento cuffie', 'headset', "document.querySelector('#hs-sleep button[data-v=\"30\"]').click()");
  await run('luce cuffie', 'headset', "document.querySelector('#hs-effect button[data-v=\"rainbow\"]').click()");
  await run('eq preset', 'headset', "document.querySelector('#eq-presets button[data-v=\"Bassi\"]').click()");
  await run('luce tastiera', 'keyboard', "document.querySelector('#kb-mode button[data-v=\"10\"]').click()");
  await run('impostazioni tastiera', 'keyboard', change('#kb-game'));
  await run('orologio', 'keyboard', "document.querySelector('#kb-clock').click()");
  await run('mirroring', 'phone', "setTimeout(() => document.querySelector('#phone-list [data-act=start]').click(), 600)", 1800);
  fs.writeFileSync(path.join(dir, 'phone-live.png'), (await win.webContents.capturePage()).toPNG());
  await run('profilo gioco', 'home', "document.querySelector('#profiles button[data-v=gioco]').click()", 1500);
  await run('overlay', 'home', "document.querySelector('#qa-overlay').click()", 1200);
  for (const t of ['procs', 'startup', 'clean', 'net']) {
    await win.webContents.executeJavaScript(`document.querySelector('nav button[data-page="system"]').click(); setTimeout(() => document.querySelector('[data-tabs="system"] button[data-tab="${t}"]').click(), 300); ${t === 'net' ? "setTimeout(() => document.querySelector('#net-run').click(), 700);" : ''}`);
    await wait(2200);
    fs.writeFileSync(path.join(dir, `system-${t}.png`), (await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.executeJavaScript(`document.querySelector('nav button[data-page="settings"]').click(); setTimeout(() => document.querySelector('[data-tabs="settings"] button[data-tab="profiles"]').click(), 300);`);
  await wait(1200);
  fs.writeFileSync(path.join(dir, 'settings-profiles.png'), (await win.webContents.capturePage()).toPNG());
  await run('opzioni telefono', 'phone', "document.querySelector('[data-tabs=phone] button[data-tab=options]').click(); setTimeout(() => document.querySelector('#ph-bitrate button[data-v=\"16\"]').click(), 300)", 1500);
  fs.writeFileSync(path.join(dir, 'phone-options.png'), (await win.webContents.capturePage()).toPNG());
  for (const [page, tab] of [['mouse', 'light'], ['headset', 'light'], ['headset', 'power'], ['keyboard', 'screen'], ['keyboard', 'keys']]) {
    await win.webContents.executeJavaScript(`document.querySelector('nav button[data-page="${page}"]').click(); document.querySelector('[data-tabs="${page}"] button[data-tab="${tab}"]').click()`);
    await wait(700);
    fs.writeFileSync(path.join(dir, `${page}-${tab}.png`), (await win.webContents.capturePage()).toPNG());
  }
  // Schermo tastiera: immagine generata nel renderer, decodifica, anteprima e caricamento
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('nav button[data-page="keyboard"]').click();
    document.querySelector('[data-tabs="keyboard"] button[data-tab="screen"]').click();
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 300, 200);
    gr.addColorStop(0, '#7c5cff'); gr.addColorStop(1, '#3ec7ff'); g.fillStyle = gr; g.fillRect(0, 0, 300, 200);
    g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.fillText('U', 120, 135);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    screenFile = new File([blob], 'prova.png', { type: 'image/png' });
    await loadScreenFile();
    document.querySelector('#kb-screen-apply').click();
    document.querySelector('main').scrollTop = 9999;
  })()`);
  await wait(2500);
  results.push(`schermo: ${await win.webContents.executeJavaScript("document.querySelector('#kb-file-info').textContent + ' | ' + document.querySelector('#toast').textContent")}`);
  fs.writeFileSync(path.join(dir, 'keyboard-screen.png'), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(dir, 'clicks.txt'), results.join('\n'));
  quitting = true;
  app.quit();
}

function safe(fn) { try { return fn(); } catch (e) { return '?'; } }
