import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertExecutableKeywordsNonEmpty,
  assertPostGenerationPersistenceGate,
  evaluateCreativeWithPersistenceGate,
  resolveOfferLinkType,
} from './bucket-creative-generation-pipeline'
import { normalizeCreativeBucketSlot } from './creative-type'
import { resolveStoredGenerationMode } from './ad-creative-generation-mode'
import { getAdCreativeGenerationModeProfile } from './ad-creative-generation-mode'

const qualityFns = vi.hoisted(() => ({
  evaluateCreativeForQuality: vi.fn(),
}))

const keywordRuntimeFns = vi.hoisted(() => ({
  evaluateCreativePersistenceHardGate: vi.fn(),
  createCreativeQualityEvaluationInput: vi.fn((input: unknown) => input),
}))

vi.mock('./ad-creative-quality-loop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ad-creative-quality-loop')>()
  return {
    ...actual,
    evaluateCreativeForQuality: qualityFns.evaluateCreativeForQuality,
  }
})

vi.mock('./creative-keyword-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative-keyword-runtime')>()
  return {
    ...actual,
    evaluateCreativePersistenceHardGate: keywordRuntimeFns.evaluateCreativePersistenceHardGate,
    createCreativeQualityEvaluationInput: keywordRuntimeFns.createCreativeQualityEvaluationInput,
  }
})

describe('bucket-creative-generation-pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    qualityFns.evaluateCreativeForQuality.mockResolvedValue({
      passed: true,
      reasons: [],
      adStrength: { finalScore: 80, finalRating: 'GOOD' },
      rsaGate: { passed: true, reasons: [] },
      ruleGate: { passed: true, reasons: [] },
      failureType: null,
    })
    keywordRuntimeFns.evaluateCreativePersistenceHardGate.mockReturnValue({
      passed: true,
      violations: [],
    })
  })

  it('assertExecutableKeywordsNonEmpty throws when keywords are empty', () => {
    expect(() => assertExecutableKeywordsNonEmpty({ keywords: [] } as any, 'A')).toThrow(
      /关键词筛选后为空/
    )
  })

  it('evaluateCreativeWithPersistenceGate merges persistence violations', async () => {
    keywordRuntimeFns.evaluateCreativePersistenceHardGate.mockReturnValueOnce({
      passed: false,
      violations: [{ code: 'EMPTY_KEYWORDS' }],
    })

    const result = await evaluateCreativeWithPersistenceGate({
      creative: { keywords: ['a'], headlines: ['h'], descriptions: ['d'] } as any,
      offer: { brand: 'B', target_language: 'en' } as any,
      userId: 1,
      bucket: 'A',
      generationProfile: getAdCreativeGenerationModeProfile('fast'),
      hardPersistenceGateEnabled: true,
    })

    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('persistence:EMPTY_KEYWORDS')
  })

  it('resolveStoredGenerationMode preserves unknown raw values', () => {
    expect(resolveStoredGenerationMode('fast')).toBe('fast')
  })

  it('normalizeCreativeBucketSlot accepts canonical A/B/D slots only', () => {
    expect(normalizeCreativeBucketSlot('A')).toBe('A')
    expect(normalizeCreativeBucketSlot('B')).toBe('B')
    expect(normalizeCreativeBucketSlot('D')).toBe('D')
    expect(normalizeCreativeBucketSlot('a')).toBe('A')
    expect(normalizeCreativeBucketSlot('C')).toBeNull()
    expect(normalizeCreativeBucketSlot('S')).toBeNull()
    expect(normalizeCreativeBucketSlot('')).toBeNull()
  })

  it('resolveOfferLinkType prefers page_type over link_type', () => {
    expect(resolveOfferLinkType({ page_type: 'store' } as any)).toBe('store')
    expect(resolveOfferLinkType({ page_type: 'product', link_type: 'store' } as any)).toBe(
      'product'
    )
    expect(resolveOfferLinkType({ link_type: 'store' } as any)).toBe('store')
  })

  it('assertPostGenerationPersistenceGate throws when gate fails', () => {
    keywordRuntimeFns.evaluateCreativePersistenceHardGate.mockReturnValueOnce({
      passed: false,
      violations: [{ code: 'EMPTY_KEYWORDS' }],
    })

    expect(() =>
      assertPostGenerationPersistenceGate({
        enabled: true,
        creative: { keywords: [], headlines: ['h'], descriptions: ['d'] } as any,
        bucket: 'B',
        offer: { brand: 'B', target_language: 'en' } as any,
        attempts: 2,
      })
    ).toThrow(/CREATIVE_PERSISTENCE_GATE_FAILED|落库门禁/)
  })
})
