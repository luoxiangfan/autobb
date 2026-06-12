import { execFileSync } from 'node:child_process'
import path from 'node:path'
import {
  batchFilesByPath,
  getChangedFiles,
  getRepoRoot,
  pathBatchPrefix,
} from './lib/git-changed-files'

function runPrettierFile(repoRoot: string, prettierCjs: string, filePath: string): boolean {
  try {
    execFileSync(process.execPath, [prettierCjs, '--write', '--ignore-unknown', filePath], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    return true
  } catch {
    return false
  }
}

function runPrettierBatch(repoRoot: string, prettierCjs: string, batch: string[]): string[] {
  try {
    execFileSync(process.execPath, [prettierCjs, '--write', '--ignore-unknown', ...batch], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    return []
  } catch {
    console.warn(`format:changed — batch failed, retrying ${batch.length} file(s) individually`)
    const failed: string[] = []
    for (const filePath of batch) {
      if (!runPrettierFile(repoRoot, prettierCjs, filePath)) {
        failed.push(filePath)
      }
    }
    return failed
  }
}

function main(): void {
  const repoRoot = getRepoRoot()
  const files = getChangedFiles(repoRoot)

  if (files.length === 0) {
    console.log('format:changed — no modified or new files')
    return
  }

  const prettierCjs = path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs')
  const batches = batchFilesByPath(files)
  console.log(`format:changed — formatting ${files.length} file(s) in ${batches.length} batch(es)`)

  const failed: string[] = []
  for (const batch of batches) {
    console.log(`format:changed — ${pathBatchPrefix(batch[0])} (${batch.length} file(s))`)
    failed.push(...runPrettierBatch(repoRoot, prettierCjs, batch))
  }

  if (failed.length > 0) {
    console.error(`format:changed — failed ${failed.length} file(s):`)
    for (const filePath of failed) {
      console.error(`  ${filePath}`)
    }
    process.exit(1)
  }
}

main()
