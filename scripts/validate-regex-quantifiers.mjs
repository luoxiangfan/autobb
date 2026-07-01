/**
 * Scan source files for corrupted regex quantifiers (`{N }`).
 * Exit code 1 when any are found.
 */
import fs from 'fs'
import path from 'path'
import { findBrokenRegexQuantifiers } from './lib/regex-quantifier-guard.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const TARGET_DIRS = [path.join(ROOT, 'src')]
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (
        ['node_modules', 'dist', '.next', 'openclaw', 'openclaw-v1', 'openclaw-prebuilt', '__tests__'].includes(
          ent.name
        )
      ) {
        continue
      }
      walk(abs, out)
    } else if (EXT.has(path.extname(ent.name))) {
      out.push(abs)
    }
  }
  return out
}

const offenders = []
for (const dir of TARGET_DIRS) {
  for (const file of walk(dir)) {
    const content = fs.readFileSync(file, 'utf8')
    const broken = findBrokenRegexQuantifiers(content)
    if (broken.length > 0) {
      offenders.push({
        file: path.relative(ROOT, file),
        samples: [...new Set(broken)].slice(0, 5),
        count: broken.length,
      })
    }
  }
}

if (offenders.length === 0) {
  console.log('validate:regex-quantifiers — OK (no corrupted quantifiers found)')
  process.exit(0)
}

console.error('validate:regex-quantifiers — corrupted regex quantifiers detected:\n')
for (const item of offenders) {
  console.error(`- ${item.file} (${item.count}): ${item.samples.join(', ')}`)
}
process.exit(1)
