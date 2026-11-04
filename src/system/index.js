'use strict';
// Monitoraggio e strumenti di sistema. Dove possibile usa strumenti standard di Windows (reg, ping,
// powercfg, shutdown, nvidia-smi); il resto passa da helper.ps1, un processo PowerShell sempre aperto.
const { spawn, execFile } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const WIN = process.platform === 'win32';
const run = (file, args, timeout = 10000) => new Promise((resolve) => {
  execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
  });
});
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

// --------------------------------------------------------------------------- helper PowerShell
class Helper {
  constructor(scriptPath, log) { this.scriptPath = scriptPath; this.log = log; this.proc = null; this.seq = 0; this.pending = new Map(); }

  start() {
    if (this.proc) return;
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], { windowsHide: true });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line.replace(/^\uFEFF/, '')); } catch (e) { return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data); else p.reject(new Error(String(msg.data)));
    });
    this.proc.stderr.on('data', (d) => this.log(`helper: ${String(d).trim().slice(0, 400)}`));
    this.proc.on('exit', (code) => {
      this.log(`helper: terminato (${code})`);
      this.proc = null;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('helper terminato')); }
      this.pending.clear();
    });
  }

  call(cmd, args = {}, timeout = 15000) {
    this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${cmd}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() { if (this.proc) { try { this.proc.kill(); } catch (e) {} this.proc = null; } }
}

// --------------------------------------------------------------------------- GPU NVIDIA
const GPU_FIELDS = ['name', 'util', 'temp', 'memUsed', 'memTotal', 'power', 'clock', 'fan'];
function parseGpuLine(line) {
  const p = line.split(',').map((x) => x.trim());
  if (p.length < 7) return null;
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const o = { name: p[0] };
  GPU_FIELDS.slice(1).forEach((k, i) => { o[k] = num(p[i + 1]); });
  return o;
}

class Gpu {
  constructor(log) { this.log = log; this.proc = null; this.last = null; this.missing = false; }
  exe() {
    const cands = [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'), 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'];
    return cands.find((c) => fs.existsSync(c)) || null;
  }
  start() {
    if (this.proc || this.missing || !WIN) return;
    const exe = this.exe();
    if (!exe) { this.missing = true; this.log('gpu: nvidia-smi non trovato'); return; }
    this.proc = spawn(exe, ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,clocks.gr,fan.speed', '--format=csv,noheader,nounits', '-lms', '1000'], { windowsHide: true });
    readline.createInterface({ input: this.proc.stdout }).on('line', (l) => { const g = parseGpuLine(l); if (g) this.last = { ...g, at: Date.now() }; });
    this.proc.on('exit', () => { this.proc = null; });
  }
  stop() { if (this.proc) { try { this.proc.kill(); } catch (e) {} this.proc = null; } }
}

// --------------------------------------------------------------------------- CPU (per core)
class Cpu {
  constructor() { this.prev = os.cpus(); }
  sample() {
    const now = os.cpus();
    const cores = now.map((c, i) => {
      const p = this.prev[i] || c;
      const t = (x) => Object.values(x.times).reduce((a, b) => a + b, 0);
      const total = t(c) - t(p);
      const idle = c.times.idle - p.times.idle;
      return total > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - idle / total)))) : 0;
    });
    this.prev = now;
    const total = cores.length ? Math.round(cores.reduce((a, b) => a + b, 0) / cores.length) : 0;
    return { total, cores, model: (now[0] && now[0].model || '').replace(/\s+/g, ' ').trim(), mhz: now[0] ? now[0].speed : null };
  }
}

// --------------------------------------------------------------------------- app all'avvio (reg.exe)
const RUN = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';

function parseReg(out) {
  const rows = [];
  for (const line of String(out).split(/\r?\n/)) {
    const m = line.match(/^ {4}(.+?) {4}(REG_[A-Z_]+) {4}(.*)$/) || line.match(/^ {4}(.+?) {4}(REG_[A-Z_]+)$/);
    if (m) rows.push({ name: m[1], type: m[2], value: (m[3] || '').trim() });
  }
  return rows;
}
// Byte 0 pari (es. 02, 06) = attivo; dispari (03, 07) = disattivato. Assente = attivo.
const approvedOn = (hex) => !hex || (parseInt(hex.slice(0, 2), 16) % 2 === 0);

async function regQuery(key) { const r = await run('reg.exe', ['query', key]); return r.ok ? parseReg(r.out) : []; }

async function startupList() {
  const items = [];
  const sources = [
    { hive: 'HKCU', key: `HKCU\\${RUN}`, approved: `HKCU\\${APPROVED}\\Run`, editable: true, scope: 'Utente' },
    { hive: 'HKLM', key: `HKLM\\${RUN}`, approved: `HKLM\\${APPROVED}\\Run`, editable: false, scope: 'Tutti gli utenti' },
    { hive: 'HKLM32', key: `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run`, approved: `HKLM\\${APPROVED}\\Run32`, editable: false, scope: 'Tutti gli utenti' },
  ];
  for (const s of sources) {
    const [vals, appr] = await Promise.all([regQuery(s.key), regQuery(s.approved)]);
    const map = Object.fromEntries(appr.map((a) => [a.name, a.value]));
    for (const v of vals) items.push({ id: `${s.hive}:${v.name}`, name: v.name, command: v.value, enabled: approvedOn(map[v.name]), editable: s.editable, scope: s.scope, kind: 'run' });
  }
  const folders = [
    { dir: path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'), approved: `HKCU\\${APPROVED}\\StartupFolder`, editable: true, scope: 'Utente' },
    { dir: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs\\StartUp'), approved: `HKLM\\${APPROVED}\\StartupFolder`, editable: false, scope: 'Tutti gli utenti' },
  ];
  for (const f of folders) {
    let files = [];
    try { files = fs.readdirSync(f.dir).filter((n) => !/^desktop\.ini$/i.test(n)); } catch (e) {}
    if (!files.length) continue;
    const map = Object.fromEntries((await regQuery(f.approved)).map((a) => [a.name, a.value]));
    for (const n of files) items.push({ id: `FOLDER:${f.scope}:${n}`, name: n.replace(/\.lnk$/i, ''), file: n, command: path.join(f.dir, n), enabled: approvedOn(map[n]), editable: f.editable, scope: f.scope, kind: 'folder' });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

async function startupSet(item, enabled) {
  if (!item.editable) return { ok: false, error: 'Questa voce vale per tutti gli utenti: serve l\'amministratore' };
  const key = item.kind === 'folder' ? `HKCU\\${APPROVED}\\StartupFolder` : `HKCU\\${APPROVED}\\Run`;
  const name = item.kind === 'folder' ? item.file : item.name;
  const data = (enabled ? '02' : '03') + '0'.repeat(22);
  const r = await run('reg.exe', ['add', key, '/v', name, '/t', 'REG_BINARY', '/d', data, '/f']);
  return r.ok ? { ok: true } : { ok: false, error: r.err.trim() || 'reg.exe ha rifiutato la modifica' };
}

// --------------------------------------------------------------------------- rete
function parsePing(out) {
  const times = [...String(out).matchAll(/[=<](\d+)\s?ms/gi)].map((m) => +m[1]);
  const sent = (String(out).match(/^(?:Risposta da|Reply from)/gim) || []).length;
  const replies = Math.max(times.length, sent);
  return { replies, times, avg: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null, max: times.length ? Math.max(...times) : null };
}
async function ping(host, count = 4) {
  if (!/^[\w.-]+$/.test(host)) return { host, error: 'indirizzo non valido' };
  const r = await run('ping.exe', ['-n', String(count), '-w', '1000', host], (count + 3) * 1500);
  const p = parsePing(r.out);
  return { host, ...p, loss: Math.round(100 * (1 - p.replies / count)) };
}
function diagnoseNet(results) {
  const [router, internet, game] = results;
  if (!router || router.avg == null) return 'Il router non risponde: problema di Wi-Fi o di cavo.';
  if (router.avg > 20 || router.loss > 0) return 'Il ritardo nasce tra PC e router: avvicinati al router, usa i 5 GHz o il cavo di rete.';
  if (internet && (internet.avg == null || internet.avg > 60 || internet.loss > 0)) return 'La rete di casa va bene, ma la linea internet è lenta o perde pacchetti: dipende dal provider.';
  if (game && game.avg != null && game.avg > 70) return 'Rete e linea vanno bene; il ritardo è verso i server di gioco (distanza o congestione).';
  return 'Tutto a posto: ritardo basso su router, internet e server di gioco.';
}

// --------------------------------------------------------------------------- energia e azioni
const POWER = { best: 'ded574b5-45a0-4f42-8737-46345c09c238', balanced: '00000000-0000-0000-0000-000000000000', efficiency: '961cc777-2547-4f9d-8174-7d86181b8a7a' };
async function powerGet() {
  const r = await run('powercfg.exe', ['/getactiveoverlayscheme']);
  const g = (r.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
  return Object.keys(POWER).find((k) => POWER[k] === (g || '').toLowerCase()) || 'balanced';
}
async function powerSet(mode) {
  if (!POWER[mode]) return { ok: false, error: 'modalità sconosciuta' };
  const r = await run('powercfg.exe', ['/overlaysetactive', POWER[mode]]);
  return r.ok ? { ok: true } : { ok: false, error: r.err.trim() };
}
const lock = () => run('rundll32.exe', ['user32.dll,LockWorkStation']).then(() => ({ ok: true }));
async function shutdownIn(minutes) {
  const s = Math.max(60, Math.round(minutes * 60));
  const r = await run('shutdown.exe', ['/s', '/t', String(s), '/c', `Unico: spegnimento programmato tra ${Math.round(s / 60)} minuti`]);
  return r.ok ? { ok: true, at: Date.now() + s * 1000 } : { ok: false, error: r.err.trim() || 'shutdown rifiutato (forse ce n\'è già uno programmato)' };
}
const shutdownCancel = () => run('shutdown.exe', ['/a']).then(() => ({ ok: true }));

// --------------------------------------------------------------------------- servizio
class SystemService {
  constructor({ scriptPath, log, onTick }) {
    this.log = log;
    this.helper = new Helper(scriptPath, log);
    this.gpu = new Gpu(log);
    this.cpu = new Cpu();
    this.onTick = onTick || (() => {});
    this.timer = null;
    this.users = new Set();
    this.history = [];
    this.last = null;
  }

  // il campionamento gira solo quando qualcuno guarda (pagina Sistema, overlay, avvisi)
  want(who, on) {
    if (on) this.users.add(who); else this.users.delete(who);
    if (this.users.size && !this.timer) { this.gpu.start(); this.timer = setInterval(() => this.tick(), 1000); this.tick(); }
    if (!this.users.size && this.timer) { clearInterval(this.timer); this.timer = null; this.gpu.stop(); }
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const cpu = this.cpu.sample();
      const total = os.totalmem(), free = os.freemem();
      let disk = null;
      try { const st = fs.statfsSync(WIN ? 'C:\\' : '/'); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch (e) {}
      let extra = {};
      // I dati di PowerShell (disco, rete, batteria) arrivano quando sono pronti: CPU e RAM non li aspettano,
      // così la pagina si riempie subito anche se il primo avvio di PowerShell è lento.
      if (WIN && !this.extraBusy && (!this.lastExtra || Date.now() - this.lastExtra > 1900)) {
        this.extraBusy = true;
        this.helper.call('sample', {}, 20000)
          .then((x) => { this.extra = x; })
          .catch((e) => this.log(`sistema: ${e.message}`))
          .finally(() => { this.lastExtra = Date.now(); this.extraBusy = false; });
      }
      extra = this.extra || {};
      const g = this.gpu.last && Date.now() - this.gpu.last.at < 5000 ? this.gpu.last : null;
      const s = {
        at: Date.now(),
        cpu,
        ram: { total, used: total - free, pct: Math.round(100 * (1 - free / total)) },
        disk,
        gpu: g,
        diskIo: extra.diskRead != null ? { read: extra.diskRead, write: extra.diskWrite, busy: Math.min(100, Math.round(extra.diskBusy || 0)) } : null,
        net: extra.netRx != null ? { rx: extra.netRx, tx: extra.netTx } : null,
        cpuTemp: extra.cpuTemp ?? null,
        battery: extra.battery || null,
        uptime: os.uptime(),
      };
      this.last = s;
      this.history.push({ at: s.at, cpu: cpu.total, ram: s.ram.pct, gpu: g ? g.util : null, gpuTemp: g ? g.temp : null, rx: s.net ? s.net.rx : null, tx: s.net ? s.net.tx : null });
      if (this.history.length > 120) this.history.shift();
      this.onTick(s);
    } finally { this.busy = false; }
  }

  async procs() {
    const list = arr(await this.helper.call('procs', {}, 20000));
    const groups = new Map();
    for (const p of list) {
      const key = (p.name || '').toLowerCase();
      if (!key) continue;
      const g = groups.get(key) || { name: p.name, desc: p.desc || null, path: p.path || null, pids: [], cpu: 0, mem: 0, io: 0 };
      g.pids.push(p.pid); g.cpu += p.cpu || 0; g.mem += p.mem || 0; g.io += p.io || 0;
      if (!g.desc && p.desc) g.desc = p.desc;
      if (!g.path && p.path) g.path = p.path;
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ ...g, cpu: Math.round(g.cpu * 10) / 10, protected: isProtected(g.name) }));
  }
  async kill(pids, name) {
    if (isProtected(name)) return { ok: false, error: `${name} è un processo di Windows: chiuderlo bloccherebbe il PC` };
    const r = await this.helper.call('kill', { pids: arr(pids) });
    const failed = arr(r && r.failed);
    return failed.length && failed.length === arr(pids).length ? { ok: false, error: 'Windows non ha permesso di chiuderlo (serve l\'amministratore)' } : { ok: true };
  }
  closeNames(names) { return this.helper.call('closeNames', { names: arr(names).filter((n) => !isProtected(n)) }, 30000); }
  procNames() { return this.helper.call('procNames', {}, 10000).then(arr); }
  async cleanupScan(downloads) { const r = await this.helper.call('cleanupScan', { downloads }, 120000); return { ...r, big: arr(r.big) }; }
  clearTemp() { return this.helper.call('clearTemp', {}, 120000); }
  emptyRecycle() { return this.helper.call('emptyRecycle', {}, 60000); }
  async network(gameHost) {
    let gw = null;
    try { gw = await this.helper.call('gateway'); } catch (e) {}
    const hosts = [gw || '192.168.1.1', '1.1.1.1', gameHost || '104.160.141.3'];
    const results = await Promise.all(hosts.map((h) => ping(h)));
    return { results: results.map((r, i) => ({ ...r, label: ['Router di casa', 'Internet (Cloudflare)', 'Server di gioco'][i] })), verdict: diagnoseNet(results) };
  }
  media() { return this.helper.call('media', {}, 6000); }
  mediaKey(key) { return this.helper.call('mediaKey', { key }); }
  brightness() { return this.helper.call('brightness', {}, 15000).then(arr); }
  setBrightness(id, value) { return this.helper.call('setBrightness', { id, value: Math.max(0, Math.min(100, Math.round(value))) }, 8000); }
  suspend() { return this.helper.call('suspend'); }
  // audio
  audioDevices(flow) { return this.helper.call('audioDevices', { flow: flow === 'capture' ? 1 : 0 }, 15000).then(arr); }
  audioSessions() { return this.helper.call('audioSessions', {}, 15000).then(arr).then(groupSessions); }
  audioSetDefault(id, comm = true) { return this.helper.call('audioSetDefault', { id, comm }); }
  audioSetDeviceVolume(id, volume) { return this.helper.call('audioSetDeviceVolume', { id, volume: clampPct(volume) }); }
  audioSetDeviceMute(id, mute) { return this.helper.call('audioSetDeviceMute', { id, mute: !!mute }); }
  async audioSetApp(pids, { volume, mute }) {
    for (const pid of arr(pids)) await this.helper.call('audioSetSession', { pid, volume: volume == null ? -1 : clampPct(volume) / 100, mute: mute == null ? -1 : mute ? 1 : 0 });
    return { ok: true };
  }
  stop() { this.want('*', false); this.users.clear(); if (this.timer) clearInterval(this.timer); this.timer = null; this.gpu.stop(); this.helper.stop(); }
}

const clampPct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
// Un'app (es. Chrome, Discord) apre più sessioni audio: le raggruppa per nome come il mixer di Windows.
function groupSessions(list) {
  const g = new Map();
  for (const s of list) {
    const key = s.system ? '__system' : String(s.name || s.pid).toLowerCase();
    const cur = g.get(key) || { name: s.name, desc: s.desc || null, path: s.path || null, pids: [], volume: s.volume, muted: s.muted, peak: 0, system: !!s.system };
    if (!cur.pids.includes(s.pid)) cur.pids.push(s.pid);
    cur.peak = Math.max(cur.peak, s.peak || 0);
    cur.muted = cur.muted && s.muted;
    if (!cur.desc && s.desc) cur.desc = s.desc;
    g.set(key, cur);
  }
  return [...g.values()].sort((a, b) => (a.system - b.system) || String(a.desc || a.name).localeCompare(String(b.desc || b.name), 'it'));
}

const PROTECTED = new Set(['system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso', 'svchost', 'dwm', 'fontdrvhost', 'memory compression', 'secure system', 'audiodg', 'spoolsv', 'sihost', 'ctfmon', 'msmpeng', 'unico', 'claude', 'cowork-svc']);
const isProtected = (name) => PROTECTED.has(String(name || '').toLowerCase());

module.exports = { groupSessions, SystemService, Helper, parseGpuLine, parseReg, approvedOn, parsePing, diagnoseNet, startupList, startupSet, ping, powerGet, powerSet, lock, shutdownIn, shutdownCancel, POWER, isProtected, Cpu };
