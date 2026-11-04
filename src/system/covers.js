'use strict';
// Copertine scaricate da internet per i giochi che non ne hanno una sul PC.
// Ordine: Steam (CDN pubblico) → SteamGridDB (se c'è la chiave) → ricerca nel negozio Steam → Wikipedia.
// Le istanze di Minecraft tengono l'icona di Prism Launcher.
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Unico (app desktop personale)' };
const safeName = (id) => String(id).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[™®©:'’.,!?()\-–]/g, ' ').replace(/\s+/g, ' ').trim();

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getImage(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const type = r.headers.get('content-type') || '';
  if (!/^image\//.test(type)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) return null; // segnaposto vuoti
  return { buf, ext: type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg' };
}

const steamUrls = (appid) => [
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900_2x.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
];
async function fromSteam(appid) {
  for (const u of steamUrls(appid)) { const img = await getImage(u).catch(() => null); if (img) return { ...img, wide: false }; }
  // copertina verticale non disponibile: immagine orizzontale del negozio
  const d = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`).catch(() => null);
  const h = d && d[appid] && d[appid].data && d[appid].data.header_image;
  if (h) { const img = await getImage(h).catch(() => null); if (img) return { ...img, wide: true }; }
  return null;
}
async function fromSteamGridDb(name, key) {
  const auth = { Authorization: `Bearer ${key}` };
  const s = await getJson(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(name)}`, auth);
  const game = (s.data || []).find((g) => norm(g.name) === norm(name)) || (s.data || [])[0];
  if (!game) return null;
  const g = await getJson(`https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=600x900,342x482,660x930&types=static&nsfw=false`, auth);
  for (const it of (g.data || []).slice(0, 3)) { const img = await getImage(it.url).catch(() => null); if (img) return { ...img, wide: false }; }
  return null;
}
async function fromSteamSearch(name) {
  const r = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=italian&cc=IT`);
  const n = norm(name);
  const hit = (r.items || []).find((i) => norm(i.name) === n) || (r.items || []).find((i) => norm(i.name).startsWith(n) && n.length >= 4);
  return hit ? fromSteam(hit.id) : null;
}
async function fromWikipedia(name) {
  for (const lang of ['en', 'it']) {
    const titleCase = name.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    const names = [...new Set([name, titleCase])];
    for (const title of names.flatMap((n) => [`${n} (video game)`, `${n} (videogioco)`, n])) {
      const d = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`).catch(() => null);
      if (!d || d.type === 'disambiguation') continue;
      const desc = `${d.description || ''} ${d.extract || ''}`.toLowerCase();
      if (!/video ?game|videogioco|videogame/.test(desc)) continue;
      const src = (d.originalimage || d.thumbnail || {}).source;
      if (!src) continue;
      const img = await getImage(src).catch(() => null);
      if (img) return { ...img, wide: d.originalimage ? d.originalimage.width > d.originalimage.height : false };
    }
  }
  return null;
}

const MISS_V = 2; // cambiando le fonti si riprovano i giochi non trovati

class Covers {
  constructor(dir, log) {
    this.dir = dir; this.log = log;
    this.metaFile = path.join(dir, 'covers.json');
    try { this.meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')); } catch (e) { this.meta = {}; }
    this.running = false;
  }
  save() { try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.metaFile, JSON.stringify(this.meta)); } catch (e) {} }
  // Copertina già pronta (scaricata o scelta da te) per un gioco.
  lookup(id) {
    const m = this.meta[id];
    if (m && m.file && fs.existsSync(path.join(this.dir, m.file))) return { cover: path.join(this.dir, m.file), wide: !!m.wide, custom: !!m.custom };
    return null;
  }
  setCustom(id, srcFile) {
    fs.mkdirSync(this.dir, { recursive: true });
    const ext = (path.extname(srcFile) || '.jpg').toLowerCase();
    const file = `custom-${safeName(id)}-${Date.now()}${ext}`;
    fs.copyFileSync(srcFile, path.join(this.dir, file));
    const old = this.meta[id];
    if (old && old.file && old.custom) { try { fs.unlinkSync(path.join(this.dir, old.file)); } catch (e) {} }
    this.meta[id] = { file, custom: true, at: Date.now() };
    this.save();
  }
  clearCustom(id) {
    const old = this.meta[id];
    if (old && old.custom) { try { fs.unlinkSync(path.join(this.dir, old.file)); } catch (e) {} delete this.meta[id]; this.save(); }
  }
  // Scarica in sottofondo le copertine mancanti; onDone viene chiamato se ne arriva almeno una.
  async fill(games, { sgdbKey, onDone } = {}) {
    if (this.running) return;
    this.running = true;
    let got = 0;
    try {
      for (const g of games) {
        if (g.source === 'Minecraft' || (g.cover && !g.cover.startsWith('data:'))) continue;
        const m = this.meta[g.id];
        if (m && (m.file || (m.missV === MISS_V && Date.now() - (m.missAt || 0) < 7 * 86400000))) continue;
        let img = null;
        const name = g.name.replace(/\s*\(.*?\)\s*$/, '');
        try {
          if (g.appid) img = await fromSteam(g.appid);
          if (!img && sgdbKey) img = await fromSteamGridDb(name, sgdbKey).catch((e) => { this.log(`copertine SteamGridDB: ${e.message}`); return null; });
          if (!img && !g.appid) img = await fromSteamSearch(name).catch(() => null);
          if (!img) img = await fromWikipedia(name).catch(() => null);
        } catch (e) { this.log(`copertina ${g.name}: ${e.message}`); }
        if (img) {
          fs.mkdirSync(this.dir, { recursive: true });
          const file = `${safeName(g.id)}.${img.ext}`;
          fs.writeFileSync(path.join(this.dir, file), img.buf);
          this.meta[g.id] = { file, wide: img.wide, at: Date.now() };
          got++;
        } else this.meta[g.id] = { missAt: Date.now(), missV: MISS_V };
        this.save();
      }
    } finally { this.running = false; }
    if (got && onDone) onDone(got);
    return got;
  }
  // Riprova anche quelli non trovati (es. dopo aver inserito la chiave SteamGridDB).
  forgetMisses() { for (const [k, v] of Object.entries(this.meta)) if (!v.file) delete this.meta[k]; this.save(); }
}

module.exports = { Covers, norm, safeName };
