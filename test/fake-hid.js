'use strict';
// Simulatore HID dei tre dispositivi, con il comportamento documentato dai progetti di riferimento.
// Usato dai test di integrazione e da UNICO_MOCK=1 per provare l'interfaccia senza hardware.
const { EventEmitter } = require('events');

function makeWorld() {
  const w = {
    sent: [],
    razer: { dpi: 1600, stages: [800, 1600, 3200], active: 2, poll: 0x01, idle: 300, low: 0x26, bright: 200, battery: 200, asleep: false },
    hs80: { mode: { 8: 1, 9: 1 }, battery: 0x0334, status: 2, sleepOn: 1, sleepMs: 600000, mic: 0, frames: 0 },
    aula: { last: null, battery: 87, lighting: null },
  };
  return w;
}

const devicesFor = () => [
  { vendorId: 0x1532, productId: 0x00b9, path: 'razer-kbd', usagePage: 0x0001, usage: 0x0006, interface: 1, product: 'Razer Basilisk V3 X HyperSpeed' },
  { vendorId: 0x1532, productId: 0x00b9, path: 'razer-mouse', usagePage: 0x0001, usage: 0x0002, interface: 0, product: 'Razer Basilisk V3 X HyperSpeed' },
  { vendorId: 0x1b1c, productId: 0x0a6b, path: 'hs80-consumer', usagePage: 0x000c, usage: 0x0001, interface: 3, product: 'CORSAIR HS80 RGB Wireless Gaming Receiver' },
  { vendorId: 0x1b1c, productId: 0x0a6b, path: 'hs80-bragi', usagePage: 0xff42, usage: 0x0001, interface: 3, product: 'CORSAIR HS80 RGB Wireless Gaming Receiver' },
  { vendorId: 0x1b1c, productId: 0x0a6b, path: 'hs80-events', usagePage: 0xff42, usage: 0x0002, interface: 3, product: 'CORSAIR HS80 RGB Wireless Gaming Receiver' },
  { vendorId: 0x0c45, productId: 0x800a, path: 'aula-wired', usagePage: 0xff13, usage: 0x0001, interface: 3, product: 'AULA F75 Max' },
  { vendorId: 0x0c45, productId: 0x800a, path: 'aula-screen', usagePage: 0xff68, usage: 0x0061, interface: 2, product: 'AULA F75 Max' },
  { vendorId: 0x05ac, productId: 0x024f, path: 'aula-dongle', usagePage: 0xff60, usage: 0x0061, interface: 2, product: '2.4G Wireless Receiver' },
];

class FakeDevice extends EventEmitter {
  constructor(path, w) { super(); this.path = path; this.w = w; this.inbox = []; this.feature = null; }
  async close() {}

  async sendFeatureReport(data) {
    const b = Buffer.from(data);
    this.w.sent.push({ path: this.path, type: 'feature', data: b });
    if (this.path === 'razer-mouse') return this.razer(b.subarray(1));
    if (this.path === 'aula-wired') { this.w.aula.last = b.subarray(1); if (b[1] <= 0x13 && b[15] === 0xaa) this.w.aula.lighting = Buffer.from(b.subarray(1)); return b.length; }
    throw new Error('Questa collezione non ha feature report');
  }

  async getFeatureReport(id, len) {
    if (this.path === 'razer-mouse') return Buffer.concat([Buffer.from([0x00]), this.feature || Buffer.alloc(90)]).subarray(0, len);
    if (this.path === 'aula-wired') {
      const r = Buffer.alloc(64);
      const l = this.w.aula.last || Buffer.alloc(64);
      r[0] = l[0]; r[1] = l[1]; r[3] = l[0] === 0x04 ? 0x01 : 0x00;
      return Buffer.concat([Buffer.from([0x00]), r]);
    }
    throw new Error('Questa collezione non ha feature report');
  }

  razer(req) {
    const W = this.w.razer;
    const r = Buffer.from(req);
    r[0] = W.asleep ? 0x04 : 0x02;
    const cls = req[6], id = req[7], a = req.subarray(8);
    const args = r.subarray(8);
    const key = (cls << 8) | id;
    switch (key) {
      case 0x0081: args[0] = 1; args[1] = 5; break;
      case 0x0780: args[1] = W.battery; break;
      case 0x0485: args[1] = W.dpi >> 8; args[2] = W.dpi & 255; args[3] = W.dpi >> 8; args[4] = W.dpi & 255; break;
      case 0x0405: W.dpi = (a[1] << 8) | a[2]; break;
      case 0x0486: {
        args[0] = 1; args[1] = W.active; args[2] = W.stages.length;
        W.stages.forEach((d, i) => { const o = 3 + i * 7; args[o] = i + 1; args[o + 1] = d >> 8; args[o + 2] = d & 255; args[o + 3] = d >> 8; args[o + 4] = d & 255; });
        break;
      }
      case 0x0406: {
        W.active = a[1];
        W.stages = [];
        for (let i = 0; i < a[2]; i++) { const o = 3 + i * 7; W.stages.push((a[o + 1] << 8) | a[o + 2]); }
        break;
      }
      case 0x0085: args[0] = W.poll; break;
      case 0x0005: W.poll = a[0]; break;
      case 0x0783: args[0] = W.idle >> 8; args[1] = W.idle & 255; break;
      case 0x0703: W.idle = (a[0] << 8) | a[1]; break;
      case 0x0781: args[0] = W.low; break;
      case 0x0701: W.low = a[0]; break;
      case 0x0f84: args[2] = W.bright; break;
      case 0x0f04: W.bright = a[2]; break;
      case 0x0f02: break;
      default: r[0] = 0x05;
    }
    this.feature = r;
    return req.length + 1;
  }

  async write(data) {
    const b = Buffer.from(data);
    this.w.sent.push({ path: this.path, type: 'output', data: b });
    if (this.path === 'hs80-bragi') return this.hs80(b);
    if (this.path === 'aula-screen') {
      if (b.length !== 4097) throw new Error(`blocco schermo di ${b.length} byte`);
      this.w.aula.chunks = (this.w.aula.chunks || 0) + 1;
      this.inbox.push(Buffer.alloc(128, 1));
      return b.length;
    }
    if (this.path === 'aula-dongle') {
      const body = b[0] === 0x00 ? b.subarray(1) : b;
      if (body[0] === 0x20 && body[1] === 0x01) this.inbox.push(Buffer.from([0x20, 0x01, 0x00, this.w.aula.battery]));
      if (body[0] === 0x05) this.w.aula.lighting = Buffer.from(body);
      return b.length;
    }
    throw new Error('write non supportato');
  }

  hs80(b) {
    const H = this.w.hs80;
    const [rid, target, cmd, prop] = b;
    if (rid !== 0x02) return b.length;
    const idx = target & 1;
    const reply = (status, ...value) => this.inbox.push(Buffer.from([0x01, idx, cmd, status, ...value]));
    // Una notifica spuria prima della risposta, come succede davvero (report 0x03)
    if (Math.random() < 0.3) this.inbox.push(Buffer.from([0x03, 0x01, 0x01, 0x0f, 0x00, H.battery & 255, H.battery >> 8]));
    if (cmd === 0x02) {
      if (target === 0x08 && prop === 0x0f) return reply(0x05);
      const v = { 0x0f: [H.battery & 255, H.battery >> 8], 0x10: [H.status], 0x13: [5, 8, 48], 0xa6: [H.mic], 0x0d: [H.sleepOn],
        0x0e: [H.sleepMs & 255, (H.sleepMs >> 8) & 255, (H.sleepMs >> 16) & 255, (H.sleepMs >>> 24) & 255], 0x03: [H.mode[target]] }[prop];
      return v ? reply(0x00, ...v) : reply(0x05);
    }
    if (cmd === 0x01) {
      const val = b[5] | (b[6] << 8) | (b[7] << 16) | (b[8] << 24);
      if (prop === 0x03) { H.mode[target] = val & 0xffff; return reply(0x00); }
      if (H.mode[target] !== 2) return reply(0x09); // scritture rifiutate in modalità hardware
      if (prop === 0x0d) H.sleepOn = val & 1;
      if (prop === 0x0e) H.sleepMs = val >>> 0;
      return reply(0x00);
    }
    if (cmd === 0x0d) return reply(0x00);
    if (cmd === 0x06) {
      H.frames++;
      H.lastFrame = Array.from(b.subarray(8, 17));
      // al 5° frame l'utente preme la rotella (notifica sulla collezione eventi)
      if (H.frames === 5 && this.w.eventsDev) this.w.eventsDev.inbox.push(Buffer.from([0x03, 0x01, 0x02, 0x01]), Buffer.from([0x03, 0x01, 0x02, 0x00]));
      return reply(0x00);
    }
    return reply(0x05);
  }

  async read(timeout) {
    if (this.inbox.length) return this.inbox.shift();
    if (timeout) await new Promise((r) => setTimeout(r, Math.min(timeout, 5)));
    return this.inbox.shift();
  }
}

function createFakeHid(world = makeWorld()) {
  return {
    world,
    devicesAsync: async () => devicesFor(),
    HIDAsync: { open: async (path) => { const d = new FakeDevice(path, world); if (path === 'hs80-events') world.eventsDev = d; return d; } },
    getHidapiVersion: () => 'fake',
  };
}

module.exports = { createFakeHid, makeWorld };
