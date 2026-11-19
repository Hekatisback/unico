'use strict';
// Batterie 2.8, sull'esempio di Joule: pannello dall'icona nella barra di sistema, icona che segnala
// la batteria bassa, anelli sul bordo dello schermo, avviso quando un dispositivo si accende.
const { BrowserWindow, Notification, nativeImage, screen, shell, nativeTheme } = require('electron');
const path = require('path');
const M = require('./model');

const DEFAULTS = { trayClick: 'panel', edge: 'auto', edgeSide: 'right', edgePos: 'center', notice: 'edge', sound: false, bluetooth: true, phone: true };

function setup(ctx) {
  const { app, handle, log, MOCK, iconPath, sys, phone } = ctx;
  const S = () => ctx.getSettings();
  const B = () => ({ ...DEFAULTS, ...(S().batteries || {}) });
  const save = (patch) => { S().batteries = { ...B(), ...patch }; ctx.saveSettings(); };

  let list = [];
  let extra = { phones: [], bluetooth: [] };
  let seen = null; // id visti all'ultimo giro (null = primo giro: niente avvisi di collegamento)
  const warned = {};

  // ---------------------------------------------------------------- statistiche dall'ultimo aggiornamento
  function stats() { return S().batteryStats || null; }
  function trackStats(newIds, warnings) {
    const st = stats() || { since: app.getVersion(), devices: [], warnings: 0 };
    let changed = false;
    for (const id of newIds) if (!st.devices.includes(id)) { st.devices.push(id); changed = true; }
    if (warnings) { st.warnings += warnings; changed = true; }
    if (changed || !stats()) { S().batteryStats = st; ctx.saveSettings(); }
  }
  // Dopo un aggiornamento: un riassunto, poi si riparte da zero. I numeri restano sul PC.
  function updateSummary() {
    const st = stats();
    if (!st || st.since === app.getVersion()) return;
    const n = st.devices.length;
    if (n && Notification.isSupported()) {
      new Notification({ title: `Unico ${app.getVersion()}`, body: `Dalla ${st.since}: ${n} ${n === 1 ? 'dispositivo seguito' : 'dispositivi seguiti'}, ${st.warnings} ${st.warnings === 1 ? 'avviso' : 'avvisi'} di batteria bassa.`, silent: true, icon: iconPath() }).show();
    }
    S().batteryStats = { since: app.getVersion(), devices: [], warnings: 0 };
    ctx.saveSettings();
  }

  // ---------------------------------------------------------------- telefono e Bluetooth
  // Il telefono si legge solo se è già stato usato con Unico: così adb non parte per chi non lo usa.
  const origList = phone.list.bind(phone);
  phone.list = async (...a) => {
    const r = await origList(...a);
    if (r && r.devices && r.devices.some((d) => d.state === 'device') && !S().batteriesPhoneSeen) { S().batteriesPhoneSeen = true; ctx.saveSettings(); }
    return r;
  };
  const phoneUsed = () => MOCK || S().batteriesPhoneSeen || (S().phoneNotif || {}).enabled || (S().phoneSync || {}).enabled;

  async function readPhones() {
    if (!B().phone || !phoneUsed()) return [];
    try {
      const r = await origList();
      const out = [];
      for (const d of (r.devices || []).filter((x) => x.state === 'device')) {
        const b = await phone.battery(d.serial).catch(() => null);
        if (b) out.push({ serial: d.serial, model: d.model, percent: b.percent, charging: b.charging });
      }
      return out;
    } catch (e) { return extra.phones; }
  }
  async function readBluetooth() {
    if (!B().bluetooth) return [];
    if (MOCK) return M.parseBluetooth([{ name: 'Xbox Wireless Controller', battery: 34, cls: 'HIDClass', connected: true }, { name: 'Galaxy Buds2 Pro', battery: 80, cls: 'AudioEndpoint', connected: true }]);
    if (!sys.btBattery) return [];
    try { return M.parseBluetooth(await sys.btBattery()); } catch (e) { log(`bluetooth batteria: ${e.message}`); return extra.bluetooth; }
  }
  let extraBusy = false;
  async function refreshExtra({ bt = true } = {}) {
    if (extraBusy) return;
    extraBusy = true;
    try {
      const [phones, bluetooth] = await Promise.all([readPhones(), bt ? readBluetooth() : Promise.resolve(extra.bluetooth)]);
      extra = { phones, bluetooth };
    } finally { extraBusy = false; }
    update();
  }

  // ---------------------------------------------------------------- aggiornamento della lista
  function update() {
    list = M.buildList(ctx.getState(), extra);
    const low = S().notifyBelow;
    // avviso di batteria bassa (le periferiche li gestisce già main.js: qui solo telefono e Bluetooth)
    const alerts = M.lowAlerts(list, warned, low);
    const fire = alerts.filter((e) => e.kind === 'phone' || e.id.startsWith('bt:'));
    for (const e of fire) if (Notification.isSupported()) new Notification({ title: `${e.name}: batteria al ${e.percent}%`, body: 'È ora di ricaricare.', icon: iconPath() }).show();
    if (alerts.length) flashEdge('low');
    // avviso di collegamento
    const ids = new Set(list.map((e) => e.id));
    if (seen) {
      const fresh = M.newlyConnected(seen, list);
      if (fresh.length) connectNotice(fresh);
      trackStats(fresh.map((e) => e.id), alerts.length);
    } else trackStats(list.map((e) => e.id), alerts.length);
    seen = ids;
    paintTray();
    sendAll();
  }

  function connectNotice(entries) {
    const b = B();
    if (b.notice === 'off') return;
    if (b.sound) shell.beep();
    if (b.notice === 'notification' || (b.notice === 'edge' && b.edge === 'off')) {
      for (const e of entries) if (Notification.isSupported()) new Notification({ title: `${e.name} collegato`, body: `Batteria al ${e.percent}%${e.charging ? ' · in carica' : ''}`, silent: true, icon: iconPath() }).show();
      return;
    }
    flashEdge('connect', entries.map((e) => e.id));
  }

  // ---------------------------------------------------------------- icona nella barra
  const baseIcon = nativeImage.createFromPath(iconPath()).resize({ width: 32, height: 32, quality: 'best' });
  let lastPaint = '';
  function paintTray() {
    const tray = ctx.getTray();
    if (!tray) return;
    tray.setToolTip(M.tooltip(list));
    const w = M.weakest(list);
    const low = w && w.percent <= S().notifyBelow;
    const key = low ? 'low' : 'ok';
    if (key === lastPaint) return;
    lastPaint = key;
    tray.setImage(low ? badged(baseIcon, [0xe5, 0x30, 0x4a]) : baseIcon.resize({ width: 16, height: 16, quality: 'best' }));
  }
  // Pallino rosso in basso a destra, con un bordo scuro per staccare dalla barra.
  function badged(img, [r, g, b]) {
    const { width: W, height: H } = img.getSize();
    const px = Buffer.from(img.toBitmap()); // BGRA
    const cx = W - 7.5, cy = H - 7.5, R = 7;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > R + 0.5) continue;
      const i = (y * W + x) * 4;
      const a = Math.min(1, R + 0.5 - d);
      const [cb, cg, cr] = d > R - 1.6 ? [20, 18, 24] : [b, g, r];
      px[i] = Math.round(px[i] * (1 - a) + cb * a);
      px[i + 1] = Math.round(px[i + 1] * (1 - a) + cg * a);
      px[i + 2] = Math.round(px[i + 2] * (1 - a) + cr * a);
      px[i + 3] = Math.max(px[i + 3], Math.round(255 * a));
    }
    return nativeImage.createFromBitmap(px, { width: W, height: H });
  }

  // ---------------------------------------------------------------- pannello dall'icona
  let panel = null, panelHiddenAt = 0;
  const dark = () => nativeTheme.shouldUseDarkColors;
  function panelSize() { return { width: 330, height: Math.min(600, 112 + Math.max(1, list.length) * 64) }; }
  function togglePanel() {
    if (panel && !panel.isDestroyed() && panel.isVisible()) { panel.hide(); return; }
    if (Date.now() - panelHiddenAt < 300) return; // il clic che ha appena chiuso il pannello
    const { width, height } = panelSize();
    const tray = ctx.getTray();
    const tb = tray ? tray.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
    const disp = screen.getDisplayNearestPoint({ x: tb.x || 0, y: tb.y || 0 });
    const wa = disp.workArea;
    // il pannello sta sopra la barra delle applicazioni, centrato sull'icona quando possibile
    let x = tb.width ? Math.round(tb.x + tb.width / 2 - width / 2) : wa.x + wa.width - width - 12;
    x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - width - 8));
    const y = tb.height && tb.y < wa.y ? wa.y + 12 : wa.y + wa.height - height - 12; // barra in alto o in basso
    if (!panel || panel.isDestroyed()) {
      panel = new BrowserWindow({
        width, height, x, y, show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: true, roundedCorners: true, title: 'Batterie', icon: iconPath(),
        backgroundColor: dark() ? '#17161f' : '#eef0f7',
        webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
      });
      panel.loadFile(path.join(__dirname, 'panel.html'));
      panel.on('blur', () => { if (panel && !panel.isDestroyed() && !process.env.UNICO_SHOT5) { panel.hide(); panelHiddenAt = Date.now(); } });
      panel.once('ready-to-show', () => { panel.show(); panel.focus(); });
    } else {
      panel.setBounds({ x, y, width, height });
      panel.show(); panel.focus();
      send(panel);
    }
    refreshExtra({ bt: false });
  }

  // ---------------------------------------------------------------- anelli sul bordo
  let edge = null, edgeUntil = 0, edgeTimer = null, edgeReason = null, edgeHighlight = [];
  let fullscreen = false;
  function edgeBounds(n) {
    const b = B();
    const wa = screen.getPrimaryDisplay().workArea;
    const w = 76, h = Math.max(1, n) * 64 + 20;
    const x = b.edgeSide === 'left' ? wa.x : wa.x + wa.width - w;
    const y = b.edgePos === 'top' ? wa.y + 80 : b.edgePos === 'bottom' ? wa.y + wa.height - h - 80 : Math.round(wa.y + (wa.height - h) / 2);
    return { x, y, width: w, height: h };
  }
  function edgeWanted() {
    const b = B();
    if (b.edge === 'off' || !list.length || fullscreen || ctx.gameRunning()) return false;
    return b.edge === 'always' || Date.now() < edgeUntil;
  }
  async function flashEdge(reason, ids = []) {
    if (B().edge === 'off') return;
    edgeReason = reason; edgeHighlight = ids;
    edgeUntil = Date.now() + 6000;
    // prima di comparire controlla lo schermo intero, così non si affaccia nemmeno per un istante sopra un gioco
    if (!MOCK && sys.fullscreen && reason !== 'test') { try { fullscreen = (await sys.fullscreen()) === 1; } catch (e) {} }
    syncEdge();
    clearTimeout(edgeTimer);
    edgeTimer = setTimeout(syncEdge, 6100);
  }
  function syncEdge() {
    const want = edgeWanted();
    if (want && (!edge || edge.isDestroyed())) {
      edge = new BrowserWindow({
        ...edgeBounds(list.length), show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
        skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
        webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
      });
      edge.setAlwaysOnTop(true, 'screen-saver');
      // i clic passano attraverso; il passaggio del mouse arriva comunque, così gli anelli si fanno da parte
      edge.setIgnoreMouseEvents(true, { forward: true });
      edge.loadFile(path.join(__dirname, 'edge.html'));
      edge.webContents.once('did-finish-load', () => { if (edge && !edge.isDestroyed()) { send(edge); edge.showInactive(); } });
    } else if (!want && edge && !edge.isDestroyed()) {
      const e = edge; edge = null;
      try { e.webContents.send('batteries:hide'); } catch (x) {}
      setTimeout(() => { try { e.destroy(); } catch (x) {} }, 260);
    } else if (want && edge) {
      edge.setBounds(edgeBounds(list.length));
      send(edge);
    }
  }
  // Schermo intero: controllato solo mentre gli anelli dovrebbero essere visibili.
  setInterval(async () => {
    if (B().edge === 'off' || MOCK || !sys.fullscreen) return;
    if (B().edge !== 'always' && Date.now() >= edgeUntil) return;
    try { const f = (await sys.fullscreen()) === 1; if (f !== fullscreen) log(`batterie: schermo intero ${f ? 'sì' : 'no'}`); fullscreen = f; } catch (e) {}
    syncEdge();
  }, 2500);

  // Mouse sopra gli anelli: diventano quasi trasparenti. Si controlla la posizione del cursore,
  // perché con i clic che passano attraverso la finestra non riceve gli eventi del mouse.
  let away = false;
  setInterval(() => {
    if (!edge || edge.isDestroyed()) { away = false; return; }
    const c = screen.getCursorScreenPoint(), b = edge.getBounds();
    const inside = c.x >= b.x - 6 && c.x <= b.x + b.width + 6 && c.y >= b.y - 6 && c.y <= b.y + b.height + 6;
    if (inside !== away) { away = inside; edge.webContents.send('batteries:away', away); }
  }, 200);

  // ---------------------------------------------------------------- comunicazione con le finestre
  function payload() {
    return { list, low: S().notifyBelow, now: Date.now(), settings: B(), reason: edgeReason, highlight: edgeHighlight, side: B().edgeSide };
  }
  function send(w) { if (w && !w.isDestroyed()) w.webContents.send('batteries', payload()); }
  function sendAll() {
    send(panel); syncEdge();
    const main = ctx.getWin();
    if (main && !main.isDestroyed()) main.webContents.send('batteries', payload());
  }

  handle('batteries:get', async () => payload());
  // periferiche subito; telefono e Bluetooth arrivano dopo (PowerShell e adb possono metterci qualche secondo)
  handle('batteries:refresh', async () => { await ctx.refreshBatteries(); refreshExtra(); return payload(); });
  handle('batteries:openMain', async () => { if (panel && !panel.isDestroyed()) panel.hide(); ctx.showWindow(); return { ok: true }; });
  handle('batteries:settings', async (patch) => {
    const clean = {};
    for (const k of Object.keys(DEFAULTS)) if (patch && patch[k] !== undefined) clean[k] = typeof DEFAULTS[k] === 'boolean' ? !!patch[k] : String(patch[k]);
    save(clean);
    if (clean.bluetooth !== undefined || clean.phone !== undefined) refreshExtra();
    if (clean.edge === 'auto' || clean.edgeSide || clean.edgePos) flashEdge('test');
    syncEdge();
    return { ok: true, settings: B() };
  });
  handle('batteries:panel', async () => { setTimeout(togglePanel, 150); return { ok: true }; });
  handle('batteries:testEdge', async () => { flashEdge('connect', list.slice(0, 1).map((e) => e.id)); return { ok: true }; });

  // ---------------------------------------------------------------- avvio
  ctx.batteries = { update, togglePanel, flashEdge, list: () => list, panelWin: () => panel, edgeWin: () => edge, trayClick: () => B().trayClick };
  updateSummary();
  setTimeout(() => refreshExtra(), MOCK ? 1500 : 12000);
  setInterval(() => refreshExtra({ bt: false }), 60 * 1000);
  setInterval(() => refreshExtra({ bt: true }), 2 * 60 * 1000);
  setInterval(() => { if (B().edge === 'always') syncEdge(); }, 5000);
  return ctx.batteries;
}

module.exports = { setup, DEFAULTS };
