import { execFileSync } from 'node:child_process'
import path from 'node:path'
import {
  batchFilesByPath,
  getChangedFiles,
  getRepoRoot,
  pathBatchPrefix,
} from './lib/git-changed-files'

const LINTABLE = /\.(?:[cm]?js|tsx?)$/i

function runEslintFile(repoRoot: string, eslintBin: string, filePath: string): boolean {
  try {
    execFileSync(process.execPath, [eslintBin, filePath, '--max-warnings', '0'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    return true
  } catch {
    return false
  }
}

function runEslintBatch(repoRoot: string, eslintBin: string, batch: string[]): string[] {
  try {
    execFileSync(process.execPath, [eslintBin, ...batch, '--max-warnings', '0'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    return []
  } catch {
    console.warn(`lint:changed — batch failed, retrying ${batch.length} file(s) individually`)
    const failed: string[] = []
    for (const filePath of batch) {
      if (!runEslintFile(repoRoot, eslintBin, filePath)) {
        failed.push(filePath)
      }
    }
    return failed
  }
}

function main(): void {
  const repoRoot = getRepoRoot()
  const files = getChangedFiles(repoRoot).filter((filePath) => LINTABLE.test(filePath))

  if (files.length === 0) {
    console.log('lint:changed — no modified or new lintable files')
    return
  }

  const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js')
  const batches = batchFilesByPath(files)
  console.log(`lint:changed — linting ${files.length} file(s) in ${batches.length} batch(es)`)

  const failed: string[] = []
  for (const batch of batches) {
    console.log(`lint:changed — ${pathBatchPrefix(batch[0])} (${batch.length} file(s))`)
    failed.push(...runEslintBatch(repoRoot, eslintBin, batch))
  }

  if (failed.length > 0) {
    console.error(`lint:changed — failed ${failed.length} file(s):`)
    for (const filePath of failed) {
      console.error(`  ${filePath}`)
    }
    process.exit(1)
  }
}

main()
