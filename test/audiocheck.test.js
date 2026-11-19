'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { analyze, fixPlan } = require('../src/system/audiocheck');

const OUT = { id: '{0.0.0.00000000}.{11111111-1111-1111-1111-111111111111}', name: 'Cuffie (CORSAIR HS80 RGB Wireless Gaming Headset)', isDefault: true, isDefaultComm: true, volume: 40, muted: false };
const MIC = { id: '{0.0.1.00000000}.{22222222-2222-2222-2222-222222222222}', name: 'Microfono (CORSAIR HS80 RGB Wireless Gaming Headset)', isDefault: true, isDefaultComm: true, volume: 85, muted: false };
const OTHER_MIC = { id: '{0.0.1.00000000}.{33333333-3333-3333-3333-333333333333}', name: 'Gruppo microfoni (Realtek)', isDefault: false, isDefaultComm: false, volume: 70, muted: false };

test('tutto a posto', () => {
  const r = analyze({ render: [OUT], capture: [MIC, OTHER_MIC], extra: { apo: {}, privacy: { user: 'Allow' } }, hw: { micMuted: false } });
  assert.ok(r.ok, JSON.stringify(r.items.filter((i) => !i.ok)));
  assert.deepStrictEqual(fixPlan(r), []);
});

test('microfono silenziato, a volume 0 e non predefinito: si sistema da Windows', () => {
  const mic = { ...MIC, muted: true, volume: 0, isDefault: false, isDefaultComm: false };
  const r = analyze({ render: [OUT], capture: [mic, { ...OTHER_MIC, isDefault: true, isDefaultComm: true }] });
  assert.ok(!r.ok && r.fixable);
  assert.deepStrictEqual(fixPlan(r).map((s) => s.op).sort(), ['default', 'mute', 'volume']);
  assert.ok(fixPlan(r).every((s) => s.id === mic.id));
});

test('Equalizer APO sul microfono: segnalato, non riparabile da Unico', () => {
  const r = analyze({ render: [OUT], capture: [MIC], extra: { apo: { [MIC.id]: true } } });
  const it = r.items.find((i) => i.key === 'micApo');
  assert.strictEqual(it.ok, false);
  assert.strictEqual(it.fix, null);
  assert.strictEqual(r.fixable, false);
});

test('asta alzata e permesso negato vengono spiegati', () => {
  const r = analyze({ render: [OUT], capture: [MIC], extra: { privacy: { desktop: 'Deny' } }, hw: { micMuted: true } });
  assert.strictEqual(r.items.find((i) => i.key === 'boom').ok, false);
  assert.strictEqual(r.items.find((i) => i.key === 'privacy').fix, 'privacy');
  assert.deepStrictEqual(fixPlan(r), []);
});

test('cuffie spente: nessuna azione', () => {
  const r = analyze({ render: [], capture: [OTHER_MIC], hw: { off: true } });
  assert.strictEqual(r.ok, false);
  assert.match(r.items[0].detail, /spente/);
  assert.deepStrictEqual(fixPlan(r), []);
});

test('chiamate su un altro dispositivo: imposta anche il ruolo comunicazioni', () => {
  const r = analyze({ render: [{ ...OUT, isDefaultComm: false }], capture: [MIC] });
  assert.deepStrictEqual(fixPlan(r), [{ op: 'default', id: OUT.id }]);
});

test('iCUE installato ma chiuso: solo un consiglio', () => {
  const r = analyze({ render: [OUT], capture: [MIC], icue: { installed: true } });
  assert.ok(r.ok);
  assert.ok(r.items.find((i) => i.key === 'icue').ok);
});
