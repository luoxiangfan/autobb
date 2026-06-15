#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const poolPath = 'src/lib/offer-keyword-pool.ts'

function readLines(rel: string): string[] {
  return fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/)
}

function writeFile(rel: string, content: string) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

function sliceLines(lines: string[], start: number, end: number): string {
  return lines.slice(start - 1, end).join('\n')
}

function removeLines(lines: string[], start: number, end: number, replacement: string): string[] {
  return [...lines.slice(0, start - 1), replacement, ...lines.slice(end)]
}

function exportFunctions(body: string, names: string[]): string {
  let out = body
  for (const name of names) {
    out = out.replace(new RegExp(`^async function ${name}`, 'm'), `export async function ${name}`)
    out = out.replace(new RegExp(`^function ${name}`, 'm'), `export function ${name}`)
  }
  return out
}

let lines = readLines(poolPath)

// --- keyword-clustering.ts ---
const clusteringHeader = `/**
 * AI keyword intent clustering + deterministic fallback.
 */
import { generateContent } from '../gemini'
import { repairJsonText } from '../ai-json'
import { loadPrompt } from '../prompt-loader'
import { recordTokenUsage, estimateTokenCost } from '../ai-token-tracker'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { classifyKeywordIntent } from '../keyword-intent'
import { sanitizePromptBlockValue, sanitizePromptInlineValue } from '../llm-input-guard'
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

writeFile(
  'src/lib/offer-keyword-pool/keyword-clustering.ts',
  `${clusteringHeader}\n${exportFunctions(
    `${sliceLines(lines, 125, 686)}\n\n${sliceLines(lines, 1569, 2976)}`,
    [
      'clusterKeywordsByIntent',
      'prioritizeBucketKeywords',
      'prioritizeKeywordsForClustering',
      'ensureMinimumBucketKeywords',
      'resolveOfferPageType',
    ]
  )}\n`
)

lines = removeLines(lines, 1569, 2976, '')
lines = removeLines(
  lines,
  125,
  686,
  `import {
  ensureMinimumBucketKeywords,
  prioritizeBucketKeywords,
  prioritizeKeywordsForClustering,
  resolveOfferPageType,
} from './offer-keyword-pool/keyword-clustering'`
)

// --- canonical-bucket-view.ts (original line numbers) ---
const original = readLines(poolPath)
const canonicalStart = original.findIndex((line) => line.includes('// 创意生成辅助')) + 2
const canonicalEnd = original.findIndex((line) =>
  line.startsWith('function getKeywordPoolBucketMeta(')
)

const canonicalHeader = `/**
 * Canonical A/B/D keyword projection for creative generation.
 */
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { filterCreativeKeywordsByOfferContextDetailed } from '../creative-keyword-context-filter'
import {
  buildProductModelFamilyContext,
  filterModelIntentFamilyKeywords,
} from '../model-intent-family-filter'
import {
  deriveCanonicalCreativeType,
  getCreativeTypeForBucketSlot,
  normalizeCanonicalCreativeType,
  normalizeKeywordPoolBucketQuery,
  type CanonicalCreativeType,
  type CreativeBucketSlot,
} from '../creative-type'
import { getPureBrandKeywords, isPureBrandKeyword as isPureBrandKeywordInternal } from '../keyword-quality-filter'
import type { BucketType, OfferKeywordPool, PoolKeywordData } from './types'
`

writeFile(
  'src/lib/offer-keyword-pool/canonical-bucket-view.ts',
  `${canonicalHeader}\n${exportFunctions(sliceLines(original, canonicalStart, canonicalEnd), [
    'buildCanonicalBucketKeywords',
    'applyOfferContextToCanonicalKeywords',
    'getComprehensiveKeywordsForPool',
  ])}\n`
)

const canonicalStartShifted = lines.findIndex((line) => line.includes('// 创意生成辅助')) + 2
const canonicalEndShifted = lines.findIndex((line) =>
  line.startsWith('function getKeywordPoolBucketMeta(')
)
lines = removeLines(
  lines,
  canonicalStartShifted,
  canonicalEndShifted,
  `import {
  applyOfferContextToCanonicalKeywords,
  buildCanonicalBucketKeywords,
  getComprehensiveKeywordsForPool,
} from './offer-keyword-pool/canonical-bucket-view'`
)

// merge clustering re-export with existing determineClusteringStrategy export
const exportLine = lines.findIndex((l) => l.includes('export { determineClusteringStrategy }'))
if (exportLine >= 0) {
  lines[exportLine] =
    "export { clusterKeywordsByIntent } from './offer-keyword-pool/keyword-clustering'"
  lines.splice(
    exportLine + 1,
    0,
    "export { determineClusteringStrategy } from './offer-keyword-pool/clustering-strategy'"
  )
}

writeFile(poolPath, lines.join('\n'))
console.log('pool split complete', lines.length, 'lines')
