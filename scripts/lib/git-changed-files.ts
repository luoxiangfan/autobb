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

export function isUnderSrc(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized === 'src' || normalized.startsWith('src/')
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

/** Path prefix for batching: `src/app/api/products`, `src/lib/queue`, `scripts`, etc. */
export function pathBatchPrefix(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  if (parts[0] === 'src' && parts[1] === 'app' && parts[2] === 'api' && parts.length >= 4) {
    return `${parts[0]}/${parts[1]}/${parts[2]}/${parts[3]}`
  }
  if (parts[0] === 'src' && parts.length >= 3) {
    return `${parts[0]}/${parts[1]}/${parts[2]}`
  }
  if (parts[0] === 'src' && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`
  }
  return parts[0]
}

/**
 * Group files by path prefix so prettier/eslint run in smaller batches (avoids ENAMETOOLONG on Windows).
 */
export function batchFilesByPath(files: string[], maxBatchSize = 40): string[][] {
  const byPrefix = new Map<string, string[]>()

  for (const filePath of files) {
    const prefix = pathBatchPrefix(filePath)
    const group = byPrefix.get(prefix) ?? []
    group.push(filePath)
    byPrefix.set(prefix, group)
  }

  const batches: string[][] = []
  for (const prefix of [...byPrefix.keys()].sort()) {
    const groupFiles = byPrefix.get(prefix)!
    for (let i = 0; i < groupFiles.length; i += maxBatchSize) {
      batches.push(groupFiles.slice(i, i + maxBatchSize))
    }
  }
  return batches
}
