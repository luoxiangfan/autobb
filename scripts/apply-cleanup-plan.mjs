/**
 * Apply cleanup-plan.json: delete dead exports, unexport internal-only symbols.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plan = JSON.parse(readFileSync(join(root, 'cleanup-plan.json'), 'utf8'))

function groupByFile(items) {
  const map = new Map()
  for (const item of items) {
    if (!map.has(item.file)) map.set(item.file, [])
    map.get(item.file).push(item.symbol)
  }
  return map
}

function findDecl(sourceFile, symbol) {
  let found = null
  function visit(node) {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbol) {
      found = node
      return
    }
    if (ts.isClassDeclaration(node) && node.name?.text === symbol) {
      found = node
      return
    }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === symbol) {
          found = node
          return
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function removalRange(sourceFile, node) {
  const text = sourceFile.getFullText()
  let start = node.getFullStart()
  let end = node.getEnd()
  while (end < text.length && (text[end] === '\r' || text[end] === '\n')) end++
  return { start, end }
}

function unexportSymbols(sourceText, symbols, relPath) {
  const sourceFile = ts.createSourceFile(
    relPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const symbolSet = new Set(symbols)
  const removals = []

  function maybeRemoveExport(node) {
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
        let end = mod.getEnd()
        while (sourceText[end] === ' ') end++
        removals.push({ start: mod.getStart(sourceFile), end })
      }
    }
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isVariableStatement(node)
    ) {
      maybeRemoveExport(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  removals.sort((a, b) => b.start - a.start)
  let text = sourceText
  for (const r of removals) {
    text = text.slice(0, r.start) + text.slice(r.end)
  }
  return text
}

function deleteSymbols(sourceText, symbols, relPath) {
  const sourceFile = ts.createSourceFile(
    relPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const ranges = []
  for (const symbol of symbols) {
    const node = findDecl(sourceFile, symbol)
    if (!node) {
      console.warn(`  missing decl: ${symbol}`)
      continue
    }
    ranges.push(removalRange(sourceFile, node))
  }
  ranges.sort((a, b) => b.start - a.start)
  let text = sourceText
  for (const r of ranges) {
    text = text.slice(0, r.start) + text.slice(r.end)
  }
  return text
}

const deleteByFile = groupByFile(plan.delete)
const unexportByFile = groupByFile(plan.unexport)
const allFiles = new Set([...deleteByFile.keys(), ...unexportByFile.keys()])

for (const relPath of allFiles) {
  const abs = join(root, relPath)
  let text = readFileSync(abs, 'utf8')
  const toDelete = deleteByFile.get(relPath) ?? []
  const toUnexport = unexportByFile.get(relPath) ?? []

  if (toDelete.length) text = deleteSymbols(text, toDelete, relPath)
  if (toUnexport.length) text = unexportSymbols(text, toUnexport, relPath)

  writeFileSync(abs, text, 'utf8')
  console.log(`${relPath}: deleted ${toDelete.length}, unexported ${toUnexport.length}`)
}

console.log('Done.')
