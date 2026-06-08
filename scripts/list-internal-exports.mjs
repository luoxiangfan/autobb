import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const j = JSON.parse(readFileSync(join(root, 'knip-classified.json'), 'utf8'))

const byFile = new Map()
for (const { file, symbol } of j.internal) {
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(symbol)
}

const sorted = [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))
console.log(`internal-only exports: ${j.internal.length} across ${sorted.length} files`)
for (const [file, symbols] of sorted) {
  console.log(`${file} (${symbols.length}): ${symbols.join(', ')}`)
}

writeFileSync(
  join(root, 'knip-internal-by-file.json'),
  JSON.stringify(Object.fromEntries(sorted), null, 2)
)
