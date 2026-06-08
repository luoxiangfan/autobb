import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const TARGET_FILES = [
  'src/lib/ad-creative-generator.ts',
  'src/lib/audit-logger.ts',
  'src/lib/brand-services-extractor.ts',
  'src/lib/currency.ts',
  'src/lib/google-ads-accounts.ts',
  'src/lib/keywords.ts',
  'src/lib/language-country-codes.ts',
  'src/lib/offer-extraction-performance.ts',
  'src/lib/offer-utils.ts',
  'src/lib/product-score-cache.ts',
  'src/lib/proxy-axios.ts',
  'src/lib/proxy/proxy-pool.ts',
  'src/lib/proxy/user-isolated-proxy-pool.ts',
  'src/lib/rate-limiter.ts',
  'src/lib/redis.ts',
  'src/lib/search-term-auto-negatives.ts',
  'src/lib/smart-wait-strategy.ts',
  'src/lib/url-swap/notifications.ts',
]

function refs(symbol) {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return execSync(`rg -n "\\b${esc}\\b" src scripts --glob "!**/*.test.*"`, {
      encoding: 'utf8',
      cwd: root,
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.replace(/\\/g, '/'))
  } catch {
    return []
  }
}

const plan = { delete: [], unexport: [] }

for (const file of TARGET_FILES) {
  const text = readFileSync(join(root, file), 'utf8')
  const exportRe =
    /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)|export\s+class\s+(\w+)|export\s+enum\s+(\w+)/g
  let m
  while ((m = exportRe.exec(text))) {
    const symbol = m[1] || m[2] || m[3] || m[4]
    const lines = refs(symbol)
    const norm = file.replace(/\\/g, '/')
    const self = lines.filter((l) => l.startsWith(norm + ':'))
    const other = lines.filter((l) => !l.startsWith(norm + ':'))
    if (other.length === 0 && self.length <= 1) {
      plan.delete.push({ file, symbol })
    } else if (other.length === 0 && self.length > 1) {
      plan.unexport.push({ file, symbol })
    }
  }
}

writeFileSync(join(root, 'cleanup-plan.json'), JSON.stringify(plan, null, 2))
console.log(`delete: ${plan.delete.length}, unexport: ${plan.unexport.length}`)
for (const x of plan.delete) console.log(`DEL ${x.file}: ${x.symbol}`)
for (const x of plan.unexport) console.log(`UNX ${x.file}: ${x.symbol}`)
