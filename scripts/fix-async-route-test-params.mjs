import fs from 'node:fs'
import path from 'node:path'

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.name.endsWith('.test.ts') || ent.name.endsWith('.test.tsx')) out.push(p)
  }
  return out
}

let changed = 0
for (const file of walk('src/app')) {
  let src = fs.readFileSync(file, 'utf8')
  const orig = src
  src = src.replace(/\{\s*params:\s*(\{[^{}]+\})\s*\}/g, '{ params: Promise.resolve($1) }')
  if (src !== orig) {
    fs.writeFileSync(file, src)
    changed++
  }
}

console.log(`Updated ${changed} test files`)
