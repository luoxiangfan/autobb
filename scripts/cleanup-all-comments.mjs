/**
 * Repository-wide comment cleanup: remove emoji/changelog markers from // and JSDoc comments.
 * Does NOT modify string literals or console.log message text.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  countBrokenRegexQuantifiers,
  maskRegexQuantifiers,
  unmaskRegexQuantifiers,
} from './lib/regex-quantifier-guard.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const TARGET_DIRS = [path.join(ROOT, 'src')]

const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

/** Strip emoji/changelog markers anywhere in comment text */
function cleanCommentText(text) {
  let t = text.trim()

  // Remove all decorative emoji in comments
  t = t.replace(
    /[🔥🎯🆕🔧🛡️🌍🎲🔴📋ℹ️🌐♻️⚠️❌🔍🧹🔄✅📦📊🚀⏩🏷️🤖🗑️🔹🔗💡📝🛠️⭐📌🎭💬💓🔓]/g,
    ''
  )

  // Remove parenthetical changelog blocks: (2025-12-29 新增), (🔥 2025-12-29...)
  t = t.replace(/[（(][^）)]*\d{4}-\d{2}-\d{2}[^）)]*[）)]/g, '')
  t = t.replace(/[（(]🔥[^）)]*[）)]/g, '')

  // Remove dated / versioned changelog prefixes anywhere
  t = t.replace(/\d{4}-\d{2}-\d{2}(?:增强|调试|添加|重构|升级|优化|修复|新增)?[：:]\s*/g, '')
  t = t.replace(/\d{4}-\d{2}-\d{2}\s+(?=[\u4e00-\u9fff])/g, '') // changelog date before Chinese text
  t = t.replace(
    /(?:修复|新增|优化|重构|KISS优化|v[\d.]+(?:优化)?)[（(]\d{4}-\d{2}-\d{2}[）)][：:]\s*/g,
    ''
  )
  t = t.replace(
    /(?:修复|新增|优化|KISS优化|v[\d.]+优化|P[0-3](?:-\d)?优化|P[0-3]修复)(?:（[^）]*）|\([^)]*\))?[：:]\s*/g,
    ''
  )
  t = t.replace(/^\d{4}-\d{2}-\d{2}\s+/, '')
  t = t.replace(/^\d{4}-\d{2}-\d{2}(?:新增|修复)?[：:]\s*/, '')
  t = t.replace(/^新增[：:]\s*/, '')
  t = t.replace(/P[0-3](?:-\d)?优化[：:]\s*/gi, '')
  t = t.replace(/P[0-3]修复[：:]\s*/gi, '')

  // Section banners: ========== text ==========
  t = t.replace(/={4,}/g, '')
  t = t.replace(/-{4,}/g, '---')

  // Trailing/leading punctuation debris after emoji removal
  t = t.replace(/\s{2,}/g, ' ')
  t = t.replace(/^[-–—:：\s]+/, '')
  t = t.replace(/[-–—:：\s]+$/, '')

  return t.trim()
}

const PHRASE_REPLACEMENTS = [
  [/修复（\d{4}-\d{2}-\d{2}）/, ''],
  [/（\d{4}-\d{2}-\d{2}）/, ''],
  [/UPDATED:\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/, ''],
  [/===== P[0-3]优化:\s*(.+?)\s*=====/, '$1'],
  [/需求10[，,]\s*/, ''],
  [/KISS优化[（(][^）)]*[）)][：:]\s*/, ''],
]

function applyPhraseReplacements(text) {
  let t = text
  for (const [from, to] of PHRASE_REPLACEMENTS) {
    t = t.replace(from, to)
  }
  return t.replace(/\s{2,}/g, ' ').trim()
}

function processCommentBody(body) {
  const { masked, tokens } = maskRegexQuantifiers(body)
  let t = cleanCommentText(masked)
  t = applyPhraseReplacements(t)
  t = unmaskRegexQuantifiers(t, tokens)
  return t
}

function canStartRegexLiteral(line, index) {
  if (index === 0) return true
  const prev = line[index - 1]
  return /[\s(,=:[!&|?{;]/.test(prev)
}

/** Split line into code + trailing comment (last ` //` segment, not inside strings/regex) */
export function splitTrailingComment(line) {
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let inRegex = false
  let escape = false
  let lastCommentIdx = -1

  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i]
    const next = line[i + 1]

    if (inRegex) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '/') {
        let j = i + 1
        while (j < line.length && /[gimsuy]/.test(line[j])) j++
        inRegex = false
        i = j - 1
      }
      continue
    }

    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && (inSingle || inDouble)) {
      escape = true
      continue
    }
    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle
      continue
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble
      continue
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate
      continue
    }
    if (!inSingle && !inDouble && !inTemplate && ch === '/') {
      if (next === '/') {
        if (i === 0 || /\s/.test(line[i - 1])) {
          lastCommentIdx = i
        }
        continue
      }
      if (canStartRegexLiteral(line, i)) {
        inRegex = true
      }
      continue
    }
  }

  if (lastCommentIdx < 0) return null
  return {
    code: line.slice(0, lastCommentIdx).trimEnd(),
    comment: line.slice(lastCommentIdx + 2),
  }
}

export function processLine(line) {
  const trimmed = line.trimStart()

  // JSX block comment {/* ... */}
  const jsxComment = line.match(/^(\s*\{\/\*)\s*(.*?)\s*(\*\/\}\s*)$/)
  if (jsxComment) {
    const cleaned = processCommentBody(jsxComment[2])
    if (!cleaned) return `${jsxComment[1]} */}`
    return `${jsxComment[1]} ${cleaned} ${jsxComment[3]}`
  }

  // Full-line // comment
  const full = line.match(/^(\s*)\/\/(.*)$/)
  if (full) {
    const cleaned = processCommentBody(full[2])
    if (!cleaned) return ''
    return `${full[1]}// ${cleaned}`
  }

  // Block comment line /* ... */ on single line
  const blockSingle = line.match(/^(\s*)\/\*\s*(.*?)\s*\*\/\s*$/)
  if (blockSingle && !blockSingle[2].includes('@')) {
    const cleaned = processCommentBody(blockSingle[2])
    if (!cleaned) return blockSingle[1]
    return `${blockSingle[1]}/* ${cleaned} */`
  }

  // JSDoc
  if (trimmed.startsWith('*') && !trimmed.startsWith('*/') && !trimmed.startsWith('/**')) {
    const m = line.match(/^(\s*\*)\s?(.*)$/)
    if (m) {
      const cleaned = processCommentBody(m[2])
      if (!cleaned) return m[1]
      return `${m[1]} ${cleaned}`
    }
  }

  const jsdocOpen = line.match(/^(\s*\/\*\*)\s?(.*)$/)
  if (jsdocOpen && !jsdocOpen[2].includes('@')) {
    const cleaned = processCommentBody(jsdocOpen[2])
    if (!cleaned) return jsdocOpen[1]
    return `${jsdocOpen[1]} ${cleaned}`
  }

  // Inline trailing comment
  const split = splitTrailingComment(line)
  if (split) {
    const cleaned = processCommentBody(split.comment)
    if (!cleaned) return split.code
    return `${split.code} // ${cleaned}`
  }

  return line
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', '.next', 'openclaw', 'openclaw-v1', 'openclaw-prebuilt'].includes(ent.name))
        continue
      walk(p, out)
    } else if (EXT.has(path.extname(ent.name))) {
      out.push(p)
    }
  }
  return out
}

function processFile(absPath) {
  const original = fs.readFileSync(absPath, 'utf8')
  let content = original

  // Ensure blank line between closing brace and next export/function JSDoc
  content = content.replace(/\}\n\/\*\*/g, '}\n\n/**')
  content = content.replace(/\}\s*\/\/ =+/g, (m) => m.replace('}', '}\n'))

  const lines = content.split('\n')
  const processed = lines.map(processLine)

  // Collapse 3+ blank lines to 2
  const collapsed = []
  let blankRun = 0
  for (const line of processed) {
    if (line === '') {
      blankRun++
      if (blankRun <= 2) collapsed.push(line)
    } else {
      blankRun = 0
      collapsed.push(line)
    }
  }

  const result = collapsed.join('\n')
  if (result !== original) {
    const beforeBroken = countBrokenRegexQuantifiers(original)
    const afterBroken = countBrokenRegexQuantifiers(result)
    if (afterBroken > beforeBroken) {
      console.warn(
        `SKIP ${path.relative(ROOT, absPath)}: would introduce corrupted regex quantifiers (${beforeBroken} -> ${afterBroken})`
      )
      return false
    }
    fs.writeFileSync(absPath, result)
    return true
  }
  return false
}

function main() {
  let changed = 0
  for (const dir of TARGET_DIRS) {
    const files = walk(dir)
    for (const f of files) {
      if (processFile(f)) {
        changed++
        console.log(path.relative(ROOT, f))
      }
    }
  }
  console.log(`\nDone: ${changed} file(s) updated`)
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)

if (invokedDirectly) {
  main()
}
