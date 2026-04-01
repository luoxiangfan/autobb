import { describe, expect, it } from 'vitest'
import { getPureBrandKeywords, isPureBrandKeyword } from '../brand-keyword-utils'
import { resolveCreativeKeywordMinimumOutputCount } from '../creative-keyword-output-floor'
import { hasModelAnchorEvidence } from '../creative-type'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  CREATIVE_KEYWORD_MAX_WORDS,
  selectCreativeKeywords,
} from '../creative-keyword-selection'

describe('creative-keyword-selection', () => {
  it('uses intent-specific minimum output floors', () => {
    expect(resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'brand_intent',
      maxKeywords: 5,
    })).toBe(3)
    expect(resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'model_intent',
      maxKeywords: 5,
    })).toBe(4)
    expect(resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'product_intent',
      maxKeywords: 5,
    })).toBe(4)
    expect(resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'product_intent',
      maxKeywords: 1,
    })).toBe(1)
    expect(resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'model_intent',
      maxKeywords: 50,
      bucket: 'B',
    })).toBe(8)
    expect(resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'product_intent',
      maxKeywords: 50,
      bucket: 'D',
    })).toBe(10)
  })

  it('caps total creative keywords to 50', () => {
    const keywordsWithVolume = Array.from({ length: 80 }, (_, index) => ({
      keyword: `brandx keyword ${index + 1}`,
      searchVolume: 1000 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume,
      brandName: 'BrandX',
    })

    expect(result.keywordsWithVolume).toHaveLength(CREATIVE_KEYWORD_MAX_COUNT)
    expect(result.keywords).toHaveLength(CREATIVE_KEYWORD_MAX_COUNT)
    expect(result.truncated).toBe(true)
  })

  it('reserves at least 10 branded slots when available', () => {
    const brandKeywords = Array.from({ length: 12 }, (_, index) => ({
      keyword: `brandx model ${index + 1}`,
      searchVolume: 10,
      source: 'AI_GENERATED',
      matchType: 'PHRASE' as const,
    }))
    const nonBrandKeywords = Array.from({ length: 70 }, (_, index) => ({
      keyword: `generic landscape light ${index + 1}`,
      searchVolume: 10000 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...brandKeywords, ...nonBrandKeywords],
      brandName: 'BrandX',
    })

    const brandedCount = result.keywords.filter(keyword => keyword.toLowerCase().includes('brandx')).length
    expect(brandedCount).toBeGreaterThanOrEqual(CREATIVE_BRAND_KEYWORD_RESERVE)
  })

  it('deduplicates normalized keyword variants', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'BrandX-Laser', searchVolume: 100, source: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'brandx laser', searchVolume: 200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx_laser', searchVolume: 150, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
    })

    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywords[0].toLowerCase()).toContain('brandx')
  })

  it('compacts transactional template variants that share the same demand core in brand and product intents', () => {
    for (const creativeType of ['brand_intent', 'product_intent'] as const) {
      const result = selectCreativeKeywords({
        keywordsWithVolume: [
          { keyword: 'novilla', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
          { keyword: 'novilla queen mattress', searchVolume: 4200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
          { keyword: 'buy novilla queen mattress', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
          { keyword: 'novilla queen mattress price', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
          { keyword: 'purchase novilla queen mattress', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
          { keyword: 'novilla memory foam mattress', searchVolume: 3800, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
          { keyword: 'purchase novilla memory foam mattress', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
        ],
        brandName: 'Novilla',
        creativeType,
        maxKeywords: 10,
      })

      expect(result.keywords).toContain('novilla queen mattress')
      expect(result.keywords).toContain('novilla memory foam mattress')
      expect(result.keywords).not.toContain('buy novilla queen mattress')
      expect(result.keywords).not.toContain('novilla queen mattress price')
      expect(result.keywords).not.toContain('purchase novilla queen mattress')
      expect(result.keywords).not.toContain('purchase novilla memory foam mattress')
    }
  })

  it('keeps one transactional representative when no non-transactional demand variant exists', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
        { keyword: 'buy brandx topper pillow', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
        { keyword: 'purchase brandx topper pillow', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
    })

    expect(result.keywords).toContain('brandx')
    expect(result.keywords.filter((keyword) => /topper pillow/i.test(keyword))).toHaveLength(1)
  })

  it('trims transactional tail keywords for brand and product intents when enough non-transactional coverage already exists', () => {
    for (const creativeType of ['brand_intent', 'product_intent'] as const) {
      const result = selectCreativeKeywords({
        keywordsWithVolume: [
          { keyword: 'brandx', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
          { keyword: 'brandx office chair', searchVolume: 4200, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
          { keyword: 'brandx ergonomic office chair', searchVolume: 3900, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
          { keyword: 'brandx desk chair', searchVolume: 3500, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
          { keyword: 'brandx executive chair', searchVolume: 3300, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
          { keyword: 'brandx mesh office chair', searchVolume: 3100, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
          { keyword: 'brandx swivel chair', searchVolume: 2800, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
          { keyword: 'brandx computer chair', searchVolume: 2500, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
          { keyword: 'buy brandx office chair', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
          { keyword: 'brandx office chair shop', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
          { keyword: 'purchase brandx desk chair', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
        ],
        brandName: 'BrandX',
        creativeType,
        maxKeywords: 20,
      })

      expect(result.keywords).toContain('brandx')
      expect(result.keywords).toContain('brandx office chair')
      expect(result.keywords).toContain('brandx ergonomic office chair')
      expect(result.keywords).not.toContain('buy brandx office chair')
      expect(result.keywords).not.toContain('brandx office chair shop')
      expect(result.keywords).not.toContain('purchase brandx desk chair')
    }
  })

  it('drops repeated-demand and brand-trailing product-intent tails', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'eureka', searchVolume: 246000, source: 'BRAND_SEED' as any, sourceType: 'BRAND_SEED' as any, matchType: 'EXACT' },
        { keyword: 'eureka cordless vacuum cleaner', searchVolume: 110, source: 'KEYWORD_POOL' as any, sourceType: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'eureka rapidclean cordless vacuum', searchVolume: 10, source: 'KEYWORD_POOL' as any, sourceType: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'vacuum cleaner eureka', searchVolume: 210, source: 'GLOBAL_KEYWORDS' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, sourceSubtype: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' },
        { keyword: 'eureka cleaner vacuum cleaner', searchVolume: 10, source: 'GLOBAL_KEYWORDS' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, sourceSubtype: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' },
        { keyword: 'Eureka RapidClean NEC280TL', searchVolume: 0, source: 'TITLE_EXTRACT' as any, sourceType: 'TITLE_EXTRACT' as any, sourceSubtype: 'TITLE_EXTRACT' as any, matchType: 'PHRASE' },
        { keyword: 'rapidclean nec280tl', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, sourceSubtype: 'MODEL_FAMILY_GUARD' as any, matchType: 'EXACT' },
      ],
      brandName: 'Eureka',
      creativeType: 'product_intent',
      maxKeywords: 10,
    })

    expect(result.keywords).toContain('eureka')
    expect(result.keywords).toContain('eureka cordless vacuum cleaner')
    expect(result.keywords).toContain('eureka rapidclean cordless vacuum')
    expect(result.keywords).toContain('Eureka RapidClean NEC280TL')
    expect(result.keywords).toContain('rapidclean nec280tl')
    expect(result.keywords).not.toContain('vacuum cleaner eureka')
    expect(result.keywords).not.toContain('eureka cleaner vacuum cleaner')
  })

  it('removes branded transactional keywords from brand intent when enough non-transactional alternatives exist even if transactional phrases rank highly', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
        { keyword: 'buy brandx office chair', searchVolume: 5000, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'brandx office chair', searchVolume: 4200, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'brandx ergonomic office chair', searchVolume: 3900, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'brandx desk chair', searchVolume: 3500, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'brandx executive chair', searchVolume: 3300, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'brandx mesh office chair', searchVolume: 3100, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'brandx swivel chair', searchVolume: 2800, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'brand_intent',
      maxKeywords: 20,
    })

    expect(result.keywords).toContain('brandx')
    expect(result.keywords).toContain('brandx office chair')
    expect(result.keywords).not.toContain('buy brandx office chair')
  })

  it('prunes boundary transactional brand phrases even when the output set is small', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
        { keyword: 'buy brandx office chair', searchVolume: 5000, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'brandx office chair', searchVolume: 4200, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'brandx ergonomic office chair', searchVolume: 3900, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'brandx office chair deal', searchVolume: 1200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'brand_intent',
      maxKeywords: 50,
    })

    expect(result.keywords).toContain('brandx')
    expect(result.keywords).toContain('brandx office chair')
    expect(result.keywords).toContain('brandx ergonomic office chair')
    expect(result.keywords).not.toContain('buy brandx office chair')
    expect(result.keywords).not.toContain('brandx office chair deal')
  })

  it('keeps compound demand nouns that contain shop as a product token while still pruning action-led variants', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'sunco lighting', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
        { keyword: 'sunco lighting led shop lights', searchVolume: 5200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'sunco lighting led tube lights', searchVolume: 4800, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' },
        { keyword: 'buy sunco lighting led shop lights', searchVolume: 600, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
      ],
      brandName: 'Sunco Lighting',
      creativeType: 'brand_intent',
      maxKeywords: 20,
    })

    expect(result.keywords).toContain('sunco lighting')
    expect(result.keywords).toContain('sunco lighting led shop lights')
    expect(result.keywords).not.toContain('buy sunco lighting led shop lights')
  })

  it('prefers higher-priority source for equal keyword', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx spotlight', searchVolume: 20, source: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'brandx spotlight', searchVolume: 20, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
    })

    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywordsWithVolume[0].source).toBe('KEYWORD_POOL')
  })

  it('drops keywords exceeding global max word count', () => {
    const tooLongKeyword = 'ninja bn401 nutri pro compact personal blender auto iq technology 1100 peak watts for frozen drinks smoothies sauces'
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: tooLongKeyword, searchVolume: 120000, source: 'KEYWORD_POOL', matchType: 'EXACT' },
        { keyword: 'lampick hair dryer', searchVolume: 4000, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'Lampick',
    })

    expect(result.keywords).toContain('lampick hair dryer')
    expect(result.keywords).not.toContain(tooLongKeyword)
    expect(
      result.keywords.every(keyword => keyword.trim().split(/\s+/).filter(Boolean).length <= CREATIVE_KEYWORD_MAX_WORDS)
    ).toBe(true)
  })

  it('enforces at least 10 branded keywords by synthesizing from non-brand candidates', () => {
    const brandedSeed = [{
      keyword: 'lampick hair dryer',
      searchVolume: 5000,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }]
    const nonBrandKeywords = Array.from({ length: 30 }, (_, index) => ({
      keyword: `hair dryer ${index + 1}`,
      searchVolume: 3000 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...brandedSeed, ...nonBrandKeywords],
      brandName: 'Lampick',
      maxKeywords: 30,
      minBrandKeywords: 10,
    })

    const brandedCount = result.keywords.filter(keyword => keyword.toLowerCase().includes('lampick')).length
    expect(brandedCount).toBeGreaterThanOrEqual(10)
    expect(
      result.keywords.every(keyword => keyword.trim().split(/\s+/).filter(Boolean).length <= CREATIVE_KEYWORD_MAX_WORDS)
    ).toBe(true)
  })

  it('supports brand-only mode and emits only branded keywords', () => {
    const brandKeywords = [
      { keyword: 'lampick hair dryer', searchVolume: 5000, source: 'KEYWORD_POOL', matchType: 'PHRASE' as const },
      { keyword: 'lampick ionic dryer', searchVolume: 4200, source: 'KEYWORD_POOL', matchType: 'PHRASE' as const },
    ]
    const nonBrandKeywords = Array.from({ length: 20 }, (_, index) => ({
      keyword: `hair dryer ${index + 1}`,
      searchVolume: 3500 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...brandKeywords, ...nonBrandKeywords],
      brandName: 'Lampick',
      maxKeywords: 12,
      brandOnly: true,
    })

    expect(result.keywordsWithVolume).toHaveLength(12)
    expect(result.keywords.every(keyword => keyword.toLowerCase().includes('lampick'))).toBe(true)
  })

  it('synthesizes branded demand terms for brand_intent when only generic demand tails are available', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'security camera', searchVolume: 5200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'outdoor camera', searchVolume: 4100, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'camera for home', searchVolume: 3600, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
      ],
      brandName: 'Eufy',
      creativeType: 'brand_intent',
      maxKeywords: 6,
      brandOnly: true,
    })

    expect(result.keywords.length).toBeGreaterThan(0)
    expect(result.keywords.every(keyword => keyword.toLowerCase().includes('eufy'))).toBe(true)
    expect(result.keywords).toContain('eufy security camera')
  })

  it('keeps pure brand terms for brand_intent while still dropping promo-only noise', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx', searchVolume: 9000, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'brandx sale', searchVolume: 4200, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
        { keyword: 'brandx security camera', searchVolume: 3200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'brand_intent',
      maxKeywords: 10,
    })

    expect(result.keywords).toContain('brandx')
    expect(result.keywords).toContain('brandx security camera')
    expect(result.keywords).not.toContain('brandx sale')
  })

  it('keeps one pure brand keyword in brand_intent after quota truncation', () => {
    const demandHeavyKeywords = Array.from({ length: 120 }, (_, index) => ({
      keyword: `brandx security camera variant ${index + 1}`,
      searchVolume: 12000 - index * 10,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        ...demandHeavyKeywords,
        { keyword: 'brandx', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
      ],
      brandName: 'BrandX',
      creativeType: 'brand_intent',
      maxKeywords: 50,
    })

    const pureBrandKeywords = getPureBrandKeywords('BrandX')
    expect(result.keywordsWithVolume).toHaveLength(50)
    expect(result.keywords.some((keyword) => isPureBrandKeyword(keyword, pureBrandKeywords))).toBe(true)
  })

  it('keeps one pure brand keyword in product_intent when pure brand ranks at the tail', () => {
    const demandHeavyKeywords = Array.from({ length: 120 }, (_, index) => ({
      keyword: `novilla king mattress option ${index + 1}`,
      searchVolume: 12000 - index * 10,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        ...demandHeavyKeywords,
        { keyword: 'novilla', searchVolume: 1, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
      ],
      brandName: 'Novilla',
      creativeType: 'product_intent',
      maxKeywords: 50,
    })

    expect(result.keywordsWithVolume).toHaveLength(50)
    expect(result.keywords).toContain('novilla')
  })

  it('enforces exact match and model anchors for model_intent', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx x200 vacuum', searchVolume: 5000, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx vacuum', searchVolume: 4200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx official store', searchVolume: 4100, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'x200 vacuum', searchVolume: 3800, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 10,
    })

    expect(result.keywords).toContain('brandx x200 vacuum')
    expect(result.keywords).toContain('x200 vacuum')
    expect(result.keywords).not.toContain('brandx vacuum')
    expect(result.keywords).not.toContain('brandx official store')
    expect(result.keywordsWithVolume.every((item) => item.matchType === 'EXACT')).toBe(true)
  })

  it('filters ASIN-like terms from model_intent output while keeping real model queries', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'novilla b0cjj9sb4y mattress', searchVolume: 5100, source: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' },
        { keyword: 'b0cjj9sb4y', searchVolume: 3200, source: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' },
        { keyword: 'novilla gen 2 mattress', searchVolume: 1800, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'gen 2 mattress', searchVolume: 900, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' },
      ],
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords.some((keyword) => /b0[a-z0-9]{8}/i.test(keyword))).toBe(false)
    expect(result.keywords).toEqual(expect.arrayContaining(['novilla gen 2 mattress']))
  })

  it('backfills model_intent output after ASIN pruning when extra qualified candidates exist', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'novilla b0cjj9sb4y mattress', searchVolume: 6200, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
        { keyword: 'novilla gen 2 mattress', searchVolume: 6100, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
        { keyword: 'novilla king size mattress 12 inch', searchVolume: 6000, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
      ],
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 2,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords.some((keyword) => /b0[a-z0-9]{8}/i.test(keyword))).toBe(false)
    expect(result.keywordsWithVolume).toHaveLength(2)
    expect(result.keywords).toEqual(expect.arrayContaining([
      'novilla gen 2 mattress',
      'novilla king size mattress 12 inch',
    ]))
    expect(result.sourceQuotaAudit.acceptedCount).toBe(result.keywordsWithVolume.length)
    expect(result.sourceQuotaAudit.targetCount).toBeGreaterThanOrEqual(result.keywordsWithVolume.length)
  })

  it('keeps a small branded floor for model_intent by synthesizing branded model tails when needed', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'x200 vacuum', searchVolume: 5000, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'x300 vacuum', searchVolume: 4200, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' },
        { keyword: 'brandx official store', searchVolume: 4100, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 6,
    })

    const brandedKeywords = result.keywords.filter(keyword => keyword.toLowerCase().includes('brandx'))

    expect(brandedKeywords.length).toBeGreaterThanOrEqual(2)
    expect(brandedKeywords).toContain('brandx x200 vacuum')
    expect(result.keywordsWithVolume.every((item) => item.matchType === 'EXACT')).toBe(true)
    expect(result.keywords).not.toContain('brandx official store')
  })

  it('rejects low-volume generic preferred soft-family terms while keeping specific branded family queries in model_intent', () => {
    const keywordsWithVolume = [
      { keyword: 'novilla', searchVolume: 9000, source: 'BRAND_SEED' as any, sourceType: 'BRAND_SEED' as any, matchType: 'EXACT' as const, isPureBrand: true },
      { keyword: 'novilla king size mattress', searchVolume: 260, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      { keyword: 'novilla king mattress', searchVolume: 210, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      { keyword: 'novilla memory foam mattress', searchVolume: 320, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      { keyword: 'novilla mattress', searchVolume: 600, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      { keyword: 'mattresses', searchVolume: 500, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      { keyword: 'king mattress 12 inch king', searchVolume: 500, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume,
      preferredBucketKeywords: keywordsWithVolume.map((item) => item.keyword),
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toEqual(expect.arrayContaining([
      'novilla king size mattress',
      'novilla king mattress',
      'novilla memory foam mattress',
    ]))
    expect(result.keywords).not.toContain('novilla mattress')
    expect(result.keywords).not.toContain('mattresses')
    expect(result.keywords).not.toContain('king mattress 12 inch king')
    const expectedSoftFamily = new Set([
      'novilla king size mattress',
      'novilla king mattress',
      'novilla memory foam mattress',
    ])
    const softFamilyItems = result.keywordsWithVolume.filter((item) => expectedSoftFamily.has(item.keyword))
    expect(softFamilyItems.length).toBeGreaterThanOrEqual(3)
    expect(softFamilyItems.every((item) => item.matchType === 'PHRASE')).toBe(true)
  })

  it('keeps high-volume branded single-core preferred demand terms in model_intent', () => {
    const keywordsWithVolume = [
      { keyword: 'novilla', searchVolume: 9000, source: 'BRAND_SEED' as any, sourceType: 'BRAND_SEED' as any, matchType: 'EXACT' as const, isPureBrand: true },
      { keyword: 'novilla mattress', searchVolume: 8100, source: 'OFFER_EXTRACTED_KEYWORDS' as any, sourceType: 'OFFER_EXTRACTED_KEYWORDS' as any, matchType: 'PHRASE' as const },
      { keyword: 'novilla king size mattress', searchVolume: 260, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      { keyword: 'novilla memory foam mattress', searchVolume: 320, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume,
      preferredBucketKeywords: keywordsWithVolume.map((item) => item.keyword),
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toEqual(expect.arrayContaining([
      'novilla mattress',
      'novilla king size mattress',
      'novilla memory foam mattress',
    ]))
    expect(result.keywords).not.toContain('novilla')
    const singleCore = result.keywordsWithVolume.find((item) => item.keyword === 'novilla mattress')
    expect(singleCore?.matchType).toBe('PHRASE')
  })

  it('rejects title-derived model_intent fragments that only carry family markers or marketing claims', () => {
    const keywordsWithVolume = [
      { keyword: 'ringconn gen 2 smart ring', searchVolume: 50, source: 'GLOBAL_KEYWORDS' as any, sourceType: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' as const },
      { keyword: 'ringconn smart ring', searchVolume: 20, source: 'TITLE_EXTRACT' as any, sourceType: 'TITLE_EXTRACT' as any, matchType: 'PHRASE' as const },
      { keyword: 'ringconn gen 2', searchVolume: 10, source: 'TITLE_EXTRACT' as any, sourceType: 'TITLE_EXTRACT' as any, matchType: 'PHRASE' as const },
      { keyword: 'Ringconn Gen World’s', searchVolume: 0, source: 'TITLE_EXTRACT' as any, sourceType: 'TITLE_EXTRACT' as any, matchType: 'PHRASE' as const },
      { keyword: 'Ringconn World’s', searchVolume: 0, source: 'TITLE_EXTRACT' as any, sourceType: 'TITLE_EXTRACT' as any, matchType: 'PHRASE' as const },
      { keyword: 'Ringconn First', searchVolume: 0, source: 'TITLE_EXTRACT' as any, sourceType: 'TITLE_EXTRACT' as any, matchType: 'PHRASE' as const },
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume,
      preferredBucketKeywords: keywordsWithVolume.map((item) => item.keyword),
      brandName: 'Ringconn',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toEqual(expect.arrayContaining([
      'ringconn gen 2 smart ring',
      'ringconn smart ring',
      'ringconn gen 2',
    ]))
    expect(result.keywords).not.toContain('Ringconn Gen World’s')
    expect(result.keywords).not.toContain('Ringconn World’s')
    expect(result.keywords).not.toContain('Ringconn First')
  })

  it('keeps branded trusted soft-family terms in normal model_intent ranking without waiting for rescue', () => {
    const hardModels = Array.from({ length: 8 }, (_, index) => ({
      keyword: `novilla n${200 + index} mattress`,
      searchVolume: 4200 - index * 50,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        ...hardModels,
        { keyword: 'novilla king size mattress', searchVolume: 260, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
        { keyword: 'novilla memory foam mattress', searchVolume: 320, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      ],
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywordsWithVolume).toHaveLength(10)
    expect(result.keywords).toEqual(expect.arrayContaining([
      'novilla king size mattress',
      'novilla memory foam mattress',
    ]))
  })

  it('uses bucket-specific rescue to avoid empty model_intent output when hard model anchors are absent', () => {
    const compatibilityOnlyKeywords = [
      { keyword: 'brandx pressure relief support', searchVolume: 0, source: 'KEYWORD_POOL', matchType: 'PHRASE' as const },
      { keyword: 'brandx cooling comfort system', searchVolume: 0, source: 'KEYWORD_POOL', matchType: 'PHRASE' as const },
      { keyword: 'brandx sleep technology', searchVolume: 0, source: 'KEYWORD_POOL', matchType: 'PHRASE' as const },
      { keyword: 'brandx cooling mattress', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume: compatibilityOnlyKeywords,
      preferredBucketKeywords: compatibilityOnlyKeywords.map((item) => item.keyword),
      brandName: 'BrandX',
      creativeType: 'model_intent',
      bucket: 'B',
      maxKeywords: 1,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywordsWithVolume.every((item) => item.matchType === 'PHRASE')).toBe(true)
    expect(result.keywords).toEqual(['brandx cooling mattress'])
    expect(result.keywords.some((keyword) => !hasModelAnchorEvidence({ keywords: [keyword] }))).toBe(true)
    expect(result.keywordsWithVolume[0]).toMatchObject({
      contractRole: 'required',
      familyMatchType: 'soft_family',
      fallbackReason: 'model_family_guard',
      rescueStage: 'post_selection',
      anchorKinds: expect.arrayContaining(['brand', 'demand']),
      evidenceStrength: 'medium',
    })
  })

  it('keeps non-empty output for non-model intents when strict filtering empties the ranked pool', () => {
    const weakSignals = [
      { keyword: 'what is vacuum cleaner', searchVolume: 1200, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' as const },
      { keyword: 'vacuum cleaner review', searchVolume: 900, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' as const },
      { keyword: 'vacuum cleaner amazon', searchVolume: 860, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' as const },
    ]

    for (const creativeType of ['brand_intent', 'model_intent', 'product_intent'] as const) {
      const result = selectCreativeKeywords({
        keywordsWithVolume: weakSignals,
        creativeType,
        maxKeywords: 5,
        minBrandKeywords: 0,
        brandReserve: 0,
      })

      if (creativeType === 'model_intent') {
        expect(result.keywords).toHaveLength(0)
      } else {
        expect(result.keywords.length).toBeGreaterThan(0)
        expect(result.keywordsWithVolume[0]?.sourceSubtype).toBe('DERIVED_RESCUE')
      }
    }
  })

  it('prefers real search-term and planner sources over lower-priority duplicates', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx x200 vacuum', searchVolume: 100, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx x200 vacuum', searchVolume: 100, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'brandx x300 vacuum', searchVolume: 100, source: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'brandx x300 vacuum', searchVolume: 100, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 10,
    })

    expect(
      result.keywordsWithVolume.find((item) => item.keyword === 'brandx x200 vacuum')?.source
    ).toBe('SEARCH_TERM_HIGH_PERFORMING')
    expect(
      result.keywordsWithVolume.find((item) => item.keyword === 'brandx x300 vacuum')?.source
    ).toBe('KEYWORD_PLANNER')
  })

  it('prefers stronger raw canonical provenance inside canonical bucket views', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        {
          keyword: 'brandx robot vacuum',
          searchVolume: 200,
          source: 'GLOBAL_KEYWORDS' as any,
          sourceType: 'CANONICAL_BUCKET_VIEW' as any,
          matchType: 'PHRASE' as const,
        },
        {
          keyword: 'brandx robot vacuum',
          searchVolume: 200,
          source: 'KEYWORD_PLANNER' as any,
          sourceType: 'CANONICAL_BUCKET_VIEW' as any,
          matchType: 'PHRASE' as const,
        },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 5,
    })

    expect(result.keywords).toContain('brandx robot vacuum')
    expect(result.keywordsWithVolume.find((item) => item.keyword === 'brandx robot vacuum')).toMatchObject({
      source: 'KEYWORD_PLANNER',
      sourceSubtype: 'KEYWORD_PLANNER',
      rawSource: 'KEYWORD_PLANNER',
    })
  })

  it('drops low-quality informational and platform keywords', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx', searchVolume: 5000, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'what is brandx camera', searchVolume: 1200, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
        { keyword: 'brandx camera review', searchVolume: 1100, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
        { keyword: 'brandx amazon camera', searchVolume: 1000, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
        { keyword: 'brandx security camera', searchVolume: 2200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'brand_intent',
      maxKeywords: 10,
    })

    expect(result.keywords).toContain('brandx')
    expect(result.keywords).toContain('brandx security camera')
    expect(result.keywords).not.toContain('what is brandx camera')
    expect(result.keywords).not.toContain('brandx camera review')
    expect(result.keywords).not.toContain('brandx amazon camera')
  })

  it('drops repeated action and locale-noise keywords', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx mattress', searchVolume: 3200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'buy brandx mattress buy', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
        { keyword: 'brandx shop kabupaten bekasi', searchVolume: 0, source: 'OFFER_EXTRACTED_KEYWORDS' as any, matchType: 'PHRASE' },
        { keyword: 'brandx a cozy home made simple', searchVolume: 0, source: 'GLOBAL_CORE' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toContain('brandx mattress')
    expect(result.keywords).not.toContain('buy brandx mattress buy')
    expect(result.keywords).not.toContain('brandx shop kabupaten bekasi')
    expect(result.keywords).not.toContain('brandx a cozy home made simple')
  })

  it('drops weak evaluative brand+category queries while keeping qualified best-for demand terms', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'novilla', searchVolume: 9000, source: 'BRAND_SEED' as any, matchType: 'EXACT' },
        { keyword: 'novilla mattresses good', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
        { keyword: 'best novilla mattresses', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
        { keyword: 'best novilla mattress for side sleepers', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as any, matchType: 'PHRASE' },
        { keyword: 'novilla queen mattress', searchVolume: 3200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
      ],
      brandName: 'Novilla',
      creativeType: 'product_intent',
      maxKeywords: 10,
    })

    expect(result.keywords).toContain('novilla')
    expect(result.keywords).toContain('novilla queen mattress')
    expect(result.keywords).toContain('best novilla mattress for side sleepers')
    expect(result.keywords).not.toContain('novilla mattresses good')
    expect(result.keywords).not.toContain('best novilla mattresses')
  })

  it('drops community/question/price-tracker query noise', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx vacuum cleaner', searchVolume: 3200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx vacuum reddit', searchVolume: 1600, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
        { keyword: 'are brandx vacuums good', searchVolume: 1400, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
        { keyword: 'brandx vacuum price tracker', searchVolume: 1200, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toContain('brandx vacuum cleaner')
    expect(result.keywords).not.toContain('brandx vacuum reddit')
    expect(result.keywords).not.toContain('are brandx vacuums good')
    expect(result.keywords).not.toContain('brandx vacuum price tracker')
  })

  it('drops stacked noun noise terms from weak page extraction phrases', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'ringconn smart ring price', searchVolume: 1100, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'ringconn electronics photo wearable technology rings cost', searchVolume: 900, source: 'PAGE_EXTRACT' as any, matchType: 'PHRASE' },
      ],
      brandName: 'Ringconn',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toContain('ringconn smart ring price')
    expect(result.keywords).not.toContain('ringconn electronics photo wearable technology rings cost')
  })

  it('deduplicates token-order permutations and keeps the better candidate', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx x200 vacuum', searchVolume: 1800, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'x200 brandx vacuum', searchVolume: 2500, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 10,
    })

    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywords[0]).toBe('brandx x200 vacuum')
  })

  it('injects a pure brand keyword floor for product_intent when missing from candidates', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx security camera', searchVolume: 4200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx outdoor camera', searchVolume: 3500, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
    })

    expect(result.keywords).toContain('brandx')
    expect(result.keywords).toContain('brandx security camera')
  })

  it('uses a light default brand reserve for product_intent and preserves multiple demand terms', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx', searchVolume: 9000, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' },
        { keyword: 'brandx security camera', searchVolume: 5200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'security camera for home', searchVolume: 5000, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' },
        { keyword: 'outdoor security camera', searchVolume: 4800, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 4,
    })

    const pureBrandKeywords = getPureBrandKeywords('BrandX')
    const pureBrandCount = result.keywords.filter((keyword) =>
      isPureBrandKeyword(keyword, pureBrandKeywords)
    ).length
    const nonPureBrandCount = result.keywords.filter((keyword) =>
      !isPureBrandKeyword(keyword, pureBrandKeywords)
    ).length

    expect(result.keywords).toContain('brandx')
    expect(pureBrandCount).toBe(1)
    expect(nonPureBrandCount).toBeGreaterThanOrEqual(2)
    expect(result.keywords).toEqual(expect.arrayContaining([
      'security camera for home',
      'outdoor security camera',
    ]))
  })

  it('preserves source priority and enriches keyword audit metadata', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1600,
          source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
          matchType: 'PHRASE',
          evidence: ['x200', 'vacuum'],
          confidence: 0.93,
        },
      ],
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      maxKeywords: 5,
    })

    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywordsWithVolume[0]).toMatchObject({
      source: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceTier: 'T0',
      sourceGovernanceBucket: 'primary',
      sourceTop1Eligible: true,
      sourceTop2Eligible: true,
      rawSource: 'SEARCH_TERM',
      derivedTags: undefined,
      isDerived: false,
      isFallback: false,
      sourceField: 'search_terms',
      anchorType: 'brand_model',
      anchorKinds: expect.arrayContaining(['brand', 'model', 'demand']),
      languageSignals: expect.objectContaining({
        targetLanguage: 'en',
        allowedLanguageHints: expect.arrayContaining(['en']),
        contentTokenCount: 1,
      }),
      contractRole: 'required',
      evidenceStrength: 'high',
      familyMatchType: 'mixed',
      suggestedMatchType: 'EXACT',
      matchType: 'EXACT',
      confidence: 0.93,
      evidence: ['x200', 'vacuum'],
      decisionTrace: expect.arrayContaining([
        expect.objectContaining({ stage: 'global_validity', outcome: 'pass' }),
        expect.objectContaining({ stage: 'source_governance', outcome: 'primary' }),
        expect.objectContaining({ stage: 'slot_contract', outcome: 'required' }),
        expect.objectContaining({ stage: 'final_invariant', outcome: 'selected' }),
      ]),
    })
    expect(result.keywordsWithVolume[0].qualityReason).toContain('真实搜索词')
  })

  it('caps low-trust sources in normal mode when enough trusted alternatives exist', () => {
    const trusted = Array.from({ length: 12 }, (_, index) => ({
      keyword: `brandx ${200 + index}`,
      searchVolume: 5000 - index,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const lowTrustAi = [
      'brandx vacuum cleaner',
      'brandx vacuum for home',
      'brandx vacuum cordless',
      'brandx vacuum waterproof',
      'brandx vacuum portable',
      'brandx vacuum lightweight',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 8000 - index,
      source: 'AI_GENERATED' as any,
      sourceType: 'AI_LLM_RAW',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...lowTrustAi, ...trusted],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const lowTrustCount = result.keywordsWithVolume.filter((item) =>
      ['AI_LLM_RAW', 'AI_GENERATED', 'SCORING_SUGGESTION', 'GAP_INDUSTRY_BRANDED'].includes(
        String(item.sourceSubtype || item.sourceType || '').toUpperCase()
      )
    ).length
    const aiRawCount = result.keywordsWithVolume.filter((item) =>
      ['AI_LLM_RAW', 'AI_GENERATED'].includes(
        String(item.sourceSubtype || item.sourceType || '').toUpperCase()
      )
    ).length

    expect(lowTrustCount).toBeLessThanOrEqual(2)
    expect(aiRawCount).toBeLessThanOrEqual(1)
    expect(result.sourceQuotaAudit.blockedByCap.lowTrust).toBeGreaterThanOrEqual(0)
    expect(result.sourceQuotaAudit.acceptedByClass.aiLlmRaw).toBeLessThanOrEqual(1)
  })

  it('loosens low-trust source quota in fallback mode', () => {
    const trusted = Array.from({ length: 12 }, (_, index) => ({
      keyword: `brandx ${300 + index}`,
      searchVolume: 4800 - index,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const lowTrustAi = [
      'brandx vacuum cleaner',
      'brandx vacuum for home',
      'brandx vacuum cordless',
      'brandx vacuum waterproof',
      'brandx vacuum portable',
      'brandx vacuum lightweight',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 8100 - index,
      source: 'AI_GENERATED' as any,
      sourceType: 'AI_LLM_RAW',
      matchType: 'PHRASE' as const,
    }))

    const normal = selectCreativeKeywords({
      keywordsWithVolume: [...lowTrustAi, ...trusted],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })
    const fallback = selectCreativeKeywords({
      keywordsWithVolume: [...lowTrustAi, ...trusted],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
      fallbackMode: true,
    })

    const countAiRaw = (items: typeof normal.keywordsWithVolume) =>
      items.filter((item) =>
        ['AI_LLM_RAW', 'AI_GENERATED'].includes(
          String(item.sourceSubtype || item.sourceType || '').toUpperCase()
        )
      ).length

    expect(countAiRaw(fallback.keywordsWithVolume)).toBeGreaterThanOrEqual(countAiRaw(normal.keywordsWithVolume))
    expect(countAiRaw(fallback.keywordsWithVolume)).toBeLessThanOrEqual(2)
    expect(fallback.sourceQuotaAudit.fallbackMode).toBe(true)
    expect(fallback.sourceQuotaAudit.quota.combinedLowTrustCap).toBeGreaterThan(
      normal.sourceQuotaAudit.quota.combinedLowTrustCap
    )
  })

  it('does not hard-filter product demand keywords by volume when search volume is unavailable', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        {
          keyword: 'brandx',
          searchVolume: 9000,
          source: 'BRAND_SEED' as any,
          sourceType: 'BRAND_SEED' as any,
          matchType: 'EXACT' as const,
        },
        {
          keyword: 'brandx vacuum',
          searchVolume: 0,
          source: 'KEYWORD_POOL' as any,
          sourceType: 'CANONICAL_BUCKET_VIEW' as any,
          sourceSubtype: 'CANONICAL_BUCKET_VIEW' as any,
          matchType: 'PHRASE' as const,
          volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS' as any,
        },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 5,
    })

    expect(result.keywords).toContain('brandx')
    expect(result.keywords).toContain('brandx vacuum')
  })

  it('does not enable no-volume fallback when unavailable reason is stale but search volume is positive', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        {
          keyword: 'brandx',
          searchVolume: 9000,
          source: 'BRAND_SEED' as any,
          sourceType: 'BRAND_SEED' as any,
          matchType: 'EXACT' as const,
          volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS' as any,
        },
        {
          keyword: 'brandx vacuum',
          searchVolume: 1200,
          source: 'KEYWORD_POOL' as any,
          sourceType: 'CANONICAL_BUCKET_VIEW' as any,
          sourceSubtype: 'CANONICAL_BUCKET_VIEW' as any,
          matchType: 'PHRASE' as const,
        },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 5,
    })

    expect(result.sourceQuotaAudit.fallbackMode).toBe(false)
    expect(result.keywords).toContain('brandx')
    expect(result.keywords).toContain('brandx vacuum')
  })

  it('records deferred refill when quota would otherwise underfill the final list', () => {
    const mostlyLowTrust = Array.from({ length: 12 }, (_, index) => ({
      keyword: `brandx vacuum long tail ${index + 1}`,
      searchVolume: 1000 - index,
      source: 'SCORING_SUGGESTION' as any,
      sourceType: 'SCORING_SUGGESTION',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: mostlyLowTrust,
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywordsWithVolume).toHaveLength(10)
    expect(result.sourceQuotaAudit.deferredCount).toBeGreaterThan(0)
    expect(result.sourceQuotaAudit.deferredRefillTriggered).toBe(true)
    expect(result.sourceQuotaAudit.deferredRefillCount).toBeGreaterThan(0)
    expect(result.sourceQuotaAudit.underfillBeforeRefill).toBeGreaterThan(0)
  })

  it('does not force deferred low-trust refill when candidates lack enough evidence', () => {
    const trusted = [
      { keyword: 'robot vacuum cleaner for home', searchVolume: 5200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
      { keyword: 'cordless vacuum cleaner for pet hair', searchVolume: 4800, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
      { keyword: 'smart vacuum cleaner for apartment', searchVolume: 4300, source: 'KEYWORD_PLANNER' as any, sourceType: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
    ]
    const lowTrustAi = Array.from({ length: 20 }, (_, index) => ({
      keyword: `brandx vacuum option ${index + 1}`,
      searchVolume: 0,
      source: 'AI_GENERATED' as any,
      sourceType: 'AI_LLM_RAW' as any,
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...trusted, ...lowTrustAi],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywordsWithVolume.length).toBeLessThan(10)
    expect(result.sourceQuotaAudit.deferredCount).toBeGreaterThan(0)
    expect(result.sourceQuotaAudit.underfillBeforeRefill).toBeGreaterThan(0)
    expect(result.sourceQuotaAudit.deferredRefillCount).toBe(0)
  })

  it('reconciles quota audit after product_intent output rescue restores a non-empty final list', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'smart choice 1', searchVolume: 1200, source: 'AI_GENERATED' as any, sourceType: 'AI_LLM_RAW' as any, matchType: 'PHRASE' as const },
        { keyword: 'premium choice 2', searchVolume: 1100, source: 'AI_GENERATED' as any, sourceType: 'AI_LLM_RAW' as any, matchType: 'PHRASE' as const },
        { keyword: 'daily option 3', searchVolume: 1000, source: 'AI_GENERATED' as any, sourceType: 'AI_LLM_RAW' as any, matchType: 'PHRASE' as const },
      ],
      creativeType: 'product_intent',
      maxKeywords: 2,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords.length).toBeGreaterThan(0)
    expect(result.keywordsWithVolume[0]?.sourceSubtype).toBe('DERIVED_RESCUE')
    expect(result.sourceQuotaAudit.deferredCount).toBeGreaterThan(0)
    expect(result.sourceQuotaAudit.underfillBeforeRefill).toBeGreaterThan(0)
    expect(result.sourceQuotaAudit.acceptedCount).toBe(result.keywordsWithVolume.length)
    expect(result.sourceQuotaAudit.targetCount).toBeGreaterThanOrEqual(result.keywordsWithVolume.length)
    expect(result.sourceQuotaAudit.acceptedBrandCount).toBe(0)
  })

  it('keeps A/D top20 overlap within 20%-35% under mixed brand + demand corpus', () => {
    const sharedBrandDemand = [
      'brandx robot vacuum for home',
      'brandx robot vacuum for pet hair',
      'brandx cordless vacuum for stairs',
      'brandx self empty vacuum for apartment',
      'brandx quiet vacuum for office',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 7950 - index * 80,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))

    const brandTailTokens = [
      'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
      'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
      'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo',
    ]
    const brandOnlyDemand = brandTailTokens.map((token, index) => ({
      keyword: `brandx vacuum collection ${token}`,
      searchVolume: 5000 - index * 30,
      source: 'KEYWORD_POOL' as any,
      matchType: 'PHRASE' as const,
    }))

    const genericDemand = Array.from({ length: 30 }, (_, index) => ({
      keyword: `cordless robot vacuum for home variant ${index + 1}`,
      searchVolume: 6800 - index * 45,
      source: 'KEYWORD_PLANNER' as any,
      matchType: 'PHRASE' as const,
    }))

    const corpus = [...sharedBrandDemand, ...brandOnlyDemand, ...genericDemand]

    const brandTop20 = selectCreativeKeywords({
      keywordsWithVolume: corpus,
      brandName: 'BrandX',
      creativeType: 'brand_intent',
      maxKeywords: 20,
    }).keywords.slice(0, 20)

    const demandTop20 = selectCreativeKeywords({
      keywordsWithVolume: corpus,
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 20,
      minBrandKeywords: 0,
      brandReserve: 0,
    }).keywords.slice(0, 20)

    const brandSet = new Set(brandTop20.map((item) => item.toLowerCase().trim()))
    const overlapCount = demandTop20.filter((item) => brandSet.has(item.toLowerCase().trim())).length
    const overlapRate = overlapCount / Math.max(brandTop20.length, demandTop20.length)

    expect(brandTop20).toHaveLength(20)
    expect(demandTop20).toHaveLength(20)
    expect(overlapRate).toBeGreaterThanOrEqual(0.2)
    expect(overlapRate).toBeLessThanOrEqual(0.35)
  })

  it('keeps D top20 pure-brand ratio <= 15%', () => {
    const keywordsWithVolume = [
      ...Array.from({ length: 28 }, (_, index) => ({
        keyword: `robot vacuum cleaner ${index + 1}`,
        searchVolume: 9000 - index * 70,
        source: 'KEYWORD_PLANNER' as any,
        matchType: 'PHRASE' as const,
      })),
      { keyword: 'brandx', searchVolume: 6000, source: 'SEARCH_TERM' as any, matchType: 'PHRASE' as const },
      { keyword: 'brandx official store', searchVolume: 5000, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' as const },
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume,
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 20,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const pureBrandKeywords = getPureBrandKeywords('BrandX')
    const pureBrandCount = result.keywords.slice(0, 20).filter((keyword) =>
      isPureBrandKeyword(keyword, pureBrandKeywords)
    ).length
    const pureBrandRatio = pureBrandCount / Math.max(1, result.keywords.slice(0, 20).length)

    expect(result.keywords.slice(0, 20)).toHaveLength(20)
    expect(pureBrandRatio).toBeLessThanOrEqual(0.15)
  })

  it('keeps B top20 model-anchor hit-rate >= 90%', () => {
    const modelAnchors = Array.from({ length: 22 }, (_, index) => {
      const modelNo = 200 + index
      return {
        keyword: index % 2 === 0 ? `brandx x${modelNo} vacuum` : `x${modelNo} vacuum`,
        searchVolume: 7000 - index * 45,
        source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
        matchType: 'PHRASE' as const,
      }
    })
    const noise = [
      { keyword: 'brandx vacuum', searchVolume: 6500, source: 'KEYWORD_POOL' as any, matchType: 'PHRASE' as const },
      { keyword: 'vacuum cleaner for home', searchVolume: 6400, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...modelAnchors, ...noise],
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 20,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const top20 = result.keywords.slice(0, 20)
    const modelAnchorHits = top20.filter((keyword) => hasModelAnchorEvidence({ keywords: [keyword] })).length
    const hitRate = modelAnchorHits / Math.max(1, top20.length)

    expect(top20).toHaveLength(20)
    expect(hitRate).toBeGreaterThanOrEqual(0.9)
  })

  it('keeps preferred-bucket demand terms in model_intent to avoid severe underfill', () => {
    const preferredBucketKeywords = [
      'brandx vacuum cleaner',
      'brandx vacuum for pet hair',
      'brandx cordless vacuum',
    ]
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx x200 vacuum', searchVolume: 4200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' },
        { keyword: 'x300 vacuum', searchVolume: 3900, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' },
        { keyword: 'x400 vacuum', searchVolume: 3600, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' },
        { keyword: 'brandx vacuum cleaner', searchVolume: 1600, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx vacuum for pet hair', searchVolume: 1500, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx cordless vacuum', searchVolume: 1400, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      preferredBucketKeywords,
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 6,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toEqual(expect.arrayContaining(preferredBucketKeywords))
    expect(result.keywordsWithVolume).toHaveLength(6)
  })

  it('caps non-model spillover for model_intent when preferred bucket is noisy', () => {
    const modelCandidates = [
      'brandx x200 vacuum',
      'brandx x300 vacuum',
      'brandx x400 vacuum',
      'x500 vacuum',
      'x600 vacuum',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 3000 - index * 50,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const noisyPreferred = Array.from({ length: 24 }, (_, index) => ({
      keyword: `brandx smart vacuum option ${index + 1}`,
      searchVolume: 1500 - index * 10,
      source: 'KEYWORD_POOL' as any,
      matchType: 'PHRASE' as const,
    }))
    const preferredBucketKeywords = noisyPreferred.map((item) => item.keyword)

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...modelCandidates, ...noisyPreferred],
      preferredBucketKeywords,
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 50,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const modelHits = result.keywords.filter((keyword) => hasModelAnchorEvidence({ keywords: [keyword] })).length
    const nonModelCount = result.keywords.length - modelHits

    expect(modelHits).toBeGreaterThanOrEqual(5)
    expect(nonModelCount).toBeLessThanOrEqual(10)
    const hardModelItems = result.keywordsWithVolume.filter((item) =>
      hasModelAnchorEvidence({ keywords: [item.keyword] })
    )
    expect(hardModelItems.every((item) => item.matchType === 'EXACT')).toBe(true)
  })

  it('prioritizes compact trusted soft-family terms over generic spillover in model_intent rebalancing', () => {
    const modelCandidates = [
      'novilla n200 mattress',
      'novilla n300 mattress',
      'novilla n400 mattress',
      'n500 mattress',
      'n600 mattress',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 4200 - index * 50,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const trustedSoftFamily = [
      'novilla king size mattress',
      'novilla memory foam mattress',
      'novilla king mattress',
      'novilla twin mattress',
      'novilla queen mattress',
      'novilla 12 inch mattress',
      'novilla medium firm mattress',
      'novilla cooling mattress',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 900 - index * 20,
      source: 'KEYWORD_POOL' as any,
      sourceType: 'CANONICAL_BUCKET_VIEW' as any,
      matchType: 'PHRASE' as const,
    }))
    const genericSpillover = Array.from({ length: 24 }, (_, index) => ({
      keyword: `novilla mattress option ${index + 1}`,
      searchVolume: 1300 - index * 10,
      source: 'KEYWORD_POOL' as any,
      sourceType: 'CANONICAL_BUCKET_VIEW' as any,
      matchType: 'PHRASE' as const,
    }))
    const preferredBucketKeywords = [
      ...trustedSoftFamily.map((item) => item.keyword),
      ...genericSpillover.map((item) => item.keyword),
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...modelCandidates, ...trustedSoftFamily, ...genericSpillover],
      preferredBucketKeywords,
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 50,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const softFamilyKeywords = result.keywords.filter((keyword) =>
      [
        'novilla king size mattress',
        'novilla memory foam mattress',
        'novilla king mattress',
        'novilla twin mattress',
        'novilla queen mattress',
        'novilla 12 inch mattress',
      ].includes(keyword)
    )
    const genericSpilloverKeywords = result.keywords.filter((keyword) =>
      /novilla mattress option/i.test(keyword)
    )

    expect(softFamilyKeywords.length).toBeGreaterThanOrEqual(6)
    expect(genericSpilloverKeywords.length).toBeLessThanOrEqual(3)
    const softFamilySet = new Set([
      'novilla king size mattress',
      'novilla memory foam mattress',
      'novilla king mattress',
      'novilla twin mattress',
      'novilla queen mattress',
      'novilla 12 inch mattress',
    ])
    const selectedSoftFamily = result.keywordsWithVolume.filter((item) => softFamilySet.has(item.keyword))
    expect(selectedSoftFamily.length).toBeGreaterThanOrEqual(6)
    expect(selectedSoftFamily.every((item) => item.matchType === 'PHRASE')).toBe(true)
  })

  it('preserves trusted soft-family terms when dense hard-model candidates saturate model_intent collection budget', () => {
    const hardModels = Array.from({ length: 30 }, (_, index) => ({
      keyword: index % 2 === 0 ? `novilla n${200 + index} mattress` : `n${200 + index} mattress`,
      searchVolume: 5000 - index * 20,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const trustedSoftFamily = [
      'novilla king size mattress',
      'novilla memory foam mattress',
      'novilla king mattress',
      'novilla queen mattress',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 900 - index * 20,
      source: 'KEYWORD_POOL' as any,
      sourceType: 'CANONICAL_BUCKET_VIEW' as any,
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...hardModels, ...trustedSoftFamily],
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const softFamilyHits = result.keywords.filter((keyword) =>
      [
        'novilla king size mattress',
        'novilla memory foam mattress',
        'novilla king mattress',
        'novilla queen mattress',
      ].includes(keyword)
    )

    expect(softFamilyHits.length).toBeGreaterThanOrEqual(2)
    const softFamilySet = new Set([
      'novilla king size mattress',
      'novilla memory foam mattress',
      'novilla king mattress',
      'novilla queen mattress',
    ])
    const selectedSoftFamily = result.keywordsWithVolume.filter((item) => softFamilySet.has(item.keyword))
    expect(selectedSoftFamily.length).toBeGreaterThanOrEqual(2)
    expect(selectedSoftFamily.every((item) => item.matchType === 'PHRASE')).toBe(true)
  })

  it('relaxes model_intent preferred bucket filtering only when strict pass severely underfills', () => {
    const strictModelAnchors = [
      { keyword: 'brandx x200 smart ring', searchVolume: 4200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
      { keyword: 'brandx x300 smart ring', searchVolume: 3900, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
      { keyword: 'x400 smart ring', searchVolume: 3600, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
      { keyword: 'x500 smart ring', searchVolume: 3300, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
    ]
    const preferredFallbackOnly = [
      'smart ring sleep tracking',
      'waterproof smart ring monitor',
      'sleep apnea smart ring monitor',
      'women health smart ring',
      'heart rate smart ring',
      'battery life smart ring',
    ]
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        ...strictModelAnchors,
        ...preferredFallbackOnly.map((keyword, index) => ({
          keyword,
          searchVolume: 1200 - index * 20,
          source: 'KEYWORD_POOL' as any,
          matchType: 'PHRASE' as const,
        })),
      ],
      preferredBucketKeywords: [
        ...strictModelAnchors.map((item) => item.keyword),
        ...preferredFallbackOnly,
      ],
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywordsWithVolume).toHaveLength(10)
    expect(result.keywords).toEqual(expect.arrayContaining(preferredFallbackOnly))
    const modelHits = result.keywords.filter((keyword) => hasModelAnchorEvidence({ keywords: [keyword] })).length
    expect(modelHits).toBeGreaterThanOrEqual(4)
  })

  it('drops AI-generated transactional model-intent keywords even when they include model anchors', () => {
    const aiTransactional = [
      'buy brandx gen 2 smart ring',
      'order brandx gen 2 smart ring',
      'price brandx gen 2 smart ring',
      'shop brandx gen 2 smart ring',
    ]

    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx x200 smart ring', searchVolume: 4200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
        { keyword: 'brandx x300 smart ring', searchVolume: 3900, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
        { keyword: 'x400 smart ring', searchVolume: 3600, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
        { keyword: 'x500 smart ring', searchVolume: 3300, source: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
        ...aiTransactional.map((keyword, index) => ({
          keyword,
          searchVolume: 0,
          source: 'AI_GENERATED' as any,
          sourceType: 'AI_LLM_RAW' as any,
          matchType: 'PHRASE' as const,
          confidence: 0.4 + index * 0.01,
        })),
      ],
      preferredBucketKeywords: [
        'brandx x200 smart ring',
        'brandx x300 smart ring',
        'x400 smart ring',
        'x500 smart ring',
        ...aiTransactional,
      ],
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 8,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).not.toEqual(expect.arrayContaining(aiTransactional))
    expect(result.keywordsWithVolume.every((item) => item.matchType === 'EXACT')).toBe(true)
  })

  it('rejects weak single-tail MODEL_FAMILY_GUARD terms while keeping specific family terms in model_intent', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'novilla mattress', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
        { keyword: 'novilla king size mattress', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
        { keyword: 'novilla memory foam mattress', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
      ],
      preferredBucketKeywords: [
        'novilla mattress',
        'novilla king size mattress',
        'novilla memory foam mattress',
      ],
      brandName: 'Novilla',
      creativeType: 'model_intent',
      maxKeywords: 6,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toEqual(expect.arrayContaining([
      'novilla king size mattress',
      'novilla memory foam mattress',
    ]))
    expect(result.keywords).not.toContain('novilla mattress')
    const keptFamily = result.keywordsWithVolume.filter((item) =>
      ['novilla king size mattress', 'novilla memory foam mattress'].includes(item.keyword)
    )
    expect(keptFamily.length).toBeGreaterThanOrEqual(2)
    expect(keptFamily.every((item) => item.matchType === 'PHRASE')).toBe(true)
  })

  it('does not rescue model_intent with pure brand when only builder-derived demand signals are available', () => {
    const pureBrandKeywords = getPureBrandKeywords('Vital Proteins')
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'vital proteins', searchVolume: 0, source: 'BRAND_SEED' as any, sourceType: 'BRAND_SEED' as any, matchType: 'EXACT' as const, isPureBrand: true },
        {
          keyword: 'vital proteins unflavored collagen powder',
          searchVolume: 0,
          source: 'DERIVED_RESCUE' as any,
          sourceType: 'BUILDER_NON_EMPTY_RESCUE' as any,
          sourceSubtype: 'BUILDER_NON_EMPTY_RESCUE' as any,
          rawSource: 'OFFER' as any,
          derivedTags: ['NON_EMPTY_RESCUE'],
          matchType: 'PHRASE' as const,
        },
      ],
      brandName: 'Vital Proteins',
      creativeType: 'model_intent',
      maxKeywords: 2,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords.length).toBeGreaterThan(0)
    expect(result.keywords.every((keyword) => !isPureBrandKeyword(keyword, pureBrandKeywords))).toBe(true)
    expect(result.keywords.some((keyword) => /collagen powder/i.test(keyword))).toBe(true)
  })

  it('rejects pack plus claim soft-family fragments in model_intent', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'livfresh 3 pack better', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
        { keyword: '3 pack better', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
        { keyword: 'livfresh toothpaste gel', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
      ],
      brandName: 'Livfresh',
      creativeType: 'model_intent',
      maxKeywords: 5,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toContain('livfresh toothpaste gel')
    expect(result.keywords).not.toContain('livfresh 3 pack better')
    expect(result.keywords).not.toContain('3 pack better')
  })

  it('rejects url fragments and included-components title noise in model_intent', () => {
    const hilife = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'hilife https www', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
        { keyword: 'hilife steamer', searchVolume: 0, source: 'BUILDER_NON_EMPTY_RESCUE' as any, sourceType: 'BUILDER_NON_EMPTY_RESCUE' as any, matchType: 'PHRASE' as const },
      ],
      brandName: 'HiLIFE',
      creativeType: 'model_intent',
      maxKeywords: 5,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(hilife.keywords).toEqual(['hilife steamer'])

    const freebird = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'freebird https www', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
        { keyword: 'freebird flexseries head', searchVolume: 0, source: 'MODEL_FAMILY_GUARD' as any, sourceType: 'MODEL_FAMILY_GUARD' as any, matchType: 'PHRASE' as const },
      ],
      brandName: 'Freebird',
      creativeType: 'model_intent',
      maxKeywords: 5,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(freebird.keywords).toContain('freebird flexseries head')
    expect(freebird.keywords).not.toContain('freebird https www')

    const waterdrop = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'waterdrop x16', searchVolume: 0, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
        { keyword: 'waterdrop x16 alkaline tankless', searchVolume: 0, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
        { keyword: 'waterdrop included components x16 alkaline', searchVolume: 0, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
      ],
      brandName: 'Waterdrop',
      creativeType: 'model_intent',
      maxKeywords: 5,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(waterdrop.keywords).toEqual(expect.arrayContaining([
      'waterdrop x16',
      'waterdrop x16 alkaline tankless',
    ]))
    expect(waterdrop.keywords).not.toContain('waterdrop included components x16 alkaline')
  })

  it('keeps high-quality PURE_BRAND_PREFIX_REWRITE candidates in product_intent', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'novilla', searchVolume: 8000, source: 'BRAND_SEED' as any, sourceType: 'BRAND_SEED' as any, matchType: 'EXACT' as const, isPureBrand: true },
        { keyword: 'novilla king mattress', searchVolume: 4200, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
        { keyword: 'novilla memory foam mattress', searchVolume: 3800, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
        {
          keyword: 'novilla cooling mattress',
          searchVolume: 2100,
          source: 'PRODUCT_RELAX_BRANDED' as any,
          sourceType: 'PRODUCT_RELAX_BRANDED' as any,
          sourceSubtype: 'PURE_BRAND_PREFIX_REWRITE' as any,
          rawSource: 'KEYWORD_PLANNER' as any,
          derivedTags: ['PRODUCT_RELAX_BRANDED', 'PURE_BRAND_PREFIX_REWRITE', 'PLANNER_NON_BRAND_DEMAND'],
          matchType: 'PHRASE' as const,
        },
      ],
      brandName: 'Novilla',
      creativeType: 'product_intent',
      maxKeywords: 6,
    })

    expect(result.keywords).toEqual(expect.arrayContaining([
      'novilla',
      'novilla cooling mattress',
      'novilla king mattress',
      'novilla memory foam mattress',
    ]))
    const rewriteCandidate = result.keywordsWithVolume.find((item) => item.keyword === 'novilla cooling mattress')
    expect(rewriteCandidate).toMatchObject({
      source: 'PRODUCT_RELAX_BRANDED',
      sourceSubtype: 'PURE_BRAND_PREFIX_REWRITE',
      rawSource: 'KEYWORD_PLANNER',
    })
  })

  it('rejects low-quality PURE_BRAND_PREFIX_REWRITE candidates in product_intent', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx', searchVolume: 8000, source: 'BRAND_SEED' as any, sourceType: 'BRAND_SEED' as any, matchType: 'EXACT' as const, isPureBrand: true },
        { keyword: 'brandx robot vacuum', searchVolume: 4200, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
        { keyword: 'brandx robot vacuum pet hair', searchVolume: 3900, source: 'KEYWORD_POOL' as any, sourceType: 'CANONICAL_BUCKET_VIEW' as any, matchType: 'PHRASE' as const },
        {
          keyword: 'brandx amazon official store',
          searchVolume: 1800,
          source: 'PRODUCT_RELAX_BRANDED' as any,
          sourceType: 'PRODUCT_RELAX_BRANDED' as any,
          sourceSubtype: 'PURE_BRAND_PREFIX_REWRITE' as any,
          rawSource: 'KEYWORD_PLANNER' as any,
          derivedTags: ['PRODUCT_RELAX_BRANDED', 'PURE_BRAND_PREFIX_REWRITE', 'PLANNER_NON_BRAND_DEMAND'],
          matchType: 'PHRASE' as const,
        },
      ],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 6,
    })

    expect(result.keywords).not.toContain('brandx amazon official store')
  })

  it('does not over-reserve weak preferred-bucket terms in model_intent', () => {
    const strongModels = Array.from({ length: 8 }, (_, index) => ({
      keyword: `brandx x${200 + index} vacuum`,
      searchVolume: 4200 - index * 20,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const weakPreferred = Array.from({ length: 20 }, (_, index) => ({
      keyword: `brandx vacuum option ${index + 1}`,
      searchVolume: 1200 - index * 5,
      source: 'KEYWORD_POOL' as any,
      sourceType: 'CANONICAL_BUCKET_VIEW' as any,
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...strongModels, ...weakPreferred],
      preferredBucketKeywords: weakPreferred.map((item) => item.keyword),
      brandName: 'BrandX',
      creativeType: 'model_intent',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const weakPreferredHits = result.keywords.filter((keyword) => /option/i.test(keyword)).length
    const modelAnchorHits = result.keywords.filter((keyword) => hasModelAnchorEvidence({ keywords: [keyword] })).length

    expect(weakPreferredHits).toBeLessThanOrEqual(5)
    expect(modelAnchorHits).toBeGreaterThanOrEqual(5)
    expect(result.keywordsWithVolume.every((item) => item.matchType === 'EXACT')).toBe(true)
  })

  it('tightens low-trust quota when trusted strong-fit supply is abundant', () => {
    const abundantTrusted = Array.from({ length: 20 }, (_, index) => ({
      keyword: `brandx robot vacuum for home ${index + 1}`,
      searchVolume: 5200 - index * 30,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const scarceTrusted = Array.from({ length: 3 }, (_, index) => ({
      keyword: `brandx robot vacuum trusted ${index + 1}`,
      searchVolume: 2200 - index * 20,
      source: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any,
      matchType: 'PHRASE' as const,
    }))
    const lowTrust = Array.from({ length: 14 }, (_, index) => ({
      keyword: `brandx robot vacuum smart option ${index + 1}`,
      searchVolume: 1800 - index * 15,
      source: 'AI_GENERATED' as any,
      sourceType: 'AI_LLM_RAW' as any,
      matchType: 'PHRASE' as const,
    }))

    const abundant = selectCreativeKeywords({
      keywordsWithVolume: [...abundantTrusted, ...lowTrust],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 12,
      minBrandKeywords: 0,
      brandReserve: 0,
    })
    const scarce = selectCreativeKeywords({
      keywordsWithVolume: [...scarceTrusted, ...lowTrust],
      brandName: 'BrandX',
      creativeType: 'product_intent',
      maxKeywords: 12,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(abundant.sourceQuotaAudit.quota.combinedLowTrustCap).toBeLessThanOrEqual(
      scarce.sourceQuotaAudit.quota.combinedLowTrustCap
    )
    expect(abundant.sourceQuotaAudit.acceptedByClass.lowTrust).toBeLessThanOrEqual(
      scarce.sourceQuotaAudit.acceptedByClass.lowTrust
    )
    expect(abundant.sourceQuotaAudit.acceptedByClass.aiLlmRaw).toBeLessThanOrEqual(
      scarce.sourceQuotaAudit.acceptedByClass.aiLlmRaw
    )
  })

  it('generates compact branded variants from high-evidence non-brand demand terms', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'novilla', searchVolume: 9000, source: 'BRAND_SEED' as any, sourceType: 'BRAND_SEED' as any, matchType: 'EXACT' as const },
        { keyword: 'queen mattress', searchVolume: 3200, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
        { keyword: 'king size mattress', searchVolume: 3000, source: 'SEARCH_TERM_HIGH_PERFORMING' as any, sourceType: 'SEARCH_TERM_HIGH_PERFORMING' as any, matchType: 'PHRASE' as const },
        { keyword: 'memory foam mattress', searchVolume: 2800, source: 'KEYWORD_PLANNER' as any, sourceType: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
        { keyword: 'twin mattress', searchVolume: 2600, source: 'KEYWORD_PLANNER' as any, sourceType: 'KEYWORD_PLANNER' as any, matchType: 'PHRASE' as const },
      ],
      brandName: 'Novilla',
      creativeType: 'brand_intent',
      maxKeywords: 8,
      minBrandKeywords: 6,
      brandReserve: 6,
    })

    expect(result.keywords).toEqual(expect.arrayContaining([
      'novilla queen mattress',
      'novilla king size mattress',
      'novilla memory foam mattress',
      'novilla twin mattress',
    ]))

    const generated = result.keywordsWithVolume.filter((item) =>
      [
        'novilla queen mattress',
        'novilla king size mattress',
        'novilla memory foam mattress',
        'novilla twin mattress',
      ].includes(item.keyword)
    )
    expect(generated.length).toBeGreaterThanOrEqual(3)
    expect(generated.every((item) => item.searchVolume === 0)).toBe(true)
  })

  it('scales AI quota with effective target count instead of static maxKeywords in model_intent', () => {
    const trusted = [
      'our place titanium pro',
      'our place wonder oven pro',
      'our place air fryer oven',
      'our place titanium always pan pro',
      'our place toaster oven pro',
      'our place frying pans',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 5200 - index * 120,
      source: index % 2 === 0 ? 'HOT_PRODUCT_AGGREGATE' as any : 'GLOBAL_CORE' as any,
      sourceType: index % 2 === 0 ? 'HOT_PRODUCT_AGGREGATE' as any : 'GLOBAL_CORE' as any,
      matchType: 'PHRASE' as const,
    }))
    const aiNoisy = [
      'our place mini always pan',
      'our place large always pan',
      'our place wonder oven',
      'our place titanium pan',
      'our place toaster oven air fryer',
      'ourplace wonder oven',
      'our place oven pro',
      'our place cookware set',
      'ourplace pans',
      'our place always pan 2 0',
    ].map((keyword, index) => ({
      keyword,
      searchVolume: 1800 - index * 30,
      source: 'AI_GENERATED' as any,
      sourceType: 'AI_LLM_RAW' as any,
      sourceSubtype: 'AI_GENERATED' as any,
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...trusted, ...aiNoisy],
      preferredBucketKeywords: [...trusted, ...aiNoisy].map((item) => item.keyword),
      brandName: 'Our Place',
      creativeType: 'model_intent',
      bucket: 'B',
      maxKeywords: 50,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.sourceQuotaAudit.targetCount).toBeGreaterThan(0)
    expect(result.sourceQuotaAudit.quota.aiCap).toBeLessThanOrEqual(
      Math.floor(result.sourceQuotaAudit.targetCount * 0.5)
    )
    expect(result.sourceQuotaAudit.quota.aiCap).toBeLessThan(10)
    const finalAiCount = result.keywordsWithVolume.filter((item) =>
      ['AI_GENERATED', 'AI_LLM_RAW'].includes(
        String(item.sourceSubtype || item.sourceType || '').trim().toUpperCase()
      )
    ).length
    expect(finalAiCount).toBeLessThan(result.keywordsWithVolume.length)
  })

  it('prefers non-ai provenance for duplicate model_intent keywords with same normalized text', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        {
          keyword: 'our place wonder oven',
          searchVolume: 6400,
          source: 'AI_GENERATED' as any,
          sourceType: 'AI_LLM_RAW' as any,
          sourceSubtype: 'AI_GENERATED' as any,
          matchType: 'PHRASE' as const,
        },
        {
          keyword: 'our place wonder oven',
          searchVolume: 120,
          source: 'OFFER_EXTRACTED_KEYWORDS' as any,
          sourceType: 'OFFER_EXTRACTED_KEYWORDS' as any,
          sourceSubtype: 'OFFER_EXTRACTED_KEYWORDS' as any,
          matchType: 'PHRASE' as const,
        },
        {
          keyword: 'our place always pan',
          searchVolume: 3200,
          source: 'HOT_PRODUCT_AGGREGATE' as any,
          sourceType: 'HOT_PRODUCT_AGGREGATE' as any,
          matchType: 'PHRASE' as const,
        },
        {
          keyword: 'our place titanium pan',
          searchVolume: 2800,
          source: 'OFFER_EXTRACTED_KEYWORDS' as any,
          sourceType: 'OFFER_EXTRACTED_KEYWORDS' as any,
          matchType: 'PHRASE' as const,
        },
        {
          keyword: 'our place pressure cooker',
          searchVolume: 2400,
          source: 'GLOBAL_CORE' as any,
          sourceType: 'GLOBAL_CORE' as any,
          matchType: 'PHRASE' as const,
        },
      ],
      preferredBucketKeywords: [
        'our place wonder oven',
        'our place always pan',
        'our place titanium pan',
      ],
      brandName: 'Our Place',
      creativeType: 'model_intent',
      bucket: 'B',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const wonderOven = result.keywordsWithVolume.find((item) => item.keyword === 'our place wonder oven')
    expect(wonderOven).toBeDefined()
    expect(String(wonderOven?.sourceSubtype || wonderOven?.sourceType || '').trim().toUpperCase()).toBe(
      'OFFER_EXTRACTED_KEYWORDS'
    )
  })

  it('normalizes compacted multi-word brand tokens to avoid noisy ourplace variants', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        {
          keyword: 'ourplace wonder oven',
          searchVolume: 1800,
          source: 'AI_GENERATED' as any,
          sourceType: 'AI_LLM_RAW' as any,
          sourceSubtype: 'AI_GENERATED' as any,
          matchType: 'PHRASE' as const,
        },
        {
          keyword: 'our place wonder oven',
          searchVolume: 4200,
          source: 'HOT_PRODUCT_AGGREGATE' as any,
          sourceType: 'HOT_PRODUCT_AGGREGATE' as any,
          matchType: 'PHRASE' as const,
        },
        {
          keyword: 'our place titanium pro',
          searchVolume: 3900,
          source: 'GLOBAL_CORE' as any,
          sourceType: 'GLOBAL_CORE' as any,
          matchType: 'PHRASE' as const,
        },
      ],
      preferredBucketKeywords: [
        'ourplace wonder oven',
        'our place wonder oven',
        'our place titanium pro',
      ],
      brandName: 'Our Place',
      creativeType: 'model_intent',
      bucket: 'B',
      maxKeywords: 10,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.keywords).toContain('our place wonder oven')
    expect(result.keywords).not.toContain('ourplace wonder oven')
  })
})
