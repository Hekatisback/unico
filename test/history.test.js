'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/batteries/history');

const T0 = 1_700_000_000_000, MIN = 60e3, HOUR = 3600e3;

test('registra solo letture vere, non troppo fitte', () => {
  const h = {};
  assert.ok(H.record(h, { id: 'm', percent: 80 }, T0));
  assert.ok(!H.record(h, { id: 'm', percent: 80 }, T0 + 2 * MIN));
  assert.ok(H.record(h, { id: 'm', percent: 77 }, T0 + 3 * MIN)); // cambiato di 3
  assert.ok(!H.record(h, { id: 'm', percent: 50, stale: true }, T0 + 60 * MIN));
  assert.ok(!H.record(h, { id: 'm', percent: null }, T0 + 60 * MIN));
  assert.strictEqual(h.m.length, 2);
});

test('stima: 5% all\'ora con 60% → circa 12 ore', () => {
  const h = {};
  for (let i = 0; i <= 6; i++) H.record(h, { id: 'c', percent: 90 - i * 5 }, T0 + i * HOUR);
  const e = H.estimate(h.c, T0 + 6 * HOUR);
  assert.ok(Math.abs(e.hours - 12) < 0.2, String(e.hours));
  assert.ok(Math.abs(e.perHour - 5) < 0.1);
  assert.strictEqual(H.formatHours(e.hours), 'circa 12 h');
});

test('dopo una ricarica conta solo la scarica nuova', () => {
  const h = {};
  H.record(h, { id: 'x', percent: 30 }, T0);
  H.record(h, { id: 'x', percent: 10 }, T0 + 2 * HOUR);
  H.record(h, { id: 'x', percent: 60, charging: true }, T0 + 3 * HOUR);
  H.record(h, { id: 'x', percent: 100 }, T0 + 4 * HOUR);
  H.record(h, { id: 'x', percent: 98 }, T0 + 5 * HOUR);
  H.record(h, { id: 'x', percent: 96 }, T0 + 6 * HOUR);
  assert.deepStrictEqual(H.dischargeRun(h.x).map((x) => x.p), [100, 98, 96]);
  const e = H.estimate(h.x, T0 + 6 * HOUR);
  assert.ok(Math.abs(e.hours - 48) < 1, String(e.hours));
});

test('niente stima con pochi dati, in carica o senza calo', () => {
  const h = {};
  H.record(h, { id: 'a', percent: 50 }, T0);
  H.record(h, { id: 'a', percent: 49 }, T0 + 20 * MIN);
  assert.strictEqual(H.estimate(h.a, T0 + 20 * MIN), null);
  H.record(h, { id: 'b', percent: 50, charging: true }, T0);
  assert.strictEqual(H.estimate(h.b), null);
});

test('i punti più vecchi di 14 giorni si buttano', () => {
  const h = {};
  H.record(h, { id: 'o', percent: 50 }, T0);
  H.record(h, { id: 'o', percent: 40 }, T0 + 15 * 86400e3);
  assert.strictEqual(h.o.length, 1);
});
