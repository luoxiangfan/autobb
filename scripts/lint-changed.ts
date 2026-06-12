import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { getChangedFiles, getRepoRoot } from './lib/git-changed-files'

const LINTABLE = /\.(?:[cm]?js|tsx?)$/i

function main(): void {
  const repoRoot = getRepoRoot()
  const files = getChangedFiles(repoRoot).filter((filePath) => LINTABLE.test(filePath))

  if (files.length === 0) {
    console.log('lint:changed — no modified or new lintable files')
    return
  }

  const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js')
  console.log(`lint:changed — linting ${files.length} file(s)`)
  execFileSync(process.execPath, [eslintBin, ...files, '--max-warnings', '0'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

main()
