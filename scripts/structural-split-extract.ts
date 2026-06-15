#!/usr/bin/env tsx
/**
 * One-off structural split helper: extracts line ranges from monolith files.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

type SplitJob = {
  source: string
  dest: string
  startLine: number
  endLine: number
  header: string
}

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
}

function writeSlice(job: SplitJob) {
  const sourcePath = path.join(root, job.source)
  const destPath = path.join(root, job.dest)
  const lines = readLines(sourcePath)
  const slice = lines.slice(job.startLine - 1, job.endLine).join('\n')
  const normalizedSlice = slice
    .replace(/^const MULTILINGUAL_CTA_WORDS/m, 'export const MULTILINGUAL_CTA_WORDS')
    .replace(/^const MULTILINGUAL_URGENCY_WORDS/m, 'export const MULTILINGUAL_URGENCY_WORDS')
    .replace(/^const FORBIDDEN_WORDS/m, 'export const FORBIDDEN_WORDS')
    .replace(
      /^function parseCompetitivePositioningAiScores/m,
      'export function parseCompetitivePositioningAiScores'
    )
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, `${job.header}\n\n${normalizedSlice}\n`)
  console.log(`Wrote ${job.dest} (${job.endLine - job.startLine + 1} lines)`)
}

function removeSlice(source: string, startLine: number, endLine: number, replacement: string) {
  const sourcePath = path.join(root, source)
  const lines = readLines(sourcePath)
  const next = [...lines.slice(0, startLine - 1), replacement, ...lines.slice(endLine)]
  fs.writeFileSync(sourcePath, next.join('\n'))
  console.log(`Trimmed ${source} lines ${startLine}-${endLine}`)
}

const contractResponseHeader = `/**
 * Gemini response schemas, business limits, and AI response parsing.
 * Extracted from contract.ts for structural clarity.
 */
import type {
  CreativeKeywordUsagePlan,
  GeneratedAdCreativeData,
  GeneratedKeywordCandidateMetadata,
} from '../../ad-creative'
import type { Offer } from '../../offers'
import { generateContent, type ResponseSchema } from '../../gemini'
import { recordTokenUsage, estimateTokenCost } from '../../ai-token-tracker'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { hasModelAnchorEvidence } from '../../creative-type'
import { getKeywordSourcePriorityScoreFromInput } from '../../creative-keyword-source-priority'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isBrandVariant,
  isSemanticQuery,
} from '../../keyword-quality-filter'
import { isPureBrandKeyword } from '../../brand-keyword-utils'
import {
  getGoogleAdsTextEffectiveLength,
  sanitizeGoogleAdsAdText,
  sanitizeGoogleAdsSymbols,
} from '@/lib/google-ads/common/ad-text'
import { classifyKeywordIntent } from '../../keyword-intent'
import {
  type GoogleAdsPolicyGuardMode,
  resolveGoogleAdsPolicyGuardMode,
  sanitizeGoogleAdsPolicyText,
  sanitizeKeywordListForGoogleAdsPolicy,
} from '@/lib/google-ads/policy/policy-guard'
import {
  buildLanguageSafeUsagePlan,
  enforceLanguagePurityGate,
  getCopyPatterns,
  getCtaPhrasesForLanguage,
  getCtaRegexForLanguage,
  isHeadlineCompatibleWithTargetLanguage,
  resolveSoftCopyLanguage,
  toLanguageCompatibleKeywordList,
} from '../language'
import {
  escapeRegex,
  extractJsonFromText,
  isValidUrl,
  normalizeWhitespace,
  safeParseJson,
} from '../utils'
import type { CanonicalCreativeType } from '../../creative-type'

export type { ResponseSchema } from '../../gemini'

// --- extracted body below ---`

writeSlice({
  source: 'src/lib/ad-creative-generator/contract.ts',
  dest: 'src/lib/ad-creative-generator/contract/response-handling.ts',
  startLine: 2877,
  endLine: 4119,
  header: contractResponseHeader,
})

removeSlice(
  'src/lib/ad-creative-generator/contract.ts',
  2873,
  4119,
  `export {
  normalizeBrandFreeText,
  normalizeHeadline2KeywordCandidate,
  tokenizeHeadline2Keyword,
  scoreAdCreativeCandidate,
  AD_CREATIVE_RESPONSE_SCHEMA,
  AD_CREATIVE_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_REQUIRED_COUNTS,
  validateGeneratedAdCreativeBusinessLimits,
  resolveAdCreativeRetryPlan,
  selectBestJsonCandidate,
  filterModelIntentGeneratedKeywords,
  parseAIResponse,
} from './contract/response-handling'`
)

const adStrengthLexiconsHeader = `/**
 * Static lexicons for Ad Strength scoring (CTA, urgency, forbidden words).
 */`

writeSlice({
  source: 'src/lib/ad-strength-evaluator.ts',
  dest: 'src/lib/ad-strength/lexicons.ts',
  startLine: 167,
  endLine: 854,
  header: adStrengthLexiconsHeader,
})

const adStrengthTypesHeader = `/**
 * Public Ad Strength evaluation types.
 */`

writeSlice({
  source: 'src/lib/ad-strength-evaluator.ts',
  dest: 'src/lib/ad-strength/types.ts',
  startLine: 51,
  endLine: 165,
  header: adStrengthTypesHeader,
})

const cpAiParseHeader = `/**
 * Competitive positioning AI JSON parsing helpers.
 */

export type CompetitivePositioningAIScores = {
  priceAdvantage: number
  uniqueMarketPosition: number
  competitiveComparison: number
  valueEmphasis: number
  confidence: number
}
`

writeSlice({
  source: 'src/lib/ad-strength-evaluator.ts',
  dest: 'src/lib/ad-strength/competitive-positioning-ai-parse.ts',
  startLine: 1948,
  endLine: 2027,
  header: cpAiParseHeader,
})

removeSlice(
  'src/lib/ad-strength-evaluator.ts',
  3742,
  3744,
  `import { parseCompetitivePositioningAiScores } from './ad-strength/competitive-positioning-ai-parse'

export const __testOnly = {
  parseCompetitivePositioningAiScores,
}`
)

removeSlice(
  'src/lib/ad-strength-evaluator.ts',
  1940,
  2027,
  `import {
  parseCompetitivePositioningAiScores,
  type CompetitivePositioningAIScores,
} from './ad-strength/competitive-positioning-ai-parse'
export { parseCompetitivePositioningAiScores } from './ad-strength/competitive-positioning-ai-parse'`
)

removeSlice(
  'src/lib/ad-strength-evaluator.ts',
  167,
  854,
  `import {
  MULTILINGUAL_CTA_WORDS,
  MULTILINGUAL_URGENCY_WORDS,
  FORBIDDEN_WORDS,
} from './ad-strength/lexicons'`
)

removeSlice(
  'src/lib/ad-strength-evaluator.ts',
  51,
  165,
  `export type { AdStrengthRating, AdStrengthEvaluation } from './ad-strength/types'
import type { AdStrengthRating, AdStrengthEvaluation } from './ad-strength/types'`
)
