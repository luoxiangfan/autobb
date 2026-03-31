import { describe, expect, it } from 'vitest'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand-keyword-utils'
import { buildCreativeKeywordSet } from '../creative-keyword-set-builder'
import { selectCreativeKeywords } from '../creative-keyword-selection'

type FixtureKeyword = {
  keyword: string
  searchVolume: number
  source: string
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  derivedTags?: string[]
  matchType: 'EXACT' | 'PHRASE'
  isPureBrand?: boolean
}

function kw(
  keyword: string,
  searchVolume: number,
  source: string,
  extras: Partial<FixtureKeyword> = {}
): FixtureKeyword {
  return {
    keyword,
    searchVolume,
    source,
    matchType: 'PHRASE',
    ...extras,
  }
}

function expectModelIntentContract(result: ReturnType<typeof selectCreativeKeywords>, brandName: string): void {
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  expect(result.keywordsWithVolume.length).toBeGreaterThanOrEqual(3)
  expect(result.keywords.every((keyword) => !isPureBrandKeyword(keyword, pureBrandKeywords))).toBe(true)
  expect(result.keywords.filter((keyword) => containsPureBrand(keyword, pureBrandKeywords)).length).toBeGreaterThanOrEqual(1)
}

function expectProductIntentContract(result: ReturnType<typeof selectCreativeKeywords>, brandName: string): void {
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  expect(result.keywords.length).toBeGreaterThanOrEqual(3)
  expect(result.keywords.some((keyword) => isPureBrandKeyword(keyword, pureBrandKeywords))).toBe(true)
  expect(result.keywords.filter((keyword) => !isPureBrandKeyword(keyword, pureBrandKeywords)).length).toBeGreaterThanOrEqual(2)
}

describe('creative keyword real-offer regression fixtures', () => {
  describe('hard model fixtures', () => {
    const fixtures = [
      {
        offerId: 235,
        brandName: 'Eufy',
        keywordsWithVolume: [
          kw('eufy', 24000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('eufy omni c20', 6200, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('omni c20', 4300, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('eufy c20 robot vacuum', 3600, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('c20 robot vacuum', 2500, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
        ],
      },
      {
        offerId: 3121,
        brandName: 'Eufy',
        keywordsWithVolume: [
          kw('eufy', 24000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('eufy x10 pro omni', 5200, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('x10 pro omni', 4100, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('eufy x10 omni robot vacuum', 3600, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('x10 robot vacuum', 2400, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
        ],
      },
      {
        offerId: 3188,
        brandName: 'Anker',
        keywordsWithVolume: [
          kw('anker', 18000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('anker solix f3800', 6400, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('solix f3800', 5300, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('anker f3800 power station', 4200, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('f3800 power station', 3100, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
        ],
      },
      {
        offerId: 3351,
        brandName: 'RingConn',
        keywordsWithVolume: [
          kw('ringconn', 11000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('ringconn gen 2 smart ring', 4800, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('gen 2 smart ring', 3100, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('ringconn gen 2', 2900, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('smart ring gen 2', 2100, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
        ],
      },
      {
        offerId: 3499,
        brandName: 'Insta360',
        keywordsWithVolume: [
          kw('insta360', 19000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('insta360 x4', 6200, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('x4 action camera', 4500, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('insta360 x4 camera', 3900, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('x4 camera', 2500, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
        ],
      },
    ]

    for (const fixture of fixtures) {
      it(`keeps model_intent contract for hard-model offer ${fixture.offerId}`, () => {
        const result = selectCreativeKeywords({
          keywordsWithVolume: fixture.keywordsWithVolume,
          brandName: fixture.brandName,
          creativeType: 'model_intent',
          maxKeywords: 10,
          brandReserve: 0,
          minBrandKeywords: 0,
        })

        expectModelIntentContract(result, fixture.brandName)
        expect(
          result.keywordsWithVolume.some((item) => item.familyMatchType === 'hard_model' || item.familyMatchType === 'mixed')
        ).toBe(true)
      })
    }
  })

  describe('soft family fixtures', () => {
    const fixtures = [
      {
        offerId: 4909,
        brandName: 'Novilla',
        keywordsWithVolume: [
          kw('novilla', 16000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('novilla king mattress', 4200, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('10 inch mattress', 3200, 'KEYWORD_PLANNER', {
            sourceType: 'KEYWORD_PLANNER',
            sourceSubtype: 'KEYWORD_PLANNER_MODEL_FAMILY',
            rawSource: 'KEYWORD_PLANNER',
            derivedTags: ['PLANNER_NON_BRAND', 'PLANNER_NON_BRAND_MODEL_FAMILY'],
          }),
          kw('memory foam mattress', 2900, 'KEYWORD_PLANNER', {
            sourceType: 'KEYWORD_PLANNER',
            sourceSubtype: 'KEYWORD_PLANNER_MODEL_FAMILY',
            rawSource: 'KEYWORD_PLANNER',
            derivedTags: ['PLANNER_NON_BRAND', 'PLANNER_NON_BRAND_MODEL_FAMILY'],
          }),
          kw('medium firm mattress', 2500, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
        ],
      },
      {
        offerId: 3274,
        brandName: 'Sonos',
        keywordsWithVolume: [
          kw('sonos', 52000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('sonos arc', 28100, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('arc soundbar', 19100, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('sonos arc soundbar', 15600, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('arc surround sound', 8200, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
        ],
      },
      {
        offerId: 5214,
        brandName: 'Brooklinen',
        keywordsWithVolume: [
          kw('brooklinen', 14000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('brooklinen queen sheet set', 3100, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('queen sheet set', 2700, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('linen sheet set', 2400, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('cooling sheet set', 2100, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
        ],
      },
      {
        offerId: 5330,
        brandName: 'Caraway',
        keywordsWithVolume: [
          kw('caraway', 9800, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('caraway ceramic cookware set', 3600, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('ceramic cookware set', 2800, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('12 piece cookware set', 2300, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('non toxic cookware set', 2200, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
        ],
      },
      {
        offerId: 5487,
        brandName: 'Vital Proteins',
        keywordsWithVolume: [
          kw('vital proteins', 12000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('vital proteins collagen powder', 5100, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('20 oz collagen powder', 2600, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('unflavored collagen powder', 2400, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('collagen powder 2 pack', 2200, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
        ],
      },
      {
        offerId: 5572,
        brandName: "Levi's",
        keywordsWithVolume: [
          kw("levi's", 26000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw("levi's straight fit jeans", 4700, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('straight fit jeans', 3100, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('32x32 jeans', 2800, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('slim fit jeans', 2300, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
        ],
      },
    ]

    for (const fixture of fixtures) {
      it(`keeps model_intent contract for soft-family offer ${fixture.offerId}`, () => {
        const result = selectCreativeKeywords({
          keywordsWithVolume: fixture.keywordsWithVolume,
          brandName: fixture.brandName,
          creativeType: 'model_intent',
          maxKeywords: 10,
          brandReserve: 0,
          minBrandKeywords: 0,
        })

        expectModelIntentContract(result, fixture.brandName)
        expect(
          result.keywordsWithVolume.some((item) => item.familyMatchType === 'soft_family' || item.familyMatchType === 'mixed')
        ).toBe(true)
      })
    }
  })

  describe('weak signal fixtures', () => {
    const fixtures = [
      {
        offerId: 4909,
        brandName: 'Novilla',
        creativeType: 'product_intent' as const,
        offer: {
          brand: 'Novilla',
          category: 'Mattress',
          product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
          target_country: 'US',
          target_language: 'en',
          page_type: 'product',
          scraped_data: JSON.stringify({
            rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
            rawAboutThisItem: ['King size support', '10 inch memory foam design', 'Medium firm feel'],
          }),
        },
        keywords: ['novilla'],
      },
      {
        offerId: 6120,
        brandName: 'Eufy',
        creativeType: 'model_intent' as const,
        offer: {
          brand: 'Eufy',
          category: 'Robot Vacuum',
          product_name: 'Eufy X10 Pro Omni Robot Vacuum',
          target_country: 'US',
          target_language: 'en',
          page_type: 'product',
          scraped_data: JSON.stringify({ rawProductTitle: 'Eufy X10 Pro Omni Robot Vacuum' }),
        },
        keywords: ['eufy'],
      },
      {
        offerId: 6255,
        brandName: 'Caraway',
        creativeType: 'product_intent' as const,
        offer: {
          brand: 'Caraway',
          category: 'Cookware',
          product_name: 'Caraway Ceramic Cookware Set',
          target_country: 'US',
          target_language: 'en',
          page_type: 'store',
        },
        keywords: ['caraway'],
      },
      {
        offerId: 6382,
        brandName: 'Brooklinen',
        creativeType: 'brand_intent' as const,
        offer: {
          brand: 'Brooklinen',
          category: 'Sheet Set',
          product_name: 'Brooklinen Luxe Core Sheet Set',
          target_country: 'US',
          target_language: 'en',
          page_type: 'product',
        },
        keywords: ['brooklinen'],
      },
      {
        offerId: 6447,
        brandName: 'Vital Proteins',
        creativeType: 'model_intent' as const,
        offer: {
          brand: 'Vital Proteins',
          category: 'Collagen Powder',
          product_name: 'Vital Proteins Unflavored Collagen Powder 20 oz',
          target_country: 'US',
          target_language: 'en',
          page_type: 'product',
        },
        keywords: ['vital proteins'],
      },
      {
        offerId: 4946,
        brandName: 'Livfresh',
        creativeType: 'model_intent' as const,
        offer: {
          brand: 'Livfresh',
          category: 'Toothpaste',
          product_name: 'Livfresh 3 Pack Better Toothpaste Gel Clinically Proven to Remove 250% More Plaque and Improve Gum Health',
          target_country: 'US',
          target_language: 'en',
          page_type: 'product',
          scraped_data: JSON.stringify({
            rawProductTitle: 'Livfresh 3 Pack Better Toothpaste Gel Clinically Proven to Remove 250% More Plaque and Improve Gum Health',
          }),
        },
        keywords: ['livfresh', 'better 250', 'remove 250', 'livfresh toothpaste gel', 'toothpaste gel'],
      },
    ]

    for (const fixture of fixtures) {
      it(`does not emit empty executable keywords for weak-signal offer ${fixture.offerId}`, async () => {
        const result = await buildCreativeKeywordSet({
          offer: fixture.offer,
          userId: 1,
          brandName: fixture.brandName,
          targetLanguage: 'en',
          creativeType: fixture.creativeType,
          scopeLabel: `real-offer-${fixture.offerId}`,
          keywords: fixture.keywords,
          enableSupplementation: false,
        })

        expect(result.executableKeywords.length).toBeGreaterThan(0)
        if (fixture.creativeType === 'model_intent') {
          const pureBrandKeywords = getPureBrandKeywords(fixture.brandName)
          expect(result.executableKeywords.every((keyword) => !isPureBrandKeyword(keyword, pureBrandKeywords))).toBe(true)
          if (fixture.offerId === 4946) {
            expect(result.executableKeywords).toContain('livfresh toothpaste gel')
            expect(result.executableKeywords.some((keyword) => /\b(?:250|better|remove)\b/i.test(keyword))).toBe(false)
          }
        } else if (fixture.creativeType === 'product_intent') {
          const pureBrandKeywords = getPureBrandKeywords(fixture.brandName)
          expect(result.executableKeywords.some((keyword) => isPureBrandKeyword(keyword, pureBrandKeywords))).toBe(true)
        } else if (fixture.creativeType === 'brand_intent') {
          const pureBrandKeywords = getPureBrandKeywords(fixture.brandName)
          expect(result.executableKeywords.some((keyword) => isPureBrandKeyword(keyword, pureBrandKeywords))).toBe(true)
        }
      })
    }
  })

  describe('product intent rewrite fixtures', () => {
    it('keeps controlled PURE_BRAND_PREFIX_REWRITE terms in D when they are high-quality', () => {
      const result = selectCreativeKeywords({
        keywordsWithVolume: [
          kw('novilla', 16000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('novilla king mattress', 4200, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('novilla memory foam mattress', 3800, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('novilla mattress for side sleepers', 2200, 'PRODUCT_RELAX_BRANDED', {
            sourceType: 'PRODUCT_RELAX_BRANDED',
            sourceSubtype: 'PURE_BRAND_PREFIX_REWRITE',
            rawSource: 'KEYWORD_PLANNER',
            derivedTags: ['PRODUCT_RELAX_BRANDED', 'PURE_BRAND_PREFIX_REWRITE'],
          }),
        ],
        brandName: 'Novilla',
        creativeType: 'product_intent',
        maxKeywords: 6,
      })

      expectProductIntentContract(result, 'Novilla')
      expect(result.keywords).toContain('novilla mattress for side sleepers')
    })
  })

  describe('root-cause production regressions', () => {
    it('rejects dimension-only model fragments while keeping the real model entity for offer 4910 style inputs', () => {
      const result = selectCreativeKeywords({
        keywordsWithVolume: [
          kw('dreo', 24000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('dreo ac516s portable air conditioner', 5400, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('ac516s portable air conditioner', 4200, 'KEYWORD_PLANNER', { sourceType: 'KEYWORD_PLANNER' }),
          kw('dreo 14.37 d', 200, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('dreo 17.32 w', 180, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('dreo 28.13 h', 160, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
        ],
        brandName: 'Dreo',
        creativeType: 'model_intent',
        maxKeywords: 6,
        brandReserve: 0,
        minBrandKeywords: 0,
      })

      expect(result.keywords).toEqual(expect.arrayContaining([
        'dreo ac516s portable air conditioner',
        'ac516s portable air conditioner',
      ]))
      expect(result.keywords).not.toContain('dreo 14.37 d')
      expect(result.keywords).not.toContain('dreo 17.32 w')
      expect(result.keywords).not.toContain('dreo 28.13 h')
    })

    it('keeps only IT-language content words for IT-market creative selection', () => {
      const result = selectCreativeKeywords({
        keywordsWithVolume: [
          kw('waterdrop', 12000, 'BRAND_SEED', { sourceType: 'BRAND_SEED', matchType: 'EXACT', isPureBrand: true }),
          kw('waterdrop filtro ufficiale x16', 1100, 'SEARCH_TERM_HIGH_PERFORMING', { sourceType: 'SEARCH_TERM_HIGH_PERFORMING' }),
          kw('waterdrop official filter x16', 900, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
          kw('waterdrop alkalisches mineral x16', 300, 'KEYWORD_POOL', { sourceType: 'CANONICAL_BUCKET_VIEW' }),
        ],
        brandName: 'Waterdrop',
        targetLanguage: 'it',
        creativeType: 'product_intent',
        maxKeywords: 6,
        brandReserve: 0,
        minBrandKeywords: 0,
      })

      expect(result.keywords).toContain('waterdrop filtro ufficiale x16')
      expect(result.keywords).not.toContain('waterdrop official filter x16')
      expect(result.keywords).not.toContain('waterdrop alkalisches mineral x16')
    })
  })
})
