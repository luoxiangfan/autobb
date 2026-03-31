import type { ComprehensiveAdStrengthResult } from './scoring'

export type RetryFailureType = 'evidence_fail' | 'intent_fail' | 'format_fail'

export const RSA_QUALITY_MINIMUM_SCORE = 70

export const RSA_QUALITY_GATE_THRESHOLDS = {
  intentAlignmentScore: 70,
  evidenceAlignmentScore: 75,
  queryLandingAlignmentScore: 65,
} as const

interface GateScores {
  intentAlignmentScore: number
  evidenceAlignmentScore: number
  queryLandingAlignmentScore: number
}

export interface RsaQualityGateDecision {
  passed: boolean
  minimumScore: number
  minimumScorePassed: boolean
  gatePassed: boolean
  reasons: string[]
  failureType: RetryFailureType | null
  scores: GateScores
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function buildFallbackScores(evaluation: ComprehensiveAdStrengthResult): GateScores {
  const relevance = evaluation.localEvaluation.dimensions.relevance
  const compliance = evaluation.localEvaluation.dimensions.compliance

  const intentAlignmentScore = clampScore(
    evaluation.localEvaluation.copyIntentMetrics?.typeIntentAlignmentScore ??
      (relevance.score / 22) * 100
  )
  const evidenceAlignmentScore = clampScore((compliance.score / 8) * 100)
  const keywordCoveragePct = clampScore((relevance.details.keywordCoverage || 0) * 10)
  const productFocusPct = clampScore(((relevance.details.productFocus || 0) / 4) * 100)
  const queryLandingAlignmentScore = clampScore(keywordCoveragePct * 0.6 + productFocusPct * 0.4)

  return {
    intentAlignmentScore,
    evidenceAlignmentScore,
    queryLandingAlignmentScore,
  }
}

function getGateScores(evaluation: ComprehensiveAdStrengthResult): GateScores {
  if (evaluation.rsaQualityGate) {
    return {
      intentAlignmentScore: clampScore(evaluation.rsaQualityGate.intentAlignmentScore),
      evidenceAlignmentScore: clampScore(evaluation.rsaQualityGate.evidenceAlignmentScore),
      queryLandingAlignmentScore: clampScore(evaluation.rsaQualityGate.queryLandingAlignmentScore),
    }
  }
  return buildFallbackScores(evaluation)
}

function resolveGateThresholds(evaluation: ComprehensiveAdStrengthResult) {
  const expectedBucket = evaluation.localEvaluation.copyIntentMetrics?.expectedBucket
  if (expectedBucket === 'A') {
    return {
      ...RSA_QUALITY_GATE_THRESHOLDS,
      queryLandingAlignmentScore: 58,
    }
  }
  return RSA_QUALITY_GATE_THRESHOLDS
}

export function inferRetryFailureType(
  evaluation: ComprehensiveAdStrengthResult
): RetryFailureType {
  const scores = getGateScores(evaluation)
  const thresholds = resolveGateThresholds(evaluation)

  if (scores.evidenceAlignmentScore < thresholds.evidenceAlignmentScore) {
    return 'evidence_fail'
  }
  if (scores.intentAlignmentScore < thresholds.intentAlignmentScore) {
    return 'intent_fail'
  }
  if (scores.queryLandingAlignmentScore < thresholds.queryLandingAlignmentScore) {
    return 'format_fail'
  }

  if (evaluation.finalScore < RSA_QUALITY_MINIMUM_SCORE) {
    if (evaluation.localEvaluation.dimensions.compliance.score <= 5) {
      return 'evidence_fail'
    }
    if ((evaluation.localEvaluation.copyIntentMetrics?.typeIntentAlignmentScore ?? 100) < 70) {
      return 'intent_fail'
    }
  }

  return 'format_fail'
}

export function evaluateRsaQualityGate(
  evaluation: ComprehensiveAdStrengthResult,
  minimumScore: number = RSA_QUALITY_MINIMUM_SCORE
): RsaQualityGateDecision {
  const scores = getGateScores(evaluation)
  const thresholds = resolveGateThresholds(evaluation)
  const minimumScorePassed = evaluation.finalScore >= minimumScore
  const gatePassed = (
    scores.intentAlignmentScore >= thresholds.intentAlignmentScore &&
    scores.evidenceAlignmentScore >= thresholds.evidenceAlignmentScore &&
    scores.queryLandingAlignmentScore >= thresholds.queryLandingAlignmentScore
  )

  const reasons: string[] = []
  if (!minimumScorePassed) {
    reasons.push(`finalScore ${evaluation.finalScore} < ${minimumScore}`)
  }

  if (scores.intentAlignmentScore < thresholds.intentAlignmentScore) {
    reasons.push(
      `intentAlignmentScore ${scores.intentAlignmentScore} < ${thresholds.intentAlignmentScore}`
    )
  }
  if (scores.evidenceAlignmentScore < thresholds.evidenceAlignmentScore) {
    reasons.push(
      `evidenceAlignmentScore ${scores.evidenceAlignmentScore} < ${thresholds.evidenceAlignmentScore}`
    )
  }
  if (scores.queryLandingAlignmentScore < thresholds.queryLandingAlignmentScore) {
    reasons.push(
      `queryLandingAlignmentScore ${scores.queryLandingAlignmentScore} < ${thresholds.queryLandingAlignmentScore}`
    )
  }

  const passed = minimumScorePassed && gatePassed
  return {
    passed,
    minimumScore,
    minimumScorePassed,
    gatePassed,
    reasons,
    failureType: passed ? null : inferRetryFailureType(evaluation),
    scores,
  }
}
