import { describe, expect, it, vi } from 'vitest'

import { parseAIResponse } from '../creative-splitted/creative-generator'

describe('creative-splitted parseAIResponse', () => {
  it('delegates to the main parser so structured keyword metadata is preserved', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = {
      text: JSON.stringify({
        headlines: [
          { text: 'BrandX X200 Vacuum', type: 'brand', length: 20 },
          { text: 'Shop BrandX Models', type: 'cta', length: 19 },
          { text: 'Verified Hot Products', type: 'feature', length: 21 },
        ],
        descriptions: [
          { text: 'Shop verified BrandX robot vacuum models today.', type: 'feature-benefit-cta', length: 48 },
          { text: 'Only verified models and evidence-backed claims.', type: 'usp-differentiation', length: 49 },
        ],
        keywords: ['brandx x200 vacuum', 'brandx robot vacuum'],
        keywordCandidates: [
          {
            text: 'brandx x200 vacuum',
            sourceType: 'search_term',
            sourceField: 'topProducts',
            anchorType: 'model',
            evidence: ['deepScrapeResults.topProducts[0].title'],
            suggestedMatchType: 'EXACT',
            confidence: 0.94,
            qualityReason: 'verified hot model',
          },
        ],
        evidenceProducts: ['BrandX X200 Vacuum'],
        theme: '商品型号/产品族意图导向',
      }),
    }

    const result = await parseAIResponse(response, {} as any)

    expect(result.keywords).toEqual(['brandx x200 vacuum', 'brandx robot vacuum'])
    expect(result.keywordCandidates).toEqual([
      {
        text: 'brandx x200 vacuum',
        sourceType: 'search_term',
        sourceField: 'topProducts',
        anchorType: 'model',
        evidence: ['deepScrapeResults.topProducts[0].title'],
        suggestedMatchType: 'EXACT',
        confidence: 0.94,
        qualityReason: 'verified hot model',
      },
    ])
    expect(result.evidenceProducts).toEqual(['BrandX X200 Vacuum'])
  })
})
