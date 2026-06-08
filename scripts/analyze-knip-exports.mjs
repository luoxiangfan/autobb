import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'knip-out.json'), 'utf8').replace(/^\uFEFF/, '')
const j = JSON.parse(raw)

const skip =
  /google-ads-accounts-auth|google-ads-api\.ts|stealth-scraper\/index|queue\/executors\/index|__tests__\/test-utils/
const rows = []
for (const i of j.issues || []) {
  if (!i.file?.startsWith('src/lib/') || skip.test(i.file)) continue
  for (const s of i.exports || []) rows.push({ file: i.file, symbol: s.name })
}

function refs(symbol) {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return execSync(`rg -l "\\b${esc}\\b" src scripts --glob "!**/*.test.*"`, {
      encoding: 'utf8',
      cwd: root,
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/'))
  } catch {
    return []
  }
}

const dead = []
const internal = []
const external = []

for (const row of rows) {
  const out = refs(row.symbol)
  const normFile = row.file.replace(/\\/g, '/')
  if (out.length === 0) dead.push(row)
  else if (out.length === 1 && out[0] === normFile) internal.push(row)
  else external.push({ ...row, refs: out.filter((f) => f !== normFile) })
}

console.log(JSON.stringify({ dead, internal, external, total: rows.length }, null, 2))
