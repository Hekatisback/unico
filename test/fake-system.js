'use strict';
// Simulatore di SystemService per provare l'interfaccia senza Windows (UNICO_MOCK=1).
class FakeSystem {
  constructor({ onTick }) { this.onTick = onTick; this.users = new Set(); this.history = []; this.t = 0; this.last = null; this.startup = null; this.timer = null; }
  want(who, on) {
    if (on) this.users.add(who); else this.users.delete(who);
    if (this.users.size && !this.timer) { this.timer = setInterval(() => this.tick(), 1000); this.tick(); }
    if (!this.users.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  tick() {
    this.t++;
    const w = (a, b, f) => Math.round(a + (b - a) * (0.5 + 0.5 * Math.sin(this.t / f)));
    const cores = Array.from({ length: 16 }, (_, i) => w(3, 60 + i, 3 + i / 3));
    const s = {
      at: Date.now(),
      cpu: { total: Math.round(cores.reduce((a, b) => a + b) / 16), cores, model: '13th Gen Intel(R) Core(TM) i5-13420H', mhz: 2100 },
      ram: { total: 34359738368, used: 34359738368 * w(38, 52, 9) / 100, pct: w(38, 52, 9) },
      disk: { total: 998896812032, free: 101146263552 },
      gpu: { name: 'NVIDIA GeForce RTX 4050 Laptop GPU', util: w(2, 88, 5), temp: w(48, 79, 8), memUsed: w(900, 4100, 7), memTotal: 6141, power: w(6, 82, 5), clock: w(210, 2535, 5), fan: null },
      diskIo: { read: w(0, 9e7, 4), write: w(0, 3e7, 6), busy: w(0, 40, 4) },
      net: { rx: w(1e3, 4.5e6, 3), tx: w(1e3, 6e5, 4) },
      cpuTemp: null,
      battery: { percent: 100, status: 2 },
      uptime: 183000,
    };
    this.last = s;
    this.history.push({ at: s.at, cpu: s.cpu.total, ram: s.ram.pct, gpu: s.gpu.util, gpuTemp: s.gpu.temp, rx: s.net.rx, tx: s.net.tx });
    if (this.history.length > 120) this.history.shift();
    this.onTick(s);
  }
  async procs() {
    const mk = (name, desc, cpu, memMb, n = 1, prot = false) => ({ name, desc, path: `C:\\Program Files\\${name}.exe`, pids: Array.from({ length: n }, (_, i) => 1000 + name.length * 37 + i), cpu, mem: memMb * 1048576, io: cpu * 1e4, protected: prot });
    return [
      mk('Discord', 'Discord', 3.2, 1310, 5), mk('wallpaper64', 'Wallpaper Engine', 14.8, 521), mk('chrome', 'Google Chrome', 6.1, 2280, 14),
      mk('LeagueClientUx', 'League of Legends', 2.4, 690, 3), mk('Spotify', 'Spotify', 0.9, 420, 4), mk('MsMpEng', 'Antimalware Service Executable', 3.6, 284, 1, true),
      mk('dwm', 'Gestione finestre desktop', 2.2, 596, 1, true), mk('explorer', 'Esplora risorse', 0.2, 308), mk('iCUE', 'iCUE', 0.4, 127), mk('Unico', 'Unico', 1.1, 210, 4, true),
    ];
  }
  async kill(pids, name) { return name === 'dwm' ? { ok: false, error: 'processo di Windows' } : { ok: true }; }
  async closeNames(names) { return { closed: names.length }; }
  async procNames() { return ['explorer', 'Discord', this.gameRunning ? 'League of Legends' : 'chrome', ...(process.env.UNICO_FAKE_ICUE ? ['iCUE'] : [])]; }
  async cleanupScan() {
    return { temp: 1.2e9, crash: 3.1e8, downloads: 8.3e10, recycle: { count: 42, bytes: 2.4e9 }, big: [
      { path: 'C:\\Users\\utente\\Downloads\\Gioco-installer.zip', name: 'Gioco-installer.zip', bytes: 1.13e10, modified: '2026-10-16T21:11:00' },
      { path: 'C:\\Users\\utente\\Downloads\\Programma-Setup.exe', name: 'Programma-Setup.exe', bytes: 1.5e8, modified: '2026-10-14T19:57:00' },
      { path: 'C:\\Users\\utente\\Downloads\\browser-installer.exe', name: 'browser-installer.exe', bytes: 1.13e8, modified: '2026-10-15T10:34:00' },
    ] };
  }
  async clearTemp() { return { freed: 1.1e9 }; }
  async emptyRecycle() { return true; }
  async network() {
    return { results: [
      { label: 'Router di casa', host: '192.168.1.1', avg: 3, max: 5, loss: 0 },
      { label: 'Internet (Cloudflare)', host: '1.1.1.1', avg: 14, max: 18, loss: 0 },
      { label: 'Server di gioco', host: '104.160.141.3', avg: 38, max: 44, loss: 0 },
    ], verdict: 'Tutto a posto: ritardo basso su router, internet e server di gioco.' };
  }
  async media() {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#ff5f6d'/><stop offset='1' stop-color='#3a1c71'/></linearGradient></defs><rect width='300' height='300' fill='url(#g)'/><circle cx='150' cy='150' r='70' fill='none' stroke='#fff' stroke-opacity='.7' stroke-width='6'/></svg>";
    return { title: 'Canzone di prova', artist: 'Artista di esempio', album: 'Album demo', app: 'Spotify.exe', playing: true, thumb: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
  }
  async mediaKey() { return true; }
  async brightness() { return [{ id: 'internal', name: 'Schermo del portatile', value: 80, max: 100 }, { id: 'ddc:0', name: 'PHL 273V7', value: 60, max: 100 }]; }
  async setBrightness() { return true; }
  async suspend() { return true; }
  async audioDevices(flow) {
    if (flow === 'capture') return [
      { id: 'mic-hs80', name: 'Microfono (CORSAIR HS80 RGB Wireless)', volume: 82, muted: false, isDefault: true, peak: 12 },
      { id: 'mic-int', name: 'Gruppo microfoni (Realtek)', volume: 70, muted: false, isDefault: false, peak: 0 },
    ];
    return [
      { id: 'out-hs80', name: 'Cuffie (CORSAIR HS80 RGB Wireless)', volume: 46, muted: false, isDefault: true, peak: 38 },
      { id: 'out-spk', name: 'Altoparlanti (Realtek)', volume: 70, muted: false, isDefault: false, peak: 0 },
      { id: 'out-phl', name: 'PHL 273V7 (NVIDIA High Definition Audio)', volume: 100, muted: false, isDefault: false, peak: 0 },
    ];
  }
  async audioSessions() {
    const t = Date.now() / 400;
    return [
      { name: 'Spotify', pids: [4100], volume: 70, muted: false, peak: Math.round(30 + 25 * Math.sin(t)), system: false },
      { name: 'Discord', pids: [3200, 3204], volume: 100, muted: false, peak: Math.round(8 + 8 * Math.sin(t * 2)), system: false },
      { name: 'League of Legends', pids: [9001], volume: 45, muted: false, peak: 0, system: false },
      { name: 'chrome', pids: [7000], volume: 100, muted: true, peak: 0, system: false },
      { name: 'Suoni di sistema', pids: [0], volume: 60, muted: false, peak: 0, system: true },
    ];
  }
  async audioSetDefault() { return true; }
  async audioSetDeviceVolume() { return true; }
  async audioSetDeviceMute() { return true; }
  async audioSetApp() { return true; }
  stop() { if (this.timer) clearInterval(this.timer); }
}

const fakeTools = {
  startupList: async () => [
    { id: 'HKCU:Discord', name: 'Discord', command: '"C:\\Users\\utente\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe', enabled: false, editable: true, scope: 'Utente', kind: 'run' },
    { id: 'HKCU:Spotify', name: 'Spotify', command: '"C:\\Users\\utente\\AppData\\Roaming\\Spotify\\Spotify.exe" --autostart', enabled: true, editable: true, scope: 'Utente', kind: 'run' },
    { id: 'HKCU:Steam', name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', enabled: true, editable: true, scope: 'Utente', kind: 'run' },
    { id: 'HKLM:RtkAudUService', name: 'RtkAudUService', command: 'RtkAudUService64.exe -background', enabled: true, editable: false, scope: 'Tutti gli utenti', kind: 'run' },
  ],
  startupSet: async () => ({ ok: true }),
  powerGet: async () => 'balanced',
  powerSet: async () => ({ ok: true }),
  lock: async () => ({ ok: true }),
  shutdownIn: async (m) => ({ ok: true, at: Date.now() + m * 60000 }),
  shutdownCancel: async () => ({ ok: true }),
};

function fakeGames() {
  const cover = (a, b, t) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='300' height='450' fill='url(#g)'/><text x='24' y='410' font-family='Segoe UI,Arial' font-size='30' font-weight='700' fill='#fff'>${t}</text></svg>`).toString('base64');
  return [
    { id: 'riot:league_of_legends', source: 'Riot', name: 'League of Legends', cover: cover('#0a3a5a', '#091428', 'LoL'), launch: { type: 'exe' } },
    { id: 'riot:valorant', source: 'Riot', name: 'VALORANT', cover: cover('#ff4655', '#1b1b25', 'VALORANT'), launch: { type: 'exe' } },
    { id: 'steam:730', source: 'Steam', name: 'Counter-Strike 2', cover: cover('#de9b35', '#1d2433', 'CS2'), launch: { type: 'url' } },
    { id: 'epic:Fortnite', source: 'Epic', name: 'Fortnite', cover: cover('#7b2ff7', '#f107a3', 'Fortnite'), launch: { type: 'url' } },
    { id: 'prism:Cozy World', source: 'Minecraft', name: 'Cozy World', cover: null, launch: { type: 'exe' } },
    { id: 'custom:1', source: 'Aggiunto da te', name: 'Roblox', cover: null, launch: { type: 'exe' } },
  ];
}

function fakeCatalog(name) {
  const c = (a, b, label, src) => ({ source: src, url: 'https://example.invalid/x.jpg', thumb: 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='200' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='200' height='300' fill='url(#g)'/><text x='14' y='270' font-family='Arial' font-size='20' font-weight='700' fill='#fff'>${label}</text></svg>`).toString('base64') });
  return [c('#ff4655', '#0f1923', name, 'SteamGridDB'), c('#2b2d42', '#ef233c', `${name} 2`, 'SteamGridDB'), c('#5f0f40', '#9a031e', 'Alt', 'SteamGridDB'), c('#003049', '#d62828', 'IGN', 'IGN'), c('#1b263b', '#415a77', 'Steam', 'Steam'), c('#264653', '#2a9d8f', 'Wiki', 'Wikipedia')];
}

module.exports = { FakeSystem, fakeTools, fakeGames, fakeCatalog };
