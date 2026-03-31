import { describe, expect, it } from 'vitest'
import {
  buildProductModelFamilyContext,
  buildProductModelFamilyFallbackKeywords,
  filterKeywordObjectsByProductModelFamily,
  isKeywordInProductModelFamily,
  MODEL_INTENT_MIN_KEYWORD_FLOOR,
  supplementModelIntentKeywordsWithFallback,
} from '../model-intent-family-filter'

describe('model-intent-family-filter', () => {
  it('extracts current product model family signals from product evidence', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX F3800 Portable Power Station, 3840Wh, 6000W AC Output',
      offer_name: 'Anker_US_07',
      scraped_data: JSON.stringify({
        title: 'Anker SOLIX F3800 Portable Power Station',
        productTitle: 'Anker SOLIX F3800',
      }),
    })

    expect(context.modelCodes).toContain('f3800')
    expect(context.lineTerms).toContain('solix')
    expect(context.specTerms).toContain('3840wh')
    expect(context.specTerms).toContain('6000w')
  })

  it('keeps only keywords within current product model family', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX F3800 Portable Power Station, 3840Wh, 6000W AC Output',
      scraped_data: JSON.stringify({ productTitle: 'Anker SOLIX F3800' }),
    })

    const input = [
      { keyword: 'anker solix f3800 price', searchVolume: 100 },
      { keyword: 'anker solix portable power station', searchVolume: 80 },
      { keyword: 'anker solix c300x', searchVolume: 90 },
      { keyword: 'anker 25k power bank', searchVolume: 120 },
      { keyword: 'anker generator', searchVolume: 70 },
    ]

    const result = filterKeywordObjectsByProductModelFamily(input, context)
    const keywords = result.filtered.map((item) => item.keyword)

    expect(keywords).toContain('anker solix f3800 price')
    expect(keywords).not.toContain('anker solix portable power station')
    expect(keywords).not.toContain('anker solix c300x')
    expect(keywords).not.toContain('anker 25k power bank')
    expect(keywords).not.toContain('anker generator')
  })

  it('returns unchanged when offer has no model-family signals', () => {
    const context = buildProductModelFamilyContext({
      brand: 'BrandX',
      product_name: 'BrandX portable speaker',
    })

    const input = [
      { keyword: 'brandx speaker', searchVolume: 100 },
      { keyword: 'brandx bluetooth speaker', searchVolume: 80 },
    ]
    const result = filterKeywordObjectsByProductModelFamily(input, context)

    expect(result.filtered).toEqual(input)
    expect(result.removed).toHaveLength(0)
  })

  it('provides deterministic fallback keywords', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX F3800 Portable Power Station, 3840Wh',
      scraped_data: JSON.stringify({ productTitle: 'Anker SOLIX F3800' }),
    })
    const fallback = buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'Anker',
    })

    expect(fallback.some((item) => item.includes('f3800'))).toBe(true)
    expect(fallback.some((item) => item.includes('solix'))).toBe(true)
  })

  it('rejects foreign model code even when line term overlaps', () => {
    const context = {
      modelCodes: ['f3800'],
      lineTerms: ['solix'],
      specTerms: [],
      evidenceTexts: [],
    }

    expect(isKeywordInProductModelFamily('anker solix f3800', context)).toBe(true)
    expect(isKeywordInProductModelFamily('anker solix c300x', context)).toBe(false)
    expect(isKeywordInProductModelFamily('anker solix portable power station', context)).toBe(false)
  })

  it('extracts and matches numeric-only model codes', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker 767 Solar Generator, 2048Wh Portable Power Station',
      scraped_data: JSON.stringify({ productTitle: 'Anker 767 Solar Generator' }),
    })

    expect(context.modelCodes).toContain('767')
    expect(isKeywordInProductModelFamily('anker 767 solar generator', context)).toBe(true)
    expect(isKeywordInProductModelFamily('anker 521 solar generator', context)).toBe(false)
  })

  it('ignores ASIN-like identifiers and uses title/about terms for fallback model context', () => {
    const title = 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm'
    const context = buildProductModelFamilyContext({
      brand: 'Novilla',
      product_name: title,
      final_url: 'https://www.amazon.com/dp/B0CJJ9SB4Y',
      scraped_data: JSON.stringify({
        rawProductTitle: title,
        rawAboutThisItem: ['King size support', 'Medium firm feel'],
        asin: 'B0CJJ9SB4Y',
      }),
    })

    const fallback = buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'Novilla',
    })

    expect(context.modelCodes).not.toContain('b0cjj9sb4y')
    expect(fallback.some((keyword) => /b0cjj9sb4y/i.test(keyword))).toBe(false)
    expect(fallback.some((keyword) => keyword.startsWith('novilla '))).toBe(true)
  })

  it('extracts soft family and product core signals for non-hard-model products', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Novilla',
      product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
        rawAboutThisItem: ['King size support', '10 inch memory foam design', 'Medium firm feel'],
      }),
    })

    expect(context.productCoreTerms).toEqual(expect.arrayContaining(['mattress']))
    expect(context.attributeTerms).toEqual(expect.arrayContaining([
      'king',
      '10 inch',
      'memory foam',
      'medium firm',
    ]))
    expect(context.softFamilyTerms).toEqual(expect.arrayContaining([
      'king mattress',
      '10 inch mattress',
      'memory foam mattress',
      'medium firm mattress',
    ]))
  })

  it('matches soft family keywords and keeps branded single-core term while rejecting weak variants', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Novilla',
      product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
        rawAboutThisItem: ['King size support', '10 inch memory foam design', 'Medium firm feel'],
      }),
    })

    expect(isKeywordInProductModelFamily('novilla king mattress', context)).toBe(true)
    expect(isKeywordInProductModelFamily('novilla 10 inch memory foam mattress', context)).toBe(true)
    expect(isKeywordInProductModelFamily('novilla medium firm mattress', context)).toBe(true)
    expect(isKeywordInProductModelFamily('novilla mattress', context)).toBe(true)
    expect(isKeywordInProductModelFamily('mattress', context)).toBe(false)
    expect(isKeywordInProductModelFamily('novilla queen mattress', context)).toBe(false)
    expect(isKeywordInProductModelFamily('novilla 12 inch mattress', context)).toBe(false)
    expect(isKeywordInProductModelFamily('novilla king mattress 12', context)).toBe(false)
    expect(isKeywordInProductModelFamily('novilla gel memory foam mattress', context)).toBe(false)
    expect(isKeywordInProductModelFamily('novilla mattress topper', context)).toBe(false)

    const fallback = buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'Novilla',
    })
    expect(context.attributeTerms).not.toEqual(expect.arrayContaining([
      'foam',
      'medium',
      'firm',
    ]))
    expect(fallback).toEqual(expect.arrayContaining([
      'novilla king mattress',
      'novilla 10 inch mattress',
      'novilla memory foam mattress',
    ]))
    expect(fallback).not.toEqual(expect.arrayContaining([
      'novilla foam mattress',
      'novilla medium mattress',
      'novilla firm mattress',
    ]))
  })

  it('activates family filtering for soft-family-only products', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Novilla',
      product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
        rawAboutThisItem: ['King size support', '10 inch memory foam design', 'Medium firm feel'],
      }),
    })

    const input = [
      { keyword: 'novilla king mattress', searchVolume: 2400 },
      { keyword: 'novilla memory foam mattress', searchVolume: 2200 },
      { keyword: 'novilla mattress', searchVolume: 2600 },
      { keyword: 'novilla queen mattress', searchVolume: 1800 },
    ]

    const result = filterKeywordObjectsByProductModelFamily(input, context)

    expect(result.filtered.map((item) => item.keyword)).toEqual([
      'novilla king mattress',
      'novilla memory foam mattress',
      'novilla mattress',
    ])
    expect(result.removed.map((item) => item.item.keyword)).toEqual([
      'novilla queen mattress',
    ])
  })

  it('supplements model_intent keywords to minimum floor with family fallback', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX F3800 Portable Power Station, 3840Wh, 6000W AC Output',
      scraped_data: JSON.stringify({ productTitle: 'Anker SOLIX F3800' }),
    })

    const base = [
      { keyword: 'anker solix f3800 price', searchVolume: 880, source: 'KEYWORD_POOL', matchType: 'EXACT' as const },
    ]

    const supplemented = supplementModelIntentKeywordsWithFallback({
      items: base,
      context,
      brandName: 'Anker',
      minKeywords: MODEL_INTENT_MIN_KEYWORD_FLOOR,
      buildFallbackItem: (keyword) => ({
        ...base[0],
        keyword,
        searchVolume: 0,
        source: 'MODEL_FAMILY_GUARD',
      }),
    })

    expect(supplemented.items.length).toBeGreaterThanOrEqual(MODEL_INTENT_MIN_KEYWORD_FLOOR)
    expect(supplemented.items.some((item) => item.keyword === 'anker solix f3800 price')).toBe(true)
    expect(supplemented.items.every((item) => item.keyword.includes('f3800') || item.keyword.includes('solix'))).toBe(true)
    expect(supplemented.addedKeywords.length).toBeGreaterThan(0)
  })

  it('ignores opaque auxiliary model codes and rescues branded soft-family fallbacks', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Novilla',
      product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress King, Medium Firm',
      offer_name: 'Novilla_US_11',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress King, Medium Firm',
        technicalDetails: {
          'Model Name': 'N-M01035',
          'Model Number': 'NAMM10KWV12',
        },
      }),
    })

    expect(context.modelCodes).toEqual([])
    expect(context.softFamilyTerms).toEqual(expect.arrayContaining([
      'king mattress',
      '10 inch mattress',
      'memory foam mattress',
    ]))

    const fallback = buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'Novilla',
    })

    expect(fallback).toEqual(expect.arrayContaining([
      'novilla king mattress',
      'novilla 10 inch mattress',
      'novilla memory foam mattress',
    ]))
    expect(fallback.some((keyword) => /m01035|namm10kwv12/i.test(keyword))).toBe(false)
  })

  it('prefers user-facing line and size fallback combinations when model code is absent', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX EverFrost 2 58L Cooler with 1 Removable Battery (Ships Separately), 58L Electric Cooler with Two 288Wh LiFePO4 Batteries, Powered by AC/DC or Solar, for Camping, Travel, Fishing',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Anker SOLIX EverFrost 2 58L Cooler with 1 Removable Battery (Ships Separately), 58L Electric Cooler with Two 288Wh LiFePO4 Batteries, Powered by AC/DC or Solar, for Camping, Travel, Fishing',
      }),
    })

    expect(context.lineTerms).toEqual(expect.arrayContaining(['solix', 'everfrost']))
    expect(context.specTerms).toEqual(expect.arrayContaining(['58l', '288wh']))

    const fallback = buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'Anker',
    })

    expect(fallback).toEqual(expect.arrayContaining([
      'anker solix everfrost',
      'anker solix everfrost cooler',
      'anker everfrost cooler',
      'anker 58l cooler',
    ]))
    expect(fallback.some((keyword) => keyword.includes('everfrost 2'))).toBe(true)
    expect(fallback).not.toContain('anker 288wh')
    expect(fallback).not.toContain('anker cooler 288wh')
  })

  it('prefers descriptive soft-family phrases over generic branded line terms when only title wording is available', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Vital Proteins',
      product_name: 'Vital Proteins Unflavored Collagen Powder 20 oz',
    })

    expect(context.lineTerms).toEqual(['powder'])
    expect(context.softFamilyTerms).toEqual(expect.arrayContaining([
      'unflavored collagen powder',
    ]))
    expect(isKeywordInProductModelFamily('vital proteins powder', context)).toBe(false)
    expect(isKeywordInProductModelFamily('vital proteins collagen', context)).toBe(false)
    expect(buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'Vital Proteins',
    })).toEqual(expect.arrayContaining([
      'vital proteins unflavored collagen powder',
    ]))
  })

  it('strips leading pack and claim noise from title-derived soft-family phrases', () => {
    const context = buildProductModelFamilyContext({
      brand: 'Livfresh',
      product_name: 'Livfresh 3 Pack Better Toothpaste Gel Clinically Proven to Remove 250% More Plaque and Improve Gum Health',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Livfresh 3 Pack Better Toothpaste Gel Clinically Proven to Remove 250% More Plaque and Improve Gum Health',
      }),
    })

    const fallback = buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'Livfresh',
    })

    expect(context.softFamilyTerms).toEqual(expect.arrayContaining([
      'toothpaste gel',
    ]))
    expect(context.softFamilyTerms).not.toEqual(expect.arrayContaining([
      '3 pack better toothpaste gel',
      '3 pack better',
    ]))
    expect(fallback).toContain('livfresh toothpaste gel')
    expect(fallback).not.toEqual(expect.arrayContaining([
      'livfresh 3 pack better toothpaste gel',
      'livfresh remove 250',
      'livfresh 250',
    ]))
  })

  it('keeps user-facing title phrases even when they are category-like soft-family signals', () => {
    const context = buildProductModelFamilyContext({
      brand: 'ALLWEI',
      product_name: 'ALLWEI Portable Power Station with Solar Panel Included, LiFePO4 Battery Backup',
    })

    const fallback = buildProductModelFamilyFallbackKeywords({
      context,
      brandName: 'ALLWEI',
    })

    expect(context.softFamilyTerms).toEqual(expect.arrayContaining([
      'portable power station',
    ]))
    expect(fallback).toContain('allwei portable power station')
  })
})
