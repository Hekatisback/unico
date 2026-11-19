'use strict';
// Batterie (idea presa da Joule): una lista sola con periferiche, telefono e dispositivi Bluetooth,
// dalla più scarica alla più carica. Se un valore non è stato letto si mostra "nessun dato", mai 0%.

const PERIPHERALS = [
  { key: 'mouse', kind: 'mouse', name: 'Mouse' },
  { key: 'headset', kind: 'headset', name: 'Cuffie' },
  { key: 'keyboard', kind: 'keyboard', name: 'Tastiera' },
];

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : null);

// Converte stato periferiche + telefono + Bluetooth in voci uniformi.
// extra: { phones: [{ serial, model, percent, charging, at }], bluetooth: [{ id, name, percent, kind }] }
function buildList(state, extra = {}, now = Date.now()) {
  const out = [];
  for (const p of PERIPHERALS) {
    const d = (state && state[p.key]) || {};
    if (!d.connected) continue;
    const live = pct(d.battery);
    const last = d.lastBattery ? pct(d.lastBattery.percent) : null;
    let status = 'ok';
    if (d.asleep) status = 'standby';
    else if (d.off) status = 'off';
    else if (live == null && p.key === 'keyboard' && d.wired) status = 'wired';
    out.push({
      id: p.key, kind: p.kind, name: p.name,
      percent: live != null ? live : last,
      stale: live == null && last != null,
      at: live != null ? now : d.lastBattery ? d.lastBattery.at : null,
      charging: d.charging === 'charging' || d.charging === true,
      status,
    });
  }
  for (const ph of extra.phones || []) {
    out.push({ id: `phone:${ph.serial}`, kind: 'phone', name: ph.model || 'Telefono', percent: pct(ph.percent), stale: false, at: ph.at || now, charging: !!ph.charging, status: 'ok' });
  }
  for (const b of extra.bluetooth || []) {
    out.push({ id: `bt:${b.id}`, kind: b.kind || 'bluetooth', name: b.name || 'Bluetooth', percent: pct(b.percent), stale: false, at: now, charging: false, status: 'ok' });
  }
  return sortList(out);
}

// Prima chi ha meno batteria; chi non ha un numero va in fondo.
function sortList(list) {
  return [...list].sort((a, b) => {
    if (a.percent == null && b.percent == null) return a.name.localeCompare(b.name);
    if (a.percent == null) return 1;
    if (b.percent == null) return -1;
    return a.percent - b.percent || a.name.localeCompare(b.name);
  });
}

const level = (p, low = 15) => (p == null ? 'none' : p <= low ? 'low' : p <= 40 ? 'mid' : 'high');
const COLORS = { high: '#19b867', mid: '#e69500', low: '#e5304a', none: '#8a8da0' };

function label(e) {
  if (e.status === 'wired' && e.percent == null) return 'Via cavo';
  if (e.percent == null) return 'Nessun dato';
  return `${e.percent}%`;
}

function detail(e, now = Date.now()) {
  const bits = [];
  if (e.charging) bits.push('In carica');
  if (e.status === 'standby') bits.push('In standby');
  if (e.status === 'off') bits.push('Spente');
  if (e.stale && e.at) bits.push(`letto ${ago(now - e.at)}`);
  return bits.join(' · ');
}

function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'adesso';
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h fa`;
  return `${Math.round(h / 24)} g fa`;
}

function tooltip(list) {
  if (!list.length) return 'Unico\nNessun dispositivo collegato';
  // Windows taglia il tooltip dell'icona a 127 caratteri
  let t = 'Unico';
  for (const e of list) {
    const line = `\n${e.name}: ${label(e)}${e.charging ? ' ⚡' : ''}`;
    if ((t + line).length > 127) break;
    t += line;
  }
  return t;
}

// La più scarica tra quelle che non sono in carica: decide il colore dell'icona.
function weakest(list) {
  return list.find((e) => e.percent != null && !e.charging) || null;
}

// Dispositivi appena accesi o collegati che ora hanno un valore di batteria.
function newlyConnected(prevIds, list) {
  return list.filter((e) => !prevIds.has(e.id) && e.percent != null && !e.stale);
}

// Avvisi di batteria bassa: uno per dispositivo finché non si ricarica sopra soglia + 5.
function lowAlerts(list, warned, threshold) {
  const fire = [];
  for (const e of list) {
    if (e.percent == null || e.stale) continue;
    if (e.percent <= threshold && !e.charging && !warned[e.id]) { warned[e.id] = true; fire.push(e); }
    if (e.percent > threshold + 5 || e.charging) warned[e.id] = false;
  }
  return fire;
}

// Riconosce il tipo di un dispositivo Bluetooth dal nome o dalla classe di Windows.
function btKind(name, cls) {
  const n = `${name || ''} ${cls || ''}`.toLowerCase();
  if (/controller|gamepad|xbox|dualsense|dualshock|joy-?con|8bitdo/.test(n)) return 'controller';
  if (/buds|airpods|headset|headphone|cuffi|auricolar|earbud|wh-|wf-|audio/.test(n)) return 'headset';
  if (/mouse|mx master|mx anywhere/.test(n)) return 'mouse';
  if (/keyboard|tastiera|keys/.test(n)) return 'keyboard';
  if (/phone|galaxy|iphone|pixel|redmi|xiaomi/.test(n)) return 'phone';
  if (/watch|band|fit/.test(n)) return 'watch';
  return 'bluetooth';
}

// Risposta dell'helper PowerShell -> lista Bluetooth senza doppioni (lo stesso dispositivo ha più nodi).
function parseBluetooth(rows) {
  const seen = new Map();
  for (const r of Array.isArray(rows) ? rows : rows ? [rows] : []) {
    const p = pct(Number(r.battery));
    if (p == null || !r.name || r.connected === false) continue;
    const key = String(r.name).trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, { id: key.replace(/[^a-z0-9]+/g, '-'), name: String(r.name).trim(), percent: p, kind: btKind(r.name, r.cls) });
  }
  return [...seen.values()];
}

module.exports = { buildList, sortList, level, COLORS, label, detail, ago, tooltip, weakest, newlyConnected, lowAlerts, btKind, parseBluetooth, pct };
