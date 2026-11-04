'use strict';
// Libreria giochi: Steam, Epic, Riot e istanze di Prism Launcher, letti dai file dei launcher.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const env = (k, d) => process.env[k] || d;
const exists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// Formato KeyValues di Valve (libraryfolders.vdf, appmanifest_*.acf) in oggetti JS.
function parseVdf(text) {
  const root = {};
  const stack = [root];
  let key = null;
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m;
  while ((m = re.exec(String(text)))) {
    if (m[2] === '{') { const o = {}; stack[stack.length - 1][key] = o; stack.push(o); key = null; continue; }
    if (m[2] === '}') { stack.pop(); key = null; continue; }
    const val = m[1].replace(/\\\\/g, '\\');
    if (key === null) key = val;
    else { stack[stack.length - 1][key] = val; key = null; }
  }
  return root;
}

const STEAM_SKIP = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '250820']); // redistributable, runtime, SteamVR
function steamGames(steamPath) {
  if (!steamPath) return [];
  const libs = new Set([path.join(steamPath, 'steamapps')]);
  const lf = parseVdf(readText(path.join(steamPath, 'steamapps', 'libraryfolders.vdf')) || '');
  const folders = lf.libraryfolders || lf.LibraryFolders || {};
  for (const v of Object.values(folders)) if (v && typeof v === 'object' && v.path) libs.add(path.join(v.path, 'steamapps'));
  const games = [];
  for (const lib of libs) {
    let files = [];
    try { files = fs.readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch (e) { continue; }
    for (const f of files) {
      const st = parseVdf(readText(path.join(lib, f)) || '').AppState;
      if (!st || !st.appid || STEAM_SKIP.has(st.appid) || /redist|proton|steamworks/i.test(st.name || '')) continue;
      games.push({
        id: `steam:${st.appid}`, source: 'Steam', name: st.name, appid: st.appid,
        dir: path.join(lib, 'common', st.installdir || ''),
        cover: steamCover(steamPath, st.appid),
        launch: { type: 'url', url: `steam://rungameid/${st.appid}` },
      });
    }
  }
  return games;
}
function steamCover(steamPath, appid) {
  const base = path.join(steamPath, 'appcache', 'librarycache');
  const cands = [path.join(base, appid, 'library_600x900.jpg'), path.join(base, `${appid}_library_600x900.jpg`), path.join(base, appid, 'header.jpg'), path.join(base, `${appid}_header.jpg`)];
  return cands.find(exists) || null;
}

function epicGames(manifestDir = path.join(env('ProgramData', 'C:\\ProgramData'), 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')) {
  let files = [];
  try { files = fs.readdirSync(manifestDir).filter((f) => f.endsWith('.item')); } catch (e) { return []; }
  const out = [];
  for (const f of files) {
    let j;
    try { j = JSON.parse(readText(path.join(manifestDir, f))); } catch (e) { continue; }
    if (!j || !j.DisplayName || !j.AppName || (j.AppCategories || []).includes('plugins')) continue;
    out.push({
      id: `epic:${j.AppName}`, source: 'Epic', name: j.DisplayName, dir: j.InstallLocation, cover: null,
      launch: { type: 'url', url: `com.epicgames.launcher://apps/${encodeURIComponent(`${j.CatalogNamespace}:${j.CatalogItemId}:${j.AppName}`)}?action=launch&silent=true` },
    });
  }
  return out;
}

function riotGames(installsFile = path.join(env('ProgramData', 'C:\\ProgramData'), 'Riot Games', 'RiotClientInstalls.json')) {
  let j = null;
  try { j = JSON.parse(readText(installsFile)); } catch (e) { j = null; }
  const client = j && (j.rc_default || j.rc_live);
  if (!client || !exists(client)) return [];
  const products = [
    { key: 'league_of_legends', name: 'League of Legends', dirs: ['C:\\Riot Games\\League of Legends'] },
    { key: 'valorant', name: 'VALORANT', dirs: ['C:\\Riot Games\\VALORANT'] },
    { key: 'bacon', name: 'Legends of Runeterra', dirs: ['C:\\Riot Games\\LoR'] },
  ];
  const meta = j.associated_client || {};
  return products.filter((p) => p.dirs.some(exists) || Object.keys(meta).some((k) => k.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]))).map((p) => ({
    id: `riot:${p.key}`, source: 'Riot', name: p.name, dir: p.dirs.find(exists) || null, cover: null,
    launch: { type: 'exe', exe: client, args: [`--launch-product=${p.key}`, '--launch-patchline=live'] },
  }));
}

function prismInstances() {
  const dataDirs = [path.join(env('APPDATA', ''), 'PrismLauncher'), path.join(env('USERPROFILE', ''), 'scoop', 'persist', 'prismlauncher')];
  const exes = [path.join(env('LOCALAPPDATA', ''), 'Programs', 'PrismLauncher', 'prismlauncher.exe'), path.join(env('USERPROFILE', ''), 'scoop', 'apps', 'prismlauncher', 'current', 'prismlauncher.exe')];
  const exe = exes.find(exists);
  if (!exe) return [];
  const out = [];
  for (const d of dataDirs) {
    const inst = path.join(d, 'instances');
    let dirs = [];
    try { dirs = fs.readdirSync(inst, { withFileTypes: true }).filter((x) => x.isDirectory() && !x.name.startsWith('_') && !x.name.startsWith('.')).map((x) => x.name); } catch (e) { continue; }
    for (const name of dirs) {
      const cfg = readText(path.join(inst, name, 'instance.cfg')) || '';
      const nm = (cfg.match(/^name=(.*)$/m) || [])[1] || name;
      out.push({ id: `prism:${name}`, source: 'Minecraft', name: nm.trim(), dir: path.join(inst, name), cover: null, launch: { type: 'exe', exe, args: ['--launch', name] } });
    }
  }
  return out;
}

async function steamPathFromRegistry() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (e, out) => {
      const m = String(out || '').match(/SteamPath\s+REG_SZ\s+(.+)/);
      resolve(m ? m[1].trim().replace(/\//g, '\\') : (exists('C:\\Program Files (x86)\\Steam') ? 'C:\\Program Files (x86)\\Steam' : null));
    });
  });
}

async function scanAll(custom = []) {
  const steam = await steamPathFromRegistry();
  const list = [...steamGames(steam), ...epicGames(), ...riotGames(), ...prismInstances(), ...custom.map((c) => ({ ...c, source: 'Aggiunto da te', launch: { type: 'exe', exe: c.exe, args: [] } }))];
  const seen = new Set();
  return list.filter((g) => (seen.has(g.id) ? false : seen.add(g.id))).sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

function launch(game, openExternal) {
  const l = game.launch || {};
  if (l.type === 'url') return openExternal(l.url).then(() => ({ ok: true }));
  if (l.type === 'exe' && l.exe && exists(l.exe)) {
    const child = spawn(l.exe, l.args || [], { detached: true, stdio: 'ignore', cwd: path.dirname(l.exe) });
    child.unref();
    return Promise.resolve({ ok: true });
  }
  return Promise.resolve({ ok: false, error: 'Non trovo il programma di avvio di questo gioco' });
}

// Nome del processo da riconoscere per il profilo automatico.
function processHint(game) {
  if (game.source === 'Riot' && game.id === 'riot:league_of_legends') return 'League of Legends';
  if (game.source === 'Riot' && game.id === 'riot:valorant') return 'VALORANT-Win64-Shipping';
  if (game.source === 'Minecraft') return 'javaw';
  return null;
}

module.exports = { parseVdf, steamGames, epicGames, riotGames, prismInstances, scanAll, launch, processHint };
