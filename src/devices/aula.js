'use strict';
// AULA F75 Max. Cavo USB-C: 0C45:800A (comandi = feature report da 64 byte sulla collezione 0xFF13).
// Ricevitore 2.4G: 05AC:024F (output report da 32 byte sulla collezione 0xFF60, checksum al byte 31).
// Fonti: mohin7/aula-f75max (Docs/Hardware-Protocol-Notes.md, verificato su hardware via USB-C)
//        VitalyArt/Aula-F75-Max-Driver (AulaCore.swift, 2.4G).
// Non vengono MAI inviati comandi di firmware, keymap (04 11) o memoria luci per tasto (04 27).

const WIRED = { vid: 0x0c45, pid: 0x800a, commandPage: 0xff13, displayPage: 0xff68 };
const SCREEN = { width: 128, height: 128, header: 256, chunk: 4096, maxFrames: 255 };
const DONGLE = { vid: 0x05ac, pid: 0x024f, rawPage: 0xff60, commandPage: 0xff59 };
const CMD_LEN = 64;
const WL_LEN = 32;

const MODES = [
  'Spento', 'Statico', 'Reattivo', 'Reattivo dissolvenza', 'Scintille', 'Pioggia', 'Multicolore', 'Respiro',
  'Ciclo spettro', 'Verso l\'esterno', 'Onda', 'Rotolamento', 'Rotazione', 'Esplosione', 'Lancio', 'Increspature',
  'Flusso', 'Pulsazione', 'Inclinazione', 'Navetta',
];
const SLEEP = { 0: 'Mai', 1: '1 minuto', 2: '5 minuti', 3: '30 minuti' };

function cmd(a, b, fields = {}) {
  const p = Buffer.alloc(CMD_LEN);
  p[0] = a; p[1] = b;
  for (const [i, v] of Object.entries(fields)) p[i] = v;
  return p;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

// --- Cavo USB-C ---------------------------------------------------------------
// Ogni passo: { data, mode } con mode 'ack' = invia e attendi byte3==1, 'send' = solo invio, 'echo' = invia e rileggi.
const wired = {
  lighting: ({ mode, color, brightness, speed, direction, multicolor }) => {
    const p = Buffer.alloc(CMD_LEN);
    p[0] = clamp(mode, 0, 19);
    if (p[0] !== 0) {
      const c = hexToRgb(color);
      p[1] = c.r; p[2] = c.g; p[3] = c.b;
      p[8] = multicolor ? 1 : 0;
      p[9] = clamp(brightness, 1, 5);
      p[10] = clamp(speed, 1, 5);
      p[11] = clamp(direction, 0, 3);
    }
    p[14] = 0xaa; p[15] = 0x55;
    return [
      { data: cmd(0x04, 0x18), mode: 'ack' },
      { data: cmd(0x04, 0x13, { 8: 0x01 }), mode: 'ack' },
      { data: p, mode: 'send' },
      { data: cmd(0x04, 0x02), mode: 'ack' },
      { data: cmd(0x04, 0xf0), mode: 'send' },
    ];
  },
  settings: ({ disableWin, disableAltF4, disableAltTab, fnSwitch, sleep, responseLevel }) => {
    const p = Buffer.alloc(CMD_LEN);
    p[0] = 0x00; p[1] = 0x01;
    p[2] = disableWin ? 1 : 0;
    p[3] = disableAltF4 ? 1 : 0;
    p[4] = disableAltTab ? 1 : 0;
    p[5] = fnSwitch ? 1 : 0;
    p[6] = clamp(sleep, 0, 3);
    p[8] = clamp(responseLevel, 1, 5);
    p[62] = 0xaa; p[63] = 0x55;
    return [
      { data: cmd(0x04, 0x18), mode: 'ack' },
      { data: cmd(0x04, 0x17, { 2: 0x01, 8: 0x01 }), mode: 'ack' },
      { data: p, mode: 'send' },
      { data: cmd(0x04, 0x02), mode: 'ack' },
    ];
  },
  clock: (date = new Date()) => {
    const t = Buffer.alloc(CMD_LEN);
    t[0] = 0x00; t[1] = 0x01; t[2] = 0x5a;
    t[3] = (date.getFullYear() - 2000) % 100;
    t[4] = date.getMonth() + 1;
    t[5] = date.getDate();
    t[6] = date.getHours();
    t[7] = date.getMinutes();
    t[8] = date.getSeconds();
    t[10] = date.getDay(); // 0 = domenica
    t[62] = 0xaa; t[63] = 0x55;
    return [
      { data: cmd(0x04, 0x18), mode: 'ack' },
      { data: cmd(0x04, 0x28, { 8: 0x01 }), mode: 'ack' },
      { data: t, mode: 'echo' },
      { data: cmd(0x04, 0x02), mode: 'ack' },
    ];
  },
};

// --- Schermo 128x128 (verificato su hardware da mohin7/aula-f75max) ------------
// Flusso: header da 256 byte ([0] = numero frame, [1+i] = ritardo del frame i in unità da 2 ms,
// 30-500 ms), poi ogni frame in RGB565 little-endian, riempito a blocchi da 4096 byte.
function delayByte(ms) { return Math.round(Math.min(500, Math.max(30, ms)) / 2); }

function screenStream(frames) {
  const list = frames.slice(0, SCREEN.maxFrames);
  const frameBytes = SCREEN.width * SCREEN.height * 2;
  const len = SCREEN.header + list.length * frameBytes;
  const chunks = Math.ceil(len / SCREEN.chunk);
  const out = Buffer.alloc(chunks * SCREEN.chunk);
  out[0] = list.length;
  list.forEach((f, i) => {
    out[1 + i] = delayByte(f.delay || 100);
    const px = Buffer.from(f.rgb565);
    if (px.length !== frameBytes) throw new Error(`frame ${i}: ${px.length} byte invece di ${frameBytes}`);
    px.copy(out, SCREEN.header + i * frameBytes);
  });
  return out;
}

wired.screenBegin = (slot, chunkCount) => [
  { data: cmd(0x04, 0x18), mode: 'ack' },
  { data: cmd(0x04, 0x72, { 2: slot, 8: chunkCount & 0xff, 9: (chunkCount >> 8) & 0xff }), mode: 'ack' },
];
wired.screenFinish = () => [{ data: cmd(0x04, 0x02), mode: 'ack' }];

// --- Ricevitore 2.4G ----------------------------------------------------------
function checksum(r) {
  r[31] = 0;
  let s = 0;
  for (let i = 0; i < WL_LEN; i++) s = (s + r[i]) & 0xff;
  r[31] = s;
  return r;
}

const wireless = {
  rgbCommit: () => { const r = Buffer.alloc(WL_LEN); r[0] = 0x0f; return checksum(r); },
  rgb: ({ mode, color, brightness, speed, direction, multicolor }) => {
    const r = Buffer.alloc(WL_LEN);
    r[0] = 0x05; r[1] = 0x10; r[2] = 0x00;
    r[3] = clamp(mode, 0, 19);
    if (r[3] !== 0) {
      const c = hexToRgb(color);
      r[4] = c.r; r[5] = c.g; r[6] = c.b;
      r[11] = multicolor ? 1 : 0;
      r[12] = clamp(brightness, 1, 5);
      r[13] = clamp(speed, 1, 5);
      r[14] = clamp(direction, 0, 3);
    }
    r[17] = 0xaa; r[18] = 0x55;
    return checksum(r);
  },
  settings: ({ responseLevel, fnSwitch, sleep, gameMode }) => {
    const r = Buffer.alloc(WL_LEN);
    r[0] = 0x07; r[1] = 0x10; r[2] = 0x00; r[3] = 0x00;
    r[4] = 0x01; r[5] = 0x01; r[6] = 0x01; r[7] = 0x01;
    r[8] = fnSwitch ? 1 : 0;
    r[9] = clamp(sleep, 0, 3);
    r[11] = clamp(responseLevel, 1, 5);
    const g = gameMode ? 1 : 0;
    r[12] = g; r[13] = g; r[14] = g; r[15] = g;
    r[17] = 0xaa; r[18] = 0x55;
    return checksum(r);
  },
  batteryQuery: () => { const r = Buffer.alloc(WL_LEN); r[0] = 0x20; r[1] = 0x01; return checksum(r); },
};

function parseBattery(buf) {
  if (buf.length >= 4 && buf[0] === 0x20 && buf[1] === 0x01 && buf[3] > 0 && buf[3] <= 100) return buf[3];
  if (buf.length >= 5 && buf[1] === 0x20 && buf[2] === 0x01 && buf[4] > 0 && buf[4] <= 100) return buf[4];
  return null;
}

class AulaKeyboard {
  constructor(hid, log) {
    this.hid = hid;
    this.log = log;
    this.queue = Promise.resolve();
  }

  run(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  async find() {
    const all = await this.hid.devicesAsync();
    const wiredCmd = all.find((d) => d.vendorId === WIRED.vid && d.productId === WIRED.pid && d.usagePage === WIRED.commandPage);
    const dongle = all.filter((d) => d.vendorId === DONGLE.vid && d.productId === DONGLE.pid);
    return {
      wired: wiredCmd || null,
      raw: dongle.find((d) => d.usagePage === DONGLE.rawPage) || null,
      cmd: dongle.find((d) => d.usagePage === DONGLE.commandPage) || null,
    };
  }

  async withDevice(info, fn) {
    const dev = await this.hid.HIDAsync.open(info.path, { nonExclusive: true });
    try { return await fn(dev); } finally { try { await dev.close(); } catch (e) {} }
  }

  async runWired(info, steps) {
    return this.withDevice(info, async (dev) => {
      for (const s of steps) {
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok; attempt++) {
          await sleep(35);
          await dev.sendFeatureReport(Buffer.concat([Buffer.from([0x00]), s.data]));
          if (s.mode === 'send') { ok = true; break; }
          for (let i = 0; i < 6; i++) {
            await sleep(50);
            let r = Buffer.from(await dev.getFeatureReport(0x00, CMD_LEN + 1));
            if (r.length === CMD_LEN + 1) r = r.subarray(1);
            if (s.mode === 'echo') { ok = true; break; }
            if (r[0] === s.data[0] && r[1] === s.data[1] && r[3] === 0x01) { ok = true; break; }
          }
        }
        this.log(`aula(cavo) > ${hexs(s.data, 16)} ${ok ? 'ok' : 'NESSUNA CONFERMA'}`);
        if (!ok) return { ok: false, error: `la tastiera non ha confermato il comando ${hexs(s.data, 2)}` };
      }
      return { ok: true };
    });
  }

  async writeWireless(info, reports) {
    return this.withDevice(info, async (dev) => {
      for (const r of reports) {
        await writeWl(dev, r);
        this.log(`aula(2.4G) > ${hexs(r, 20)}`);
        await sleep(60);
      }
      return { ok: true };
    });
  }

  status() {
    return this.run(async () => {
      const f = await this.find();
      const out = { name: 'AULA F75 Max', connected: !!(f.wired || f.raw), wired: !!f.wired, wireless: !!f.raw };
      if (f.raw) {
        try {
          out.battery = await this.readBattery(f);
        } catch (e) { this.log(`aula: batteria non letta ${e.message}`); }
      }
      return out;
    });
  }

  async readBattery(f) {
    const listen = [f.raw, f.cmd].filter(Boolean);
    const devs = [];
    try {
      for (const i of listen) devs.push(await this.hid.HIDAsync.open(i.path, { nonExclusive: true }));
      await writeWl(devs[0], wireless.batteryQuery());
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        for (const d of devs) {
          const data = await d.read(60);
          if (data && data.length) {
            const p = parseBattery(Buffer.from(data));
            if (p) return p;
          }
        }
      }
      return null;
    } finally {
      for (const d of devs) { try { await d.close(); } catch (e) {} }
    }
  }

  battery() { return this.status(); }

  applyLighting(cfg) {
    return this.run(async () => {
      const f = await this.find();
      if (f.wired) return this.runWired(f.wired, wired.lighting(cfg));
      if (f.raw) return this.writeWireless(f.raw, [wireless.rgbCommit(), wireless.rgb(cfg)]);
      return { ok: false, error: 'Tastiera non trovata' };
    });
  }

  applySettings(cfg) {
    return this.run(async () => {
      const f = await this.find();
      if (f.wired) {
        const g = !!cfg.gameMode;
        return this.runWired(f.wired, wired.settings({ ...cfg, disableWin: g || cfg.disableWin, disableAltF4: g || cfg.disableAltF4, disableAltTab: g || cfg.disableAltTab }));
      }
      if (f.raw) return this.writeWireless(f.raw, [wireless.settings(cfg)]);
      return { ok: false, error: 'Tastiera non trovata' };
    });
  }

  // Carica un'immagine o una GIF sullo schermo. Serve il cavo USB-C.
  uploadScreen(frames, onProgress = () => {}) {
    return this.run(async () => {
      const all = await this.hid.devicesAsync();
      const cmdInfo = all.find((d) => d.vendorId === WIRED.vid && d.productId === WIRED.pid && d.usagePage === WIRED.commandPage);
      const rawInfo = all.find((d) => d.vendorId === WIRED.vid && d.productId === WIRED.pid && d.usagePage === WIRED.displayPage);
      if (!cmdInfo || !rawInfo) return { ok: false, error: 'Per lo schermo collega la tastiera con il cavo USB-C' };
      const stream = screenStream(frames);
      const chunkCount = stream.length / SCREEN.chunk;
      const raw = await this.hid.HIDAsync.open(rawInfo.path, { nonExclusive: true });
      try {
        const begin = await this.runWired(cmdInfo, wired.screenBegin(1, chunkCount));
        if (!begin.ok) return begin;
        await raw.read(150).catch(() => {});
        let acked = 0;
        for (let i = 0; i < chunkCount; i++) {
          await raw.write(Buffer.concat([Buffer.from([0x00]), stream.subarray(i * SCREEN.chunk, (i + 1) * SCREEN.chunk)]));
          const ack = await raw.read(400).catch(() => null);
          if (ack && ack.length) acked++;
          onProgress((i + 1) / chunkCount);
        }
        this.log(`aula: schermo ${frames.length} frame, ${chunkCount} blocchi, ${acked} confermati`);
        const fin = await this.runWired(cmdInfo, wired.screenFinish());
        return fin.ok ? { ok: true, frames: frames.length } : fin;
      } finally {
        try { await raw.close(); } catch (e) {}
      }
    });
  }

  syncClock() {
    return this.run(async () => {
      const f = await this.find();
      if (!f.wired) return { ok: false, error: 'Per l\'orologio collega la tastiera con il cavo USB-C' };
      return this.runWired(f.wired, wired.clock(new Date()));
    });
  }
}

// Su Windows il primo byte è il report ID: 0x00 se la collezione non ne usa.
// Se il ricevitore rifiuta la lunghezza, si riprova con i dati così come sono (come fa VitalyArt su Linux).
async function writeWl(dev, r) {
  try {
    return await dev.write(Buffer.concat([Buffer.from([0x00]), r]));
  } catch (e) {
    return dev.write(r);
  }
}

function hexToRgb(h) {
  const n = parseInt(String(h || '#ffffff').replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const hexs = (b, n) => Array.from(b.subarray(0, n)).map((x) => x.toString(16).padStart(2, '0')).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { AulaKeyboard, wired, wireless, checksum, parseBattery, screenStream, delayByte, SCREEN, MODES, SLEEP, WIRED, DONGLE };
