'use strict';
// Funzioni aggiunte nella 2.1: audio, giochi, strumenti (appunti, promemoria, cattura schermo),
// notifiche del telefono, backup delle impostazioni e aggiornamenti automatici.
const { clipboard, desktopCapturer, dialog, globalShortcut, Notification, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const games = require('./system/games');
const { Covers } = require('./system/covers');
const { pathToFileURL } = require('url');

function setup(ctx) {
  const { app, handle, log, sys, phone, MOCK, iconPath } = ctx;
  const S = () => ctx.getSettings();
  const send = (ch, data) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
  const notify = (title, body, onClick) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: iconPath() });
    if (onClick) n.on('click', onClick);
    n.show();
  };
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const userDir = app.getPath('userData');

  // --- Audio -------------------------------------------------------------------
  handle('audio:devices', async (flow) => sys.audioDevices(flow));
  handle('audio:sessions', async () => sys.audioSessions());
  handle('audio:setDefault', async (id) => { await sys.audioSetDefault(id, true); return { ok: true }; });
  handle('audio:setDeviceVolume', async ({ id, volume }) => { await sys.audioSetDeviceVolume(id, volume); return { ok: true }; });
  handle('audio:setDeviceMute', async ({ id, mute }) => { await sys.audioSetDeviceMute(id, mute); return { ok: true }; });
  handle('audio:setApp', async ({ pids, volume, mute }) => { await sys.audioSetApp(pids, { volume, mute }); return { ok: true }; });

  // --- Giochi ------------------------------------------------------------------
  const sessionsFile = path.join(userDir, 'sessions.json');
  const readSessions = () => { try { return JSON.parse(fs.readFileSync(sessionsFile, 'utf8')); } catch (e) { return []; } };
  let current = null; // sessione di gioco in corso
  let library = null;

  const covers = new Covers(path.join(userDir, 'covers'), log);
  const toUrl = (p) => (!p || p.startsWith('data:') ? p : pathToFileURL(p).href);
  const view = (g) => {
    const c = covers.lookup(g.id);
    // la copertina scelta da te vince sempre; quella scaricata solo se il PC non ne ha una
    if (c && (c.custom || !g.cover || g.icon)) return { ...g, cover: toUrl(c.cover), icon: false, wide: c.wide, customCover: c.custom };
    return { ...g, cover: toUrl(g.cover) };
  };
  const fillCovers = () => {
    if (MOCK || !library) return;
    covers.fill(library, { sgdbKey: (S().steamGridDbKey || '').trim(), onDone: (n) => { log(`copertine: ${n} scaricate`); send('games:covers', n); } }).catch((e) => log(`copertine: ${e.message}`));
  };

  handle('games:list', async (force) => {
    if (!library || force) library = MOCK ? require('../test/fake-system').fakeGames() : await games.scanAll(S().customGames || []);
    setTimeout(fillCovers, 500);
    return library.map(view);
  });
  handle('games:setCover', async (id) => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Scegli la copertina', filters: [{ name: 'Immagini', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, changed: false };
    covers.setCustom(id, r.filePaths[0]);
    return { ok: true, changed: true };
  });
  handle('games:clearCover', async (id) => { covers.clearCustom(id); return { ok: true }; });
  handle('games:retryCovers', async () => { covers.forgetMisses(); fillCovers(); return { ok: true }; });
  handle('games:launch', async (id) => {
    const g = (library || []).find((x) => x.id === id);
    if (!g) return { ok: false, error: 'Gioco non trovato, aggiorna la libreria' };
    if (S().gamesProfile !== false && S().activeProfile !== 'gioco') await ctx.activateProfile('gioco');
    const r = MOCK ? { ok: true } : await games.launch(g, (u) => shell.openExternal(u));
    if (r.ok) { S().lastPlayed = { ...(S().lastPlayed || {}), [id]: Date.now() }; ctx.saveSettings(); }
    return r;
  });
  handle('games:addCustom', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Scegli il file .exe del gioco', filters: [{ name: 'Programmi', extensions: ['exe', 'lnk', 'url'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, added: false };
    const exe = r.filePaths[0];
    const list = S().customGames || [];
    list.push({ id: `custom:${Date.now()}`, name: path.basename(exe).replace(/\.(exe|lnk|url)$/i, ''), exe, dir: path.dirname(exe), cover: null });
    S().customGames = list;
    ctx.saveSettings();
    library = null;
    return { ok: true, added: true };
  });
  handle('games:removeCustom', async (id) => { S().customGames = (S().customGames || []).filter((g) => g.id !== id); ctx.saveSettings(); library = null; return { ok: true }; });
  handle('games:sessions', async () => ({ sessions: readSessions().slice(-100).reverse(), current: current && sessionView(current) }));

  function sessionView(c) {
    const n = Math.max(1, c.samples);
    return { game: c.game, start: c.start, end: c.end || null, minutes: Math.round(((c.end || Date.now()) - c.start) / 60000), cpuAvg: Math.round(c.cpu / n), gpuAvg: Math.round(c.gpu / n), gpuTempMax: c.gpuTempMax, ramMax: c.ramMax };
  }
  ctx.onGame = (game) => {
    if (game && !current) {
      current = { game, start: Date.now(), samples: 0, cpu: 0, gpu: 0, gpuTempMax: 0, ramMax: 0 };
      sys.want('session', true);
      log(`sessione: ${game} iniziata`);
    } else if (!game && current) {
      current.end = Date.now();
      sys.want('session', false);
      const v = sessionView(current);
      current = null;
      if (v.minutes < 1) return;
      const list = readSessions();
      list.push(v);
      try { fs.writeFileSync(sessionsFile, JSON.stringify(list.slice(-100))); } catch (e) { log(`sessioni: ${e.message}`); }
      log(`sessione: ${v.game} ${v.minutes} min, GPU max ${v.gpuTempMax}°C`);
    }
  };
  ctx.onSample = (s) => {
    if (!current || !s) return;
    current.samples++;
    current.cpu += (s.cpu && s.cpu.total) || 0;
    current.gpu += (s.gpu && s.gpu.util) || 0;
    current.gpuTempMax = Math.max(current.gpuTempMax, (s.gpu && s.gpu.temp) || 0);
    current.ramMax = Math.max(current.ramMax, (s.ram && s.ram.pct) || 0);
  };

  // --- Cronologia appunti ------------------------------------------------------
  let clips = [];
  let lastClip = '';
  try { lastClip = clipboard.readText(); } catch (e) {}
  setInterval(() => {
    if (S().clipboard && S().clipboard.enabled === false) return;
    let t = '';
    try { t = clipboard.readText(); } catch (e) { return; }
    if (!t || t === lastClip || t.length > 20000) { lastClip = t; return; }
    lastClip = t;
    clips = [{ id: Date.now(), text: t, at: Date.now(), pinned: false }, ...clips.filter((c) => c.text !== t)];
    const pinned = clips.filter((c) => c.pinned);
    clips = [...pinned, ...clips.filter((c) => !c.pinned).slice(0, 50)].sort((a, b) => (b.pinned - a.pinned) || (b.at - a.at));
    send('clips', clips);
  }, 1000);
  if (MOCK) clips = [
    { id: 3, text: 'https://github.com/Hekatisback/unico', at: Date.now() - 30000, pinned: true },
    { id: 2, text: 'Ci vediamo alle 21 su Discord', at: Date.now() - 120000, pinned: false },
    { id: 1, text: 'ipconfig /flushdns', at: Date.now() - 3600000, pinned: false },
  ];
  handle('clip:list', async () => clips);
  handle('clip:copy', async (id) => { const c = clips.find((x) => x.id === id); if (c) { clipboard.writeText(c.text); lastClip = c.text; } return { ok: !!c }; });
  handle('clip:pin', async (id) => { clips = clips.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)); return clips; });
  handle('clip:remove', async (id) => { clips = clips.filter((c) => c.id !== id); return clips; });
  handle('clip:clear', async () => { clips = clips.filter((c) => c.pinned); return clips; });

  // --- Promemoria e timer ------------------------------------------------------
  const reminders = () => S().reminders || (S().reminders = []);
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const r of reminders()) {
      if (r.done || r.at > now) continue;
      notify(r.kind === 'timer' ? 'Timer finito' : 'Promemoria', r.text || (r.kind === 'timer' ? 'Tempo scaduto' : ''), () => ctx.showWindow());
      if (r.repeat === 'daily') { while (r.at <= now) r.at += 86400000; } else r.done = true;
      changed = true;
    }
    if (changed) {
      S().reminders = reminders().filter((r) => !r.done || now - r.at < 3600000);
      ctx.saveSettings();
      send('reminders', S().reminders);
    }
  }, 5000);
  handle('rem:list', async () => reminders());
  handle('rem:add', async ({ text, at, kind, repeat }) => {
    const r = { id: Date.now(), text: String(text || '').slice(0, 200), at: +at, kind: kind === 'timer' ? 'timer' : 'reminder', repeat: repeat === 'daily' ? 'daily' : 'none', done: false };
    if (!r.at || r.at < Date.now() - 1000) return { ok: false, error: 'Scegli un orario futuro' };
    reminders().push(r);
    ctx.saveSettings();
    return { ok: true, list: reminders() };
  });
  handle('rem:remove', async (id) => { S().reminders = reminders().filter((r) => r.id !== id); ctx.saveSettings(); return { ok: true, list: S().reminders }; });

  // --- Screenshot e registrazione schermo ---------------------------------------
  const shotsDir = () => path.join(app.getPath('pictures'), 'Screenshots', 'Unico');
  const videosDir = () => path.join(app.getPath('videos'), 'Unico');
  async function screenshot() {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src) return { ok: false, error: 'Schermo non disponibile' };
    fs.mkdirSync(shotsDir(), { recursive: true });
    const file = path.join(shotsDir(), `Screenshot-${stamp()}.png`);
    fs.writeFileSync(file, src.thumbnail.toPNG());
    clipboard.writeImage(src.thumbnail);
    notify('Screenshot salvato', 'Copiato anche negli appunti. Clicca per aprire la cartella.', () => shell.showItemInFolder(file));
    return { ok: true, file };
  }
  handle('cap:screenshot', async () => screenshot());
  handle('cap:openFolder', async (which) => { const d = which === 'video' ? videosDir() : shotsDir(); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); return { ok: true }; });

  // La registrazione la fa la finestra (MediaRecorder); qui scegliamo lo schermo e salviamo i pezzi.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
      cb(src ? { video: src, audio: S().capture && S().capture.audio === false ? undefined : 'loopback' } : {});
    } catch (e) { log(`registrazione: ${e.message}`); cb({}); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write'].includes(perm)));
  let recFile = null;
  handle('rec:begin', async () => { fs.mkdirSync(videosDir(), { recursive: true }); recFile = path.join(videosDir(), `Registrazione-${stamp()}.webm`); fs.writeFileSync(recFile, Buffer.alloc(0)); return { ok: true }; });
  handle('rec:chunk', async (buf) => { if (recFile && buf) fs.appendFileSync(recFile, Buffer.from(buf)); return { ok: true }; });
  handle('rec:end', async () => {
    const f = recFile;
    recFile = null;
    if (f) notify('Registrazione salvata', path.basename(f), () => shell.showItemInFolder(f));
    return { ok: true, file: f };
  });
  ctx.registerToolShortcuts = () => {
    const c = S().capture || {};
    const reg = (key, fn) => { try { if (key && !globalShortcut.register(key, fn)) log(`scorciatoia occupata: ${key}`); } catch (e) { log(`scorciatoia ${key}: ${e.message}`); } };
    reg(c.shotKey || 'Control+Alt+S', () => screenshot().catch((e) => log(`screenshot: ${e.message}`)));
    reg(c.recKey || 'Control+Alt+R', () => send('rec:toggle', true));
  };

  // --- Notifiche dal telefono ---------------------------------------------------
  const seenNotif = new Set();
  let notifPrimed = false;
  let recentNotif = [];
  setInterval(async () => {
    const P = S().phoneNotif || {};
    if (!P.enabled) { notifPrimed = false; return; }
    let serial = P.serial;
    try {
      const l = await phone.list();
      const devs = (l.devices || []).filter((d) => d.state === 'device');
      if (!devs.some((d) => d.serial === serial)) serial = devs[0] && devs[0].serial;
    } catch (e) { return; }
    if (!serial) return;
    const list = await phone.notifications(serial);
    if (!list) return;
    recentNotif = list.slice(0, 30);
    for (const n of list) {
      if (seenNotif.has(n.id)) continue;
      seenNotif.add(n.id);
      if (notifPrimed && !(P.muted || []).includes(n.pkg)) notify(`${n.app}: ${n.title}`, n.text);
    }
    notifPrimed = true; // al primo giro non mostro quelle già presenti
    if (seenNotif.size > 2000) seenNotif.clear();
    send('phoneNotif', recentNotif);
  }, MOCK ? 4000 : 8000);
  handle('phone:notifications', async () => recentNotif);
  handle('phone:type', async ({ serial, text }) => phone.typeText(serial, text));

  // --- Backup impostazioni ------------------------------------------------------
  handle('backup:export', async () => {
    const r = await dialog.showSaveDialog(ctx.getWin(), { title: 'Salva il backup di Unico', defaultPath: path.join(app.getPath('documents'), `Unico-backup-${stamp().slice(0, 10)}.json`), filters: [{ name: 'Backup Unico', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { ok: true, saved: false };
    fs.writeFileSync(r.filePath, JSON.stringify({ unico: app.getVersion(), at: new Date().toISOString(), settings: S() }, null, 2));
    return { ok: true, saved: true, file: r.filePath };
  });
  handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Scegli un backup di Unico', filters: [{ name: 'Backup Unico', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, loaded: false };
    let j;
    try { j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (e) { return { ok: false, error: 'Il file non è un backup valido' }; }
    if (!j || !j.settings || typeof j.settings !== 'object') return { ok: false, error: 'Il file non è un backup di Unico' };
    ctx.replaceSettings(j.settings);
    return { ok: true, loaded: true };
  });

  // --- Aggiornamenti ------------------------------------------------------------
  let upd = { status: app.isPackaged ? 'idle' : 'dev', version: app.getVersion() };
  const setUpd = (p) => { upd = { ...upd, ...p }; send('update', upd); };
  let updater = null;
  if (app.isPackaged && !MOCK) {
    try {
      updater = require('electron-updater').autoUpdater;
      updater.logger = { info: (m) => log(`update: ${m}`), warn: (m) => log(`update: ${m}`), error: (m) => log(`update: ${m}`), debug: () => {} };
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;
      updater.on('checking-for-update', () => setUpd({ status: 'checking', error: null }));
      updater.on('update-available', (i) => setUpd({ status: 'downloading', next: i.version, percent: 0 }));
      updater.on('update-not-available', () => setUpd({ status: 'latest', checkedAt: Date.now() }));
      updater.on('download-progress', (p) => setUpd({ status: 'downloading', percent: Math.round(p.percent) }));
      updater.on('update-downloaded', (i) => {
        setUpd({ status: 'ready', next: i.version });
        notify('Aggiornamento pronto', `Unico ${i.version} si installa alla prossima chiusura, oppure riavvia da Impostazioni.`, () => ctx.showWindow());
      });
      updater.on('error', (e) => setUpd({ status: 'error', error: String(e && e.message || e).split('\n')[0] }));
      setTimeout(() => updater.checkForUpdates().catch(() => {}), 15000);
      setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
    } catch (e) { log(`updater: ${e.message}`); upd.status = 'error'; upd.error = e.message; }
  }
  if (MOCK) upd = { status: 'latest', version: app.getVersion(), checkedAt: Date.now() };
  handle('update:get', async () => upd);
  handle('update:check', async () => { if (updater) await updater.checkForUpdates().catch((e) => setUpd({ status: 'error', error: e.message })); return upd; });
  handle('update:install', async () => { if (updater && upd.status === 'ready') { ctx.prepareQuit(); updater.quitAndInstall(false, true); } return { ok: true }; });
}

module.exports = { setup };
