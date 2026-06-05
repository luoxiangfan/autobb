import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

let changed = 0;
for (const file of walk('src')) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('outline-solid')) continue;
  fs.writeFileSync(file, src.replaceAll('outline-solid', 'outline'));
  changed++;
}

console.log(`Fixed outline variant names in ${changed} files`);
