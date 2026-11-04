'use strict';
// Test "golden bytes": i pacchetti generati devono coincidere con quelli documentati
// dai progetti di riferimento (OpenRazer, OpenPeripheral/hs80-battery, AULA F75 Max).
const test = require('node:test');
const assert = require('node:assert/strict');
const razer = require('../src/devices/razer');
const hs80 = require('../src/devices/hs80');
const aula = require('../src/devices/aula');
const apo = require('../src/eq/apo');

const hex = (b, n = b.length) => Array.from(b.subarray(0, n)).map((x) => x.toString(16).padStart(2, '0')).join(' ');

test('razer: struttura report e CRC', () => {
  const r = razer.req.battery();
  assert.equal(r.length, 90);
  assert.equal(hex(r, 8), '00 1f 00 00 00 02 07 80');
  assert.equal(r[88], 0x02 ^ 0x07 ^ 0x80); // 0x85
  assert.equal(r[88], 0x85);
  assert.equal(r[89], 0x00);
});

test('razer: set DPI 1600 (VARSTORE, X e Y big endian)', () => {
  const r = razer.req.setDpi(1600);
  assert.equal(hex(r, 15), '00 1f 00 00 00 07 04 05 01 06 40 06 40 00 00');
  assert.equal(r[88], razer.crc(r));
});

test('razer: DPI fuori limite viene limitato a 100..18000', () => {
  assert.equal(hex(razer.req.setDpi(50), 13).slice(-11), '00 64 00 64');
  assert.equal(hex(razer.req.setDpi(99999), 13).slice(-11), '46 50 46 50');
});

test('razer: polling rate', () => {
  assert.equal(razer.req.setPollRate(1000)[8], 0x01);
  assert.equal(razer.req.setPollRate(500)[8], 0x02);
  assert.equal(razer.req.setPollRate(125)[8], 0x08);
  assert.equal(razer.pollFromCode(0x08), 125);
});

test('razer: stadi DPI come OpenRazer (varstore, attivo 1-based, stadi 0-based)', () => {
  const r = razer.req.setStages([800, 1600], 2);
  assert.equal(hex(r, 8), '00 1f 00 00 00 26 04 06');
  assert.equal(hex(r.subarray(8), 17), '01 02 02 00 03 20 03 20 00 00 01 06 40 06 40 00 00');
});

test('razer: lettura stadi dalla risposta documentata', () => {
  const args = Buffer.alloc(80);
  Buffer.from([0x01, 0x02, 0x02, 0x01, 0x03, 0x20, 0x03, 0x20, 0, 0, 0x02, 0x07, 0x08, 0x07, 0x08, 0, 0]).copy(args);
  assert.deepEqual(razer.parseStages(args), { active: 2, stages: [800, 1800] });
});

test('razer: rotella statica verde, LED 0x01', () => {
  const r = razer.req.scrollStatic({ r: 0, g: 255, b: 0 });
  assert.equal(hex(r, 17), '00 1f 00 00 00 09 0f 02 01 01 01 00 00 01 00 ff 00');
});

test('razer: soglia batteria e percentuale', () => {
  assert.equal(razer.batteryPercent(255), 100);
  assert.equal(razer.batteryPercent(128), 50);
  assert.equal(razer.lowBatteryPercentToRaw(1), 0x0c);
  assert.equal(razer.lowBatteryPercentToRaw(90), 0x3f);
});

test('hs80: GET batteria = 02 09 02 0F 00', () => {
  const p = hs80.req.get(0x09, hs80.PROP.BATTERY);
  assert.equal(p.length, 64);
  assert.equal(hex(p, 5), '02 09 02 0f 00');
});

test('hs80: risposta batteria documentata 01 01 02 00 34 03 = 82,0%', () => {
  const r = hs80.parseReply(Buffer.from([0x01, 0x01, 0x02, 0x00, 0x34, 0x03]));
  assert.equal(r.status, 0);
  assert.equal((r.value[0] | (r.value[1] << 8)) / 10, 82);
});

test('hs80: SET timer spegnimento 10 min (u32 LE ms)', () => {
  const p = hs80.req.set32(0x09, hs80.PROP.SLEEP_MS, 600000);
  assert.equal(hex(p, 9), '02 09 01 0e 00 c0 27 09 00');
});

test('hs80: frame LED planare', () => {
  const f = hs80.ledFrame([{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }]);
  assert.deepEqual(f, [255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const p = hs80.req.writeLeds(0x09, f);
  assert.equal(hex(p, 17), '02 09 06 00 09 00 00 00 ff 00 00 00 ff 00 00 00 ff');
});

test('aula cavo: sequenza luci come da note verificate', () => {
  const steps = aula.wired.lighting({ mode: 1, color: '#ff8000', brightness: 5, speed: 3, direction: 0, multicolor: false });
  assert.deepEqual(steps.map((s) => s.mode), ['ack', 'ack', 'send', 'ack', 'send']);
  assert.equal(hex(steps[0].data, 2), '04 18');
  assert.equal(hex(steps[1].data, 9), '04 13 00 00 00 00 00 00 01');
  assert.equal(hex(steps[2].data, 16), '01 ff 80 00 00 00 00 00 00 05 03 00 00 00 aa 55');
  assert.equal(hex(steps[3].data, 2), '04 02');
  assert.equal(hex(steps[4].data, 2), '04 f0');
  assert.ok(steps.every((s) => s.data.length === 64));
});

test('aula cavo: luci spente non inviano colore', () => {
  const p = aula.wired.lighting({ mode: 0, color: '#ffffff', brightness: 5, speed: 3, direction: 0 })[2].data;
  assert.equal(hex(p, 16), '00 00 00 00 00 00 00 00 00 00 00 00 00 00 aa 55');
});

test('aula cavo: impostazioni', () => {
  const steps = aula.wired.settings({ disableWin: true, disableAltF4: false, disableAltTab: false, fnSwitch: false, sleep: 2, responseLevel: 1 });
  assert.equal(hex(steps[1].data, 9), '04 17 01 00 00 00 00 00 01');
  assert.equal(hex(steps[2].data, 9), '00 01 01 00 00 00 02 00 01');
  assert.equal(hex(steps[2].data.subarray(62)), 'aa 55');
});

test('aula 2.4G: checksum = somma dei byte al byte 31', () => {
  const r = aula.wireless.batteryQuery();
  assert.equal(r.length, 32);
  assert.equal(r[31], 0x21); // 0x20 + 0x01, come nelle note "20 01 00… 21"
  const c = aula.wireless.rgbCommit();
  assert.equal(c[0], 0x0f);
  assert.equal(c[31], 0x0f);
});

test('aula 2.4G: report RGB', () => {
  const r = aula.wireless.rgb({ mode: 8, color: '#102030', brightness: 4, speed: 2, direction: 1, multicolor: true });
  assert.equal(hex(r, 19), '05 10 00 08 10 20 30 00 00 00 00 01 04 02 01 00 00 aa 55');
  let s = 0; for (let i = 0; i < 31; i++) s = (s + r[i]) & 0xff;
  assert.equal(r[31], s);
});

test('aula 2.4G: lettura batteria nei due formati', () => {
  assert.equal(aula.parseBattery(Buffer.from([0x20, 0x01, 0x00, 0x57])), 87);
  assert.equal(aula.parseBattery(Buffer.from([0x00, 0x20, 0x01, 0x00, 0x2a])), 42);
  assert.equal(aula.parseBattery(Buffer.from([0x05, 0x10, 0x00, 0x00])), null);
});

test('eq: configurazione Equalizer APO', () => {
  const c = apo.buildConfig([6, 5, 4, 2, 0, 0, 0, 0, 0, -3], '{12345678-1234-1234-1234-123456789abc}');
  assert.match(c, /Device: \{12345678-1234-1234-1234-123456789abc\}/);
  assert.doesNotMatch(c, /Device: HS80/);
  assert.match(c, /Preamp: -6\.0 dB/);
  assert.match(c, /GraphicEQ: 32 6\.0; 64 5\.0; .* 16000 -3\.0/);
  assert.match(c, /Device: all/);
});

test('eq: senza il GUID dell\'uscita non scrive niente (mai sul microfono)', () => {
  const r = apo.apply([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], true, 'HS80');
  assert.equal(r.ok, false);
});

test('hs80: con iCUE aperto non manda niente alle cuffie', async () => {
  const sent = [];
  const h = new hs80.Hs80({ devicesAsync: async () => { sent.push('enum'); return []; } }, () => {});
  await h.setBlocked(true);
  assert.deepEqual(await h.ask(Buffer.alloc(64)), { blocked: true });
  assert.deepEqual(await h.status(), { connected: true, managed: 'iCUE', name: 'Corsair HS80 RGB Wireless' });
  assert.equal((await h.startLighting({}, {})).ok, false);
  assert.deepEqual(sent, []);
});

test('hs80: motore effetti', () => {
  const base = { color: '#ff0000', color2: '#0000ff', speed: 3, brightness: 100, status: 'off', mic: 'off' };
  assert.deepEqual(hs80.computeFrame({ ...base, effect: 'static' }, 0, 50, false).slice(0, 9), [255, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(hs80.computeFrame({ ...base, effect: 'breathing' }, 0, 50, false)[0], 0); // inizio del respiro = spento
  assert.equal(hs80.computeFrame({ ...base, effect: 'breathing' }, 1.5, 50, false)[0], 255); // metà periodo (3 s) = pieno
  assert.deepEqual(hs80.computeFrame({ ...base, effect: 'colorshift' }, 1.5, 50, false), [0, 0, 0, 0, 0, 0, 255, 0, 0]);
  assert.equal(hs80.computeFrame({ ...base, effect: 'static', brightness: 50 }, 0, 50, false)[0], 128);
  assert.deepEqual(hs80.computeFrame({ ...base, effect: 'off', status: 'battery', mic: 'mute' }, 0, 10, true), [0, 255, 255, 0, 0, 0, 0, 0, 0]);
});

test('hs80: notifiche', () => {
  assert.deepEqual(hs80.parseEvent(Buffer.from([0x03, 0x01, 0x02, 0x01])), { type: 'wheel', pressed: true });
  assert.deepEqual(hs80.parseEvent(Buffer.from([0x03, 0x01, 0x01, 0x0f, 0x00, 0x2a, 0x03])), { type: 'prop', prop: 0x0f, value: 0x032a });
  assert.equal(hs80.parseEvent(Buffer.from([0x01, 0x01, 0x02, 0x00, 0x76, 0x02])), null);
  assert.equal(hs80.parseEvent(Buffer.from([0x0e, 0x01])), null);
});

test('razer: rotella reattiva e respiro a due colori come OpenRazer', () => {
  assert.equal(hex(razer.req.scrollReactive(2, { r: 1, g: 2, b: 3 }), 17), '00 1f 00 00 00 09 0f 02 01 01 05 00 02 01 01 02 03');
  assert.equal(hex(razer.req.scrollBreathingDual({ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }), 20), '00 1f 00 00 00 0c 0f 02 01 01 02 02 00 02 01 02 03 04 05 06');
  assert.equal(hex(razer.req.scrollBreathingRandom(), 11), '00 1f 00 00 00 06 0f 02 01 01 02');
});

test('aula schermo: header, RGB565 e blocchi da 4096', () => {
  const px = new Uint8Array(128 * 128 * 2).fill(0xab);
  const st = aula.screenStream([{ rgb565: px, delay: 100 }, { rgb565: px, delay: 10 }]);
  assert.equal(st.length % 4096, 0);
  assert.equal(st.length, Math.ceil((256 + 2 * 32768) / 4096) * 4096);
  assert.equal(st[0], 2);
  assert.equal(st[1], 50); // 100 ms / 2
  assert.equal(st[2], 15); // minimo 30 ms
  assert.equal(st[256], 0xab);
  assert.equal(hex(aula.wired.screenBegin(1, 17)[1].data, 10), '04 72 01 00 00 00 00 00 11 00');
});

const phone = require('../src/phone/scrcpy');
test('telefono: lettura di adb devices -l', () => {
  const out = 'List of devices attached\nR5CT1234ABC            device usb:1-1 product:dm2qxeea model:SM_S916B device:dm2q transport_id:3\n192.168.1.42:5555      device product:dm2qxeea model:SM_S916B device:dm2q transport_id:4\nZY22ABC   unauthorized usb:1-2 transport_id:5\n\n';
  const d = phone.parseDevices(out);
  assert.equal(d.length, 3);
  assert.deepEqual(d[0], { serial: 'R5CT1234ABC', state: 'device', model: 'SM S916B', wifi: false });
  assert.equal(d[1].wifi, true);
  assert.equal(d[2].state, 'unauthorized');
});
test('telefono: IP del Wi-Fi da ip route', () => {
  assert.equal(phone.parseIp('192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.42\n'), '192.168.1.42');
  assert.equal(phone.parseIp('10.0.0.0/8 dev rmnet0 src 100.64.3.2\n192.168.0.0/24 dev wlan0 src 192.168.0.7'), '192.168.0.7');
  assert.equal(phone.parseIp(''), null);
});
test('telefono: argomenti di scrcpy', () => {
  const a = phone.buildArgs('R5CT', { maxSize: 1920, bitrate: 8, maxFps: 60, audio: false, control: true, turnScreenOff: true, stayAwake: true, realKeyboard: true, alwaysOnTop: true }, 'Unico · S23', null);
  assert.deepEqual(a, ['--serial=R5CT', '--window-title=Unico · S23', '--max-size=1920', '--video-bit-rate=8M', '--max-fps=60', '--no-audio', '--turn-screen-off', '--stay-awake', '--keyboard=uhid', '--always-on-top']);
  const b = phone.buildArgs('X', { control: false, turnScreenOff: true, record: true }, 'T', 'C:\\\\Users\\\\utente\\\\Videos');
  assert.ok(b.includes('--no-control'));
  assert.ok(!b.includes('--turn-screen-off'));
  assert.ok(b.some((x) => /^--record=.*Telefono-.*\.mp4$/.test(x)));
});
test('telefono: errori comprensibili', () => {
  assert.match(phone.friendlyError('ERROR: Device is unauthorized'), /Consenti debug USB/);
  assert.equal(phone.friendlyError('INFO: x\nERROR: Could not open video stream'), 'Could not open video stream');
});

const sysm = require('../src/system');
const prof = require('../src/system/profiles');
test('sistema: lettura di reg query', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    Discord    REG_SZ    "C:\\Users\\utente\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe\r\n    Esempio    REG_SZ    C:\\Users\\utente\\Downloads\\Esempio.exe\r\n    Vuoto    REG_SZ\r\n\r\n';
  const r = sysm.parseReg(out);
  assert.equal(r.length, 3);
  assert.equal(r[1].name, 'Esempio');
  assert.equal(r[1].value, 'C:\\Users\\utente\\Downloads\\Esempio.exe');
  assert.equal(r[2].value, '');
});
test('sistema: stato StartupApproved', () => {
  assert.equal(sysm.approvedOn('020000000000000000000000'), true);
  assert.equal(sysm.approvedOn('030000000000000000000000'), false);
  assert.equal(sysm.approvedOn('0600000080B1A2C3D4E5F6A7'), true);
  assert.equal(sysm.approvedOn('07000000'), false);
  assert.equal(sysm.approvedOn(undefined), true);
});
test('sistema: ping in italiano e in inglese', () => {
  const it = 'Esecuzione di Ping 1.1.1.1 con 32 byte di dati:\nRisposta da 1.1.1.1: byte=32 durata=14ms TTL=57\nRisposta da 1.1.1.1: byte=32 durata=12ms TTL=57\nRisposta da 1.1.1.1: byte=32 durata<1ms TTL=57\nRichiesta scaduta.\n\nStatistiche Ping per 1.1.1.1:\n    Pacchetti: Trasmessi = 4, Ricevuti = 3, Persi = 1 (25% persi),\nTempo approssimativo percorsi andata/ritorno in millisecondi:\n    Minimo = 1ms, Massimo =  14ms, Medio =  9ms\n';
  const p = sysm.parsePing(it);
  assert.deepEqual(p.times, [14, 12, 1]);
  assert.equal(p.replies, 3);
  assert.equal(p.avg, 9);
  const en = sysm.parsePing('Reply from 8.8.8.8: bytes=32 time=20ms TTL=117\nReply from 8.8.8.8: bytes=32 time=22ms TTL=117\n    Minimum = 20ms, Maximum = 22ms, Average = 21ms');
  assert.deepEqual(en.times, [20, 22]);
});
test('sistema: diagnosi rete', () => {
  assert.match(sysm.diagnoseNet([{ avg: 45, loss: 0 }, { avg: 60, loss: 0 }, { avg: 80 }]), /router/);
  assert.match(sysm.diagnoseNet([{ avg: 3, loss: 0 }, { avg: 120, loss: 0 }, { avg: 140 }]), /provider/);
  assert.match(sysm.diagnoseNet([{ avg: 3, loss: 0 }, { avg: 15, loss: 0 }, { avg: 30 }]), /Tutto a posto/);
  assert.match(sysm.diagnoseNet([{ avg: null }]), /non risponde/);
});
test('sistema: riga di nvidia-smi', () => {
  const g = sysm.parseGpuLine('NVIDIA GeForce RTX 4050 Laptop GPU, 37, 61, 1234, 6141, 24.56, 1755, [N/A]');
  assert.deepEqual(g, { name: 'NVIDIA GeForce RTX 4050 Laptop GPU', util: 37, temp: 61, memUsed: 1234, memTotal: 6141, power: 24.56, clock: 1755, fan: null });
  assert.equal(sysm.parseGpuLine('errore'), null);
});
test('sistema: processi protetti', () => {
  assert.equal(sysm.isProtected('csrss'), true);
  assert.equal(sysm.isProtected('SVCHOST'), true);
  assert.equal(sysm.isProtected('Discord'), false);
});
test('profili: rilevamento giochi', () => {
  assert.equal(prof.detectGame(['explorer', 'League of Legends', 'Discord'], prof.DEFAULT_AUTO.games), 'League of Legends');
  assert.equal(prof.detectGame(['javaw.exe'], ['javaw']), 'javaw');
  assert.equal(prof.detectGame(['chrome'], prof.DEFAULT_AUTO.games), null);
});
test('profili: applicazione con errori parziali', async () => {
  const calls = [];
  const deps = {
    power: async (m) => { calls.push(['power', m]); return { ok: true }; },
    mouseDpi: async () => { calls.push(['dpi']); return { ok: false, error: 'mouse in standby' }; },
    eq: async (n) => { calls.push(['eq', n]); return { ok: true }; },
    keyboard: async (k) => { calls.push(['kb', k]); return { ok: true }; },
    headset: async () => { throw new Error('non usato'); },
    closeApps: async (a) => { calls.push(['close', a]); return { closed: 1 }; },
    overlay: async (o) => { calls.push(['overlay', o]); return { ok: true }; },
  };
  const r = await prof.applyProfile({ power: 'best', dpi: 1600, eqPreset: 'FPS (passi)', kbMode: null, kbBrightness: 5, headsetLight: null, closeApps: ['Discord'], overlay: true }, deps);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['mouse: mouse in standby']);
  assert.deepEqual(calls.map((c) => c[0]), ['power', 'dpi', 'eq', 'kb', 'close', 'overlay']);
  assert.deepEqual(calls[3][1], { mode: null, brightness: 5 });
});
test('helper PowerShell: ogni comando ha la sua funzione', () => {
  const rd = (f) => require('fs').readFileSync(require('path').join(__dirname, '../src/system', f), 'utf8');
  const ps = rd('helper.ps1');
  const all = ps + rd('audio.ps1');
  const cmds = [...ps.matchAll(/^\s+'(\w+)' \{ (\S+)/gm)].map((m) => [m[1], m[2]]);
  assert.ok(cmds.length >= 15);
  for (const [, fn] of cmds) {
    if (/^(Get|Stop|Close|Clear|Set|Send|Invoke)-/.test(fn) && !/^Clear-RecycleBin/.test(fn)) assert.match(all, new RegExp(`function ${fn}\\b`), `manca la funzione ${fn}`);
  }
  // parentesi bilanciate
  const count = (c) => (ps.match(new RegExp(`\\${c}`, 'g')) || []).length;
  assert.equal(count('{'), count('}'));
  assert.equal(count('('), count(')'));
});
