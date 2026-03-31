import { describe, expect, it, vi } from 'vitest'

vi.mock('google-ads-api', () => ({
  GoogleAdsApi: class {},
  Customer: class {},
  enums: {},
}))

describe('ensureKeywordsInHeadlines duplicate-asset guard', () => {
  it('avoids duplicate headline assets after sanitization and truncation', async () => {
    const { ensureKeywordsInHeadlines } = await import('@/lib/google-ads-api')
    const { sanitizeGoogleAdsAdText } = await import('@/lib/google-ads-ad-text')

    const headlines = [
      '{KeyWord:Novilla} Official',
      'Novilla Full Size Mattress 14',
      'Novilla Gel-Infused Bliss',
      'Novilla Pain Relief & Spinal',
      'Novilla Memory Foam Mattress',
      'Novilla 14 Inch Mattress',
      'Novilla Full Mattress',
      'Novilla Full Size Mattress',
      'Novilla 14 Inch Gel',
      'Waking Up Sweaty & Tired?',
      'Need Better Spinal Support?',
      'Triple-Certified Safety',
      'Luxury 14-Inch Profile',
      'Shop Novilla Bliss Today',
      'Need Better Everyday Results?',
    ]

    const keywords = [
      'novilla full size mattress 14 inch',
      'novilla full mattress',
      'novilla full size mattress',
      'novilla memory foam mattress',
    ]

    const optimized = ensureKeywordsInHeadlines(headlines, keywords, 'Novilla', 3)
    const sanitizedAssetKeys = optimized.map((headline) =>
      sanitizeGoogleAdsAdText(headline, 30).trim().toLowerCase()
    )

    expect(optimized).toHaveLength(15)
    expect(new Set(sanitizedAssetKeys).size).toBe(sanitizedAssetKeys.length)
    expect(
      sanitizedAssetKeys.filter((item) => item === 'novilla full size mattress 14')
    ).toHaveLength(1)
  })

  it('normalizes duplicate headline assets before RSA mutate', async () => {
    const { ensureUniqueResponsiveSearchAdAssets } = await import('@/lib/google-ads-api')
    const { sanitizeGoogleAdsAdText } = await import('@/lib/google-ads-ad-text')

    const headlines = [
      '{KeyWord:Gevi} Official',
      'Gevi Commercial Espresso',
      'Gevi Professional Espresso',
      'Gevi Stainless Steel Expresso',
      'Gevi Espresso Machine',
      'Gevi Commercial Espresso',
      'Gevi Espresso Maker',
      'Gevi Espresso Machines',
      'gevi 1500w fast heating system',
      'Want Cafe Quality at Home?',
      'Need a Space-Saving Maker?',
      'Professional Grade Extraction',
      'Integrated Manual Frother',
      'Great Value Espresso Maker',
      'Buy gevi espresso machine',
    ]

    const uniqueHeadlines = ensureUniqueResponsiveSearchAdAssets(headlines, 30, '标题')
    const assetKeys = uniqueHeadlines.map((headline) =>
      sanitizeGoogleAdsAdText(headline, 30).trim().toLowerCase()
    )

    expect(uniqueHeadlines).toHaveLength(15)
    expect(new Set(assetKeys).size).toBe(assetKeys.length)
    expect(uniqueHeadlines[5]).not.toBe('Gevi Commercial Espresso')
  })
})
