// Embed our multi-size icon + version info into the Windows exe using resedit (pure JS, no wine needed).
const fs = require('fs'); const path = require('path');
module.exports = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const pkg = require('../package.json');
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const pe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(pe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '../build/icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a,b,c] = pkg.version.split('.').map(Number);
  vi.setFileVersion(a,b,c,0,1033); vi.setProductVersion(a,b,c,0,1033);
  const lng = vi.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
  vi.setStringValues(lng, { ProductName: 'ArchWorkbench', FileDescription: 'ArchWorkbench', CompanyName: 'ArchWorkbench',
    LegalCopyright: 'Copyright © ArchWorkbench', OriginalFilename: 'ArchWorkbench.exe', InternalName: 'ArchWorkbench',
    FileVersion: pkg.version, ProductVersion: pkg.version });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('[afterPack] patched icon+version:', exe);
};
