import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

type Scope = 'staged' | 'all' | 'compare'

type ChangeStatus = 'A' | 'M' | 'D' | 'R' | '?'

interface Options {
  scope: Scope
  baseRef?: string
  json: boolean
}

interface ChangedFile {
  path: string
  status: ChangeStatus
  oldPath?: string
  touchedLines: number[]
  lineCount: number
}

interface ChangedSymbol {
  filePath: string
  name: string
  kind: string
  startLine: number
  endLine: number
  touchedLines: number[]
}

interface SymbolDefinition {
  name: string
  kind: string
  startLine: number
  endLine: number
}

interface Report {
  tool: 'gnx-detect-changes'
  mode: 'compat'
  scope: Scope
  baseRef?: string
  changedFiles: ChangedFile[]
  changedSymbols: ChangedSymbol[]
  summary: {
    fileCount: number
    symbolCount: number
  }
  note: string
}

function usage(): never {
  console.error(
    [
      'Usage: tsx scripts/gnx-detect-changes.ts [--scope staged|all|compare] [--base-ref main] [--json]',
      '',
      'Examples:',
      '  npm run gnx:detect-changes -- --scope staged',
      '  npm run gnx:detect-changes -- --scope compare --base-ref main --json',
    ].join('\n')
  )
  process.exit(1)
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    scope: 'staged',
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--scope') {
      const value = argv[index + 1]
      if (value !== 'staged' && value !== 'all' && value !== 'compare') usage()
      options.scope = value
      index += 1
      continue
    }
    if (arg === '--base-ref') {
      const value = argv[index + 1]
      if (!value) usage()
      options.baseRef = value
      index += 1
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '-h' || arg === '--help') {
      usage()
    }
    usage()
  }

  if (options.scope === 'compare' && !options.baseRef) {
    options.baseRef = 'main'
  }

  return options
}

function runGit(args: string[], repoRoot: string): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

function getRepoRoot(): string {
  return runGit(['rev-parse', '--show-toplevel'], process.cwd()).trim()
}

function parseNameStatusOutput(output: string, options: Pick<Options, 'scope' | 'baseRef'>, repoRoot: string): ChangedFile[] {
  const files: ChangedFile[] = []
  if (!output.trim()) return files

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split('\t')
    const statusToken = parts[0] || ''

    if (statusToken.startsWith('R')) {
      const oldPath = parts[1]
      const newPath = parts[2]
      if (!newPath) continue
      files.push({
        path: newPath,
        oldPath,
        status: 'R',
        touchedLines: resolveTouchedLines({
          repoRoot,
          scope: options.scope,
          baseRef: options.baseRef,
          filePath: newPath,
          oldPath,
          status: 'R',
        }),
        lineCount: getLineCount(path.join(repoRoot, newPath)),
      })
      continue
    }

    const status = statusToken.slice(0, 1) as ChangeStatus
    const filePath = parts[1] || parts[0]
    if (!filePath) continue
    files.push({
      path: filePath,
      status,
      touchedLines: resolveTouchedLines({
        repoRoot,
        scope: options.scope,
        baseRef: options.baseRef,
        filePath,
        status,
      }),
      lineCount: getLineCount(path.join(repoRoot, filePath)),
    })
  }

  return files
}

function getChangedFiles(options: Options, repoRoot: string): ChangedFile[] {
  if (options.scope === 'staged') {
    return parseNameStatusOutput(
      runGit(['diff', '--cached', '--name-status', '--diff-filter=ACMR'], repoRoot),
      options,
      repoRoot
    )
  }

  if (options.scope === 'compare') {
    return parseNameStatusOutput(
      runGit(['diff', '--name-status', '--diff-filter=ACMR', `${options.baseRef}...HEAD`], repoRoot),
      options,
      repoRoot
    )
  }

  const tracked = parseNameStatusOutput(
    runGit(['diff', '--name-status', '--diff-filter=ACMR', 'HEAD'], repoRoot),
    options,
    repoRoot
  )
  const trackedPaths = new Set(tracked.map((item) => item.path))
  const untrackedOut = runGit(['ls-files', '--others', '--exclude-standard'], repoRoot)
  const untracked = untrackedOut
    ? untrackedOut.split('\n').filter(Boolean).map((filePath) => ({
        path: filePath,
        status: '?' as ChangeStatus,
        touchedLines: allFileLines(path.join(repoRoot, filePath)),
        lineCount: getLineCount(path.join(repoRoot, filePath)),
      }))
    : []

  return tracked.concat(untracked.filter((item) => !trackedPaths.has(item.path)))
}

function resolveTouchedLines(params: {
  repoRoot: string
  scope: Scope
  baseRef?: string
  filePath: string
  status: ChangeStatus
  oldPath?: string
}): number[] {
  const fullPath = path.join(params.repoRoot, params.filePath)
  if (params.status === 'A' || params.status === '?') return allFileLines(fullPath)

  const diffTarget = params.filePath
  const args =
    params.scope === 'staged'
      ? ['diff', '--cached', '--unified=0', '--no-ext-diff', '--', diffTarget]
      : params.scope === 'compare'
        ? ['diff', '--unified=0', '--no-ext-diff', `${params.baseRef || 'main'}...HEAD`, '--', diffTarget]
        : ['diff', '--unified=0', '--no-ext-diff', 'HEAD', '--', diffTarget]

  const diffText = runGit(args, params.repoRoot)
  return extractTouchedLinesFromDiff(diffText, fullPath)
}

function extractTouchedLinesFromDiff(diffText: string, fullPath: string): number[] {
  const touched = new Set<number>()
  if (!diffText.trim()) return []

  for (const line of diffText.split('\n')) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (!match) continue
    const start = Number(match[1])
    const count = Number(match[2] || '1')
    if (!Number.isFinite(start) || !Number.isFinite(count)) continue
    if (count <= 0) continue
    for (let current = start; current < start + count; current += 1) {
      touched.add(current)
    }
  }

  return Array.from(touched).sort((left, right) => left - right)
}

function allFileLines(fullPath: string): number[] {
  const count = getLineCount(fullPath)
  return Array.from({ length: count }, (_, index) => index + 1)
}

function getLineCount(fullPath: string): number {
  if (!fs.existsSync(fullPath)) return 0
  const text = fs.readFileSync(fullPath, 'utf8')
  if (!text) return 0
  return text.split('\n').length
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.Unknown
}

function getNodeName(node: ts.Node): string | undefined {
  if ('name' in node && node.name && ts.isIdentifier(node.name)) {
    return node.name.text
  }
  if ('name' in node && node.name && ts.isStringLiteral(node.name)) {
    return node.name.text
  }
  return undefined
}

function collectSymbols(filePath: string, fullPath: string): SymbolDefinition[] {
  const scriptKind = scriptKindForFile(filePath)
  if (scriptKind === ts.ScriptKind.Unknown || !fs.existsSync(fullPath)) return []
  const sourceText = fs.readFileSync(fullPath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  const symbols: SymbolDefinition[] = []

  function pushSymbol(name: string | undefined, kind: string, node: ts.Node): void {
    if (!name) return
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
    symbols.push({
      name,
      kind,
      startLine: start,
      endLine: end,
    })
  }

  function visit(node: ts.Node, owner?: string): void {
    if (ts.isFunctionDeclaration(node)) {
      pushSymbol(getNodeName(node) || 'default', 'function', node)
    } else if (ts.isClassDeclaration(node)) {
      const className = getNodeName(node)
      pushSymbol(className, 'class', node)
      ts.forEachChild(node, (child) => visit(child, className))
      return
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const methodName = getNodeName(node)
      pushSymbol(owner && methodName ? `${owner}.${methodName}` : methodName, 'method', node)
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(getNodeName(node), 'interface', node)
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(getNodeName(node), 'type', node)
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        if (!declaration.initializer) continue
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          pushSymbol(declaration.name.text, 'variable_function', declaration)
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, owner))
  }

  visit(sourceFile)
  return symbols
}

function collectChangedSymbols(files: ChangedFile[], repoRoot: string): ChangedSymbol[] {
  const changedSymbols: ChangedSymbol[] = []

  for (const file of files) {
    if (file.status === 'D') continue
    const fullPath = path.join(repoRoot, file.path)
    const symbols = collectSymbols(file.path, fullPath)
    if (symbols.length === 0) continue

    for (const symbol of symbols) {
      const touchedLines = file.touchedLines.filter(
        (line) => line >= symbol.startLine && line <= symbol.endLine
      )
      if (touchedLines.length === 0) continue
      changedSymbols.push({
        filePath: file.path,
        name: symbol.name,
        kind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        touchedLines,
      })
    }
  }

  return changedSymbols
}

function renderHumanReadable(report: Report): string {
  const lines: string[] = []
  lines.push('GitNexus detect-changes compatibility report')
  lines.push(`Scope: ${report.scope}${report.baseRef ? ` (${report.baseRef})` : ''}`)
  lines.push(`Changed files: ${report.summary.fileCount}`)
  lines.push(`Changed symbols: ${report.summary.symbolCount}`)
  lines.push('')
  lines.push('Files:')

  for (const file of report.changedFiles) {
    const touchedSummary = file.touchedLines.length > 0
      ? `${file.touchedLines[0]}${file.touchedLines.length > 1 ? `..${file.touchedLines[file.touchedLines.length - 1]}` : ''}`
      : 'n/a'
    lines.push(`- [${file.status}] ${file.path} (lines: ${touchedSummary})`)
  }

  if (report.changedSymbols.length > 0) {
    lines.push('')
    lines.push('Symbols:')
    for (const symbol of report.changedSymbols) {
      lines.push(`- ${symbol.filePath}: ${symbol.kind} ${symbol.name} (${symbol.startLine}-${symbol.endLine})`)
    }
  }

  lines.push('')
  lines.push(`Note: ${report.note}`)
  return lines.join('\n')
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const repoRoot = getRepoRoot()
  const changedFiles = getChangedFiles(options, repoRoot)
  const changedSymbols = collectChangedSymbols(changedFiles, repoRoot)
  const report: Report = {
    tool: 'gnx-detect-changes',
    mode: 'compat',
    scope: options.scope,
    baseRef: options.baseRef,
    changedFiles,
    changedSymbols,
    summary: {
      fileCount: changedFiles.length,
      symbolCount: changedSymbols.length,
    },
    note: 'Installed GitNexus CLI has no detect-changes subcommand; this repo-local fallback reports changed files and enclosing symbols.',
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }

  process.stdout.write(`${renderHumanReadable(report)}\n`)
}

main()
