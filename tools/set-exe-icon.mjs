// Imposta icona e nome prodotto su dist/win-unpacked/Unico.exe senza Wine.
import fs from 'node:fs';
import * as PE from 'pe-library';
import * as ResEdit from 'resedit';

const exePath = process.argv[2];
const icoPath = process.argv[3];
const exe = PE.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PE.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const groupId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  const langs = vi.getAllLanguagesForStringValues();
  for (const l of langs) {
    vi.setStringValues(l, { ProductName: 'Unico', FileDescription: 'Unico - periferiche', CompanyName: 'Hekat', OriginalFilename: 'Unico.exe', InternalName: 'Unico' });
  }
  vi.setFileVersion(2, 0, 0, 0);
  vi.setProductVersion(2, 0, 0, 0);
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('icona impostata su', exePath);
