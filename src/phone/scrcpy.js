'use strict';
// Mirroring del telefono Android con scrcpy (Apache 2.0, github.com/Genymobile/scrcpy), incluso in Unico.
// Niente app sul telefono: serve solo il debug USB attivo. scrcpy apre una sua finestra con lo schermo
// del telefono, che si controlla con mouse e tastiera del PC.
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Senza la ricerca mDNS adb non apre porte in rete, quindi Windows non chiede il permesso del firewall.
// L'associazione Wi-Fi con indirizzo e codice funziona lo stesso.
const ADB_ENV = { ...process.env, ADB_MDNS: '0', ADB_MDNS_AUTO_CONNECT: '' };

class Phone {
  constructor({ binDir, log, onChange, videosDir }) {
    this.binDir = binDir;
    this.log = log;
    this.onChange = onChange || (() => {});
    this.videosDir = videosDir;
    this.sessions = new Map(); // serial -> child process
  }

  get adbPath() { return path.join(this.binDir, 'adb.exe'); }
  get scrcpyPath() { return path.join(this.binDir, 'scrcpy.exe'); }
  available() { return fs.existsSync(this.adbPath) && fs.existsSync(this.scrcpyPath); }

  adb(args, timeout = 15000) {
    return new Promise((resolve) => {
      execFile(this.adbPath, args, { cwd: this.binDir, timeout, windowsHide: true, env: ADB_ENV }, (err, stdout, stderr) => {
        resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
      });
    });
  }

  async list() {
    if (!this.available()) return { available: false, devices: [] };
    const r = await this.adb(['devices', '-l']);
    const devices = parseDevices(r.out).map((d) => ({ ...d, mirroring: this.sessions.has(d.serial) }));
    return { available: true, devices };
  }

  // Android 11+: Opzioni sviluppatore → Debug wireless → "Associa dispositivo con codice".
  async pair(address, code) {
    if (!/^[\w.:-]+:\d+$/.test(address) || !/^\d{6}$/.test(code)) return { ok: false, error: 'Indirizzo (IP:porta) o codice a 6 cifre non validi' };
    const r = await this.adb(['pair', address, code], 20000);
    const ok = /Successfully paired/i.test(r.out + r.err);
    this.log(`phone: pair ${address} -> ${ok ? 'ok' : (r.out + r.err).trim()}`);
    return ok ? { ok: true } : { ok: false, error: 'Associazione non riuscita: controlla indirizzo e codice sul telefono' };
  }

  async connect(address) {
    if (!/^[\w.-]+(:\d+)?$/.test(address)) return { ok: false, error: 'Indirizzo non valido' };
    const target = address.includes(':') ? address : `${address}:5555`;
    const r = await this.adb(['connect', target], 15000);
    const ok = /connected to/i.test(r.out) && !/cannot|failed/i.test(r.out);
    this.log(`phone: connect ${target} -> ${r.out.trim()}`);
    return ok ? { ok: true, address: target } : { ok: false, error: `Connessione non riuscita (${(r.out || r.err).trim()})` };
  }

  async disconnect(address) {
    await this.adb(['disconnect', address]);
    return { ok: true };
  }

  // Telefono collegato via USB: attiva l'ascolto Wi-Fi e si collega al suo IP, così poi si stacca il cavo.
  async switchToWifi(serial) {
    const ipr = await this.adb(['-s', serial, 'shell', 'ip', 'route']);
    const ip = parseIp(ipr.out);
    if (!ip) return { ok: false, error: 'Il telefono non sembra collegato al Wi-Fi' };
    const t = await this.adb(['-s', serial, 'tcpip', '5555']);
    if (!t.ok) return { ok: false, error: 'Il telefono ha rifiutato la modalità Wi-Fi' };
    await new Promise((r) => setTimeout(r, 1500));
    const c = await this.connect(`${ip}:5555`);
    return c.ok ? { ok: true, address: c.address } : c;
  }

  start(serial, opts = {}, title = 'Telefono') {
    if (!this.available()) return { ok: false, error: 'scrcpy non trovato nella cartella di Unico' };
    if (this.sessions.has(serial)) return { ok: true, already: true };
    const args = buildArgs(serial, opts, title, this.videosDir);
    this.log(`phone: avvio scrcpy ${args.join(' ')}`);
    const child = spawn(this.scrcpyPath, args, { cwd: this.binDir, windowsHide: true, env: ADB_ENV });
    let errText = '';
    child.stdout.on('data', (d) => this.log(`scrcpy: ${String(d).trim()}`));
    child.stderr.on('data', (d) => { errText += String(d); this.log(`scrcpy: ${String(d).trim()}`); });
    child.on('exit', (code) => {
      this.sessions.delete(serial);
      this.log(`phone: scrcpy terminato (${code})`);
      this.onChange({ serial, stopped: true, code, error: code ? friendlyError(errText) : null });
    });
    child.on('error', (e) => { this.sessions.delete(serial); this.onChange({ serial, stopped: true, error: e.message }); });
    this.sessions.set(serial, child);
    this.onChange({ serial, started: true });
    return { ok: true, recording: opts.record ? args.find((a) => a.startsWith('--record=')).slice(9) : null };
  }

  async battery(serial) {
    const r = await this.adb(['-s', serial, 'shell', 'dumpsys', 'battery'], 8000);
    return r.ok ? parseBattery(r.out) : null;
  }

  // Invia file nella cartella Download del telefono.
  async pushFiles(serial, files) {
    const done = [], failed = [];
    for (const f of files) {
      if (!fs.existsSync(f)) { failed.push(path.basename(f)); continue; }
      const r = await this.adb(['-s', serial, 'push', f, '/sdcard/Download/'], 10 * 60 * 1000);
      (r.ok ? done : failed).push(path.basename(f));
    }
    this.log(`phone: inviati ${done.length}, falliti ${failed.length}`);
    return failed.length && !done.length ? { ok: false, error: `Invio non riuscito: ${failed.join(', ')}` } : { ok: true, sent: done.length, failed };
  }

  // Copia le ultime foto e video della fotocamera in una cartella del PC.
  async importPhotos(serial, count, destRoot) {
    const r = await this.adb(['-s', serial, 'shell', 'ls', '-t', '/sdcard/DCIM/Camera'], 15000);
    if (!r.ok) return { ok: false, error: 'Cartella della fotocamera non trovata sul telefono' };
    const names = parseCameraList(r.out).slice(0, Math.max(1, Math.min(500, count)));
    if (!names.length) return { ok: false, error: 'Nessuna foto trovata' };
    const dest = path.join(destRoot, 'Telefono', new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dest, { recursive: true });
    let ok = 0;
    for (const n of names) {
      const target = path.join(dest, n);
      if (fs.existsSync(target)) { ok++; continue; }
      const p = await this.adb(['-s', serial, 'pull', `/sdcard/DCIM/Camera/${n}`, target], 5 * 60 * 1000);
      if (p.ok) ok++;
    }
    return { ok: true, copied: ok, dir: dest };
  }

  async notifications(serial) {
    const r = await this.adb(['-s', serial, 'shell', 'dumpsys', 'notification', '--noredact'], 10000);
    return r.ok ? parseNotifications(r.out) : null;
  }

  // Scrive il testo nel campo attivo sul telefono (come se lo digitassi).
  async typeText(serial, text) {
    const t = String(text || '').slice(0, 1000);
    if (!t) return { ok: false, error: 'Testo vuoto' };
    // adb "input text" vuole gli spazi come %s e i caratteri speciali protetti per la shell del telefono
    const esc = t.replace(/[\\'"`$&|;<>()*?!#~^{}\[\]]/g, (c) => `\\${c}`).replace(/\r?\n/g, ' ').replace(/ /g, '%s');
    const r = await this.adb(['-s', serial, 'shell', 'input', 'text', esc], 15000);
    return r.ok ? { ok: true } : { ok: false, error: friendlyError(r.err) };
  }

  stop(serial) {
    const c = this.sessions.get(serial);
    if (c) c.kill();
    return { ok: true };
  }

  stopAll() {
    for (const c of this.sessions.values()) { try { c.kill(); } catch (e) {} }
    this.sessions.clear();
  }
}

function parseDevices(out) {
  return out.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [serial, state, ...rest] = l.split(/\s+/);
    const kv = Object.fromEntries(rest.map((p) => p.split(':')).filter((p) => p.length === 2));
    return {
      serial,
      state, // device | unauthorized | offline
      model: (kv.model || kv.device || serial).replace(/_/g, ' '),
      wifi: /:\d+$/.test(serial) || serial.includes('._adb-tls-connect'),
    };
  }).filter((d) => d.serial && d.state);
}

function parseBattery(out) {
  const g = (k) => { const m = String(out).match(new RegExp(`^\\s*${k}:\\s*(-?\\d+)`, 'mi')); return m ? +m[1] : null; };
  const level = g('level'), scale = g('scale') || 100, status = g('status'), temp = g('temperature');
  if (level == null) return null;
  return { percent: Math.round((level / scale) * 100), charging: status === 2 || status === 5, full: status === 5, temp: temp != null ? temp / 10 : null };
}

// Notifiche visibili da "dumpsys notification --noredact".
const NOTIF_SKIP = /^(android|com\.android\.systemui|com\.android\.providers\.downloads|com\.google\.android\.gms|com\.samsung\.android\.(lool|game\.gos)|com\.sec\.android\.app\.shealth)$/;
function parseNotifications(out) {
  const blocks = String(out).split(/NotificationRecord\(/).slice(1);
  const res = [];
  const seen = new Set();
  for (const b of blocks) {
    const pkg = (b.match(/pkg=(\S+)/) || [])[1];
    if (!pkg || NOTIF_SKIP.test(pkg)) continue;
    const field = (k) => { const m = b.match(new RegExp(`^\\s*${k}=\\S+ \\((.*)\\)\\s*$`, 'm')); return m ? m[1].trim() : ''; };
    const title = field('android\\.title');
    const text = field('android\\.bigText') || field('android\\.text');
    if (!title && !text) continue;
    const flags = parseInt((b.match(/flags=0x([0-9a-f]+)/i) || [])[1] || '0', 16);
    if (flags & 0x2 || flags & 0x40) continue; // in corso / servizio in primo piano
    const key = ((b.match(/key=(\S+)/) || [])[1] || `${pkg}|${title}`).replace(/:$/, '');
    const id = `${key}|${title}|${text}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const when = +((b.match(/\bwhen=(\d{10,})/) || [])[1] || 0);
    res.push({ id, pkg, app: appLabel(pkg), title, text, when });
  }
  return res;
}
const APP_NAMES = { 'com.whatsapp': 'WhatsApp', 'org.telegram.messenger': 'Telegram', 'com.instagram.android': 'Instagram', 'com.google.android.gm': 'Gmail', 'com.discord': 'Discord', 'com.samsung.android.messaging': 'Messaggi', 'com.google.android.apps.messaging': 'Messaggi', 'com.spotify.music': 'Spotify', 'com.zhiliaoapp.musically': 'TikTok', 'com.snapchat.android': 'Snapchat', 'com.facebook.orca': 'Messenger', 'com.android.dialer': 'Telefono', 'com.samsung.android.dialer': 'Telefono', 'com.google.android.dialer': 'Telefono' };
function appLabel(pkg) {
  if (APP_NAMES[pkg]) return APP_NAMES[pkg];
  const last = pkg.split('.').filter((x) => !/^(com|org|android|app|apps|google|samsung|sec|net)$/.test(x)).pop() || pkg;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

const MEDIA_RE = /\.(jpe?g|png|heic|heif|webp|gif|dng|mp4|mov|3gp|mkv)$/i;
function parseCameraList(out) {
  return String(out).split(/\r?\n/).map((l) => l.trim()).filter((n) => n && !n.startsWith('.') && MEDIA_RE.test(n) && !/[\\/]/.test(n));
}

function parseIp(out) {
  const m = String(out).match(/src (\d+\.\d+\.\d+\.\d+)/g);
  if (!m) return null;
  const ips = m.map((x) => x.slice(4)).filter((ip) => !ip.startsWith('127.'));
  return ips.find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(ip)) || ips[0] || null;
}

function buildArgs(serial, o, title, videosDir) {
  const a = [`--serial=${serial}`, `--window-title=${title}`];
  if (o.maxSize) a.push(`--max-size=${o.maxSize}`);
  if (o.bitrate) a.push(`--video-bit-rate=${o.bitrate}M`);
  if (o.maxFps) a.push(`--max-fps=${o.maxFps}`);
  if (o.audio === false) a.push('--no-audio');
  if (o.control === false) a.push('--no-control');
  else {
    if (o.turnScreenOff) a.push('--turn-screen-off');
    if (o.stayAwake) a.push('--stay-awake');
    if (o.realKeyboard) a.push('--keyboard=uhid');
  }
  if (o.alwaysOnTop) a.push('--always-on-top');
  if (o.fullscreen) a.push('--fullscreen');
  if (o.powerOffOnClose) a.push('--power-off-on-close');
  if (o.record && videosDir) {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    a.push(`--record=${path.join(videosDir, `Telefono-${stamp}.mp4`)}`);
  }
  return a;
}

function friendlyError(t) {
  if (/unauthorized/i.test(t)) return 'Conferma "Consenti debug USB" sul telefono e riprova';
  if (/Could not find any ADB device|no devices/i.test(t)) return 'Telefono non trovato';
  if (/audio/i.test(t) && /not supported|could not/i.test(t)) return 'Audio non supportato da questo telefono (serve Android 11+): disattivalo';
  const line = String(t).split(/\r?\n/).reverse().find((l) => /ERROR/.test(l));
  return line ? line.replace(/^.*ERROR:\s*/, '') : 'scrcpy si è chiuso';
}

// Simulatore per sviluppo (UNICO_MOCK=1)
class FakePhone extends Phone {
  constructor(o) { super(o); this.fake = [{ serial: 'R5CT1234ABC', state: 'device', model: 'Galaxy S23+', wifi: false }]; }
  available() { return true; }
  async list() { return { available: true, devices: this.fake.map((d) => ({ ...d, mirroring: this.sessions.has(d.serial) })) }; }
  async pair() { return { ok: true }; }
  async connect(addr) { this.fake.push({ serial: addr.includes(':') ? addr : `${addr}:5555`, state: 'device', model: 'Galaxy S23+', wifi: true }); return { ok: true, address: addr }; }
  async switchToWifi() { return this.connect('192.168.1.42:5555'); }
  async battery() { return { percent: 64, charging: false, full: false, temp: 31.2 }; }
  async pushFiles(serial, files) { return { ok: true, sent: files.length, failed: [] }; }
  async notifications() { this.nTick = (this.nTick || 0) + 1; const base = [{ id: 'a', pkg: 'com.whatsapp', app: 'WhatsApp', title: 'Mamma', text: 'A che ora torni?', when: Date.now() - 60000 }]; return this.nTick > 2 ? [...base, { id: 'b' + this.nTick, pkg: 'org.telegram.messenger', app: 'Telegram', title: 'Luca', text: 'Stasera partita?', when: Date.now() }] : base; }
  async typeText() { return { ok: true }; }
  async importPhotos(serial, n) { return { ok: true, copied: n, dir: 'C:\\Users\\utente\\Pictures\\Telefono' }; }
  start(serial) { this.sessions.set(serial, { kill: () => { this.sessions.delete(serial); this.onChange({ serial, stopped: true }); } }); this.onChange({ serial, started: true }); return { ok: true }; }
}

module.exports = { Phone, FakePhone, parseNotifications, parseDevices, parseIp, buildArgs, friendlyError, parseBattery, parseCameraList };
