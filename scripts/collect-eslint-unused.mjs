import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: root })
const results = await eslint.lintFiles(['src/**/*.ts', 'src/**/*.tsx'])

const warnings = []
for (const file of results) {
  const rel = file.filePath.replace(/\\/g, '/').replace(/.*\/autobb\//, '')
  for (const m of file.messages) {
    if (m.severity !== 1 || m.ruleId !== 'unused-imports/no-unused-vars') continue
    const name = m.message.match(/'([^']+)'/)?.[1] ?? ''
    warnings.push({ file: rel, line: m.line, name, message: m.message })
  }
}

writeFileSync(join(root, 'eslint-unused-warnings.json'), JSON.stringify(warnings, null, 2))
console.log(`Found ${warnings.length} unused-var warnings`)
for (const w of warnings) {
  console.log(`${w.file}:${w.line} ${w.name}`)
}
