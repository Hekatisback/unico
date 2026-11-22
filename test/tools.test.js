'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('script di rilevamento: parentesi bilanciate e solo letture', () => {
  const ps = fs.readFileSync(path.join(__dirname, '../tools/rileva-periferiche.ps1'), 'utf8');
  for (const [a, b] of [['{', '}'], ['(', ')'], ['[', ']']]) assert.strictEqual(ps.split(a).length, ps.split(b).length, `${a}${b}`);
  // niente comandi che cambiano il sistema
  assert.doesNotMatch(ps, /\b(Set-ItemProperty|Remove-Item|New-ItemProperty|Disable-PnpDevice|Enable-PnpDevice|Stop-Process|Set-Content)\b/);
  const js = fs.readFileSync(path.join(__dirname, '../tools/rileva-hid.js'), 'utf8');
  assert.doesNotMatch(js, /\.write\(|sendFeatureReport|new HID\.HID/);
});
