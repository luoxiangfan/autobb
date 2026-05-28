import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateMultipleCreativesWithDiversityCheck } from '../ad-creative-generator'

const poolFns = vi.hoisted(() => ({
  resolveKeywordPoolForCreativeGeneration: vi.fn(),
}))

const generatorFns = vi.hoisted(() => ({
  generateAdCreative: vi.fn(),
}))

vi.mock('../offer-keyword-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../offer-keyword-pool')>()
  return {
    ...actual,
    resolveKeywordPoolForCreativeGeneration: poolFns.resolveKeywordPoolForCreativeGeneration,
  }
})

vi.mock('../ad-creative-generator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ad-creative-generator')>()
  return {
    ...actual,
    generateAdCreative: generatorFns.generateAdCreative,
  }
})

describe('generateMultipleCreativesWithDiversityCheck', () => {
  const mockSession = { volumeAuth: { authType: 'oauth' } }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    poolFns.resolveKeywordPoolForCreativeGeneration.mockResolvedValue({
      pool: { id: 1, offerId: 9, totalKeywords: 10 },
      plannerSession: mockSession,
      preparedExpand: {
        ok: true,
        creds: { authType: 'oauth', linkedServiceAccountId: null },
        plannerSession: mockSession,
      },
    })

    generatorFns.generateAdCreative.mockResolvedValue({
      headlines: ['H1', 'H2', 'H3'],
      descriptions: ['D1', 'D2'],
      keywords: ['kw'],
      ai_model: 'test',
    })
  })

  it('resolves keyword pool once before the diversity loop when session is not provided', async () => {
    await generateMultipleCreativesWithDiversityCheck(9, 1, 1, 0.2, 3, {
      skipCache: true,
    })

    expect(poolFns.resolveKeywordPoolForCreativeGeneration).toHaveBeenCalledTimes(1)
    expect(poolFns.resolveKeywordPoolForCreativeGeneration).toHaveBeenCalledWith(9, 1)
  })

  it('skips resolve when caller supplies keyword pool and planner session', async () => {
    const keywordPool = { id: 2, offerId: 9, totalKeywords: 5 }

    await generateMultipleCreativesWithDiversityCheck(9, 1, 1, 0.2, 3, {
      keywordPool: keywordPool as any,
      plannerSession: mockSession as any,
      skipCache: true,
    })

    expect(poolFns.resolveKeywordPoolForCreativeGeneration).not.toHaveBeenCalled()
  })
})
