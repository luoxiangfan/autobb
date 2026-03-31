import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getKeywordsMock } = vi.hoisted(() => ({
  getKeywordsMock: vi.fn(),
}))

vi.mock('../offer-keyword-pool', () => ({
  getKeywords: getKeywordsMock,
}))

import {
  buildIntentStrategySection,
  buildPromptVariables,
  resolvePromptKeywordMinSearchVolume,
  resolvePromptBucket,
} from '../creative-splitted/creative-orchestrator'

describe('creative-orchestrator intent strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getKeywordsMock.mockResolvedValue({
      keywords: [],
    })
  })

  it('normalizes legacy buckets to canonical prompt buckets', () => {
    expect(resolvePromptBucket('A')).toBe('A')
    expect(resolvePromptBucket('C')).toBe('B')
    expect(resolvePromptBucket('S')).toBe('D')
  })

  it('keeps model-intent prompt keyword thresholds relaxed for long-tail model anchors', () => {
    expect(resolvePromptKeywordMinSearchVolume('B')).toBe(0)
    expect(resolvePromptKeywordMinSearchVolume('A')).toBe(100)
    expect(resolvePromptKeywordMinSearchVolume('D')).toBe(100)
  })

  it('builds model-intent strategy for legacy bucket C', () => {
    const section = buildIntentStrategySection('C', 0, 0, 0)

    expect(section).toContain('Bucket B')
    expect(section).toContain('model_intent')
    expect(section).toContain('完全匹配')
  })

  it('builds product-intent strategy for legacy bucket S', () => {
    const section = buildIntentStrategySection('S', 0, 0, 0)

    expect(section).toContain('Bucket D')
    expect(section).toContain('product_intent')
    expect(section).toContain('商品需求')
  })

  it('injects canonical model-intent prompt guidance even without review-derived sections', async () => {
    getKeywordsMock.mockResolvedValue({
      keywords: [
        { keyword: 'eufy x10 pro omni robot vacuum', searchVolume: 1200, source: 'POOL' },
      ],
    })

    const variables = await buildPromptVariables(
      {
        id: 101,
        title: 'Eufy X10 Pro Omni Robot Vacuum',
        category: 'Robot Vacuum',
        brand: 'Eufy',
      },
      {},
      null,
      {
        bucket: 'C',
        brandName: 'Eufy',
      }
    )

    expect(getKeywordsMock).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        bucket: 'B',
        minSearchVolume: 0,
      })
    )
    expect(variables.ai_keywords_section).toContain('商品型号/产品族导向关键词池')
    expect(variables.ai_keywords_section).toContain('完全匹配')
    expect(variables.intent_strategy_section).toContain('model_intent')
  })

  it('requires branded keywords for brand-intent prompt pools', async () => {
    getKeywordsMock.mockResolvedValue({
      keywords: [
        { keyword: 'security camera', searchVolume: 1800, source: 'POOL' },
        { keyword: 'eufy security camera', searchVolume: 1500, source: 'POOL' },
      ],
    })

    const variables = await buildPromptVariables(
      {
        id: 103,
        title: 'Eufy Security Camera',
        category: 'Security Camera',
        brand: 'Eufy',
      },
      {},
      null,
      {
        bucket: 'A',
        brandName: 'Eufy',
      }
    )

    expect(getKeywordsMock).toHaveBeenCalledWith(
      103,
      expect.objectContaining({
        bucket: 'A',
        minSearchVolume: 100,
      })
    )
    const promptKeywordLine = variables.ai_keywords_section
      .split('\n')
      .map(line => line.trim())
      .find(line => line.includes('eufy security camera')) || ''
    expect(promptKeywordLine.split(', ').filter(Boolean)).toEqual(['eufy security camera'])
  })

  it('injects canonical product-intent prompt guidance for legacy bucket S', async () => {
    getKeywordsMock.mockResolvedValue({
      keywords: [
        { keyword: 'eufy robot vacuum for pet hair', searchVolume: 900, source: 'POOL' },
      ],
    })

    const variables = await buildPromptVariables(
      {
        id: 102,
        title: 'Eufy Robot Vacuum',
        category: 'Robot Vacuum',
        brand: 'Eufy',
      },
      {},
      null,
      {
        bucket: 'S',
        brandName: 'Eufy',
      }
    )

    expect(getKeywordsMock).toHaveBeenCalledWith(
      102,
      expect.objectContaining({
        bucket: 'D',
        minSearchVolume: 100,
      })
    )
    expect(variables.ai_keywords_section).toContain('商品需求导向关键词池')
    expect(variables.intent_strategy_section).toContain('product_intent')
  })
})
