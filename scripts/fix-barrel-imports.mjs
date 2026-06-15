/**
 * Fix barrel index files (avoid export * conflicts) and repair broken import paths.
 */
import fs from 'node:fs'
import path from 'node:path'

const LIB = path.resolve('src/lib')

/** dir -> modules excluded from barrel (import via @/lib/{dir}/{module}) */
const BARREL_EXCLUDE = {
  ai: ['gemini-axios'],
  campaign: ['naming-convention'],
  common: ['structured-logger', 'exchange-rates-service'],
  creatives: ['review-compressor'],
  keywords: ['google-suggestions', 'keyword-invalid-filter'],
  'launch-score': ['launch-score-cache'],
  scraping: ['proxy-warmup', 'proxy'],
}

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

for (const dirName of DOMAIN_DIRS) {
  const dir = path.join(LIB, dirName)
  if (!fs.existsSync(dir)) continue
  const exclude = new Set(BARREL_EXCLUDE[dirName] ?? [])
  const modules = listTsModules(dir).filter((m) => !exclude.has(m))
  const lines = [
    `// Public barrel for @/lib/${dirName}`,
    ...modules.map((m) => `export * from './${m}'`),
    '',
  ]
  fs.writeFileSync(path.join(dir, 'index.ts'), lines.join('\n'))
  console.log(`${dirName}/index.ts: ${modules.length} modules (${exclude.size} excluded)`)
}

/** Legacy root paths -> barrel paths */
const LEGACY_ALIAS = [
  [/@\/lib\/db-helpers\b/g, '@/lib/db'],
  [/@\/lib\/db-datetime\b/g, '@/lib/db'],
  [/@\/lib\/json-field\b/g, '@/lib/db'],
  [/@\/lib\/ai-token-tracker\b/g, '@/lib/ai'],
  [/@\/lib\/ai-json\b/g, '@/lib/ai'],
  [/@\/lib\/ai-cache\b/g, '@/lib/ai'],
  [/@\/lib\/ai-analysis-service\b/g, '@/lib/ai'],
  [/@\/lib\/prompt-loader\b/g, '@/lib/ai'],
  [/@\/lib\/gemini-models\b/g, '@/lib/ai'],
  [/@\/lib\/gemini-config\b/g, '@/lib/ai'],
  [/@\/lib\/auth-security\b/g, '@/lib/auth'],
  [/@\/lib\/user-sessions\b/g, '@/lib/auth'],
  [/@\/lib\/bcrypt\b/g, '@/lib/auth'],
  [/@\/lib\/settings\b/g, '@/lib/common'],
  [/@\/lib\/feature-flags\b/g, '@/lib/common'],
  [/@\/lib\/config\b/g, '@/lib/common'],
]

const REL_LEGACY = [
  [/from '\.\.\/db-helpers'/g, "from '../db'"],
  [/from "\.\.\/db-helpers"/g, 'from "../db"'],
  [/from '\.\.\/\.\.\/db-helpers'/g, "from '../../db'"],
  [/from "\.\.\/\.\.\/db-helpers"/g, 'from "../../db"'],
  [/from '\.\.\/\.\.\/\.\.\/db-helpers'/g, "from '../../../db'"],
  [/from '\.\.\/db-datetime'/g, "from '../db'"],
  [/from '\.\.\/\.\.\/db-datetime'/g, "from '../../db'"],
  [/from '\.\.\/ai-token-tracker'/g, "from '../ai'"],
  [/from "\.\.\/ai-token-tracker"/g, 'from "../ai"'],
  [/from '\.\.\/\.\.\/ai-token-tracker'/g, "from '../../ai'"],
  [/from '\.\.\/ai-json'/g, "from '../ai'"],
  [/from "\.\.\/ai-json"/g, 'from "../ai"'],
  [/from '\.\.\/\.\.\/ai-json'/g, "from '../../ai'"],
  [/from '\.\.\/ai-cache'/g, "from '../ai'"],
  [/from '\.\.\/\.\.\/ai-cache'/g, "from '../../ai'"],
]

/** App-layer dynamic imports broken by over-shortening */
const SIMPLE_FIXES = [
  [/import\('\.\.\/offers'\)/g, "import('../offers/task-modal-helpers')"],
  [/import\("\.\.\/offers"\)/g, 'import("../offers/task-modal-helpers")'],
  [/await import\('\.\.\/\.\.\/db-helpers'\)/g, "await import('../../db')"],
  [/await import\("\.\.\/\.\.\/db-helpers"\)/g, 'await import("../../db")'],
]

function fixGoogleAdsLoggerPaths(content, filePath) {
  const rel = path.relative(LIB, filePath).replace(/\\/g, '/')
  if (!rel.startsWith('google-ads/')) return content

  const loggerSymbols =
    /googleAdsAccountsLogger|googleAdsSyncLogger|googleAdsKeywordLogger|createGoogleAdsLogger|GoogleAdsLogFields|GoogleAdsLogScope/

  const fixImport = (fromPath, toPath) => {
    const reSingle = new RegExp(`from '${fromPath.replace(/\//g, '\\/')}'`, 'g')
    const reDouble = new RegExp(`from "${fromPath.replace(/\//g, '\\/')}"`, 'g')
    content = content.replace(reSingle, (match) =>
      loggerSymbols.test(content.slice(content.indexOf(match), content.indexOf(match) + 200))
        ? `from '${toPath}'`
        : match
    )
    content = content.replace(reDouble, (match) =>
      loggerSymbols.test(content.slice(content.indexOf(match), content.indexOf(match) + 200))
        ? `from "${toPath}"`
        : match
    )
  }

  // Per-file: rewrite logger-only import lines
  content = content.replace(
    /^import \{([^}]+)\} from '(\.\.\/)+common';$/gm,
    (line, imports, _dots) => {
      if (!loggerSymbols.test(imports)) return line
      const depth = (line.match(/\.\.\//g) || []).length
      const loggerPath = '../'.repeat(Math.max(1, depth - 1)) + 'common/logger'
      return line.replace(/from '[^']+'/, `from '${loggerPath}'`)
    }
  )

  return content
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

function writeFileSafe(file, content) {
  try {
    fs.writeFileSync(file, content)
    return true
  } catch (err) {
    console.warn(`skip write ${file}: ${err.message}`)
    return false
  }
}

let changed = 0
for (const file of walkFiles(path.resolve('.'))) {
  if (file.includes('scripts/add-lib-barrels.mjs') || file.includes('scripts/fix-barrel-imports.mjs'))
    continue
  let content = fs.readFileSync(file, 'utf8')
  const before = content

  for (const [re, rep] of LEGACY_ALIAS) content = content.replace(re, rep)
  for (const [re, rep] of REL_LEGACY) content = content.replace(re, rep)
  for (const [re, rep] of SIMPLE_FIXES) content = content.replace(re, rep)
  content = fixGoogleAdsLoggerPaths(content, file)

  if (content !== before) {
    if (writeFileSafe(file, content)) changed++
  }
}

console.log(`patched legacy imports in ${changed} files`)
