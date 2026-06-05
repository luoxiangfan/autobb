/**
 * One-off codemod: add zErr to all Zod constraint calls missing { error: ... }.
 * Run: node scripts/migrate-zod-errors.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

function chainBeforeMinMax(line, endIndex) {
  return line.slice(0, endIndex)
}

function isArrayChain(before) {
  const idx = before.lastIndexOf('z.array(')
  if (idx === -1) return false
  const after = before.slice(idx)
  let depth = 0
  for (const ch of after) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (depth === 0) return before.endsWith(after.slice(0, after.indexOf(')', 7) + 1))
  }
  return /z\.array\([\s\S]+\)\s*$/.test(before)
}

function inferMinError(before, n) {
  const num = Number(n)
  if (isArrayChain(before)) return `zErr.minItems(${n})`
  const tail = before.slice(-80)
  if (/z\.number\(\)|z\.coerce\.number\(\)|\.int\(zErr\.int\)|\.int\(zErr\.int\)/.test(tail)) {
    return `zErr.minNumber(${n})`
  }
  if (/z\.string\(\)|z\.coerce\.string\(\)/.test(tail)) {
    if (num === 1) return 'zErr.required'
    return `zErr.minChars(${n})`
  }
  if (/z\.number\(\)|z\.coerce\.number\(\)/.test(before)) return `zErr.minNumber(${n})`
  if (/z\.string\(\)|z\.coerce\.string\(\)/.test(before)) {
    if (num === 1) return 'zErr.required'
    return `zErr.minChars(${n})`
  }
  return `zErr.minNumber(${n})`
}

function inferMaxError(before, n) {
  if (isArrayChain(before)) return `zErr.maxItems(${n})`
  const tail = before.slice(-80)
  if (/z\.string\(\)|z\.coerce\.string\(\)/.test(tail)) return `zErr.maxChars(${n})`
  if (/z\.number\(\)|z\.coerce\.number\(\)|\.int\(/.test(tail)) return `zErr.maxNumber(${n})`
  if (/z\.string\(\)|z\.coerce\.string\(\)/.test(before)) return `zErr.maxChars(${n})`
  if (/z\.number\(\)|z\.coerce\.number\(\)/.test(before)) return `zErr.maxNumber(${n})`
  return `zErr.maxNumber(${n})`
}

function hasZErrSecondArg(s, startIndex) {
  const rest = s.slice(startIndex)
  return /^\s*,\s*zErr\./.test(rest)
}

function transformLine(line) {
  if (!line.includes('z.') && !line.includes('.min(') && !line.includes('.max(')) return line

  let s = line

  // Already migrated inline objects -> zErr constants (login, offer-update)
  s = s.replace(/\{ error: '用户名不能为空' \}/g, 'zErr.usernameRequired')
  s = s.replace(/\{ error: '密码不能为空' \}/g, 'zErr.passwordRequired')
  s = s.replace(/\{ error: '品牌名称不能为空' \}/g, 'zErr.brandRequired')
  s = s.replace(/\{ error: '目标国家代码至少2个字符' \}/g, 'zErr.targetCountryMin')
  s = s.replace(/\{ error: '无效的URL格式' \}/g, 'zErr.invalidUrl')
  s = s.replace(/\{ error: '无效的联盟链接格式' \}/g, 'zErr.invalidAffiliateUrl')

  // int().positive()
  s = s.replace(/\.int\(\)\.positive\(\)/g, '.int(zErr.int).positive(zErr.positiveInt)')

  // bare .int() — including before .optional / .nullable / .default
  s = s.replace(/\.int\(\)(?=\.|\)|,|\s|$)/g, '.int(zErr.int)')

  // bare .positive()
  s = s.replace(/\.positive\(\)/g, '.positive(zErr.positiveInt)')

  // .regex(...) without second arg (skip if zErr already present)
  s = s.replace(/\.regex\((\/[^/]+\/[^)]*)\)(?!\s*,\s*zErr)/g, '.regex($1, zErr.dateYmd)')

  // z.url() without args
  s = s.replace(/\bz\.url\(\)/g, 'z.url(zErr.invalidUrl)')

  // country code min(2).max(8) on strings - special case after generic min replace
  s = s.replace(
    /\.min\(2, zErr\.minChars\(2\)\)\.max\(8, zErr\.maxChars\(8\)\)/g,
    '.min(2, zErr.targetCountryMin).max(8, zErr.countryCode)'
  )

  // .min(n) / .max(n) without zErr second arg (allow trailing comma/paren)
  s = s.replace(/\.min\((\d+)\)/g, (match, n, offset) => {
    if (hasZErrSecondArg(s, offset + match.length)) return match
    const before = chainBeforeMinMax(s, offset)
    return `.min(${n}, ${inferMinError(before, n)})`
  })
  s = s.replace(/\.max\((\d+)\)/g, (match, n, offset) => {
    if (hasZErrSecondArg(s, offset + match.length)) return match
    const before = chainBeforeMinMax(s, offset)
    return `.max(${n}, ${inferMaxError(before, n)})`
  })

  // .max(VAR) / .min(VAR) for queue config constants
  s = s.replace(/\.max\(([A-Z][A-Z0-9_]+)\)/g, (match, varName, offset) => {
    if (hasZErrSecondArg(s, offset + match.length)) return match
    return `.max(${varName}, zErr.maxNumber(${varName}))`
  })
  s = s.replace(/\.min\(([A-Z][A-Z0-9_]+)\)/g, (match, varName, offset) => {
    if (hasZErrSecondArg(s, offset + match.length)) return match
    return `.min(${varName}, zErr.minNumber(${varName}))`
  })

  return s
}

function transformFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  if (!content.includes("from 'zod'") && !content.includes('from "zod"')) return false

  const lines = content.split('\n')
  const newLines = lines.map(transformLine)
  let newContent = newLines.join('\n')

  if (!newContent.includes("from '@/lib/zod-errors'")) {
    newContent = newContent.replace(
      /^import \{ z \} from 'zod'\n/m,
      "import { z } from 'zod'\nimport { zErr } from '@/lib/zod-errors'\n"
    )
  }

  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent)
    return true
  }
  return false
}

const files = walk(srcDir)
const changed = []
for (const f of files) {
  if (transformFile(f)) changed.push(path.relative(root, f))
}

console.log(`Updated ${changed.length} files:`)
for (const f of changed) console.log(`  ${f}`)
