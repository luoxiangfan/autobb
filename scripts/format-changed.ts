import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { getChangedFiles, getRepoRoot } from './lib/git-changed-files'

function main(): void {
  const repoRoot = getRepoRoot()
  const files = getChangedFiles(repoRoot)

  if (files.length === 0) {
    console.log('format:changed — no modified or new files')
    return
  }

  const prettierCjs = path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs')
  console.log(`format:changed — formatting ${files.length} file(s)`)
  execFileSync(process.execPath, [prettierCjs, '--write', '--ignore-unknown', ...files], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

main()
