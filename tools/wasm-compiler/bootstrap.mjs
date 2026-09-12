// Optional compiler bootstrap for hosts where pnpm's fetch transport fails.
// Packages are pinned, integrity-checked and extracted only under this tool.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const [name, version] of [['assemblyscript','0.28.9'],['long','5.3.2'],['binaryen','123.0.0-nightly.20250530']]) {
  const meta = await (await fetch(`https://registry.npmjs.org/${name}/${version}`)).json();
  const bytes = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== meta.dist.integrity) throw new Error(`Integrity mismatch: ${name}`);
  const archive = new URL(`${name}.tgz`, import.meta.url);
  const target = new URL(`node_modules/${name}/`, import.meta.url);
  mkdirSync(target, {recursive:true}); writeFileSync(archive, bytes);
  const entries = execFileSync('tar.exe',['-tzf',fileURLToPath(archive)],{encoding:'utf8'}).trim().split(/\r?\n/);
  if(entries.some(p=>!p.startsWith('package/') || p.split('/').includes('..'))) throw new Error('Unexpected archive path');
  execFileSync('tar.exe',['-xzf',fileURLToPath(archive),'-C',fileURLToPath(target),'--strip-components=1']);
  console.log(`Installed ${name}@${version}, verified ${bytes.length} bytes`);
}
