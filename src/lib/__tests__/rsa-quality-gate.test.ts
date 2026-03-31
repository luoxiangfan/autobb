import { describe, expect, it } from 'vitest'
import { evaluateRsaQualityGate } from '../rsa-quality-gate'

function buildEvaluation(params: {
  expectedBucket: 'A' | 'B' | 'D' | 'UNSPECIFIED'
  queryLandingAlignmentScore: number
}) {
  return {
    localEvaluation: {
      dimensions: {
        relevance: {
          score: 16,
          details: {
            keywordCoverage: 8,
            productFocus: 2,
          },
        },
        compliance: {
          score: 7,
          details: {},
        },
      },
      copyIntentMetrics: {
        expectedBucket: params.expectedBucket,
        typeIntentAlignmentScore: 82,
        copyIntentCoverage: 60,
      },
    },
    rsaQualityGate: {
      intentAlignmentScore: 82,
      evidenceAlignmentScore: 88,
      queryLandingAlignmentScore: params.queryLandingAlignmentScore,
      passed: false,
      reasons: [`queryLandingAlignmentScore ${params.queryLandingAlignmentScore} < 65`],
    },
    finalRating: 'GOOD',
    finalScore: 75,
    combinedSuggestions: [],
  } as any
}

describe('rsa-quality-gate adaptive thresholds', () => {
  it('passes brand-intent bucket A when queryLandingAlignmentScore is 58', () => {
    const decision = evaluateRsaQualityGate(buildEvaluation({
      expectedBucket: 'A',
      queryLandingAlignmentScore: 58,
    }))

    expect(decision.passed).toBe(true)
    expect(decision.reasons).toEqual([])
  })

  it('keeps non-A buckets on stricter queryLandingAlignmentScore threshold', () => {
    const decision = evaluateRsaQualityGate(buildEvaluation({
      expectedBucket: 'B',
      queryLandingAlignmentScore: 64,
    }))

    expect(decision.passed).toBe(false)
    expect(decision.reasons.join(' | ')).toContain('queryLandingAlignmentScore 64 < 65')
  })
})
