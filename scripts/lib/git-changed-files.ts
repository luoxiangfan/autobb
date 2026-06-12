import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

export function getRepoRoot(): string {
  return runGit(['rev-parse', '--show-toplevel'], process.cwd()).trim()
}

/** Working-tree changes vs HEAD: modified, added, renamed, and untracked files. */
export function getChangedFiles(repoRoot: string): string[] {
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
