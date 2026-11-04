'use strict';
// Razer Basilisk V3 X HyperSpeed (dongle 1532:00B9).
// Protocollo ricavato da OpenRazer (driver/razermouse_driver.c, razerchromacommon.c):
// report da 90 byte, feature report ID 0, transaction id 0x1F, CRC = XOR dei byte 2..87.

const VID = 0x1532;
const PIDS = { 0x00b9: 'Razer Basilisk V3 X HyperSpeed' };
const TRANSACTION_ID = 0x1f;
const REPORT_LEN = 90;
const WAIT_MS = 35; // OpenRazer: RAZER_NEW_MOUSE_RECEIVER_WAIT_US = 31000
const NOSTORE = 0x00;
const VARSTORE = 0x01;
const SCROLL_LED = 0x01;
const DPI_MIN = 100;
const DPI_MAX = 18000;
const MAX_STAGES = 5;

const STATUS = { 0x00: 'nuovo', 0x01: 'occupato', 0x02: 'ok', 0x03: 'errore', 0x04: 'timeout', 0x05: 'non supportato' };

function crc(buf) {
  let c = 0;
  for (let i = 2; i < 88; i++) c ^= buf[i];
  return c;
}

function report(cls, id, size, args = [], tid = TRANSACTION_ID) {
  const b = Buffer.alloc(REPORT_LEN);
  b[1] = tid;
  b[5] = size;
  b[6] = cls;
  b[7] = id;
  for (let i = 0; i < args.length && i < 80; i++) b[8 + i] = args[i] & 0xff;
  b[88] = crc(b);
  return b;
}

function parse(buf) {
  return {
    status: buf[0],
    transactionId: buf[1],
    remaining: (buf[2] << 8) | buf[3],
    size: buf[5],
    cls: buf[6],
    id: buf[7],
    args: buf.subarray(8, 88),
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
const hi = (v) => (v >> 8) & 0xff;
const lo = (v) => v & 0xff;

// Costruttori di richieste (puri, testati in test/protocol.test.js)
const req = {
  firmware: () => report(0x00, 0x81, 0x02),
  serial: () => report(0x00, 0x82, 0x16),
  battery: () => report(0x07, 0x80, 0x02),
  getPollRate: () => report(0x00, 0x85, 0x01),
  setPollRate: (hz) => report(0x00, 0x05, 0x01, [hz === 1000 ? 0x01 : hz === 125 ? 0x08 : 0x02]),
  getDpi: () => report(0x04, 0x85, 0x07, [NOSTORE]),
  setDpi: (x, y = x) => {
    x = clamp(x, DPI_MIN, DPI_MAX); y = clamp(y, DPI_MIN, DPI_MAX);
    return report(0x04, 0x05, 0x07, [VARSTORE, hi(x), lo(x), hi(y), lo(y), 0, 0]);
  },
  getStages: () => report(0x04, 0x86, 0x26, [VARSTORE]),
  setStages: (stages, active) => {
    const list = stages.slice(0, MAX_STAGES).map((d) => clamp(d, DPI_MIN, DPI_MAX));
    const act = clamp(active, 1, list.length);
    const args = [VARSTORE, act, list.length];
    list.forEach((d, i) => args.push(i, hi(d), lo(d), hi(d), lo(d), 0, 0));
    return report(0x04, 0x06, 0x26, args);
  },
  getIdle: () => report(0x07, 0x83, 0x02),
  setIdle: (sec) => { sec = clamp(sec, 60, 900); return report(0x07, 0x03, 0x02, [hi(sec), lo(sec)]); },
  getLowBattery: () => report(0x07, 0x81, 0x01),
  setLowBattery: (raw) => report(0x07, 0x01, 0x01, [clamp(raw, 0x0c, 0x3f)]),
  getScrollBrightness: () => report(0x0f, 0x84, 0x03, [VARSTORE, SCROLL_LED]),
  setScrollBrightness: (v) => report(0x0f, 0x04, 0x03, [VARSTORE, SCROLL_LED, clamp(v, 0, 255)]),
  scrollStatic: ({ r, g, b }) => report(0x0f, 0x02, 0x09, [VARSTORE, SCROLL_LED, 0x01, 0, 0, 0x01, r, g, b]),
  scrollBreathing: ({ r, g, b }) => report(0x0f, 0x02, 0x09, [VARSTORE, SCROLL_LED, 0x02, 0x01, 0, 0x01, r, g, b]),
  scrollSpectrum: () => report(0x0f, 0x02, 0x06, [VARSTORE, SCROLL_LED, 0x03]),
  scrollReactive: (speed, { r, g, b }) => report(0x0f, 0x02, 0x09, [VARSTORE, SCROLL_LED, 0x05, 0, clamp(speed, 1, 4), 0x01, r, g, b]),
  scrollBreathingDual: (c1, c2) => report(0x0f, 0x02, 0x0c, [VARSTORE, SCROLL_LED, 0x02, 0x02, 0, 0x02, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b]),
  scrollBreathingRandom: () => report(0x0f, 0x02, 0x06, [VARSTORE, SCROLL_LED, 0x02]),
  scrollOff: () => report(0x0f, 0x02, 0x06, [VARSTORE, SCROLL_LED, 0x00]),
};

const pollFromCode = (c) => ({ 0x01: 1000, 0x02: 500, 0x08: 125 }[c] || null);
const batteryPercent = (raw) => Math.round((raw / 255) * 100);
const lowBatteryPercentToRaw = (p) => clamp((p * 255) / 100, 0x0c, 0x3f);
const lowBatteryRawToPercent = (raw) => Math.round((raw / 255) * 100);

function parseStages(args) {
  const active = args[1];
  const count = Math.min(args[2], MAX_STAGES);
  const stages = [];
  for (let i = 0; i < count; i++) {
    const o = 4 + i * 7;
    stages.push((args[o] << 8) | args[o + 1]);
  }
  return { active, stages };
}

class RazerMouse {
  constructor(hid, log) {
    this.hid = hid;
    this.log = log;
    this.dev = null;
    this.info = null;
    this.queue = Promise.resolve();
  }

  get name() { return this.info ? PIDS[this.info.productId] : 'Mouse Razer'; }

  // Serializza le richieste: una sola alla volta verso il dongle.
  run(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  async connect() {
    if (this.dev) return true;
    const all = await this.hid.devicesAsync();
    const candidates = all.filter((d) => d.vendorId === VID && PIDS[d.productId]);
    if (!candidates.length) {
      if (!this.warnedMissing) this.log(`razer: nessun ricevitore 1532:00B9 tra ${all.length} dispositivi HID`);
      this.warnedMissing = true;
      return false;
    }
    this.warnedMissing = false;
    // Su Windows ogni "collezione" del ricevitore è un percorso diverso: si prova quella che risponde.
    // Prima la transaction id di OpenRazer per questo modello (0x1F), poi quella generica (0xFF).
    for (const tid of [TRANSACTION_ID, 0xff]) {
      for (const c of candidates) {
        let dev;
        const where = `if${c.interface} ${hex16(c.usagePage)}:${hex16(c.usage)}`;
        try {
          dev = await this.hid.HIDAsync.open(c.path, { nonExclusive: true });
          this.dev = dev;
          this.tid = tid;
          const r = await this.transact(req.firmware(), { quiet: true });
          if (r && (r.status === 0x02 || r.status === 0x04)) {
            this.info = c;
            this.log(`razer: collegato su ${where} tid ${tid.toString(16)} (stato ${r.status})`);
            return true;
          }
          this.log(`razer: ${where} tid ${tid.toString(16)} risposta non valida ${r ? `stato ${r.status}` : 'assente'}`);
        } catch (e) {
          this.log(`razer: ${where} tid ${tid.toString(16)} errore: ${e.message}`);
        }
        try { if (dev) await dev.close(); } catch (e) {}
        this.dev = null;
      }
    }
    return false;
  }

  async disconnect() {
    if (!this.dev) return;
    try { await this.dev.close(); } catch (e) {}
    this.dev = null;
  }

  async transact(request, { quiet = false } = {}) {
    if (!this.dev) throw new Error('mouse non collegato');
    if (this.tid && request[1] !== this.tid) { request = Buffer.from(request); request[1] = this.tid; }
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.dev.sendFeatureReport(Buffer.concat([Buffer.from([0x00]), request]));
      await sleep(WAIT_MS + attempt * 25);
      let buf = await this.dev.getFeatureReport(0x00, REPORT_LEN + 1);
      buf = Buffer.from(buf);
      if (buf.length === REPORT_LEN + 1) buf = buf.subarray(1);
      const r = parse(buf);
      if (!quiet) this.log(`razer > ${hexs(request, 12)} < ${hexs(buf, 16)}`);
      if (r.cls !== request[6] || r.id !== request[7]) { await sleep(15); continue; }
      if (r.status === 0x01 || r.status === 0x00) { await sleep(20); continue; }
      return r;
    }
    return null;
  }

  async ask(request, opts = {}) {
    return this.run(async () => {
      if (!(await this.connect())) return { offline: true };
      try {
        const r = await this.transact(request, opts);
        if (!r) return { error: 'nessuna risposta' };
        if (r.status === 0x04) return { asleep: true };
        if (r.status !== 0x02) return { error: STATUS[r.status] || `stato ${r.status}` };
        return { args: r.args };
      } catch (e) {
        await this.disconnect();
        return { error: e.message };
      }
    });
  }

  async status() {
    const fw = await this.ask(req.firmware());
    if (fw.offline) return { connected: false };
    if (fw.asleep) return { connected: true, asleep: true, name: this.name };
    if (fw.error) return { connected: true, error: fw.error, name: this.name };
    const out = { connected: true, name: this.name, firmware: `${fw.args[0]}.${fw.args[1]}` };
    const bat = await this.ask(req.battery());
    if (bat.args) out.battery = batteryPercent(bat.args[1]);
    const dpi = await this.ask(req.getDpi());
    if (dpi.args) out.dpi = (dpi.args[1] << 8) | dpi.args[2];
    const st = await this.ask(req.getStages());
    if (st.args) Object.assign(out, parseStages(st.args));
    const pr = await this.ask(req.getPollRate());
    if (pr.args) out.pollRate = pollFromCode(pr.args[0]);
    const idle = await this.ask(req.getIdle());
    if (idle.args) out.idle = (idle.args[0] << 8) | idle.args[1];
    const lb = await this.ask(req.getLowBattery());
    if (lb.args) out.lowBattery = lowBatteryRawToPercent(lb.args[0]);
    const br = await this.ask(req.getScrollBrightness());
    if (br.args) out.scrollBrightness = br.args[2];
    return out;
  }

  // DPI attuale, letta in silenzio (serve all'avviso a schermo quando premi il tasto DPI)
  async currentDpi() {
    const d = await this.ask(req.getDpi(), { quiet: true });
    return d.args ? (d.args[1] << 8) | d.args[2] : null;
  }

  async battery() {
    const bat = await this.ask(req.battery(), { quiet: true });
    if (bat.offline) return { connected: false };
    if (bat.asleep) return { connected: true, asleep: true };
    return bat.args ? { connected: true, battery: batteryPercent(bat.args[1]) } : { connected: true };
  }

  async apply(change) {
    const steps = [];
    if (change.stages) steps.push(req.setStages(change.stages, change.active || 1));
    if (change.dpi) steps.push(req.setDpi(change.dpi));
    if (change.pollRate) steps.push(req.setPollRate(change.pollRate));
    if (change.idle) steps.push(req.setIdle(change.idle));
    if (change.lowBattery) steps.push(req.setLowBattery(lowBatteryPercentToRaw(change.lowBattery)));
    if (change.scroll) {
      const s = change.scroll;
      if (s.effect === 'static') steps.push(req.scrollStatic(hexToRgb(s.color)));
      if (s.effect === 'breathing') steps.push(req.scrollBreathing(hexToRgb(s.color)));
      if (s.effect === 'spectrum') steps.push(req.scrollSpectrum());
      if (s.effect === 'reactive') steps.push(req.scrollReactive(s.speed || 2, hexToRgb(s.color)));
      if (s.effect === 'breathingDual') steps.push(req.scrollBreathingDual(hexToRgb(s.color), hexToRgb(s.color2 || '#0066ff')));
      if (s.effect === 'breathingRandom') steps.push(req.scrollBreathingRandom());
      if (s.effect === 'off') steps.push(req.scrollOff());
      if (s.brightness !== undefined) steps.push(req.setScrollBrightness(s.brightness));
    }
    const errors = [];
    for (const s of steps) {
      const r = await this.ask(s);
      if (r.offline) return { ok: false, error: 'Mouse non trovato' };
      if (r.asleep) return { ok: false, error: 'Il mouse è in standby: muovilo e riprova' };
      if (r.error) errors.push(r.error);
    }
    return errors.length ? { ok: false, error: errors.join(', ') } : { ok: true };
  }
}

function hexToRgb(h) {
  const n = parseInt(String(h || '#00ff00').replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const hex16 = (v) => (v || 0).toString(16).padStart(4, '0');
const hexs = (b, n) => Array.from(b.subarray(0, n)).map((x) => x.toString(16).padStart(2, '0')).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { RazerMouse, req, crc, report, parse, parseStages, batteryPercent, pollFromCode, lowBatteryPercentToRaw, VID, PIDS, DPI_MAX };
