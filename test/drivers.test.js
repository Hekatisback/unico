'use strict';
// Test di integrazione dei driver contro il simulatore: apertura delle collezioni giuste,
// lettura dello stato, scritture e ripristino della modalità hardware delle cuffie.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeHid } = require('./fake-hid');
const { RazerMouse } = require('../src/devices/razer');
const { Hs80 } = require('../src/devices/hs80');
const { AulaKeyboard } = require('../src/devices/aula');

const noop = () => {};

test('mouse: trova la collezione con i feature report e legge lo stato', async () => {
  const hid = createFakeHid();
  const m = new RazerMouse(hid, noop);
  const s = await m.status();
  assert.equal(s.connected, true);
  assert.equal(s.firmware, '1.5');
  assert.equal(s.battery, 78);
  assert.equal(s.dpi, 1600);
  assert.deepEqual(s.stages, [800, 1600, 3200]);
  assert.equal(s.active, 2);
  assert.equal(s.pollRate, 1000);
  assert.equal(s.idle, 300);
  assert.equal(s.scrollBrightness, 200);
  assert.equal(m.info.path, 'razer-mouse');
});

test('mouse: applica stadi, polling, standby e luce', async () => {
  const hid = createFakeHid();
  const m = new RazerMouse(hid, noop);
  const r = await m.apply({ stages: [400, 800, 1200, 2400], active: 3, dpi: 1200, pollRate: 500, idle: 600, scroll: { effect: 'static', color: '#ff0000', brightness: 128 } });
  assert.deepEqual(r, { ok: true });
  const W = hid.world.razer;
  assert.deepEqual(W.stages, [400, 800, 1200, 2400]);
  assert.equal(W.active, 3);
  assert.equal(W.dpi, 1200);
  assert.equal(W.poll, 0x02);
  assert.equal(W.idle, 600);
  assert.equal(W.bright, 128);
});

test('mouse: in standby lo segnala invece di dare errore', async () => {
  const hid = createFakeHid();
  hid.world.razer.asleep = true;
  const m = new RazerMouse(hid, noop);
  const s = await m.status();
  assert.equal(s.connected, true);
  assert.equal(s.asleep, true);
});

test('cuffie: stato completo, ignorando le notifiche spurie', async () => {
  const hid = createFakeHid();
  const h = new Hs80(hid, noop);
  for (let i = 0; i < 5; i++) {
    const s = await h.status();
    assert.equal(s.connected, true);
    assert.equal(s.battery, 82);
    assert.equal(s.charging, 'discharging');
    assert.equal(s.firmware, '5.8.48');
    assert.equal(s.micMuted, false);
    assert.equal(s.sleepMinutes, 10);
  }
});

test('cuffie: timer di spegnimento passa in modalità software e poi torna in hardware', async () => {
  const hid = createFakeHid();
  const h = new Hs80(hid, noop);
  const r = await h.setSleep(30);
  assert.deepEqual(r, { ok: true });
  assert.equal(hid.world.hs80.sleepMs, 30 * 60000);
  assert.equal(hid.world.hs80.sleepOn, 1);
  assert.equal(hid.world.hs80.mode[8], 1);
  assert.equal(hid.world.hs80.mode[9], 1);
});

test('cuffie: LED personalizzati inviano frame e alla fine ripristinano la modalità hardware', async () => {
  const hid = createFakeHid();
  const h = new Hs80(hid, noop);
  const r = await h.startLeds('#00aaff', () => 82, () => false);
  assert.deepEqual(r, { ok: true });
  assert.equal(hid.world.hs80.mode[9], 2);
  await new Promise((res) => setTimeout(res, 1100));
  assert.ok(hid.world.hs80.frames >= 2, `frame inviati: ${hid.world.hs80.frames}`);
  await h.stopLeds(true);
  assert.equal(hid.world.hs80.mode[8], 1);
  assert.equal(hid.world.hs80.mode[9], 1);
});

test('tastiera: stato con cavo e batteria dal ricevitore', async () => {
  const hid = createFakeHid();
  const k = new AulaKeyboard(hid, noop);
  const s = await k.status();
  assert.equal(s.connected, true);
  assert.equal(s.wired, true);
  assert.equal(s.battery, 87);
});

test('tastiera: luci via cavo con conferme', async () => {
  const hid = createFakeHid();
  const k = new AulaKeyboard(hid, noop);
  const r = await k.applyLighting({ mode: 1, color: '#00ff00', brightness: 5, speed: 3, direction: 0, multicolor: false });
  assert.deepEqual(r, { ok: true });
  const L = hid.world.aula.lighting;
  assert.equal(L[0], 1);
  assert.equal(L[2], 0xff);
  const feats = hid.world.sent.filter((s) => s.path === 'aula-wired').map((s) => s.data.subarray(1, 3).toString('hex'));
  assert.deepEqual(feats, ['0418', '0413', '0100', '0402', '04f0']);
});

test('tastiera: nessun comando pericoloso (firmware, keymap 04 11, luci per tasto 04 27) viene mai inviato', async () => {
  const hid = createFakeHid();
  const k = new AulaKeyboard(hid, noop);
  await k.applyLighting({ mode: 8, color: '#123456', brightness: 3, speed: 3, direction: 1, multicolor: true });
  await k.applySettings({ sleep: 2, responseLevel: 1, gameMode: true });
  await k.syncClock();
  const bad = hid.world.sent.filter((s) => s.path === 'aula-wired' && s.data[1] === 0x04 && [0x11, 0x27, 0x15, 0x19].includes(s.data[2]));
  assert.equal(bad.length, 0);
});

test('cuffie: effetti software, rotella e microfono', async () => {
  const hid = createFakeHid();
  const h = new Hs80(hid, noop);
  let wheel = 0;
  const r = await h.startLighting(
    { effect: 'static', color: '#102030', brightness: 100, status: 'battery', mic: 'mute' },
    { getBattery: () => 82, getMuted: () => true, onWheel: () => wheel++ },
  );
  assert.deepEqual(r, { ok: true });
  await new Promise((res) => setTimeout(res, 900));
  assert.ok(hid.world.hs80.frames >= 5, `frame: ${hid.world.hs80.frames}`);
  // logo #102030, stato verde (batteria 82%), microfono rosso (disattivato): formato planare
  assert.deepEqual(hid.world.hs80.lastFrame, [0x10, 0, 255, 0x20, 255, 0, 0x30, 0, 0]);
  assert.equal(wheel, 1);
  await h.stopLighting(true);
  assert.equal(hid.world.hs80.mode[9], 1);
});

test('tastiera: caricamento schermo via cavo', async () => {
  const hid = createFakeHid();
  const k = new AulaKeyboard(hid, noop);
  const px = new Uint8Array(128 * 128 * 2);
  let last = 0;
  const r = await k.uploadScreen([{ rgb565: px, delay: 100 }, { rgb565: px, delay: 100 }, { rgb565: px, delay: 100 }], (p) => { last = p; });
  assert.deepEqual(r, { ok: true, frames: 3 });
  assert.equal(hid.world.aula.chunks, Math.ceil((256 + 3 * 32768) / 4096));
  assert.equal(last, 1);
  const feats = hid.world.sent.filter((s) => s.path === 'aula-wired').map((s) => s.data.subarray(1, 3).toString('hex'));
  assert.deepEqual(feats, ['0418', '0472', '0402']);
});

test('mouse: se la prima collezione non risponde prova le altre e lo registra', async () => {
  const hid = createFakeHid();
  const logs = [];
  const m = new RazerMouse(hid, (l) => logs.push(l));
  assert.equal(await m.connect(), true);
  assert.ok(logs.some((l) => /if1 0001:0006 tid 1f errore/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /collegato su if0/.test(l)));
});
