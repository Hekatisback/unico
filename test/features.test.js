'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const games = require('../src/system/games');
const { parseNotifications } = require('../src/phone/scrcpy');
const { groupSessions } = require('../src/system');

test('parseVdf legge libraryfolders e appmanifest', () => {
  const v = games.parseVdf(`"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t\t"apps" { "730" "123" }\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}`);
  assert.strictEqual(v.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
  assert.strictEqual(v.libraryfolders['1'].path, 'D:\\SteamLibrary');
  assert.strictEqual(v.libraryfolders['0'].apps['730'], '123');
});

test('steamGames trova i giochi e salta i componenti', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
  const apps = path.join(root, 'steamapps');
  fs.mkdirSync(apps);
  fs.writeFileSync(path.join(apps, 'libraryfolders.vdf'), '"libraryfolders" { }');
  fs.writeFileSync(path.join(apps, 'appmanifest_730.acf'), '"AppState" { "appid" "730" "name" "Counter-Strike 2" "installdir" "Counter-Strike Global Offensive" }');
  fs.writeFileSync(path.join(apps, 'appmanifest_228980.acf'), '"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" }');
  const list = games.steamGames(root);
  assert.deepStrictEqual(list.map((g) => g.name), ['Counter-Strike 2']);
  assert.strictEqual(list[0].launch.url, 'steam://rungameid/730');
});

test('epicGames legge i manifest .item', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-'));
  fs.writeFileSync(path.join(dir, 'a.item'), JSON.stringify({ DisplayName: 'Fortnite', AppName: 'Fortnite', CatalogNamespace: 'fn', CatalogItemId: 'abc', InstallLocation: 'C:\\Fortnite' }));
  fs.writeFileSync(path.join(dir, 'b.item'), JSON.stringify({ DisplayName: 'Plugin', AppName: 'P', AppCategories: ['plugins'] }));
  const list = games.epicGames(dir);
  assert.strictEqual(list.length, 1);
  assert.match(list[0].launch.url, /^com\.epicgames\.launcher:\/\/apps\/fn%3Aabc%3AFortnite\?action=launch/);
});

test('notifiche del telefono: titolo, testo, salta quelle in corso e di sistema', () => {
  const out = `
  NotificationRecord(0x1: pkg=com.whatsapp user=UserHandle{0} id=1 tag=null importance=4 key=0|com.whatsapp|1|null|10123: Notification(channel=x))
      flags=0x18
      when=1730000000000
        android.title=String (Mario Rossi)
        android.text=String (Ciao, ci sei?)
  NotificationRecord(0x2: pkg=com.spotify.music user=UserHandle{0} id=2 key=0|com.spotify.music|2|null|1: Notification())
      flags=0x62
        android.title=String (Canzone)
  NotificationRecord(0x3: pkg=android user=UserHandle{0} key=0|android|3)
        android.title=String (USB)
  NotificationRecord(0x4: pkg=org.telegram.messenger key=0|org.telegram.messenger|5|null|1: Notification())
      flags=0x10
        android.title=SpannableString (Luca)
        android.text=String (Stasera?)
        android.bigText=String (Stasera partita?)`;
  const l = parseNotifications(out);
  assert.deepStrictEqual(l.map((n) => [n.app, n.title, n.text]), [['WhatsApp', 'Mario Rossi', 'Ciao, ci sei?'], ['Telegram', 'Luca', 'Stasera partita?']]);
  assert.strictEqual(l[0].id, '0|com.whatsapp|1|null|10123|Mario Rossi|Ciao, ci sei?');
});

test('groupSessions unisce le sessioni della stessa app', () => {
  const g = groupSessions([
    { pid: 1, name: 'chrome', volume: 100, muted: false, peak: 10 },
    { pid: 2, name: 'Chrome', volume: 100, muted: false, peak: 40 },
    { pid: 0, name: 'x', volume: 50, muted: false, peak: 0, system: true },
  ]);
  assert.strictEqual(g.length, 2);
  assert.deepStrictEqual(g[0].pids, [1, 2]);
  assert.strictEqual(g[0].peak, 40);
  assert.ok(g[1].system);
});

test('copertine Steam: formato nuovo in sottocartella e formato vecchio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steamc-'));
  const lc = path.join(root, 'appcache', 'librarycache');
  fs.mkdirSync(path.join(lc, '730', 'a1b2c3'), { recursive: true });
  fs.writeFileSync(path.join(lc, '730', 'header.jpg'), 'x');
  fs.writeFileSync(path.join(lc, '730', 'a1b2c3', 'library_600x900.jpg'), 'x');
  fs.writeFileSync(path.join(lc, '440_library_600x900.jpg'), 'x');
  assert.strictEqual(games.steamCover(root, '730'), path.join(lc, '730', 'a1b2c3', 'library_600x900.jpg'));
  assert.strictEqual(games.steamCover(root, '440'), path.join(lc, '440_library_600x900.jpg'));
  assert.strictEqual(games.steamCover(root, '999'), null);
});
