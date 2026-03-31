import { describe, expect, it, vi } from 'vitest'

vi.mock('../prompt-loader', () => ({
  loadPrompt: vi.fn(async () => {
    throw new Error('prompt not found')
  }),
}))

import { buildSyntheticPrompt } from '../creative-splitted/creative-prompt-builder'

describe('creative-prompt-builder synthetic prompt', () => {
  it('describes synthetic prompt as internal product-intent coverage mode, not a fourth type', async () => {
    const prompt = await buildSyntheticPrompt(
      {
        offer_title: 'Eufy Robot Vacuum',
        offer_category: 'Robot Vacuum',
        product_features: 'Self-emptying',
        target_audience: 'Pet owners',
        brand_name: 'Eufy',
        extracted_keywords_section: '',
        ai_keywords_section: '',
        market_analysis_section: '',
        competitor_intelligence_section: '',
        landing_page_insights_section: '',
        cpc_recommendations_section: '',
        negative_keywords_section: '',
        creative_guidelines_section: '',
        product_usps: '',
        seasonal_trends: '',
        market_positioning: '',
        tone_of_voice: '',
        call_to_action: '',
      },
      {}
    )

    expect(prompt).toContain('这不是第4种创意类型')
    expect(prompt).toContain('商品需求覆盖导向')
    expect(prompt).toContain('product_intent')
    expect(prompt).not.toContain('结合品牌、场景和功能三个维度')
  })
})
