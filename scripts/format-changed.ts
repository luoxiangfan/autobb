import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

function getRepoRoot(): string {
  return runGit(['rev-parse', '--show-toplevel'], process.cwd()).trim()
}

/** Working-tree changes vs HEAD: modified, added, renamed, and untracked files. */
function getChangedFiles(repoRoot: string): string[] {
  const tracked = runGit(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'], repoRoot)
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], repoRoot)
  const paths = new Set<string>()

  for (const line of [...tracked.split('\n'), ...untracked.split('\n')]) {
    const filePath = line.trim()
    if (!filePath) continue
    if (!fs.existsSync(path.join(repoRoot, filePath))) continue
    paths.add(filePath)
  }

  return Array.from(paths).sort()
}

function main(): void {
  const repoRoot = getRepoRoot()
  const files = getChangedFiles(repoRoot)

  if (files.length === 0) {
    console.log('format:changed — no modified or new files')
    return
  }

  const prettierCjs = path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs')
  console.log(`format:changed — formatting ${files.length} file(s)`)
  execFileSync(process.execPath, [prettierCjs, '--write', ...files], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

main()
