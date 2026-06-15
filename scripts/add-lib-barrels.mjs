/**
 * Add index.ts barrel exports to domain folders under src/lib,
 * then simplify @/lib/{dir}/{module} -> @/lib/{dir} and redundant db/db paths.
 */
import fs from 'node:fs'
import path from 'node:path'

const LIB = path.resolve('src/lib')
const DOMAIN_DIRS = [
  'campaign',
  'offers',
  'keywords',
  'creatives',
  'ai',
  'db',
  'auth',
  'launch-score',
  'optimization',
  'scraping',
  'affiliate',
  'common',
]

function listTsModules(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && e.name !== 'index.ts')
    .map((e) => e.name.replace(/\.ts$/, ''))
    .sort()
}

function writeBarrel(dirName) {
  const dir = path.join(LIB, dirName)
  if (!fs.existsSync(dir)) return
  const modules = listTsModules(dir)
  const lines = [
    `// Public barrel for @/lib/${dirName}`,
    ...modules.map((m) => `export * from './${m}'`),
    '',
  ]
  const indexPath = path.join(dir, 'index.ts')
  fs.writeFileSync(indexPath, lines.join('\n'))
  console.log(`wrote ${dirName}/index.ts (${modules.length} exports)`)
}

for (const dir of DOMAIN_DIRS) {
  writeBarrel(dir)
}

const DOMAIN_PATTERN = DOMAIN_DIRS.join('|')
const aliasRe = new RegExp(`@/lib/(${DOMAIN_PATTERN})/([a-z0-9-]+(?:-[a-z0-9]+)*)`, 'g')
const redundant = [
  ['db/db', 'db'],
  ['auth/auth', 'auth'],
  ['ai/ai', 'ai'],
  ['offers/offers', 'offers'],
]

function simplifyContent(content) {
  let out = content
  for (const [from, to] of redundant) {
    out = out.replaceAll(`@/lib/${from}`, `@/lib/${to}`)
  }
  out = out.replace(aliasRe, '@/lib/$1')
  // relative: ../db -> ../db, ../../db -> ../../db
  out = out.replace(/((?:\.\.\/)+)db\/db/g, '$1db')
  out = out.replace(/((?:\.\.\/)+)offers\/offers/g, '$1offers')
  out = out.replace(/((?:\.\.\/)+)auth\/auth/g, '$1auth')
  out = out.replace(/((?:\.\.\/)+)ai\/ai/g, '$1ai')
  // domain module subpaths -> barrel
  const relRe = new RegExp(
    `(from ['"]|import\\(['"]|vi\\.mock\\(['"]|typeof import\\(['"])((?:\\.\\.\\/)+)(${DOMAIN_PATTERN})/([a-z0-9-]+(?:-[a-z0-9]+)*)(['"])`,
    'g'
  )
  out = out.replace(relRe, (m, pre, dots, dir, mod, q) => `${pre}${dots}${dir}${q}`)
  // dynamic import without from
  out = out.replace(
    new RegExp(`import\\(['"]((?:\\.\\.\\/)+)(${DOMAIN_PATTERN})/([a-z0-9-]+(?:-[a-z0-9]+)*)['"]\\)`, 'g'),
    (m, dots, dir) => `import('${dots}${dir}')`
  )
  return out
}

function walkFiles(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walkFiles(p, acc)
    else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) acc.push(p)
  }
  return acc
}

let changed = 0
for (const file of walkFiles(path.resolve('.'))) {
  if (file.includes('scripts/add-lib-barrels.mjs')) continue
  const before = fs.readFileSync(file, 'utf8')
  const after = simplifyContent(before)
  if (after !== before) {
    fs.writeFileSync(file, after)
    changed++
  }
}
console.log(`simplified imports in ${changed} files`)
