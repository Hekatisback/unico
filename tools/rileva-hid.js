'use strict';
// Elenca le periferiche HID collegate (VID:PID, usage page, interfaccia, nome): serve a Claude per
// capire quali periferiche ha l'utente senza chiedergli niente. Solo lettura: non manda comandi.
// Uso: node tools/rileva-hid.js            (testo)
//      node tools/rileva-hid.js --json     (per elaborarlo)
const HID = require('node-hid');

const hex = (v) => (v || 0).toString(16).padStart(4, '0');
const all = HID.devices();
const byDevice = new Map();
for (const d of all) {
  const key = `${hex(d.vendorId)}:${hex(d.productId)}`;
  if (!byDevice.has(key)) byDevice.set(key, { id: key, vendorId: d.vendorId, productId: d.productId, product: d.product || '', manufacturer: d.manufacturer || '', interfaces: [] });
  const e = byDevice.get(key);
  if (!e.product && d.product) e.product = d.product;
  e.interfaces.push({ interface: d.interface, usagePage: `0x${hex(d.usagePage)}`, usage: `0x${hex(d.usage)}`, vendorDefined: d.usagePage >= 0xff00 });
}
// i dispositivi "vendor defined" (usage page 0xFFxx) sono quelli con cui parlano i programmi dei produttori
const list = [...byDevice.values()].filter((e) => e.vendorId).sort((a, b) => a.id.localeCompare(b.id));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(list, null, 2));
} else {
  for (const e of list) {
    const vend = e.interfaces.filter((i) => i.vendorDefined).map((i) => `${i.usagePage}/${i.usage} if${i.interface}`);
    console.log(`${e.id}  ${e.manufacturer ? e.manufacturer + ' — ' : ''}${e.product || '(senza nome)'}`);
    console.log(`           interfacce: ${e.interfaces.length}${vend.length ? `, del produttore: ${vend.join(', ')}` : ''}`);
  }
}
