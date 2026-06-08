/**
 * Remove export keyword from symbols that are only used within their defining file.
 * Input: knip-internal-by-file.json (from scripts/list-internal-exports.mjs)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const byFile = JSON.parse(readFileSync(join(root, 'knip-internal-by-file.json'), 'utf8'))

function unexportSymbols(sourceText, symbols, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  const symbolSet = new Set(symbols)
  const removals = []

  function maybeRemove(node) {
    if (!ts.canHaveModifiers(node)) return
    const mods = ts.getModifiers(node)
    if (!mods) return
    for (const mod of mods) {
      if (mod.kind !== ts.SyntaxKind.ExportKeyword) continue
      let name
      if (ts.isVariableStatement(node)) {
        const decl = node.declarationList.declarations[0]
        name = decl?.name && ts.isIdentifier(decl.name) ? decl.name.text : undefined
      } else if ('name' in node && node.name && ts.isIdentifier(node.name)) {
        name = node.name.text
      }
      if (name && symbolSet.has(name)) {
        removals.push({ start: mod.getStart(sourceFile), end: mod.getEnd() })
      }
    }
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isVariableStatement(node)
    ) {
      maybeRemove(node)
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) {
        const exported = (el.propertyName ?? el.name).text
        const local = el.name.text
        if (symbolSet.has(exported) || symbolSet.has(local)) {
          removals.push({ start: el.getStart(sourceFile), end: el.getEnd(), kind: 'exportElement' })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  if (removals.length === 0) return { text: sourceText, changed: 0, missed: [...symbolSet] }

  removals.sort((a, b) => b.start - a.start)
  let text = sourceText
  const removed = new Set()

  for (const r of removals) {
    if (r.kind === 'exportElement') {
      // export { a, b } — drop element including trailing comma handled below
      let start = r.start
      let end = r.end
      while (end < text.length && /[\s,]/.test(text[end]) && text[end] !== '}') {
        if (text[end] === ',') {
          end++
          break
        }
        end++
      }
      text = text.slice(0, start) + text.slice(end)
    } else {
      // Remove "export " including following space
      let end = r.end
      while (text[end] === ' ') end++
      text = text.slice(0, r.start) + text.slice(end)
    }
    removed.add('ok')
  }

  // Clean empty export declarations: export { } or export {} lines
  text = text.replace(/^export\s*\{\s*\}\s*;?\s*\r?\n/gm, '')

  const missed = symbols.filter((s) => {
    const re = new RegExp(`\\bexport\\b[^\\n]*\\b${s}\\b`)
    return re.test(text)
  })

  return { text, changed: symbols.length - missed.length, missed }
}

let totalChanged = 0
const allMissed = []

for (const [relPath, symbols] of Object.entries(byFile)) {
  const abs = join(root, relPath)
  const original = readFileSync(abs, 'utf8')
  const { text, changed, missed } = unexportSymbols(original, symbols, relPath)
  if (text !== original) {
    writeFileSync(abs, text, 'utf8')
    totalChanged += changed
    if (missed.length) allMissed.push({ file: relPath, missed })
    console.log(`${relPath}: unexported ${changed}/${symbols.length}`)
  } else if (missed.length === symbols.length) {
    allMissed.push({ file: relPath, missed: symbols })
    console.log(`${relPath}: SKIPPED (0 matched)`)
  }
}

console.log(`\nTotal symbols unexported: ${totalChanged}`)
if (allMissed.length) {
  console.log('\nMissed:')
  for (const { file, missed } of allMissed) {
    console.log(`  ${file}: ${missed.join(', ')}`)
  }
  process.exitCode = 1
}
