'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createRemote, isLocal } = require('../src/remote/server');

test('solo indirizzi della rete locale', () => {
  for (const a of ['192.168.1.20', '10.0.0.5', '172.20.1.1', '::ffff:192.168.0.9', '127.0.0.1']) assert.ok(isLocal(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '::ffff:93.184.216.34', '2001:db8::1', '']) assert.ok(!isLocal(a), a);
});

function req(port, method, path, { body, cookie, header = true } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(header ? { 'X-Unico': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d ? JSON.parse(d) : null }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

test('abbinamento con codice, poi comandi; senza gettone niente', async () => {
  const settings = {};
  const calls = [];
  const remote = createRemote({
    log: () => {}, getSettings: () => settings, saveSettings: () => {},
    actions: { state: async () => ({ ok: 1 }), volume: async (v) => { calls.push(['vol', v]); return { ok: true }; }, mute: async () => ({}), media: async (k) => { calls.push(['media', k]); }, profile: async () => ({}), lock: async () => ({}) },
  });
  const srv = http.createServer((q, s) => remote.handle(q, s));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    assert.strictEqual((await req(port, 'GET', '/api/state')).status, 401);
    assert.strictEqual((await req(port, 'GET', '/api/state', { header: false })).status, 403);
    assert.strictEqual((await req(port, 'POST', '/api/pair', { body: { pin: '123456' } })).status, 400); // nessun codice aperto
    const { code } = remote.newPin();
    const wrong = code === '000000' ? '000001' : '000000';
    assert.strictEqual((await req(port, 'POST', '/api/pair', { body: { pin: wrong } })).status, 401);
    const ok = await req(port, 'POST', '/api/pair', { body: { pin: code, name: 'Test' } });
    assert.strictEqual(ok.status, 200);
    const cookie = ok.headers['set-cookie'][0].split(';')[0];
    assert.ok(!JSON.stringify(settings).includes(cookie.split('=')[1]), 'sul PC solo l\'impronta del gettone');
    assert.strictEqual((await req(port, 'POST', '/api/pair', { body: { pin: code } })).status, 400); // codice usa e getta
    assert.strictEqual((await req(port, 'GET', '/api/state', { cookie })).status, 200);
    await req(port, 'POST', '/api/action', { cookie, body: { type: 'volume', value: 250 } });
    await req(port, 'POST', '/api/action', { cookie, body: { type: 'media', key: 'next' } });
    assert.strictEqual((await req(port, 'POST', '/api/action', { cookie, body: { type: 'shutdown' } })).status, 400);
    assert.deepStrictEqual(calls, [['vol', 100], ['media', 'next']]);
    remote.forgetAll();
    assert.strictEqual((await req(port, 'GET', '/api/state', { cookie })).status, 401);
  } finally { srv.close(); }
});

test('troppi codici sbagliati bloccano', async () => {
  const settings = {};
  const remote = createRemote({ log: () => {}, getSettings: () => settings, saveSettings: () => {}, actions: {} });
  const srv = http.createServer((q, s) => remote.handle(q, s));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const { code } = remote.newPin();
    const wrong = code === '999999' ? '999998' : '999999';
    for (let i = 0; i < 5; i++) await req(port, 'POST', '/api/pair', { body: { pin: wrong } });
    assert.strictEqual((await req(port, 'POST', '/api/pair', { body: { pin: code } })).status, 429);
  } finally { srv.close(); }
});
