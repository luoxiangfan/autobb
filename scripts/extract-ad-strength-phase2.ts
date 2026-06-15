#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const evaluatorPath = path.join(root, 'src/lib/ad-strength-evaluator.ts')

function slice(start: number, end: number): string {
  return fs
    .readFileSync(evaluatorPath, 'utf8')
    .split(/\r?\n/)
    .slice(start - 1, end)
    .join('\n')
}

function exportFunctions(body: string, names: string[]): string {
  let next = body
  for (const name of names) {
    next = next.replace(new RegExp(`^function ${name}\\(`, 'm'), `export function ${name}(`)
  }
  return next
}

const keywordMatching = `import { MULTILINGUAL_CTA_WORDS } from './lexicons'

${exportFunctions(slice(70, 197), [
  'resolveLanguageKey',
  'containsLocalizedPhrase',
  'keywordAppearsInText',
  'calculateKeywordDensityByToken',
])}
`

const textSimilarity = exportFunctions(slice(2702, 2862), [
  'calculateSimilarity',
  'calculateJaccardSimilarity',
  'calculateCosineSimilarity',
  'calculateLevenshteinSimilarity',
  'levenshteinDistance',
  'calculateNgramSimilarity',
  'getNgrams',
])

fs.writeFileSync(path.join(root, 'src/lib/ad-strength/keyword-matching.ts'), keywordMatching)
fs.writeFileSync(path.join(root, 'src/lib/ad-strength/text-similarity.ts'), textSimilarity)

const lines = fs.readFileSync(evaluatorPath, 'utf8').split(/\r?\n/)
const trimmed = [
  ...lines.slice(0, 69),
  'import {',
  '  calculateKeywordDensityByToken,',
  '  containsLocalizedPhrase,',
  '  keywordAppearsInText,',
  '  resolveLanguageKey,',
  "} from './ad-strength/keyword-matching'",
  "import { calculateSimilarity } from './ad-strength/text-similarity'",
  ...lines.slice(197, 2701),
  ...lines.slice(2862),
].join('\n')

fs.writeFileSync(evaluatorPath, trimmed)
console.log('Extracted ad-strength keyword-matching and text-similarity')
