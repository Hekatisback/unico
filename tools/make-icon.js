// Genera assets/icon.png (256x256) e assets/icon.ico senza dipendenze: quadrato arrotondato con gradiente e una "U".
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // "U": due barre verticali e un arco
  const t = size * 0.13, L = size * 0.3, R = size * 0.7, top = size * 0.24, bot = size * 0.58;
  const inU = (x, y) => {
    if (y >= top && y <= bot && ((x >= L && x <= L + t) || (x >= R - t && x <= R))) return true;
    const cx = size / 2, cy = bot, ro = (R - L) / 2, ri = ro - t;
    const d = Math.hypot(x - cx, y - cy);
    return y >= bot && d <= ro && d >= ri;
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      let aa = 0;
      let uu = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
        if (inRounded(px, py)) { aa++; if (inU(px, py)) uu++; }
      }
      const k = (x + y) / (2 * size);
      const bg = [124 + (62 - 124) * k, 92 + (199 - 92) * k, 255];
      const u = uu / 16, a = aa / 16;
      raw[o] = Math.round(bg[0] * (1 - u) + 255 * u);
      raw[o + 1] = Math.round(bg[1] * (1 - u) + 255 * u);
      raw[o + 2] = Math.round(bg[2] * (1 - u) + 255 * u);
      raw[o + 3] = Math.round(255 * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = path.join(__dirname, '..', 'assets');
const big = png(256);
fs.writeFileSync(path.join(out, 'icon.png'), big);
// ICO con immagini PNG incorporate (supportato da Windows Vista in poi)
const sizes = [16, 32, 48, 256];
const imgs = sizes.map((s) => (s === 256 ? big : png(s)));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += imgs[i].length;
  return e;
});
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...imgs]));
console.log('icone create');
