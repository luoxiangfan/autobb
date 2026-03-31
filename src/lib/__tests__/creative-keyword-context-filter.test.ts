import { describe, expect, it } from 'vitest'
import { filterCreativeKeywordsByOfferContextDetailed } from '../creative-keyword-context-filter'
import type { PoolKeywordData } from '../offer-keyword-pool'

function kw(keyword: string, searchVolume = 0): PoolKeywordData {
  return {
    keyword,
    searchVolume,
    source: 'KEYWORD_POOL',
    sourceType: 'KEYWORD_POOL',
    matchType: 'PHRASE',
  } as PoolKeywordData
}

describe('creative-keyword-context-filter', () => {
  it('falls back to a precise soft-family phrase when model_intent tightening removes weak product-page candidates', () => {
    const offer = {
      brand: 'BrandX',
      category: 'Portable Power Stations',
      product_name: 'BrandX Portable Power Station',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productTitle: 'BrandX Portable Power Station',
        category: 'Portable Power Stations',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'model_intent',
      scopeLabel: 'unit-underfill-soft-fallback',
      keywordsWithVolume: [
        kw('brandx portable station', 1200),
        kw('brandx portable power', 320),
        kw('brandx portable electric', 260),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toEqual(['brandx portable power station'])
  })

  it('injects model-family guard fallback when tightening leaves only hard-blocked sibling variants', () => {
    const offer = {
      brand: 'Novilla',
      category: 'Mattresses',
      product_name: 'Novilla King Mattress, 12 Inch King Size Memory Foam Mattress with Comfort Foam, Medium Firm',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Mattress, 12 Inch King Size Memory Foam Mattress with Comfort Foam, Medium Firm',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'model_intent',
      scopeLabel: 'unit-hard-blocked-variants',
      keywordsWithVolume: [
        kw('novilla king size mattress pro', 220),
        kw('novilla king size mattress plus', 210),
        kw('novilla king size mattress ultra', 200),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords.length).toBeGreaterThan(0)
    expect(keywords).toEqual(expect.arrayContaining([
      'novilla king mattress',
      'novilla memory foam mattress',
    ]))
    expect(keywords).not.toContain('novilla king size mattress pro')
    expect(keywords).not.toContain('novilla king size mattress plus')
    expect(keywords).not.toContain('novilla king size mattress ultra')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'novilla king size mattress pro',
      'novilla king size mattress plus',
      'novilla king size mattress ultra',
    ]))
  })

  it('supplements model_intent underfill with model-family guard fallback when only one tightened keyword remains', () => {
    const offer = {
      brand: 'Novilla',
      category: 'Mattresses',
      product_name: 'Novilla King Mattress, 12 Inch King Size Memory Foam Mattress with Comfort Foam, Medium Firm',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Mattress, 12 Inch King Size Memory Foam Mattress with Comfort Foam, Medium Firm',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'model_intent',
      scopeLabel: 'unit-underfill-guard-supplement',
      keywordsWithVolume: [
        kw('novilla king size mattress 12 inch', 820),
        kw('novilla king size mattress pro', 260),
        kw('novilla king size mattress plus', 240),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('novilla king size mattress 12 inch')
    expect(keywords.length).toBeGreaterThanOrEqual(3)
    expect(keywords).toContain('novilla memory foam mattress')
    expect(
      keywords.some((keyword) =>
        keyword === 'novilla king mattress'
        || keyword === 'novilla medium firm mattress'
      )
    ).toBe(true)
    expect(keywords).not.toContain('novilla king size mattress pro')
    expect(keywords).not.toContain('novilla king size mattress plus')
  })

  it('prefers trusted source when selecting model_intent underfill supplement candidates', () => {
    const offer = {
      brand: 'BrandX',
      category: 'Vacuum Cleaner',
      product_name: 'BrandX X200 Vacuum Cleaner',
      page_type: 'store',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        pageType: 'store',
        storeName: 'BrandX Official Store',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'model_intent',
      scopeLabel: 'unit-underfill-trust-ranking',
      keywordsWithVolume: [
        kw('brandx x200 vacuum', 1500),
        kw('brandx vacuum cleaner', 900),
        {
          ...kw('brandx energy unit', 2400),
          source: 'AI_GENERATED',
          sourceType: 'AI_LLM_RAW',
          sourceSubtype: 'AI_LLM_RAW',
        },
        {
          ...kw('brandx energy unit', 180),
          source: 'KEYWORD_PLANNER',
          sourceType: 'KEYWORD_PLANNER',
          sourceSubtype: 'KEYWORD_PLANNER',
        },
      ],
    })

    const supplemented = result.keywords.find((item) => item.keyword === 'brandx energy unit')
    expect(result.keywords.length).toBeGreaterThanOrEqual(3)
    expect(supplemented).toBeDefined()
    expect(supplemented?.sourceType).toBe('KEYWORD_PLANNER')
  })

  it('relaxes non-model tightening for high-priority sources under store-specificity underfill', () => {
    const offer = {
      brand: 'BrandX',
      category: 'Vacuum Cleaner',
      product_name: 'BrandX X200 Vacuum Cleaner',
      page_type: 'store',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        pageType: 'store',
        storeName: 'BrandX Official Store',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-non-model-high-priority-relax',
      keywordsWithVolume: [
        {
          ...kw('brandx x200 vacuum cleaner', 1200),
          source: 'KEYWORD_PLANNER',
          sourceType: 'KEYWORD_PLANNER',
          sourceSubtype: 'KEYWORD_PLANNER',
        },
        {
          ...kw('brandx x200 vacuum', 900),
          source: 'SEARCH_TERM_HIGH_PERFORMING',
          sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
          sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
        },
      ],
    })

    const keywords = result.keywords.map((item) => item.keyword)
    expect(keywords).toContain('brandx x200 vacuum')
    expect(keywords).toContain('brandx x200 vacuum cleaner')
  })

  it('deduplicates permutation-equivalent soft fallback keywords', () => {
    const offer = {
      brand: 'BrandX',
      category: 'Lifestyle',
      product_name: 'BrandX Lifestyle Collection',
      page_type: 'store',
      target_country: 'US',
      target_language: 'en',
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'model_intent',
      scopeLabel: 'unit-soft-fallback-permutation-dedupe',
      keywordsWithVolume: [
        kw('brandx premium bundle', 900),
        kw('premium bundle brandx', 860),
        kw('brandx signature bundle', 700),
        kw('brandx exclusive bundle', 650),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords.length).toBeGreaterThan(0)
    expect(keywords).toContain('brandx premium bundle')
    expect(keywords).not.toContain('premium bundle brandx')
  })

  it.each([
    'brand_intent',
    'product_intent',
  ] as const)('filters marketplace/support leakage for %s on product pages', (creativeType) => {
    const offer = {
      brand: 'Novilla',
      category: 'Mattresses',
      product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress King, Medium Firm',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productCategory: 'Home & Kitchen > Furniture > Bedroom Furniture > Mattresses & Box Springs > Mattresses',
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress King, Medium Firm',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType,
      scopeLabel: `unit-product-noise-${creativeType}`,
      keywordsWithVolume: [
        kw('novilla home security', 0),
        kw('novilla home kitchen see top', 0),
        kw('novilla mattresses any good', 0),
        kw('novilla king size mattress how long to expand', 0),
        kw('novilla king size mattress pro', 0),
        kw('novilla mattress plus', 0),
        kw('novilla queen mattress', 3200),
        kw('novilla memory foam mattress', 2800),
        kw('novilla', 14000),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('novilla')
    expect(keywords).toContain('novilla memory foam mattress')
    expect(keywords).not.toContain('novilla home security')
    expect(keywords).not.toContain('novilla home kitchen see top')
    expect(keywords).not.toContain('novilla mattresses any good')
    expect(keywords).not.toContain('novilla king size mattress how long to expand')
    expect(keywords).not.toContain('novilla king size mattress pro')
    expect(keywords).not.toContain('novilla mattress plus')
    expect(keywords).not.toContain('novilla queen mattress')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'novilla home security',
      'novilla home kitchen see top',
      'novilla mattresses any good',
      'novilla king size mattress how long to expand',
      'novilla king size mattress pro',
      'novilla mattress plus',
      'novilla queen mattress',
    ]))
  })

  it.each([
    'brand_intent',
    'product_intent',
  ] as const)('blocks broad family-adjacent accessory drift for %s on product pages', (creativeType) => {
    const offer = {
      brand: 'Anker',
      category: 'Portable Electric Coolers',
      product_name: 'Anker SOLIX EverFrost 2 Electric Cooler 58L with 288Wh Battery',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productCategory: 'Sports & Outdoors > Coolers > Electric Coolers',
        rawProductTitle: 'Anker SOLIX EverFrost 2 Electric Cooler 58L with 288Wh Battery',
        rawAboutThisItem: ['Electric cooler', '58L capacity', '288Wh battery', 'Road trip ready'],
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType,
      scopeLabel: `unit-family-adjacent-drift-${creativeType}`,
      keywordsWithVolume: [
        kw('anker', 12000),
        kw('anker solix cooler', 880),
        kw('anker solix everfrost 2', 880),
        kw('anker solix battery', 6600),
        kw('anker solix solar', 4400),
        kw('anker solix 300x', 3900),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('anker')
    expect(keywords).toContain('anker solix cooler')
    expect(keywords).toContain('anker solix everfrost 2')
    expect(keywords).not.toContain('anker solix battery')
    expect(keywords).not.toContain('anker solix solar')
    expect(keywords).not.toContain('anker solix 300x')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'anker solix battery',
      'anker solix solar',
      'anker solix 300x',
    ]))
  })

  it.each([
    'brand_intent',
    'product_intent',
  ] as const)('blocks conflicting sibling size/spec variants while preserving scenario demand for %s', (creativeType) => {
    const offer = {
      brand: 'Novilla',
      category: 'Mattresses',
      product_name: 'Novilla King Mattress, 12 Inch King Size Memory Foam Mattress with Comfort Foam for Pressure Relief & Cool Fresh Sleep, Removable Washable Cover, Mattresses in a Box, Medium Firm',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productCategory: 'Home & Kitchen > Furniture > Bedroom Furniture > Mattresses & Box Springs > Mattresses',
        rawProductTitle: 'Novilla King Mattress, 12 Inch King Size Memory Foam Mattress with Comfort Foam for Pressure Relief & Cool Fresh Sleep, Removable Washable Cover, Mattresses in a Box, Medium Firm',
        rawAboutThisItem: [
          '12 inch king size memory foam mattress',
          'Medium firm comfort foam support',
          'Pressure relief for side sleepers',
        ],
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType,
      scopeLabel: `unit-conflicting-soft-variant-drift-${creativeType}`,
      keywordsWithVolume: [
        kw('novilla', 2400),
        kw('Novilla Mattress', 0),
        kw('novilla memory foam mattress', 320),
        kw('novilla king size mattress 12 inch', 50),
        kw('king novilla mattress', 0),
        kw('best novilla mattress for side sleepers', 0),
        kw('novilla 10 inch mattress', 30),
        kw('novilla mattress twin', 0),
        kw('novilla full mattress', 0),
        kw('queen novilla mattress', 0),
        kw('novilla king size mattress 14 inch', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('novilla')
    expect(keywords).toContain('novilla memory foam mattress')
    expect(keywords).toContain('novilla king size mattress 12 inch')
    expect(keywords).toContain('king novilla mattress')
    expect(keywords).toContain('best novilla mattress for side sleepers')
    if (creativeType === 'brand_intent') {
      expect(keywords).toContain('Novilla Mattress')
    } else {
      expect(keywords).not.toContain('Novilla Mattress')
    }
    expect(keywords).not.toContain('novilla 10 inch mattress')
    expect(keywords).not.toContain('novilla mattress twin')
    expect(keywords).not.toContain('novilla full mattress')
    expect(keywords).not.toContain('queen novilla mattress')
    expect(keywords).not.toContain('novilla king size mattress 14 inch')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'novilla 10 inch mattress',
      'novilla mattress twin',
      'novilla full mattress',
      'queen novilla mattress',
      'novilla king size mattress 14 inch',
    ]))
  })

  it('blocks unsupported generic modifiers and weak noise anchors on product pages', () => {
    const offer = {
      brand: 'Eureka',
      category: 'Stick Vacuums & Electric Brooms',
      product_name: 'Eureka RapidClean Pro NEC280TL Cordless Stick Vacuum Cleaner',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Eureka RapidClean Pro NEC280TL Cordless Stick Vacuum Cleaner',
        productCategory: 'Home & Kitchen > Vacuums > Stick Vacuums & Electric Brooms',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-product-unsupported-generic-modifier',
      keywordsWithVolume: [
        kw('eureka cordless vacuum cleaner', 110),
        kw('eureka portable vacuum cleaner', 10),
        kw('eureka pro vacuum', 40),
        kw('Eureka Stick', 0),
        kw('Eureka RapidClean NEC280TL', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('eureka cordless vacuum cleaner')
    expect(keywords).toContain('Eureka RapidClean NEC280TL')
    expect(keywords).not.toContain('eureka portable vacuum cleaner')
    expect(keywords).not.toContain('eureka pro vacuum')
    expect(keywords).not.toContain('Eureka Stick')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'eureka portable vacuum cleaner',
      'eureka pro vacuum',
      'eureka stick',
    ]))
  })

  it.each([
    'brand_intent',
    'product_intent',
  ] as const)('drops sibling subcategory drift that only matches broad room tokens for %s', (creativeType) => {
    const offer = {
      brand: 'Mellanni',
      category: 'Sheet & Pillowcase Sets',
      product_name: 'Mellanni King Sheets Set - 4 PC Iconic Collection Bedding',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productCategory: 'Home & Kitchen > Bedding > Sheet & Pillowcase Sets',
        rawProductTitle: 'Mellanni King Sheets Set - 4 PC Iconic Collection Bedding',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType,
      scopeLabel: `unit-sibling-drift-${creativeType}`,
      keywordsWithVolume: [
        kw('mellanni king size sheet set', 3200),
        kw('mellanni king comforter bed sets', 1200),
        kw('mellanni', 14000),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('mellanni')
    expect(keywords).toContain('mellanni king size sheet set')
    expect(keywords).not.toContain('mellanni king comforter bed sets')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'mellanni king comforter bed sets',
    ]))
  })

  it.each([
    'brand_intent',
    'product_intent',
  ] as const)('uses store scraped context to drop off-category brand noise for %s', (creativeType) => {
    const offer = {
      brand: 'Sunaofe',
      category: 'Office Furniture',
      product_name: null,
      page_type: 'store',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productDescription: 'Discover modern ergonomic office chairs and electric standing desks designed for ultimate home office comfort.',
        products: [
          { name: 'CTS200 Dual Modular Monitor Arm with Stand' },
          { name: 'MORPH Classic Lumbar Auto-track Tech Ergonomic Chair' },
          { name: 'Boss Pro Leather Office Chair' },
        ],
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType,
      scopeLabel: `unit-store-context-${creativeType}`,
      keywordsWithVolume: [
        kw('sunaofe office furniture', 1800),
        kw('sunaofe boss pro leather office chair', 1400),
        kw('sunaofe office security', 300),
        kw('sunaofe home security', 260),
        kw('sunaofe website', 220),
        kw('sunaofe legit', 180),
        kw('Sunaofe There was', 90),
        kw('sunaofe', 12000),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('sunaofe')
    expect(keywords).toContain('sunaofe office furniture')
    expect(keywords).toContain('sunaofe boss pro leather office chair')
    expect(keywords).not.toContain('sunaofe office security')
    expect(keywords).not.toContain('sunaofe home security')
    expect(keywords).not.toContain('sunaofe website')
    expect(keywords).not.toContain('sunaofe legit')
    expect(keywords).not.toContain('Sunaofe There was')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'sunaofe office security',
      'sunaofe home security',
      'sunaofe website',
      'sunaofe legit',
      'sunaofe there was',
    ]))
  })

  it.each([
    'brand_intent',
    'product_intent',
  ] as const)('suppresses underspecified store fragments when richer sibling demand exists for %s', (creativeType) => {
    const offer = {
      brand: 'Sunaofe',
      category: 'Office Furniture',
      product_name: null,
      page_type: 'store',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productDescription: 'Discover ergonomic office chairs, standing desks and monitor arms for your workspace.',
        products: [
          { name: 'Boss Pro Leather Office Chair' },
          { name: 'CTS200 Dual Modular Monitor Arm' },
          { name: 'MORPH Classic Ergonomic Chair' },
          { name: 'Lunar Standing Desk' },
          { name: 'Ergonomic Office Furniture Collection' },
        ],
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType,
      scopeLabel: `unit-store-fragment-tightening-${creativeType}`,
      keywordsWithVolume: [
        kw('sunaofe office chair', 2200),
        kw('sunaofe standing desk', 1700),
        kw('sunaofe office furniture', 1400),
        kw('sunaofe ergonomic furniture', 1200),
        kw('sunaofe cts200 dual modular monitor arm', 900),
        kw('sunaofe morph chair', 800),
        kw('sunaofe lunar desk', 760),
        kw('sunaofe chair', 1300),
        kw('sunaofe desk', 1250),
        kw('sunaofe furniture', 1100),
        kw('sunaofe office', 700),
        kw('sunaofe morph', 650),
        kw('sunaofe lunar', 620),
        kw('sunaofe brand chair', 610),
        kw('sunaofe morph classic', 580),
        kw('sunaofe resistance color', 560),
        kw('sunaofe', 12000),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('sunaofe')
    expect(keywords).toContain('sunaofe office chair')
    expect(keywords).toContain('sunaofe standing desk')
    expect(keywords).toContain('sunaofe office furniture')
    expect(keywords).toContain('sunaofe cts200 dual modular monitor arm')
    expect(keywords).toContain('sunaofe morph chair')
    expect(keywords).toContain('sunaofe lunar desk')

    expect(keywords).not.toContain('sunaofe chair')
    expect(keywords).not.toContain('sunaofe desk')
    expect(keywords).not.toContain('sunaofe furniture')
    expect(keywords).not.toContain('sunaofe office')
    expect(keywords).not.toContain('sunaofe morph')
    expect(keywords).not.toContain('sunaofe lunar')
    expect(keywords).not.toContain('sunaofe brand chair')
    expect(keywords).not.toContain('sunaofe morph classic')
    expect(keywords).not.toContain('sunaofe resistance color')
    expect(result.blockedKeywordKeys).toEqual(expect.arrayContaining([
      'sunaofe chair',
      'sunaofe desk',
      'sunaofe furniture',
      'sunaofe office',
      'sunaofe morph',
      'sunaofe lunar',
      'sunaofe brand chair',
      'sunaofe morph classic',
      'sunaofe resistance color',
    ]))
  })

  it('filters support-tail model_intent keywords while preserving family-demand phrases', () => {
    const offer = {
      brand: 'Vanswe',
      category: 'Exercise Bikes',
      product_name: 'VANSWE Recumbent Exercise Bike for Home with Magnetic Resistance',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'VANSWE Recumbent Exercise Bike for Home with Magnetic Resistance',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'model_intent',
      scopeLabel: 'unit-model-support-tail',
      keywordsWithVolume: [
        kw('vanswe recumbent exercise bike', 2200),
        kw('vanswe recumbent bike', 1200),
        kw('vanswe recumbent exercise bike assembly', 0),
        kw('vanswe recumbent exercise bike manual', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('vanswe recumbent exercise bike')
    expect(keywords.length).toBeGreaterThanOrEqual(1)
    expect(keywords).not.toContain('vanswe recumbent exercise bike assembly')
    expect(keywords).not.toContain('vanswe recumbent exercise bike manual')
  })

  it('filters weak shared-token product_intent drift on product pages while keeping core product demand', () => {
    const offer = {
      brand: 'Bazic Products',
      category: 'Standard Pencil Erasers',
      product_name: 'BAZIC Products Pink Eraser, Latex Free Bevel Block Erasers, Large Size for Classroom, Office, and Art Use, Smooth Pencil Correction for Writing, Sketching, & Daily Tasks, 12/Pack, 48-Pack',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'BAZIC Products Pink Eraser, Latex Free Bevel Block Erasers, Large Size for Classroom, Office, and Art Use, Smooth Pencil Correction for Writing, Sketching, & Daily Tasks, 12/Pack, 48-Pack',
        productCategory: 'Office Products > School Supplies > Erasers > Pencil Erasers',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-product-shared-token-drift',
      keywordsWithVolume: [
        kw('bazic office supplies', 0),
        kw('Bazic Products standard pencil erasers', 0),
        kw('bazic eraser', 0),
        kw('bazic pencil box', 0),
        kw('bazic pencil sharpener', 0),
        kw('bazic mechanical pencil', 0),
        kw('bazic jumbo correction tape', 0),
        kw('bazic products pink eraser', 0),
        kw('bazic products', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('Bazic Products standard pencil erasers')
    expect(keywords).toContain('bazic products pink eraser')
    expect(keywords).toContain('bazic products')
    expect(keywords).not.toContain('bazic office supplies')
    expect(keywords).not.toContain('bazic eraser')
    expect(keywords).not.toContain('bazic pencil box')
    expect(keywords).not.toContain('bazic pencil sharpener')
    expect(keywords).not.toContain('bazic mechanical pencil')
    expect(keywords).not.toContain('bazic jumbo correction tape')
  })

  it('blocks product_intent accessory and sibling-line drift when the product title has a tighter core', () => {
    const offer = {
      brand: 'Eureka',
      category: 'Stick Vacuums & Electric Brooms',
      product_name: 'Eureka RapidClean Pro NEC280TL Cordless Stick Vacuum Cleaner – Lightweight 5.3 lbs, 40-Min Runtime, LED Headlights, 3 Power Modes, Ideal for Pet Hair, Hard Floors & Carpets',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Eureka RapidClean Pro NEC280TL Cordless Stick Vacuum Cleaner – Lightweight 5.3 lbs, 40-Min Runtime, LED Headlights, 3 Power Modes, Ideal for Pet Hair, Hard Floors & Carpets',
        productCategory: 'Home & Kitchen > Vacuums > Stick Vacuums & Electric Brooms',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-product-core-title-drift',
      keywordsWithVolume: [
        kw('eureka', 0),
        kw('eureka cordless vacuum cleaner', 0),
        kw('eureka cordless stick vacuum', 0),
        kw('eureka for vacuum cleaner', 0),
        kw('battery for eureka cordless vacuum', 0),
        kw('eureka cordless wet dry vacuum', 0),
        kw('eureka pet vacuum', 0),
        kw('eureka forbes compact vacuum cleaner', 0),
        kw('eureka vacuum cleaner hepa filter', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('eureka')
    expect(keywords).toContain('eureka cordless vacuum cleaner')
    expect(keywords).toContain('eureka cordless stick vacuum')
    expect(keywords).not.toContain('eureka for vacuum cleaner')
    expect(keywords).not.toContain('battery for eureka cordless vacuum')
    expect(keywords).not.toContain('eureka cordless wet dry vacuum')
    expect(keywords).not.toContain('eureka pet vacuum')
    expect(keywords).not.toContain('eureka forbes compact vacuum cleaner')
    expect(keywords).not.toContain('eureka vacuum cleaner hepa filter')
  })

  it('keeps product_intent audience tails after for while still dropping off-product modifiers', () => {
    const offer = {
      brand: 'Novilla',
      category: 'Mattresses',
      product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
        productCategory: 'Home & Kitchen > Mattresses',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-product-for-tail-demand',
      keywordsWithVolume: [
        kw('novilla mattress for side sleepers', 0),
        kw('novilla mattress topper', 0),
        kw('novilla', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('novilla')
    expect(keywords).toContain('novilla mattress for side sleepers')
    expect(keywords).not.toContain('novilla mattress topper')
  })

  it('keeps shorthand descriptive tails after a strongly anchored product phrase on product pages', () => {
    const offer = {
      brand: 'BrandX',
      category: 'Vacuums',
      product_name: 'BrandX X200 Robot Vacuum with Self-Empty Station',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productTitle: 'BrandX X200 Robot Vacuum with Self-Empty Station',
        productCategory: 'Home & Kitchen > Vacuums & Floor Care > Robotic Vacuums',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-product-shorthand-descriptive-tail',
      keywordsWithVolume: [
        kw('brandx robot vacuum pet hair', 0),
        kw('brandx robot vacuum', 0),
        kw('brandx laptop docking station', 0),
        kw('brandx', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('brandx robot vacuum pet hair')
    expect(keywords).toContain('brandx robot vacuum')
    expect(keywords).toContain('brandx')
    expect(keywords).not.toContain('brandx laptop docking station')
  })

  it('keeps title suffix feature modifiers when they stay inside the same anchored product line', () => {
    const offer = {
      brand: 'BrandX',
      category: 'Vacuums',
      product_name: 'BrandX X200 Robot Vacuum with Self-Empty Station',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        productTitle: 'BrandX X200 Robot Vacuum with Self-Empty Station',
        productCategory: 'Home & Kitchen > Vacuums & Floor Care > Robotic Vacuums',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-product-title-suffix-feature',
      keywordsWithVolume: [
        kw('brandx self empty robot vacuum', 0),
        kw('brandx x300 robot vacuum', 0),
        kw('brandx laptop docking station', 0),
        kw('brandx', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('brandx self empty robot vacuum')
    expect(keywords).toContain('brandx')
    expect(keywords).not.toContain('brandx x300 robot vacuum')
    expect(keywords).not.toContain('brandx laptop docking station')
  })

  it('drops product_intent spec fragments that do not contain a real product head on product pages', () => {
    const offer = {
      brand: 'Anker',
      category: 'Coolers & Refrigerators',
      product_name: 'Anker SOLIX EverFrost 2 58L Electric Cooler with 288Wh Battery',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Anker SOLIX EverFrost 2 58L Electric Cooler with 288Wh Battery',
        productCategory: 'Sports & Outdoors > Coolers & Refrigerators',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'product_intent',
      scopeLabel: 'unit-product-spec-fragment',
      keywordsWithVolume: [
        kw('anker 288wh', 0),
        kw('Anker 58L', 0),
        kw('288wh', 0),
        kw('Anker SOLIX EverFrost', 0),
        kw('anker cooler', 0),
        kw('anker', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('Anker SOLIX EverFrost')
    expect(keywords).toContain('anker cooler')
    expect(keywords).toContain('anker')
    expect(keywords).not.toContain('anker 288wh')
    expect(keywords).not.toContain('Anker 58L')
    expect(keywords).not.toContain('288wh')
  })

  ;([
    'brand_intent',
    'product_intent',
  ] as const).forEach((creativeType) => {
    it(`drops parent-category leakage and broad single-line fragments on product pages for ${creativeType}`, () => {
      const offer = {
        brand: 'Anker',
        category: 'Electrical Appliances',
        product_name: 'Anker SOLIX EverFrost 2 58L Cooler with 1 Removable Battery (Ships Separately), 58L Electric Cooler with Two 288Wh LiFePO4 Batteries, Powered by AC/DC or Solar, for Camping, Travel, Fishing',
        page_type: 'product',
        target_country: 'US',
        target_language: 'en',
        scraped_data: JSON.stringify({
          rawProductTitle: 'Anker SOLIX EverFrost 2 58L Cooler with 1 Removable Battery (Ships Separately), 58L Electric Cooler with Two 288Wh LiFePO4 Batteries, Powered by AC/DC or Solar, for Camping, Travel, Fishing',
        }),
      }

      const result = filterCreativeKeywordsByOfferContextDetailed({
        offer,
        creativeType,
        scopeLabel: `unit-product-parent-category-leakage-${creativeType}`,
        keywordsWithVolume: [
          kw('anker accessories', 110),
          kw('anker appliances', 260),
          kw('anker solix accessories', 40),
          kw('anker solix power', 40),
          kw('Anker 58L', 0),
          kw('Anker SOLIX', 0),
          kw('Anker EverFrost', 0),
          kw('Anker SOLIX EverFrost', 0),
          kw('anker everfrost 1', 20),
          kw('anker solix everfrost 2', 880),
          kw('anker portable cooler', 50),
          kw('anker cooler', 2400),
          kw('anker', 165000),
        ],
      })
      const keywords = result.keywords.map((item) => item.keyword)

      expect(keywords).toContain('Anker EverFrost')
      expect(keywords).toContain('Anker SOLIX EverFrost')
      expect(keywords).toContain('anker solix everfrost 2')
      expect(keywords).toContain('anker')

      expect(keywords).not.toContain('anker accessories')
      expect(keywords).not.toContain('anker appliances')
      expect(keywords).not.toContain('anker solix accessories')
      expect(keywords).not.toContain('anker solix power')
      expect(keywords).not.toContain('Anker 58L')
      expect(keywords).not.toContain('Anker SOLIX')
      expect(keywords).not.toContain('anker everfrost 1')
    })
  })

  it('drops broad single-head model_intent phrases on product pages while preserving richer demand anchors', () => {
    const offer = {
      brand: 'Novilla',
      category: 'Mattresses',
      product_name: 'Novilla Queen Mattress, 12 Inch Memory Foam Mattress, Medium Firm',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla Queen Mattress, 12 Inch Memory Foam Mattress, Medium Firm',
        productCategory: 'Home & Kitchen > Mattresses',
      }),
    }

    const result = filterCreativeKeywordsByOfferContextDetailed({
      offer,
      creativeType: 'model_intent',
      scopeLabel: 'unit-model-single-head-drift',
      keywordsWithVolume: [
        kw('mattresses', 0),
        kw('queen mattress', 0),
        kw('memory foam mattress', 0),
        kw('novilla queen mattress', 0),
      ],
    })
    const keywords = result.keywords.map((item) => item.keyword)

    expect(keywords).toContain('queen mattress')
    expect(keywords).toContain('memory foam mattress')
    expect(keywords).toContain('novilla queen mattress')
    expect(keywords).not.toContain('mattresses')
  })
})
