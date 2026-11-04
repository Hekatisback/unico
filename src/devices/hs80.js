'use strict';
// Corsair HS80 RGB Wireless: ricevitore 1B1C:0A6B (cavo: 0A69, cavo con cuffie spente: 0A6A).
// Protocollo "Bragi" sulla collezione vendor FF42:0001, report OUT 0x02 / IN 0x01.
// Fonti verificate su questo modello: joanjgm/hs80-battery, GordoLonha/OpenPeripheral (protocol/hs80_bragi.md).

const VID = 0x1b1c;
const PID_RECEIVER = 0x0a6b;
const PID_WIRED = 0x0a69;
const PID_WIRED_OFF = 0x0a6a;
const OUT_REPORT = 0x02;
const IN_REPORT = 0x01;
const OUT_LEN = 64; // 63 byte + report ID

const TARGET_RECEIVER = 0x08;
const TARGET_HEADSET = 0x09;
const CMD_SET = 0x01;
const CMD_GET = 0x02;
const CMD_WRITE_DATA = 0x06;
const CMD_OPEN_ENDPOINT = 0x0d;
const PROP = { MODE: 0x03, BATTERY: 0x0f, BATTERY_STATUS: 0x10, SLEEP_ENABLED: 0x0d, SLEEP_MS: 0x0e, FIRMWARE: 0x13, MIC_MUTE: 0xa6 };
const MODE_HARDWARE = 0x01;
const MODE_SOFTWARE = 0x02;
const RESOURCE_LIGHTING = 0x01;
const SLEEP_MINUTES = [0, 1, 5, 10, 15, 30, 60];

function packet(payload) {
  const b = Buffer.alloc(OUT_LEN);
  b[0] = OUT_REPORT;
  Buffer.from(payload).copy(b, 1);
  return b;
}

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

const req = {
  get: (target, prop) => packet([target, CMD_GET, prop, 0x00]),
  set: (target, prop, value) => packet([target, CMD_SET, prop, 0x00, ...u16(value)]),
  set32: (target, prop, value) => packet([target, CMD_SET, prop, 0x00, ...u32(value)]),
  openLighting: (target) => packet([target, CMD_OPEN_ENDPOINT, 0x00, RESOURCE_LIGHTING]),
  writeLeds: (target, frame) => packet([target, CMD_WRITE_DATA, 0x00, ...u32(frame.length), ...frame]),
};

// 3 LED (0 logo, 1 stato, 2 microfono) in formato planare RRR GGG BBB.
function ledFrame(leds) {
  const f = new Array(9).fill(0);
  leds.forEach((c, i) => { f[i] = c.r; f[3 + i] = c.g; f[6 + i] = c.b; });
  return f;
}

// Risposta (senza report ID): [indice, comando, stato, valore...]; stato 0 = ok.
function parseReply(buf) {
  const b = buf[0] === IN_REPORT ? buf.subarray(1) : buf;
  return { index: b[0], cmd: b[1], status: b[2], value: b.subarray(3) };
}

const batteryStatusName = (v) => ({ 1: 'charging', 2: 'discharging', 3: 'full' }[v] || 'unknown');

class Hs80 {
  constructor(hid, log) {
    this.hid = hid;
    this.log = log;
    this.dev = null;
    this.pid = null;
    this.queue = Promise.resolve();
    this.ledTimer = null;
    this.ledState = null;
  }

  get target() { return this.pid === PID_WIRED ? TARGET_RECEIVER : TARGET_HEADSET; }

  run(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  async connect() {
    if (this.dev) return true;
    const all = await this.hid.devicesAsync();
    const order = [PID_WIRED, PID_RECEIVER];
    for (const pid of order) {
      const c = all.find((d) => d.vendorId === VID && d.productId === pid && d.usagePage === 0xff42 && d.usage === 0x0001);
      if (!c) continue;
      try {
        this.dev = await this.hid.HIDAsync.open(c.path, { nonExclusive: true });
        this.pid = pid;
        this.log(`hs80: collegato (${pid === PID_WIRED ? 'cavo' : 'ricevitore'}) ${c.path}`);
        return true;
      } catch (e) {
        this.log(`hs80: apertura fallita ${e.message}`);
      }
    }
    if (all.some((d) => d.vendorId === VID && d.productId === PID_WIRED_OFF)) this.pid = PID_WIRED_OFF;
    return false;
  }

  async disconnect() {
    this.stopLeds(false);
    if (!this.dev) return;
    try { await this.dev.close(); } catch (e) {}
    this.dev = null;
  }

  async drain() {
    for (let i = 0; i < 16; i++) {
      const r = await this.dev.read(0);
      if (!r || !r.length) return;
    }
  }

  async transact(pkt, { quiet = false } = {}) {
    await this.drain();
    await this.dev.write(pkt);
    for (let i = 0; i < 8; i++) {
      const data = await this.dev.read(500);
      if (!data || !data.length) return null;
      const buf = Buffer.from(data);
      if (buf[0] !== IN_REPORT) continue; // notifiche (0x03) e rotella volume (0x0E)
      const r = parseReply(buf);
      if (r.cmd !== pkt[2]) continue;
      if (!quiet) this.log(`hs80 > ${hexs(pkt, 10)} < ${hexs(buf, 10)}`);
      return r;
    }
    return null;
  }

  ask(pkt, opts) {
    return this.run(async () => {
      if (!(await this.connect())) return { offline: true };
      try {
        const r = await this.transact(pkt, opts);
        if (!r) return { error: 'nessuna risposta' };
        if (r.status !== 0) return { refused: r.status };
        return { value: r.value };
      } catch (e) {
        await this.disconnect();
        return { error: e.message };
      }
    });
  }

  async batteryPercent() {
    // Due letture concordi: se un altro programma interroga le cuffie le risposte si mescolano.
    let last = null;
    for (let i = 0; i < 4; i++) {
      const r = await this.ask(req.get(this.target, PROP.BATTERY), { quiet: i > 0 });
      if (!r.value) return r;
      const v = (r.value[0] | (r.value[1] << 8)) / 10;
      if (v <= 0 || v > 100) return { off: true };
      if (last !== null && Math.abs(v - last) <= 2) return { percent: Math.round(v) };
      last = v;
    }
    return { error: 'letture discordanti (iCUE è aperto?)' };
  }

  async battery() {
    const b = await this.batteryPercent();
    if (b.offline) return { connected: false, cableOff: this.pid === PID_WIRED_OFF };
    if (b.off || b.refused) return { connected: true, off: true };
    const st = await this.ask(req.get(this.target, PROP.BATTERY_STATUS));
    return { connected: true, battery: b.percent, charging: st.value ? batteryStatusName(st.value[0]) : 'unknown', error: b.error };
  }

  async status() {
    const out = await this.battery();
    if (!out.connected || out.off) return { ...out, name: 'Corsair HS80 RGB Wireless' };
    out.name = 'Corsair HS80 RGB Wireless';
    out.wired = this.pid === PID_WIRED;
    const fw = await this.ask(req.get(this.target, PROP.FIRMWARE));
    if (fw.value) out.firmware = `${fw.value[0]}.${fw.value[1]}.${fw.value[2]}`;
    const mute = await this.ask(req.get(this.target, PROP.MIC_MUTE));
    if (mute.value) out.micMuted = mute.value[0] === 1;
    const se = await this.ask(req.get(this.target, PROP.SLEEP_ENABLED));
    const sm = await this.ask(req.get(this.target, PROP.SLEEP_MS));
    if (se.value) {
      const ms = sm.value ? (sm.value[0] | (sm.value[1] << 8) | (sm.value[2] << 16) | (sm.value[3] << 24)) >>> 0 : 0;
      out.sleepMinutes = se.value[0] ? Math.round(ms / 60000) : 0;
    }
    out.customLeds = !!this.ledTimer;
    return out;
  }

  async setMode(mode) {
    const a = await this.ask(req.set(TARGET_RECEIVER, PROP.MODE, mode));
    const b = this.pid === PID_WIRED ? a : await this.ask(req.set(this.target, PROP.MODE, mode));
    return !(a.error || a.offline || b.error || b.offline);
  }

  // Le scritture funzionano solo in modalità software: si entra, si scrive, si torna in hardware
  // (i valori restano salvati nelle cuffie). Così l'illuminazione di fabbrica non cambia.
  async setSleep(minutes) {
    if (!SLEEP_MINUTES.includes(minutes)) return { ok: false, error: 'valore non valido' };
    if (!(await this.setMode(MODE_SOFTWARE))) return { ok: false, error: 'cuffie non raggiungibili' };
    const a = await this.ask(req.set(this.target, PROP.SLEEP_ENABLED, minutes > 0 ? 1 : 0));
    let b = { value: true };
    if (minutes > 0) b = await this.ask(req.set32(this.target, PROP.SLEEP_MS, minutes * 60000));
    if (!this.ledTimer) await this.setMode(MODE_HARDWARE);
    const bad = a.refused || a.error || b.refused || b.error;
    return bad ? { ok: false, error: `le cuffie hanno rifiutato (${a.refused || b.refused || a.error || b.error})` } : { ok: true };
  }

  // --- Illuminazione software ---------------------------------------------------
  // In modalità software le cuffie mostrano l'ultimo frame ricevuto e tornano all'effetto
  // di fabbrica se i frame si fermano: Unico ricalcola e invia un frame ogni 100 ms.
  // cfg = { effect: static|breathing|colorshift|rainbow|off, color, color2, speed 1-5,
  //         brightness 0-100, status: battery|color|off, statusColor, mic: mute|color|off, micColor }
  async startLighting(cfg, ctx) {
    await this.stopLighting(false);
    if (!(await this.setMode(MODE_SOFTWARE))) return { ok: false, error: 'cuffie non raggiungibili' };
    await this.ask(req.openLighting(this.target));
    await this.openEvents();
    this.ledState = { cfg, ctx, t0: Date.now(), n: 0, busy: false };
    const tick = async () => {
      const st = this.ledState;
      if (!st || st.busy) return;
      st.busy = true;
      try {
        st.n++;
        if (st.n % 20 === 0) {
          const m = await this.ask(req.get(this.target, PROP.MIC_MUTE), { quiet: true });
          if (m.value && st.ctx.onMic) st.ctx.onMic(m.value[0] === 1);
        }
        await this.pollEvents();
        const frame = computeFrame(st.cfg, (Date.now() - st.t0) / 1000, st.ctx.getBattery(), st.ctx.getMuted());
        const r = await this.ask(req.writeLeds(this.target, frame), { quiet: true });
        if (r.offline || r.error) st.fails = (st.fails || 0) + 1; else st.fails = 0;
        if (st.fails > 50) { this.log('hs80: troppi errori, illuminazione software fermata'); await this.stopLighting(false); }
      } finally { if (this.ledState) this.ledState.busy = false; }
    };
    await tick();
    this.ledTimer = setInterval(tick, 100);
    return { ok: true };
  }

  updateLighting(cfg) { if (this.ledState) this.ledState.cfg = cfg; }

  async stopLighting(restore = true) {
    if (this.ledTimer) clearInterval(this.ledTimer);
    this.ledTimer = null;
    this.ledState = null;
    await this.closeEvents();
    if (restore && this.dev) await this.setMode(MODE_HARDWARE);
    return { ok: true };
  }

  // Notifiche (collezione FF42:0002): pressione della rotella e cambio microfono.
  // Arrivano solo in modalità software.
  async openEvents() {
    if (this.events) return;
    try {
      const all = await this.hid.devicesAsync();
      const c = all.find((d) => d.vendorId === VID && d.productId === this.pid && d.usagePage === 0xff42 && d.usage === 0x0002);
      if (c) this.events = await this.hid.HIDAsync.open(c.path, { nonExclusive: true });
    } catch (e) { this.log(`hs80: notifiche non disponibili ${e.message}`); this.events = null; }
  }

  async closeEvents() {
    if (!this.events) return;
    try { await this.events.close(); } catch (e) {}
    this.events = null;
  }

  async pollEvents() {
    if (!this.events || !this.ledState) return;
    for (let i = 0; i < 8; i++) {
      const data = await this.events.read(0);
      if (!data || !data.length) return;
      const ev = parseEvent(Buffer.from(data));
      if (!ev) continue;
      const ctx = this.ledState && this.ledState.ctx;
      if (!ctx) return;
      if (ev.type === 'wheel' && ev.pressed && ctx.onWheel) ctx.onWheel();
      if (ev.type === 'prop' && (ev.prop === 0xa6 || ev.prop === 0x8e) && ctx.onMic) ctx.onMic(ev.value === 1);
      if (ev.type === 'prop' && ev.prop === PROP.BATTERY && ctx.onBattery) ctx.onBattery(Math.round(ev.value / 10));
    }
  }

  // compatibilità con la versione 1.0
  startLeds(color, getBattery, getMuted) {
    return this.startLighting({ effect: 'static', color, brightness: 100, status: 'battery', mic: 'mute' }, { getBattery, getMuted });
  }
  stopLeds(restore = true) { return this.stopLighting(restore); }
}

// [03, indice, tipo, ...]: tipo 02 = rotella premuta/rilasciata, tipo 01 = proprietà cambiata (valore LE16)
function parseEvent(b) {
  if (b[0] !== 0x03) return null;
  if (b[2] === 0x02) return { type: 'wheel', pressed: b[3] !== 0 };
  if (b[2] === 0x01) return { type: 'prop', prop: b[3], value: b[5] | (b[6] << 8) };
  return null;
}

const EFFECT_PERIOD = { 1: 6, 2: 4.5, 3: 3, 4: 2, 5: 1.2 }; // secondi per ciclo

function computeFrame(cfg, t, battery, muted) {
  const bright = Math.max(0, Math.min(100, cfg.brightness ?? 100)) / 100;
  const period = EFFECT_PERIOD[cfg.speed || 3] || 3;
  const phase = (t % period) / period;
  const c1 = hexToRgb(cfg.color);
  const c2 = hexToRgb(cfg.color2 || '#00d0ff');
  let logo;
  switch (cfg.effect) {
    case 'off': logo = { r: 0, g: 0, b: 0 }; break;
    case 'breathing': logo = scale(c1, 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)); break;
    case 'colorshift': logo = mix(c1, c2, 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)); break;
    case 'rainbow': logo = hsv(phase * 360, 1, 1); break;
    default: logo = c1;
  }
  let status = { r: 0, g: 0, b: 0 };
  if (cfg.status === 'battery') status = battery == null ? status : battery > 50 ? { r: 0, g: 255, b: 0 } : battery > 15 ? { r: 255, g: 160, b: 0 } : { r: 255, g: 0, b: 0 };
  else if (cfg.status === 'color') status = hexToRgb(cfg.statusColor || cfg.color);
  let mic = { r: 0, g: 0, b: 0 };
  if (cfg.mic === 'mute') mic = muted ? { r: 255, g: 0, b: 0 } : mic;
  else if (cfg.mic === 'color') mic = hexToRgb(cfg.micColor || cfg.color);
  return ledFrame([scale(logo, bright), scale(status, bright), scale(mic, bright)]);
}

const scale = (c, k) => ({ r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k) });
const mix = (a, b, k) => ({ r: Math.round(a.r + (b.r - a.r) * k), g: Math.round(a.g + (b.g - a.g) * k), b: Math.round(a.b + (b.b - a.b) * k) });
function hsv(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return { r: f(5), g: f(3), b: f(1) };
}

function hexToRgb(h) {
  const n = parseInt(String(h || '#ffffff').replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const hexs = (b, n) => Array.from(b.subarray(0, n)).map((x) => x.toString(16).padStart(2, '0')).join(' ');

module.exports = { Hs80, req, ledFrame, parseReply, parseEvent, computeFrame, batteryStatusName, PROP, SLEEP_MINUTES, VID, PID_RECEIVER, PID_WIRED };
