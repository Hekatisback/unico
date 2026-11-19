'use strict';
// Controllo del PC dal telefono: una pagina web nella rete di casa.
// Sicurezza: spento finché non lo accendi; risponde solo a indirizzi della rete locale; ogni telefono
// va abbinato con un codice di 6 cifre che vale 5 minuti; dopo l'abbinamento il telefono tiene un
// gettone segreto (sul PC ne resta solo l'impronta). Troppi codici sbagliati bloccano per un minuto.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 47810;
const PIN_MS = 5 * 60e3;
const COOKIE = 'unico_t';

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function isLocal(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  if (a === '::1' || a === '127.0.0.1') return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [x, y] = [+m[1], +m[2]];
  return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254);
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || !isLocal(i.address) || i.address.startsWith('169.254.')) continue;
      if (/vethernet|virtualbox|vmware|hyper-v|wsl|loopback/i.test(name)) continue;
      out.push(`http://${i.address}:${PORT}`);
    }
  }
  return out;
}

function parseCookies(h) {
  const o = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return o;
}

function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('troppo grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// deps: { log, getSettings, saveSettings, actions: { state(), volume(v), mute(), media(k), profile(id), lock() } }
function createRemote(deps) {
  let server = null;
  let pin = null; // { code, until }
  let fails = 0, lockedUntil = 0;
  const page = () => fs.readFileSync(path.join(__dirname, 'page.html'));
  const S = () => { const s = deps.getSettings(); if (!s.remote) s.remote = { enabled: false, tokens: [] }; if (!s.remote.tokens) s.remote.tokens = []; return s.remote; };

  function authed(req) {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (!t) return false;
    const h = sha(t);
    const tok = S().tokens.find((x) => x.hash === h);
    if (tok) tok.seen = Date.now();
    return !!tok;
  }
  const send = (res, code, obj, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(obj));
  };

  async function handle(req, res) {
    if (!isLocal(req.socket.remoteAddress)) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
      return res.end(page());
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    // l'intestazione obbligatoria impedisce a un sito qualsiasi di mandare comandi dal browser del telefono
    if (req.headers['x-unico'] !== '1') return send(res, 403, { error: 'richiesta non valida' });

    if (url.pathname === '/api/pair' && req.method === 'POST') {
      if (Date.now() < lockedUntil) return send(res, 429, { error: 'Troppi tentativi: riprova tra un minuto' });
      const body = await readBody(req).catch(() => ({}));
      if (!pin || Date.now() > pin.until) return send(res, 400, { error: 'Nessun abbinamento aperto: in Unico premi "Abbina un telefono"' });
      const ok = typeof body.pin === 'string' && body.pin.length === pin.code.length && crypto.timingSafeEqual(Buffer.from(body.pin), Buffer.from(pin.code));
      if (!ok) { if (++fails >= 5) { lockedUntil = Date.now() + 60e3; fails = 0; } return send(res, 401, { error: 'Codice sbagliato' }); }
      fails = 0; pin = null;
      const token = crypto.randomBytes(32).toString('hex');
      const name = String(body.name || req.headers['user-agent'] || 'Telefono').replace(/[^\w\s.()-]/g, '').slice(0, 40);
      S().tokens.push({ hash: sha(token), name, at: Date.now() });
      deps.saveSettings();
      deps.log(`telefono: abbinato ${name}`);
      deps.onChange && deps.onChange();
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` });
    }
    if (!authed(req)) return send(res, 401, { error: 'non abbinato' });

    try {
      if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, await deps.actions.state());
      if (url.pathname === '/api/action' && req.method === 'POST') {
        const b = await readBody(req);
        const A = deps.actions;
        let r;
        if (b.type === 'volume') r = await A.volume(Math.max(0, Math.min(100, Math.round(+b.value || 0))));
        else if (b.type === 'mute') r = await A.mute();
        else if (b.type === 'media' && ['prev', 'playpause', 'next'].includes(b.key)) r = await A.media(b.key);
        else if (b.type === 'profile' && typeof b.id === 'string') r = await A.profile(b.id);
        else if (b.type === 'lock') r = await A.lock();
        else return send(res, 400, { error: 'azione sconosciuta' });
        return send(res, 200, r || { ok: true });
      }
    } catch (e) { deps.log(`telefono: ${e.message}`); return send(res, 500, { error: e.message }); }
    res.writeHead(404); res.end();
  }

  function start() {
    if (server) return;
    server = http.createServer((req, res) => { handle(req, res).catch((e) => { try { send(res, 500, { error: e.message }); } catch (x) {} }); });
    server.on('error', (e) => { deps.log(`telefono: server ${e.message}`); server = null; deps.onChange && deps.onChange(e.code === 'EADDRINUSE' ? 'Porta occupata' : e.message); });
    server.listen(PORT, '0.0.0.0', () => deps.log(`telefono: in ascolto su ${lanAddresses().join(', ') || 'porta ' + PORT}`));
  }
  function stop() { if (server) { try { server.close(); } catch (e) {} server = null; } pin = null; }
  function sync() { if (S().enabled) start(); else stop(); }
  function newPin() {
    pin = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), until: Date.now() + PIN_MS };
    return { code: pin.code, until: pin.until };
  }
  function info() {
    const r = S();
    return { enabled: !!r.enabled, running: !!server, addresses: lanAddresses(), devices: r.tokens.map((t) => ({ name: t.name, at: t.at, seen: t.seen || null })), pin: pin && Date.now() < pin.until ? { code: pin.code, until: pin.until } : null };
  }
  function forgetAll() { S().tokens = []; deps.saveSettings(); }

  return { start, stop, sync, newPin, info, forgetAll, handle };
}

module.exports = { createRemote, isLocal, parseCookies, PORT };
