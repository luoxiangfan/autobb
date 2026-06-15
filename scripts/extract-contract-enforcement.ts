#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const contractPath = path.join(root, 'src/lib/ad-creative-generator/contract.ts')
const enforcementPath = path.join(root, 'src/lib/ad-creative-generator/contract/enforcement.ts')
const responseHandlingPath = path.join(
  root,
  'src/lib/ad-creative-generator/contract/response-handling.ts'
)

const lines = fs.readFileSync(contractPath, 'utf8').split(/\r?\n/)
const imports = lines.slice(0, 69).join('\n')
const body = lines.slice(70, 2867).join('\n')

fs.mkdirSync(path.dirname(enforcementPath), { recursive: true })
fs.writeFileSync(enforcementPath, `${imports}\n\n${body}\n`)

const barrel = `export * from './contract/enforcement'

export {
  normalizeBrandFreeText,
  normalizeHeadline2KeywordCandidate,
  tokenizeHeadline2Keyword,
  scoreAdCreativeCandidate,
  AD_CREATIVE_RESPONSE_SCHEMA,
  AD_CREATIVE_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_REQUIRED_COUNTS,
  AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE,
  AD_CREATIVE_SIMPLIFIED_RETRY_MAX_OUTPUT_TOKENS,
  validateGeneratedAdCreativeBusinessLimits,
  resolveAdCreativeRetryPlan,
  selectBestJsonCandidate,
  filterModelIntentGeneratedKeywords,
  parseAIResponse,
  isLikelyModelCodeToken,
  HEADLINE2_STOPWORDS,
  HEADLINE2_INTENT_TOKENS,
  HEADLINE2_BANNED_TOKENS,
  HEADLINE_DANGLING_TAIL_TOKENS,
} from './contract/response-handling'
`
fs.writeFileSync(contractPath, barrel)

const responseHandling = fs.readFileSync(responseHandlingPath, 'utf8')
const updatedResponseHandling = responseHandling.replace(
  "} from '../contract'",
  "} from '../contract/enforcement'"
)
fs.writeFileSync(responseHandlingPath, updatedResponseHandling)

console.log('Wrote contract/enforcement.ts and trimmed contract.ts barrel')
