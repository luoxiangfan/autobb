/**
 * 创意关键词运行时：共享类型
 */
import type { GeneratedAdCreativeData } from '../../creatives/server'
import type {
  BuildCreativeKeywordSetInput,
  BuildCreativeKeywordSetOutput,
} from './creative-keyword-set-builder'
import type { CreativeKeywordSourceAudit } from './creative-keyword-set-builder'
import type { CanonicalCreativeType } from '../../creatives/server'

type CreativeKeywordSupplementation = GeneratedAdCreativeData['keywordSupplementation']
type CreativeKeywordsWithVolume = BuildCreativeKeywordSetOutput['keywordsWithVolume']

export interface KeywordSetAssignmentInput {
  executableKeywords: string[]
  keywordsWithVolume: CreativeKeywordsWithVolume
  promptKeywords: string[]
  keywordSupplementation?: CreativeKeywordSupplementation
  audit?: CreativeKeywordSourceAudit
}

export interface ApplyCreativeKeywordSetOptions {
  includeKeywordSupplementation?: boolean
}

export interface CreateCreativeKeywordSetBuilderInputOptions {
  offer: BuildCreativeKeywordSetInput['offer']
  userId: number
  creative: Pick<GeneratedAdCreativeData, 'keywords' | 'keywordsWithVolume' | 'promptKeywords'>
  creativeType?: BuildCreativeKeywordSetInput['creativeType']
  bucket?: BuildCreativeKeywordSetInput['bucket']
  scopeLabel: string
  seedCandidates?: BuildCreativeKeywordSetInput['seedCandidates']
  enableSupplementation?: boolean
  skipSupplementAiRanking?: boolean
  continueOnSupplementError?: boolean
  fallbackMode?: boolean
}

export interface BuildPreGenerationCreativeKeywordSetOptions {
  offer: BuildCreativeKeywordSetInput['offer']
  userId: number
  creativeType?: BuildCreativeKeywordSetInput['creativeType']
  bucket?: BuildCreativeKeywordSetInput['bucket']
  scopeLabel: string
  seedCandidates?: BuildCreativeKeywordSetInput['seedCandidates']
  enableSupplementation?: boolean
  skipSupplementAiRanking?: boolean
  continueOnSupplementError?: boolean
  fallbackMode?: boolean
}

export interface FinalizeCreativeKeywordSetOptions<
  TCreative extends CreativeKeywordRuntimeCarrier,
> {
  offer: BuildCreativeKeywordSetInput['offer']
  userId: number
  creative: TCreative
  creativeType?: BuildCreativeKeywordSetInput['creativeType']
  bucket?: BuildCreativeKeywordSetInput['bucket']
  scopeLabel: string
  seedCandidates?: BuildCreativeKeywordSetInput['seedCandidates']
  includeKeywordSupplementation?: boolean
}

export interface MergeUsedKeywordsExcludingBrandInput {
  usedKeywords: string[]
  candidateKeywords?: Array<string | null | undefined>
  brandKeywords: string[]
}

export interface CreativeEvaluationOfferContext {
  id?: number
  brand?: string | null
  category?: string | null
  product_name?: string | null
  product_title?: string | null
  title?: string | null
  name?: string | null
  brand_description?: string | null
  unique_selling_points?: string | null
  product_highlights?: string | null
  target_country?: string | null
  target_language?: string | null
  page_type?: string | null
}

export interface CreateCreativeQualityEvaluationInputOptions {
  creative: GeneratedAdCreativeData
  minimumScore?: number
  offer: CreativeEvaluationOfferContext
  userId: number
  bucket?: string | null
  creativeType?: CanonicalCreativeType | null
  keywords?: string[]
  productNameFallback?: string | null
  productTitleFallback?: string | null
  skipCompetitivePositioningAi?: boolean
  plannerSession?: import('@/lib/google-ads/accounts/auth/index').KeywordPlannerPreparedSession
  skipKeywordPoolExpandLoad?: boolean
}

export interface CreateCreativeAdStrengthPayloadOptions {
  includeRsaQualityGate?: boolean
}

export interface CreateCreativeScoreBreakdownOptions {
  allowPartialMetrics?: boolean
}

export interface CreateCreativeOptimizationPayloadOptions<THistory> {
  attempts: number
  targetRating: string
  achieved: boolean
  history: THistory[]
  qualityGatePassed?: boolean
}

export interface CreativeOfferSummaryInput {
  id?: number | null
  brand?: string | null
  url?: string | null
  affiliate_link?: string | null
}

export interface CreativeBucketSummaryInput {
  creativeType: string
  bucket: string
  bucketIntent: string
  generatedBuckets: string[]
}

export interface CreateCreativeResponsePayloadOptions {
  id?: number | null
  creative: GeneratedAdCreativeData
  audit?: CreativeKeywordSourceAudit
  includeNegativeKeywords?: boolean
  includeKeywordSupplementation?: boolean
}

export type CreativeKeywordRuntimeCarrier = Pick<
  GeneratedAdCreativeData,
  'keywords' | 'keywordsWithVolume' | 'promptKeywords' | 'keywordSupplementation'
> & {
  executableKeywords?: string[]
  audit?: CreativeKeywordSourceAudit
  /** @deprecated Read-compat for persisted creatives before audit field migration */
  keywordSourceAudit?: CreativeKeywordSourceAudit
  adStrength?: {
    audit?: CreativeKeywordSourceAudit
    keywordSourceAudit?: CreativeKeywordSourceAudit
  } | null
}
