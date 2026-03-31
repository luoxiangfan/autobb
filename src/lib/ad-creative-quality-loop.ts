import type { DescriptionAsset, GeneratedAdCreativeData, HeadlineAsset } from './ad-creative'
import {
  evaluateCreativeAdStrength,
  type ComprehensiveAdStrengthResult
} from './scoring'
import {
  evaluateRsaQualityGate,
  inferRetryFailureType,
  RSA_QUALITY_MINIMUM_SCORE,
  type RetryFailureType,
  type RsaQualityGateDecision
} from './rsa-quality-gate'
import {
  evaluateCreativeRuleGate,
  type CreativeRuleContext,
  type CreativeRuleContextInput,
  type CreativeRuleGateDecision
} from './ad-creative-rule-gate'
import type { CanonicalCreativeType } from './creative-type'

export const AD_CREATIVE_REQUIRED_MIN_SCORE = RSA_QUALITY_MINIMUM_SCORE // GOOD
export const AD_CREATIVE_MAX_AUTO_RETRIES = 2

export interface CreativeAttemptEvaluation {
  adStrength: ComprehensiveAdStrengthResult
  rsaGate: RsaQualityGateDecision
  ruleGate: CreativeRuleGateDecision
  passed: boolean
  failureType: RetryFailureType | null
  reasons: string[]
}

export interface CreativeGenerationHistoryItem {
  attempt: number
  rating: string
  score: number
  passed: boolean
  rsaPassed: boolean
  rulePassed: boolean
  failureType: RetryFailureType | null
  reasons: string[]
  suggestions: string[]
  error?: string
}

export interface CreativeGenerationLoopResult<TCreative extends GeneratedAdCreativeData> {
  attempts: number
  maxRetries: number
  accepted: boolean
  selectedCreative: TCreative
  selectedEvaluation: CreativeAttemptEvaluation
  history: CreativeGenerationHistoryItem[]
}

export interface CreativeQualityEvaluationInput {
  creative: GeneratedAdCreativeData
  ruleContext: CreativeRuleContextInput | CreativeRuleContext
  minimumScore?: number
  adStrengthContext: {
    brandName?: string | null
    targetCountry?: string | null
    targetLanguage?: string | null
    bucketType?: 'A' | 'B' | 'C' | 'D' | 'S' | null
    creativeType?: CanonicalCreativeType | null
    userId?: number
  }
}

interface AttemptCandidate<TCreative extends GeneratedAdCreativeData> {
  creative: TCreative
  evaluation: CreativeAttemptEvaluation
}

interface LoopCallbacks<TCreative extends GeneratedAdCreativeData> {
  maxRetries?: number
  delayMs?: number
  generate: (ctx: { attempt: number; retryFailureType?: RetryFailureType }) => Promise<TCreative>
  evaluate: (creative: TCreative, ctx: { attempt: number }) => Promise<CreativeAttemptEvaluation>
}

function ensureCreativeMetadata(creative: GeneratedAdCreativeData): {
  headlinesWithMetadata: HeadlineAsset[]
  descriptionsWithMetadata: DescriptionAsset[]
} {
  const headlinesWithMetadata = creative.headlinesWithMetadata && creative.headlinesWithMetadata.length > 0
    ? creative.headlinesWithMetadata.map((item, index) => ({
      ...item,
      text: creative.headlines[index] ?? item.text,
      length: (creative.headlines[index] ?? item.text).length
    }))
    : (creative.headlines || []).map(text => ({
      text,
      length: text.length
    }))

  const descriptionsWithMetadata = creative.descriptionsWithMetadata && creative.descriptionsWithMetadata.length > 0
    ? creative.descriptionsWithMetadata.map((item, index) => ({
      ...item,
      text: creative.descriptions[index] ?? item.text,
      length: (creative.descriptions[index] ?? item.text).length
    }))
    : (creative.descriptions || []).map(text => ({
      text,
      length: text.length
    }))

  return {
    headlinesWithMetadata,
    descriptionsWithMetadata
  }
}

function resolveFailureType(
  rsaGate: RsaQualityGateDecision,
  ruleGate: CreativeRuleGateDecision,
  adStrength: ComprehensiveAdStrengthResult
): RetryFailureType | null {
  if (ruleGate.relevance.passed === false) return 'intent_fail'
  if (ruleGate.conversion.passed === false) return 'intent_fail'
  if (ruleGate.diversity.passed === false) return 'format_fail'
  if (rsaGate.passed) return null
  return rsaGate.failureType || inferRetryFailureType(adStrength)
}

function isCandidateBetter<TCreative extends GeneratedAdCreativeData>(
  current: AttemptCandidate<TCreative>,
  best: AttemptCandidate<TCreative>
): boolean {
  if (current.evaluation.passed && !best.evaluation.passed) return true
  if (current.evaluation.passed === best.evaluation.passed) {
    if (current.evaluation.rsaGate.passed && !best.evaluation.rsaGate.passed) return true
    if (current.evaluation.rsaGate.passed === best.evaluation.rsaGate.passed) {
      if (current.evaluation.adStrength.finalScore > best.evaluation.adStrength.finalScore) return true
    }
  }
  return false
}

function normalizeMaxRetries(value: number | undefined): number {
  const parsed = Number.isFinite(Number(value)) ? Number(value) : AD_CREATIVE_MAX_AUTO_RETRIES
  if (parsed < 0) return 0
  if (parsed > AD_CREATIVE_MAX_AUTO_RETRIES) return AD_CREATIVE_MAX_AUTO_RETRIES
  return Math.floor(parsed)
}

export async function evaluateCreativeForQuality(
  input: CreativeQualityEvaluationInput
): Promise<CreativeAttemptEvaluation> {
  const { creative, ruleContext, adStrengthContext } = input
  const minimumScore = Number(input.minimumScore || AD_CREATIVE_REQUIRED_MIN_SCORE)
  const metadata = ensureCreativeMetadata(creative)

  creative.headlinesWithMetadata = metadata.headlinesWithMetadata
  creative.descriptionsWithMetadata = metadata.descriptionsWithMetadata

  const adStrength = await evaluateCreativeAdStrength(
    metadata.headlinesWithMetadata,
    metadata.descriptionsWithMetadata,
    creative.keywords || [],
    {
      brandName: adStrengthContext.brandName || undefined,
      targetCountry: adStrengthContext.targetCountry || 'US',
      targetLanguage: adStrengthContext.targetLanguage || 'en',
      bucketType: adStrengthContext.bucketType || undefined,
      creativeType: adStrengthContext.creativeType || undefined,
      userId: adStrengthContext.userId,
      keywordsWithVolume: creative.keywordsWithVolume,
    }
  )
  const rsaGate = evaluateRsaQualityGate(adStrength, minimumScore)
  const ruleGate = evaluateCreativeRuleGate(creative, ruleContext)
  const passed = rsaGate.passed && ruleGate.passed
  const reasons = [...rsaGate.reasons, ...ruleGate.reasons]
  const failureType = passed ? null : resolveFailureType(rsaGate, ruleGate, adStrength)

  return {
    adStrength,
    rsaGate,
    ruleGate,
    passed,
    failureType,
    reasons
  }
}

export async function runCreativeGenerationQualityLoop<TCreative extends GeneratedAdCreativeData>(
  callbacks: LoopCallbacks<TCreative>
): Promise<CreativeGenerationLoopResult<TCreative>> {
  const maxRetries = normalizeMaxRetries(callbacks.maxRetries)
  const maxAttempts = maxRetries + 1
  const history: CreativeGenerationHistoryItem[] = []
  let attempts = 0
  let retryFailureType: RetryFailureType | undefined
  let bestCandidate: AttemptCandidate<TCreative> | null = null
  let accepted = false
  let lastError: Error | null = null

  while (attempts < maxAttempts) {
    attempts += 1
    try {
      const creative = await callbacks.generate({ attempt: attempts, retryFailureType })
      const evaluation = await callbacks.evaluate(creative, { attempt: attempts })
      const candidate = { creative, evaluation }

      if (!bestCandidate || isCandidateBetter(candidate, bestCandidate)) {
        bestCandidate = candidate
      }

      history.push({
        attempt: attempts,
        rating: evaluation.adStrength.finalRating,
        score: evaluation.adStrength.finalScore,
        passed: evaluation.passed,
        rsaPassed: evaluation.rsaGate.passed,
        rulePassed: evaluation.ruleGate.passed,
        failureType: evaluation.failureType,
        reasons: evaluation.reasons,
        suggestions: evaluation.adStrength.combinedSuggestions || []
      })

      if (evaluation.passed) {
        accepted = true
        break
      }

      retryFailureType = evaluation.failureType || 'format_fail'
    } catch (error: any) {
      const message = error?.message || String(error)
      lastError = error instanceof Error ? error : new Error(message)
      history.push({
        attempt: attempts,
        rating: 'ERROR',
        score: 0,
        passed: false,
        rsaPassed: false,
        rulePassed: false,
        failureType: 'format_fail',
        reasons: [message],
        suggestions: [],
        error: message
      })
    }

    if (attempts < maxAttempts && callbacks.delayMs && callbacks.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, callbacks.delayMs))
    }
  }

  if (!bestCandidate) {
    if (lastError) throw lastError
    throw new Error('creative generation failed with no successful attempts')
  }

  return {
    attempts,
    maxRetries,
    accepted,
    selectedCreative: bestCandidate.creative,
    selectedEvaluation: bestCandidate.evaluation,
    history
  }
}
