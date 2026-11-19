'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/batteries/model');

const NOW = 1_700_000_000_000;
const state = {
  mouse: { connected: true, battery: 72 },
  headset: { connected: true, battery: 9, charging: 'discharging' },
  keyboard: { connected: true, wired: true },
};

test('lista: dalla più scarica, chi non ha dati in fondo', () => {
  const l = M.buildList(state, { phones: [{ serial: 'x', model: 'Galaxy', percent: 40, charging: true }] }, NOW);
  assert.deepStrictEqual(l.map((e) => e.id), ['headset', 'phone:x', 'mouse', 'keyboard']);
  assert.strictEqual(M.label(l[3]), 'Via cavo');
});

test('mai 0% inventato: senza lettura è "Nessun dato"', () => {
  const l = M.buildList({ mouse: { connected: true } }, {}, NOW);
  assert.strictEqual(l[0].percent, null);
  assert.strictEqual(M.label(l[0]), 'Nessun dato');
});

test('standby: usa l\'ultima lettura, segnata come vecchia', () => {
  const l = M.buildList({ mouse: { connected: true, asleep: true, lastBattery: { percent: 55, at: NOW - 2 * 3600e3 } } }, {}, NOW);
  assert.strictEqual(l[0].percent, 55);
  assert.ok(l[0].stale);
  assert.match(M.detail(l[0], NOW), /standby.*2 h fa/i);
});

test('scollegati non compaiono', () => {
  assert.strictEqual(M.buildList({ mouse: { connected: false, battery: 50 } }, {}, NOW).length, 0);
});

test('nuovi collegati e avvisi bassi (una volta sola)', () => {
  const l = M.buildList(state, {}, NOW);
  assert.deepStrictEqual(M.newlyConnected(new Set(['mouse']), l).map((e) => e.id), ['headset']);
  const warned = {};
  assert.strictEqual(M.lowAlerts(l, warned, 15).length, 1);
  assert.strictEqual(M.lowAlerts(l, warned, 15).length, 0);
  const charged = M.buildList({ headset: { connected: true, battery: 30 } }, {}, NOW);
  M.lowAlerts(charged, warned, 15);
  assert.strictEqual(warned.headset, false);
});

test('icona: la più scarica che non è in carica', () => {
  const l = M.buildList({ headset: { connected: true, battery: 5, charging: 'charging' }, mouse: { connected: true, battery: 60 } }, {}, NOW);
  assert.strictEqual(M.weakest(l).id, 'mouse');
});

test('tooltip entro 127 caratteri', () => {
  const bt = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, name: `Dispositivo con nome lungo ${i}`, percent: 50 }));
  assert.ok(M.tooltip(M.buildList(state, { bluetooth: bt }, NOW)).length <= 127);
});

test('Bluetooth: niente doppioni, tipo riconosciuto, scollegati e valori assurdi esclusi', () => {
  const r = M.parseBluetooth([
    { name: 'Xbox Wireless Controller', battery: 34, connected: true },
    { name: 'Xbox Wireless Controller', battery: 34, connected: true },
    { name: 'Galaxy Buds2 Pro', battery: 80 },
    { name: 'Vecchio mouse', battery: 50, connected: false },
    { name: 'Strano', battery: 255 },
  ]);
  assert.deepStrictEqual(r.map((x) => [x.name, x.kind]), [['Xbox Wireless Controller', 'controller'], ['Galaxy Buds2 Pro', 'headset']]);
  assert.deepStrictEqual(M.parseBluetooth(null), []);
});
