import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'api')

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, files)
    else if (ent.name === 'route.ts') files.push(p)
  }
  return files
}

let fixed = 0
for (const file of walk(apiRoot)) {
  let content = fs.readFileSync(file, 'utf8')
  if (!content.includes('verifyAuth')) continue
  if (/from ['"]@\/lib\/auth['"]/.test(content)) continue

  const importLine = "import { verifyAuth } from '@/lib/auth'\n"
  const nextImport = content.match(/^import .+ from .+$/m)
  if (nextImport) {
    const idx = content.indexOf(nextImport[0])
    content = content.slice(0, idx) + importLine + content.slice(idx)
  } else {
    content = importLine + content
  }
  fs.writeFileSync(file, content)
  fixed++
}
console.log(`Added verifyAuth import to ${fixed} files.`)
