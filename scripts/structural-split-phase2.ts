#!/usr/bin/env tsx
/**
 * Phase-2 structural splits for offer-keyword-pool, contract, ad-strength, campaigns.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function readLines(rel: string): string[] {
  return fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/)
}

function writeFile(rel: string, content: string) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

function sliceLines(rel: string, start: number, end: number): string {
  return readLines(rel)
    .slice(start - 1, end)
    .join('\n')
}

function removeLines(rel: string, start: number, end: number, replacement: string) {
  const lines = readLines(rel)
  const next = [...lines.slice(0, start - 1), replacement, ...lines.slice(end)]
  writeFile(rel, next.join('\n'))
  console.log(`trim ${rel} ${start}-${end}`)
}

function prependExports(body: string, names: string[]): string {
  return body.replace(/^(async )?function (\w+)/gm, (match, asyncKw, name) => {
    if (names.includes(name)) {
      return `export ${asyncKw ? 'async ' : ''}function ${name}`
    }
    return match
  })
}

// --- 1) offer-keyword-pool/keyword-clustering.ts ---
const clusteringHeader = `/**
 * AI keyword intent clustering + deterministic fallback.
 */
import { generateContent } from '../gemini'
import { repairJsonText } from '../ai-json'
import { loadPrompt } from '../prompt-loader'
import { recordTokenUsage, estimateTokenCost } from '../ai-token-tracker'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { classifyKeywordIntent } from '../keyword-intent'
import {
  sanitizePromptBlockValue,
  sanitizePromptInlineValue,
} from '../llm-input-guard'
import {
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
  type KeywordBuckets,
  type KeywordPoolProgressReporter,
  type PoolKeywordData,
  type StoreKeywordBuckets,
} from './types'

type GeminiGenerateParams = Parameters<typeof generateContent>[0]
type GeminiGenerateResult = Awaited<ReturnType<typeof generateContent>>
type OfferPageTypeSource = { link_type?: string | null; scraped_data?: string | null }
`

const clusteringBody = [
  sliceLines('src/lib/offer-keyword-pool.ts', 125, 686),
  '',
  sliceLines('src/lib/offer-keyword-pool.ts', 1569, 2976),
].join('\n')

const clusteringExports = [
  'clusterKeywordsByIntent',
  'prioritizeBucketKeywords',
  'prioritizeKeywordsForClustering',
  'ensureMinimumBucketKeywords',
  'resolveOfferPageType',
]

writeFile(
  'src/lib/offer-keyword-pool/keyword-clustering.ts',
  `${clusteringHeader}\n${prependExports(clusteringBody, clusteringExports)}\n`
)

removeLines(
  'src/lib/offer-keyword-pool.ts',
  125,
  686,
  `import {
  clusterKeywordsByIntent,
  ensureMinimumBucketKeywords,
  prioritizeBucketKeywords,
  prioritizeKeywordsForClustering,
  resolveOfferPageType,
} from './offer-keyword-pool/keyword-clustering'
export { clusterKeywordsByIntent, determineClusteringStrategy } from './offer-keyword-pool/clustering-strategy'
export { clusterKeywordsByIntent } from './offer-keyword-pool/keyword-clustering'`
)

// fix duplicate export - we'll clean manually after
removeLines('src/lib/offer-keyword-pool.ts', 1569 - (686 - 125), 2976 - (686 - 125), '')

// --- 1b) offer-keyword-pool/canonical-bucket-view.ts ---
const canonicalHeader = `/**
 * Canonical A/B/D keyword projection for creative generation.
 */
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { filterCreativeKeywordsByOfferContextDetailed } from '../creative-keyword-context-filter'
import {
  buildProductModelFamilyContext,
  filterModelIntentFamilyKeywords,
  type ModelIntentFamilyContext,
} from '../model-intent-family-filter'
import {
  deriveCanonicalCreativeType,
  getCreativeTypeForBucketSlot,
  normalizeCanonicalCreativeType,
  normalizeKeywordPoolBucketQuery,
  type CanonicalCreativeType,
  type CreativeBucketSlot,
} from '../creative-type'
import { isPureBrandKeyword as isPureBrandKeywordInternal } from '../keyword-quality-filter'
import { getPureBrandKeywords } from '../keyword-quality-filter'
import type { BucketType, OfferKeywordPool, PoolKeywordData } from './types'
`

const canonicalBody = sliceLines('src/lib/offer-keyword-pool.ts', 6202, 7542)
const canonicalExports = [
  'buildCanonicalBucketKeywords',
  'applyOfferContextToCanonicalKeywords',
  'getComprehensiveKeywordsForPool',
]

writeFile(
  'src/lib/offer-keyword-pool/canonical-bucket-view.ts',
  `${canonicalHeader}\n${prependExports(canonicalBody, canonicalExports)}\n`
)

// Re-read line numbers after first trim - use grep in fix pass
console.log('Wrote keyword-clustering.ts and canonical-bucket-view.ts (trim canonical manually)')

// --- 3) contract/enforcement.ts ---
const contractImports = sliceLines('src/lib/ad-creative-generator/contract.ts', 1, 69)
const enforcementBody = sliceLines('src/lib/ad-creative-generator/contract.ts', 71, 2867)
writeFile(
  'src/lib/ad-creative-generator/contract/enforcement.ts',
  `${contractImports.join('\n')}\n\n${enforcementBody}\n`
)
removeLines(
  'src/lib/ad-creative-generator/contract.ts',
  1,
  2867,
  `export * from './contract/enforcement'
`
)

// --- 3b) ad-strength modules ---
const adStrengthSharedHeader = `import type { HeadlineAsset, DescriptionAsset } from '../ad-creative'
import {
  AD_STRENGTH_DIMENSION_CONFIG,
  AD_STRENGTH_RELEVANCE_THRESHOLDS,
  AD_STRENGTH_SUGGESTION_THRESHOLDS,
  mapRawScoreToTarget,
} from '../ad-strength-config'
import type { AdStrengthRating } from './types'
import { MULTILINGUAL_CTA_WORDS, MULTILINGUAL_URGENCY_WORDS, FORBIDDEN_WORDS } from './lexicons'
`

writeFile(
  'src/lib/ad-strength/keyword-matching.ts',
  `import { MULTILINGUAL_CTA_WORDS, MULTILINGUAL_URGENCY_WORDS } from './lexicons'\n\n${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 70, 200), ['resolveLanguageKey', 'containsLocalizedPhrase', 'calculateKeywordDensityByToken'])}\n`
)

writeFile(
  'src/lib/ad-strength/text-similarity.ts',
  `${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 2702, 2855), ['calculateSimilarity', 'calculateJaccardSimilarity', 'calculateCosineSimilarity', 'calculateLevenshteinSimilarity', 'calculateNgramSimilarity'])}\n`
)

writeFile(
  'src/lib/ad-strength/dimensions/diversity.ts',
  `${adStrengthSharedHeader}
import { calculateTextUniqueness } from './text-uniqueness'
${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 405, 483), ['calculateDiversity'])}
`
)

writeFile(
  'src/lib/ad-strength/dimensions/text-uniqueness.ts',
  `${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 2443, 2473), ['calculateTextUniqueness'])}\n`
)

writeFile(
  'src/lib/ad-strength/dimensions/relevance.ts',
  `${adStrengthSharedHeader}
import { resolveLanguageKey, calculateKeywordDensityByToken } from '../keyword-matching'
import { calculateTextSimilarity } from '../text-similarity'
${prependExports(
  [
    sliceLines('src/lib/ad-strength-evaluator.ts', 485, 747),
    sliceLines('src/lib/ad-strength-evaluator.ts', 2475, 2700),
  ].join('\n'),
  ['calculateRelevance', 'calculateBrandContentConsistency', 'calculateProductFocus']
)}
`
)

// Fix text-similarity export name - relevance may use calculateSimilarity not calculateTextSimilarity - fix in post

writeFile(
  'src/lib/ad-strength/dimensions/completeness.ts',
  `${adStrengthSharedHeader}\n${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 749, 793), ['calculateCompleteness'])}\n`
)

writeFile(
  'src/lib/ad-strength/dimensions/quality.ts',
  `${adStrengthSharedHeader}
import { resolveLanguageKey, containsLocalizedPhrase } from '../keyword-matching'
import { calculateTextUniqueness } from './text-uniqueness'
${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 795, 928), ['calculateQuality', 'calculateDifferentiation'])}
`
)

writeFile(
  'src/lib/ad-strength/dimensions/compliance.ts',
  `${adStrengthSharedHeader}
import { calculateTextUniqueness } from './text-uniqueness'
${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 1836, 2185), ['calculateCompliance'])}
`
)

writeFile(
  'src/lib/ad-strength/copy-intent-metrics.ts',
  `${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 2187, 2291), ['calculateCopyIntentMetrics'])}\n`
)

writeFile(
  'src/lib/ad-strength/rating-suggestions.ts',
  `import { AD_STRENGTH_RATING_THRESHOLDS, AD_STRENGTH_SUGGESTION_THRESHOLDS } from '../ad-strength-config'
import type { AdStrengthRating } from './types'
${prependExports(sliceLines('src/lib/ad-strength-evaluator.ts', 2293, 2441), ['scoreToRating', 'generateSuggestions'])}
`
)

console.log(
  'Phase-2 extraction scaffold written. Manual wiring required for offer-keyword-pool canonical trim and ad-strength evaluator imports.'
)
