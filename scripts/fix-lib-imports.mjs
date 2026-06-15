/**
 * Fix imports after src/lib reorganization.
 * - Normalizes @/lib/* to canonical paths
 * - Fixes relative imports using filesystem resolution
 * - Fixes ./lib/* paths outside src/lib
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('src/lib')
const SRC = path.resolve('src')

function loadMoveMap() {
  const src = fs.readFileSync(new URL('./reorganize-lib.mjs', import.meta.url), 'utf8')
  const match = src.match(/const MOVE_MAP = (\{[\s\S]*?\n\})\n\n\/\*\* old module/)
  if (!match) throw new Error('MOVE_MAP not found in reorganize-lib.mjs')
  // eslint-disable-next-line no-eval
  return eval(`(${match[1]})`)
}

/** Same map as reorganize-lib.mjs */
const MOVE_MAP = loadMoveMap()

/** old module id (no @/lib/) -> new module id */
const OLD_TO_NEW = new Map()
/** basename without .ts -> new module id */
for (const [basename, targetRel] of Object.entries(MOVE_MAP)) {
  const oldMod = basename.replace(/\.ts$/, '')
  const newMod = targetRel.replace(/\.ts$/, '').replace(/\/index$/, '')
  OLD_TO_NEW.set(oldMod, newMod)
}

/** Modules that moved to dir/index.ts — subpaths @/lib/dir/* stay unchanged */
const INDEX_ONLY = new Set(['click-farm', 'url-swap', 'offer-keyword-pool'])

/** All .ts/.tsx files under src/lib indexed by path without ext relative to src/lib */
function buildFileIndex() {
  /** @type {Map<string, string>} moduleKey -> abs path */
  const index = new Map()

  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(abs)
        continue
      }
      if (!/\.tsx?$/.test(ent.name)) continue
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/')
      const noExt = rel.replace(/\.tsx?$/, '')
      index.set(noExt, abs)
      if (ent.name === 'index.ts' || ent.name === 'index.tsx') {
        const dirKey = path.dirname(rel).replace(/\\/g, '/')
        if (dirKey !== '.') index.set(dirKey, abs)
      }
    }
  }
  walk(ROOT)
  return index
}

const FILE_INDEX = buildFileIndex()

/** Subdirs that share a name with a moved root file — @/lib/dir/* keeps the subdir */
const SUBDIR_PRESERVE = new Set(['proxy', 'offers', 'google-ads', 'openclaw', 'queue'])

function dedupeSegments(modulePath) {
  const parts = modulePath.split('/')
  while (parts.length >= 2 && parts[0] === parts[1]) {
    parts.splice(1, 1)
  }
  return parts.join('/')
}

function canonicalAlias(spec) {
  if (!spec.startsWith('@/lib/')) return spec
  let rest = dedupeSegments(spec.slice('@/lib/'.length))

  // Fix mistaken scraping/proxy/* -> proxy/*
  if (rest.startsWith('scraping/proxy/')) {
    const sub = rest.slice('scraping/proxy/'.length)
    if (FILE_INDEX.has(`proxy/${sub}`)) return `@/lib/proxy/${sub}`
  }

  // Fix mistaken offers/offers/* -> offers/* (except offers/offers module itself)
  if (rest.startsWith('offers/offers/')) {
    const sub = rest.slice('offers/offers/'.length)
    if (FILE_INDEX.has(`offers/${sub}`)) return `@/lib/offers/${sub}`
  }

  if (FILE_INDEX.has(rest)) return `@/lib/${rest}`

  for (const dir of INDEX_ONLY) {
    if (rest === dir || rest.startsWith(`${dir}/`)) return `@/lib/${rest}`
  }

  for (const dir of SUBDIR_PRESERVE) {
    if (rest.startsWith(`${dir}/`)) return `@/lib/${rest}`
  }

  if (OLD_TO_NEW.has(rest)) return `@/lib/${OLD_TO_NEW.get(rest)}`

  const base = rest.includes('/') ? (rest.split('/').pop() ?? rest) : rest
  if (base && OLD_TO_NEW.has(base)) {
    const newMod = OLD_TO_NEW.get(base)
    // Don't remap subdir paths: proxy/foo, offers/bar
    const first = rest.split('/')[0]
    if (SUBDIR_PRESERVE.has(first) && rest.includes('/')) return `@/lib/${rest}`
    return `@/lib/${newMod}`
  }

  return `@/lib/${rest}`
}

function resolveTsAbs(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const fromDir = path.dirname(fromFile)
  let resolved = path.normalize(path.join(fromDir, spec))
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    path.join(resolved, 'index.ts'),
    path.join(resolved, 'index.tsx'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }

  const baseName = path.basename(spec)
  const mapped = MOVE_MAP[`${baseName}.ts`]
  if (mapped) {
    const abs = path.join(ROOT, mapped)
    if (fs.existsSync(abs)) return abs
  }

  const fromRel = path.relative(ROOT, fromFile).replace(/\\/g, '/')
  const fromPkg = path.dirname(fromRel)

  const singleUp = spec.match(/^\.\.\/([^/]+)$/)
  if (singleUp) {
    const name = singleUp[1]
    if (MOVE_MAP[`${name}.ts`]) {
      const abs = path.join(ROOT, MOVE_MAP[`${name}.ts`])
      if (fs.existsSync(abs)) return abs
    }
    if (fromPkg !== '.' && FILE_INDEX.has(`${fromPkg}/${name}`)) {
      return FILE_INDEX.get(`${fromPkg}/${name}`)
    }
  }

  return null
}

function toImportPath(fromFile, targetAbs) {
  let rel = path.relative(path.dirname(fromFile), targetAbs).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel.replace(/\.tsx?$/, '')
}

function fixRelative(content, filePath) {
  const replace = (spec) => {
    if (!spec.startsWith('.')) return spec
    const targetAbs = resolveTsAbs(filePath, spec)
    if (!targetAbs) return spec
    return toImportPath(filePath, targetAbs)
  }

  return content
    .replace(/(from\s+['"])(\.\.?[^'"]+)(['"])/g, (m, a, spec, c) => `${a}${replace(spec)}${c}`)
    .replace(/(import\s*\(\s*['"])(\.\.?[^'"]+)(['"]\s*\))/g, (m, a, spec, c) => `${a}${replace(spec)}${c}`)
    .replace(/(vi\.mock\s*\(\s*['"])(\.\.?[^'"]+)(['"])/g, (m, a, spec, c) => `${a}${replace(spec)}${c}`)
    .replace(
      /(typeof\s+import\s*\(\s*['"])(\.\.?[^'"]+)(['"]\s*\))/g,
      (m, a, spec, c) => `${a}${replace(spec)}${c}`
    )
}

function fixLibRelativeOutsideAlias(content) {
  return content
    .replace(/(from\s+['"])(\.\/lib\/([^'"]+))(['"])/g, (m, a, spec, rest, c) => {
      const aliased = canonicalAlias(`@/lib/${rest}`)
      const newRest = aliased.slice('@/lib/'.length)
      return `${a}./lib/${newRest}${c}`
    })
    .replace(/(import\s*\(\s*['"])(\.\/lib\/([^'"]+))(['"]\s*\))/g, (m, a, spec, rest, c) => {
      const aliased = canonicalAlias(`@/lib/${rest}`)
      const newRest = aliased.slice('@/lib/'.length)
      return `${a}./lib/${newRest}${c}`
    })
}

function fixCommonRelativeDbOffers(content) {
  content = content.replace(/(from ['"])((?:\.\.\/)+db)(['"])/g, (m, pre, p, q) => {
    if (p.endsWith('/db/db') || p === '../db' || p.match(/\/db\/db$/)) return m
    return `${pre}${p}/db${q}`
  })
  content = content.replace(/(from ['"])((?:\.\.\/)+offers)(['"])/g, (m, pre, p, q) => {
    if (p.endsWith('/offers/offers') || p.match(/\/offers\/offers$/)) return m
    return `${pre}${p}/offers${q}`
  })
  return content
}

function fixKnownBrokenImports(content, filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/')
  if (rel === 'ai/ai-analysis-service.ts') {
    content = content.replace(/from '\.\/'/g, "from '../src/lib/ai/ai'")
  }
  if (rel === 'db/db-init.ts') {
    content = content.replace(/from '\.\/'/g, "from '../src/lib/db/db'")
  }
  if (rel === 'click-farm/index.ts') {
    content = content
      .replace(/from '\.\.\/scheduler'/g, "from './scheduler'")
      .replace(/from '\.\.\/distribution'/g, "from './distribution'")
      .replace(/from '\.\.\/queue-cleanup'/g, "from './queue-cleanup'")
  }
  return content
}

function fixAliasInContent(content) {
  return content.replace(/(@\/lib\/[^'"\s)]+)/g, (match) => canonicalAlias(match))
}

function walkRepoFiles() {
  /** @type {string[]} */
  const files = []
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) files.push(p)
    }
  }
  walk(path.resolve('.'))
  return files.filter((f) => !f.includes('scripts/fix-lib-imports.mjs'))
}

let changed = 0
for (const file of walkRepoFiles()) {
  let content = fs.readFileSync(file, 'utf8')
  const before = content
  content = fixAliasInContent(content)
  content = fixLibRelativeOutsideAlias(content)
  content = fixCommonRelativeDbOffers(content)
  content = fixRelative(content, file)
  content = fixKnownBrokenImports(content, file)
  if (content !== before) {
    fs.writeFileSync(file, content)
    changed++
  }
}
console.log(`Fixed imports in ${changed} files`)
