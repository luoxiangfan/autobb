import { describe, expect, it } from 'vitest'
import type { GeneratedAdCreativeData } from '../ad-creative'
import {
  runCreativeGenerationQualityLoop,
  type CreativeAttemptEvaluation
} from '../ad-creative-quality-loop'

function buildCreative(attempt: number): GeneratedAdCreativeData {
  return {
    headlines: [`Headline ${attempt}`, 'Headline B', 'Headline C'],
    descriptions: [
      'Trusted quality and comfort. Shop Now.',
      'Learn More about breathable support.',
      'Premium fit for daily training.'
    ],
    keywords: ['sports bra', 'workout bra'],
    callouts: ['Breathable Fabric'],
    sitelinks: [{ text: 'Shop Now', url: '/', description: 'Find Your Fit' }],
    theme: 'test',
    explanation: 'test'
  }
}

function mockEvaluation(params: {
  score: number
  rating: string
  passed: boolean
  failureType?: 'intent_fail' | 'format_fail' | 'evidence_fail' | null
}): CreativeAttemptEvaluation {
  return {
    adStrength: {
      finalScore: params.score,
      finalRating: params.rating,
      combinedSuggestions: params.passed ? [] : ['Improve relevance']
    } as any,
    rsaGate: {
      passed: params.passed,
      reasons: params.passed ? [] : ['finalScore < 70']
    } as any,
    ruleGate: {
      passed: params.passed
    } as any,
    passed: params.passed,
    failureType: params.passed ? null : (params.failureType || 'format_fail'),
    reasons: params.passed ? [] : ['quality gate failed']
  }
}

describe('ad-creative-quality-loop', () => {
  it('stops early when quality gate passes', async () => {
    const result = await runCreativeGenerationQualityLoop({
      maxRetries: 2,
      generate: async ({ attempt }) => buildCreative(attempt),
      evaluate: async (_, { attempt }) => {
        if (attempt === 1) {
          return mockEvaluation({ score: 66, rating: 'AVERAGE', passed: false, failureType: 'intent_fail' })
        }
        return mockEvaluation({ score: 74, rating: 'GOOD', passed: true })
      }
    })

    expect(result.accepted).toBe(true)
    expect(result.attempts).toBe(2)
    expect(result.history).toHaveLength(2)
    expect(result.selectedEvaluation.adStrength.finalScore).toBe(74)
  })

  it('keeps best-scoring fallback when all attempts fail', async () => {
    const scores = [61, 69, 66]

    const result = await runCreativeGenerationQualityLoop({
      maxRetries: 2,
      generate: async ({ attempt }) => buildCreative(attempt),
      evaluate: async (_, { attempt }) => mockEvaluation({
        score: scores[attempt - 1],
        rating: 'AVERAGE',
        passed: false
      })
    })

    expect(result.accepted).toBe(false)
    expect(result.attempts).toBe(3)
    expect(result.history).toHaveLength(3)
    expect(result.selectedEvaluation.adStrength.finalScore).toBe(69)
    expect(result.selectedCreative.headlines[0]).toBe('Headline 2')
  })

  it('clamps max retries to 2 (total 3 attempts)', async () => {
    const result = await runCreativeGenerationQualityLoop({
      maxRetries: 9,
      generate: async ({ attempt }) => buildCreative(attempt),
      evaluate: async () => mockEvaluation({
        score: 65,
        rating: 'AVERAGE',
        passed: false
      })
    })

    expect(result.maxRetries).toBe(2)
    expect(result.attempts).toBe(3)
    expect(result.history).toHaveLength(3)
  })
})
