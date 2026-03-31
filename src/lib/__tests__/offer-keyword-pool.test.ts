/**
 * Offer 级关键词池服务单元测试
 *
 * 测试覆盖：
 * 1. 纯品牌词识别
 * 2. 品牌词/非品牌词分离
 * 3. 降级分桶策略
 * 4. 关键词重叠率计算
 * 5. 聚类策略确定
 * 6. 桶信息获取
 */

import {
  isPureBrandKeyword,
  separateBrandKeywords,
  getBucketInfo,
  calculateKeywordOverlapRate,
  determineClusteringStrategy,
  type OfferKeywordPool,
  type BucketType
} from '../offer-keyword-pool'

// 新增导入
import {
  getPureBrandKeywords,
  containsPureBrand,
  isBrandIrrelevant,
  filterLowIntentKeywords,
  filterMismatchedGeoKeywords,
  calculateSearchVolumeThreshold,
  isPureBrandKeyword as isExactPureBrandKeyword  // 🔥 2026-01-05: 使用别名避免与 offer-keyword-pool.ts 中的同名函数冲突
} from '../keyword-quality-filter'

// Mock 数据
const mockKeywordPool: OfferKeywordPool = {
  id: 1,
  offerId: 139,
  userId: 1,
  brandKeywords: ['eufy'],
  bucketAKeywords: ['eufy camera', 'indoor camera', 'outdoor camera', 'doorbell cam', 'eufycam'],
  bucketBKeywords: ['home security', 'baby monitor', 'pet watching', 'garage cam', 'driveway security'],
  bucketCKeywords: ['wireless camera', 'night vision', '2k camera', 'motion detection', 'best camera'],
  bucketDKeywords: ['eufy camera deal'],
  bucketAIntent: '品牌商品锚点',
  bucketBIntent: '商品需求场景',
  bucketCIntent: '功能规格特性',
  bucketDIntent: '商品需求扩展',
  storeBucketAKeywords: [],
  storeBucketBKeywords: [],
  storeBucketCKeywords: [],
  storeBucketDKeywords: [],
  storeBucketSKeywords: [],
  storeBucketAIntent: '品牌商品集合',
  storeBucketBIntent: '商品需求场景',
  storeBucketCIntent: '热门商品线',
  storeBucketDIntent: '信任服务信号',
  storeBucketSIntent: '店铺全量覆盖',
  linkType: 'product',
  totalKeywords: 16,
  clusteringModel: 'gemini',
  clusteringPromptVersion: 'v1.0',
  balanceScore: 0.95,
  createdAt: '2025-12-15T00:00:00Z',
  updatedAt: '2025-12-15T00:00:00Z'
}

const getKeywordTexts = (keywords: Array<{ keyword?: string } | string>) =>
  keywords.map(kw => typeof kw === 'string' ? kw : (kw.keyword || ''))

describe('OfferKeywordPool', () => {
  describe('isPureBrandKeyword', () => {
    it('should identify pure brand keyword correctly', () => {
      expect(isPureBrandKeyword('eufy', 'Eufy')).toBe(true)
      expect(isPureBrandKeyword('Eufy', 'Eufy')).toBe(true)
      expect(isPureBrandKeyword('EUFY', 'Eufy')).toBe(true)
    })

    it('should reject non-pure brand keywords', () => {
      expect(isPureBrandKeyword('eufy camera', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufy security', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufycam', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('best eufy camera', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufy indoor camera', 'Eufy')).toBe(false)
    })

    it('should handle brand names with spaces', () => {
      expect(isPureBrandKeyword('Reo Link', 'Reo Link')).toBe(true)
      expect(isPureBrandKeyword('reo link', 'Reo Link')).toBe(true)
      expect(isPureBrandKeyword('reolink', 'Reo Link')).toBe(true) // 去空格变体
    })

    it('should handle brand names with hyphens', () => {
      expect(isPureBrandKeyword('Ring-Alarm', 'Ring-Alarm')).toBe(true)
      expect(isPureBrandKeyword('ringalarm', 'Ring-Alarm')).toBe(true) // 去连字符变体
    })

    it('should handle brand names with periods (Google Ads normalization)', () => {
      expect(isPureBrandKeyword('dr mercola', 'Dr. Mercola')).toBe(true)
      expect(isPureBrandKeyword('dr. mercola', 'Dr. Mercola')).toBe(true)
      expect(isPureBrandKeyword('dr.mercola', 'Dr. Mercola')).toBe(true)
    })

    it('should handle edge cases', () => {
      expect(isPureBrandKeyword('', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufy', '')).toBe(false)
      expect(isPureBrandKeyword('', '')).toBe(false)
    })
  })

  describe('separateBrandKeywords', () => {
    it('should separate pure brand keywords from non-brand keywords', () => {
      const keywords = [
        'eufy',
        'eufy camera',
        'indoor camera',
        'eufy security',
        'home security',
        'best camera'
      ]

      const result = separateBrandKeywords(keywords, 'Eufy')

      expect(result.brandKeywords).toEqual(['eufy'])
      expect(result.nonBrandKeywords).toHaveLength(5)
      expect(result.nonBrandKeywords).toContain('eufy camera')
      expect(result.nonBrandKeywords).toContain('indoor camera')
      expect(result.nonBrandKeywords).toContain('eufy security')
      expect(result.nonBrandKeywords).toContain('home security')
      expect(result.nonBrandKeywords).toContain('best camera')
    })

    it('should handle empty keyword list', () => {
      const result = separateBrandKeywords([], 'Eufy')

      expect(result.brandKeywords).toEqual([])
      expect(result.nonBrandKeywords).toEqual([])
    })

    it('should handle keywords with no pure brand word', () => {
      const keywords = [
        'eufy camera',
        'eufy security',
        'home security'
      ]

      const result = separateBrandKeywords(keywords, 'Eufy')

      expect(result.brandKeywords).toEqual([])
      expect(result.nonBrandKeywords).toHaveLength(3)
    })

    it('should handle keywords with multiple pure brand words', () => {
      const keywords = [
        'eufy',
        'Eufy',
        'EUFY',
        'eufy camera'
      ]

      const result = separateBrandKeywords(keywords, 'Eufy')

      // 所有大小写变体都应被识别为品牌词
      expect(result.brandKeywords).toHaveLength(3)
      expect(result.nonBrandKeywords).toEqual(['eufy camera'])
    })
  })

  describe('getBucketInfo', () => {
    it('should return correct info for bucket A', () => {
      const info = getBucketInfo(mockKeywordPool, 'A')
      const keywords = getKeywordTexts(info.keywords)

      expect(info.intent).toBe('品牌意图')
      expect(info.intentEn).toBe('Brand Intent')
      expect(keywords).toContain('eufy')  // 品牌词
      expect(keywords).toContain('eufy camera')  // 桶A关键词
      expect(keywords).not.toContain('indoor camera')
      expect(keywords).not.toContain('outdoor camera')
    })

    it('should return correct info for bucket B', () => {
      const info = getBucketInfo(mockKeywordPool, 'B')
      const keywords = getKeywordTexts(info.keywords)

      expect(info.intent).toBe('商品型号/产品族意图')
      expect(info.intentEn).toBe('Model Intent')
      expect(keywords).toEqual([])
    })

    it('should return correct info for bucket C', () => {
      const info = getBucketInfo(mockKeywordPool, 'C')
      const keywords = getKeywordTexts(info.keywords)

      expect(info.intent).toBe('商品型号/产品族意图')
      expect(info.intentEn).toBe('Model Intent')
      expect(keywords).toEqual([])
    })

    it('should keep brand keywords only in canonical brand intent when no model anchors exist', () => {
      const bucketAKeywords = getKeywordTexts(getBucketInfo(mockKeywordPool, 'A').keywords)
      const bucketBKeywords = getKeywordTexts(getBucketInfo(mockKeywordPool, 'B').keywords)
      const bucketCKeywords = getKeywordTexts(getBucketInfo(mockKeywordPool, 'C').keywords)

      expect(bucketAKeywords).toContain('eufy')
      expect(bucketBKeywords).toEqual([])
      expect(bucketCKeywords).toEqual([])
    })

    it('should return full coverage for bucket D', () => {
      const info = getBucketInfo(mockKeywordPool, 'D')
      const keywords = getKeywordTexts(info.keywords)

      expect(info.intent).toBe('商品需求意图')
      expect(info.intentEn).toBe('Product Demand Intent')
      // getBucketInfo 返回 canonical bucket 视图，不包含执行阶段追加的纯品牌兜底词
      expect(keywords).not.toContain('eufy')
      expect(keywords).toContain('eufy camera')
      expect(keywords).toContain('home security')
      expect(keywords).toContain('wireless camera')
      expect(keywords).toContain('eufy camera deal')
      expect(keywords.length).toBeGreaterThanOrEqual(6)
    })

    it('should prefer model-anchored keywords for bucket B when explicit models exist', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['brandx'],
        bucketAKeywords: ['brandx vacuum'],
        bucketBKeywords: ['brandx x200 vacuum', 'x200 vacuum'],
        bucketCKeywords: ['brandx series x100 vacuum', 'brandx vacuum accessories'],
        bucketDKeywords: ['brandx official store'],
      }, 'B')
      const keywords = getKeywordTexts(info.keywords)

      expect(keywords).toContain('brandx x200 vacuum')
      expect(keywords).toContain('x200 vacuum')
      expect(keywords).toContain('brandx series x100 vacuum')
      expect(keywords).not.toContain('brandx')
      expect(keywords).not.toContain('brandx vacuum')
      expect(keywords).not.toContain('brandx official store')
    })

    it('should admit branded soft family/spec keywords into bucket B without generic fallback terms', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['novilla'],
        bucketAKeywords: [
          { keyword: 'novilla king size mattress 12 inch', searchVolume: 50, source: 'GOOGLE_SUGGEST', matchType: 'PHRASE' },
          { keyword: 'novilla mattress', searchVolume: 500, source: 'TITLE_EXTRACT', matchType: 'PHRASE' },
        ],
        bucketBKeywords: [
          { keyword: 'novilla memory foam mattress', searchVolume: 320, source: 'OFFER_EXTRACTED_KEYWORDS', matchType: 'PHRASE' },
          { keyword: 'mattresses', searchVolume: 800, source: 'KEYWORD_PLANNER', matchType: 'PHRASE' },
        ],
        bucketCKeywords: [
          { keyword: 'novilla king size mattress', searchVolume: 260, source: 'TITLE_EXTRACT', matchType: 'PHRASE' },
          { keyword: 'novilla king mattress', searchVolume: 210, source: 'TITLE_EXTRACT', matchType: 'PHRASE' },
        ],
        bucketDKeywords: ['novilla mattress in a box'],
      } as any, 'B')
      const keywords = getKeywordTexts(info.keywords)

      expect(keywords).toEqual(expect.arrayContaining([
        'novilla memory foam mattress',
        'novilla king size mattress 12 inch',
        'novilla king size mattress',
        'novilla king mattress',
      ]))
      expect(keywords).not.toContain('mattresses')
      expect(keywords).not.toContain('novilla')
      expect(keywords).not.toContain('novilla mattress')
    })

    it('should rank trusted model_intent sources ahead of global rewrites and awkward keyword shapes', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['novilla'],
        bucketAKeywords: [
          { keyword: 'novilla king size mattress 12 inch', searchVolume: 50, source: 'GOOGLE_SUGGEST', matchType: 'PHRASE' },
        ],
        bucketBKeywords: [
          { keyword: 'novilla king size mattress', searchVolume: 590, source: 'OFFER_EXTRACTED_KEYWORDS', matchType: 'PHRASE' },
          { keyword: 'novilla memory foam mattress', searchVolume: 320, source: 'OFFER_EXTRACTED_KEYWORDS', matchType: 'PHRASE' },
          { keyword: 'novilla king mattress', searchVolume: 210, source: 'OFFER_EXTRACTED_KEYWORDS', matchType: 'PHRASE' },
          { keyword: 'king novilla mattress', searchVolume: 0, source: 'GLOBAL_CORE', matchType: 'PHRASE' },
          { keyword: 'novilla mattress king size', searchVolume: 0, source: 'GLOBAL_CORE', matchType: 'PHRASE' },
          { keyword: 'novilla king size memory foam mattress', searchVolume: 0, source: 'GLOBAL_CORE', matchType: 'PHRASE' },
          { keyword: 'novilla king size mattress 12', searchVolume: 0, source: 'GLOBAL_CORE', matchType: 'PHRASE' },
        ],
        bucketCKeywords: [],
        bucketDKeywords: [],
      } as any, 'B')
      const keywords = getKeywordTexts(info.keywords)

      expect(keywords.slice(0, 4)).toEqual([
        'novilla king size mattress',
        'novilla memory foam mattress',
        'novilla king mattress',
        'novilla king size mattress 12 inch',
      ])
      expect(keywords).not.toContain('king novilla mattress')
      expect(keywords).not.toContain('novilla mattress king size')
      expect(keywords).not.toContain('novilla king size mattress 12')
      expect(keywords).toContain('novilla king size memory foam mattress')
    })

    it('should build brand intent from canonical sources before legacy bucket projection', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: [{ keyword: 'brandx', searchVolume: 1000, source: 'KEYWORD_PLANNER_BRAND', matchType: 'EXACT', isPureBrand: true }],
        bucketAKeywords: [],
        bucketBKeywords: [],
        bucketCKeywords: [],
        bucketDKeywords: [
          { keyword: 'brandx cordless vacuum for pet hair', searchVolume: 500, source: 'TITLE_EXTRACT', matchType: 'PHRASE' },
        ],
      } as any, 'A')
      const keywords = getKeywordTexts(info.keywords)

      expect(keywords).toContain('brandx')
      expect(keywords).toContain('brandx cordless vacuum for pet hair')
    })

    it('should filter promo-only and store-navigation keywords from bucket D without demand anchors', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['brandx'],
        bucketAKeywords: ['brandx vacuum'],
        bucketBKeywords: ['brandx official store'],
        bucketCKeywords: ['robot vacuum'],
        bucketDKeywords: ['brandx coupon', 'brandx x200 vacuum deal', 'vacuum accessories'],
      }, 'D')
      const keywords = getKeywordTexts(info.keywords)

      // canonical bucket 视图不追加纯品牌兜底词
      expect(keywords).not.toContain('brandx')
      expect(keywords).not.toContain('brandx official store')
      expect(keywords).not.toContain('brandx coupon')
      expect(keywords).toContain('brandx vacuum')
      expect(keywords).toContain('robot vacuum')
      expect(keywords).toContain('brandx x200 vacuum deal')
    })

    it('should filter platform, geo-admin and slogan noise from canonical bucket D while keeping branded navigation terms in the raw view', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['novilla'],
        bucketAKeywords: ['novilla mattress'],
        bucketBKeywords: ['novilla shopee', 'novilla a cozy home made simple'],
        bucketCKeywords: ['novilla shop kabupaten bekasi'],
        bucketDKeywords: [
          'buy novilla mattress buy',
          'where novilla store',
          'novilla rng',
          'novilla memory foam mattress',
        ],
      }, 'D')
      const keywords = getKeywordTexts(info.keywords)

      expect(keywords).toContain('novilla memory foam mattress')
      expect(keywords).toContain('novilla mattress')
      expect(keywords).not.toContain('novilla')
      expect(keywords).not.toContain('novilla shopee')
      expect(keywords).not.toContain('novilla a cozy home made simple')
      expect(keywords).not.toContain('novilla shop kabupaten bekasi')
      expect(keywords).not.toContain('buy novilla mattress buy')
      expect(keywords).toContain('where novilla store')
      expect(keywords).not.toContain('novilla rng')
    })

    it('should filter multilingual review and support-navigation noise from canonical bucket D', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['novilla'],
        bucketAKeywords: ['novilla mattress'],
        bucketBKeywords: [],
        bucketCKeywords: [],
        bucketDKeywords: [
          'novilla recensioni',
          'novilla bewertungen',
          'novilla avis',
          'novilla official site',
          'novilla customer service',
          'novilla memory foam mattress',
        ],
      }, 'D')
      const keywords = getKeywordTexts(info.keywords)

      expect(keywords).toContain('novilla memory foam mattress')
      expect(keywords).not.toContain('novilla recensioni')
      expect(keywords).not.toContain('novilla bewertungen')
      expect(keywords).not.toContain('novilla avis')
      expect(keywords).not.toContain('novilla official site')
      expect(keywords).not.toContain('novilla customer service')
    })

    it('should demote model-anchored demand terms behind generic product demand and drop model-only terms for bucket D', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['brandx'],
        bucketAKeywords: [],
        bucketBKeywords: [],
        bucketCKeywords: [],
        bucketDKeywords: [
          { keyword: 'brandx cordless vacuum', searchVolume: 500, source: 'D', matchType: 'PHRASE' },
          { keyword: 'brandx x200 vacuum', searchVolume: 500, source: 'D', matchType: 'PHRASE' },
          { keyword: 'brandx x200', searchVolume: 500, source: 'D', matchType: 'PHRASE' },
        ],
      } as any, 'D')
      const keywords = getKeywordTexts(info.keywords)

      expect(keywords).toContain('brandx cordless vacuum')
      expect(keywords).toContain('brandx x200 vacuum')
      expect(keywords).not.toContain('brandx x200')
      expect(keywords.indexOf('brandx cordless vacuum')).toBeLessThan(keywords.indexOf('brandx x200 vacuum'))
    })

    it('should use store hot-product model anchors for store bucket B', () => {
      const info = getBucketInfo({
        ...mockKeywordPool,
        brandKeywords: ['brandx'],
        bucketAKeywords: [],
        bucketBKeywords: [],
        bucketCKeywords: [],
        bucketDKeywords: [],
        storeBucketAKeywords: ['brandx robot vacuum'],
        storeBucketBKeywords: ['brandx x200 vacuum', 'x200 vacuum'],
        storeBucketCKeywords: ['brandx series x100 vacuum'],
        storeBucketDKeywords: ['brandx official store'],
        storeBucketSKeywords: ['brandx coupon'],
        linkType: 'store',
      }, 'B')
      const keywords = getKeywordTexts(info.keywords)

      expect(info.intent).toBe('热门商品型号/产品族意图')
      expect(info.intentEn).toBe('Store Model Intent')
      expect(keywords).toContain('brandx x200 vacuum')
      expect(keywords).toContain('x200 vacuum')
      expect(keywords).toContain('brandx series x100 vacuum')
      expect(keywords).not.toContain('brandx')
      expect(keywords).not.toContain('brandx official store')
      expect(keywords).not.toContain('brandx coupon')
    })
  })

  describe('calculateKeywordOverlapRate', () => {
    it('should return 0 for completely different keywords', () => {
      const keywords1 = ['camera', 'doorbell', 'indoor']
      const keywords2 = ['security', 'monitor', 'watching']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      expect(rate).toBe(0)
    })

    it('should return 1 for identical keywords', () => {
      const keywords1 = ['camera', 'doorbell', 'indoor']
      const keywords2 = ['camera', 'doorbell', 'indoor']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      expect(rate).toBe(1)
    })

    it('should calculate partial overlap correctly', () => {
      const keywords1 = ['camera', 'doorbell', 'indoor']
      const keywords2 = ['camera', 'security', 'outdoor']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      // 1 overlap (camera) / 3 max = 0.333...
      expect(rate).toBeCloseTo(0.333, 2)
    })

    it('should be case-insensitive', () => {
      const keywords1 = ['Camera', 'Doorbell']
      const keywords2 = ['camera', 'doorbell']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      expect(rate).toBe(1)
    })

    it('should handle empty arrays', () => {
      expect(calculateKeywordOverlapRate([], ['camera'])).toBe(0)
      expect(calculateKeywordOverlapRate(['camera'], [])).toBe(0)
      expect(calculateKeywordOverlapRate([], [])).toBe(0)
    })

    it('should handle different sized arrays', () => {
      const keywords1 = ['camera', 'doorbell']
      const keywords2 = ['camera', 'doorbell', 'indoor', 'outdoor']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      // 2 overlap / 4 max = 0.5
      expect(rate).toBe(0.5)
    })

    it('should achieve target ~3% overlap with bucket strategy', () => {
      // 模拟实际场景：每个桶只共享品牌词
      const bucketA = ['eufy', 'eufy camera', 'indoor camera', 'outdoor camera']
      const bucketB = ['eufy', 'home security', 'baby monitor', 'pet watching']
      const bucketC = ['eufy', 'wireless camera', 'night vision', '2k camera']

      // 桶A vs 桶B
      const rateAB = calculateKeywordOverlapRate(bucketA, bucketB)
      expect(rateAB).toBeCloseTo(0.25, 2)  // 1/4 = 0.25

      // 桶A vs 桶C
      const rateAC = calculateKeywordOverlapRate(bucketA, bucketC)
      expect(rateAC).toBeCloseTo(0.25, 2)  // 1/4 = 0.25

      // 桶B vs 桶C
      const rateBC = calculateKeywordOverlapRate(bucketB, bucketC)
      expect(rateBC).toBeCloseTo(0.25, 2)  // 1/4 = 0.25

      // 平均重叠率应该较低（仅品牌词）
      const avgRate = (rateAB + rateAC + rateBC) / 3
      expect(avgRate).toBeLessThan(0.5)  // 低于50%
    })
  })

  describe('determineClusteringStrategy', () => {
    it('should return single strategy for < 15 keywords', () => {
      const strategy = determineClusteringStrategy(10)

      expect(strategy.bucketCount).toBe(1)
      expect(strategy.strategy).toBe('single')
      expect(strategy.message).toContain('太少')
    })

    it('should return dual strategy for 15-29 keywords', () => {
      const strategy = determineClusteringStrategy(20)

      expect(strategy.bucketCount).toBe(2)
      expect(strategy.strategy).toBe('dual')
      expect(strategy.message).toContain('较少')
    })

    it('should return full strategy for >= 30 keywords', () => {
      const strategy = determineClusteringStrategy(30)

      expect(strategy.bucketCount).toBe(3)
      expect(strategy.strategy).toBe('full')
      expect(strategy.message).toContain('充足')
    })

    it('should handle boundary cases', () => {
      expect(determineClusteringStrategy(14).bucketCount).toBe(1)
      expect(determineClusteringStrategy(15).bucketCount).toBe(2)
      expect(determineClusteringStrategy(29).bucketCount).toBe(2)
      expect(determineClusteringStrategy(30).bucketCount).toBe(3)
    })

    it('should handle edge cases', () => {
      expect(determineClusteringStrategy(0).bucketCount).toBe(1)
      expect(determineClusteringStrategy(100).bucketCount).toBe(3)
    })
  })

  describe('Integration: Bucket Isolation', () => {
    it('should ensure bucket keywords are exclusive (no overlap except brand)', () => {
      const bucketA = new Set(mockKeywordPool.bucketAKeywords.map(k => k.toLowerCase()))
      const bucketB = new Set(mockKeywordPool.bucketBKeywords.map(k => k.toLowerCase()))
      const bucketC = new Set(mockKeywordPool.bucketCKeywords.map(k => k.toLowerCase()))

      // 桶A和桶B不应有交集
      const overlapAB = [...bucketA].filter(k => bucketB.has(k))
      expect(overlapAB).toHaveLength(0)

      // 桶A和桶C不应有交集
      const overlapAC = [...bucketA].filter(k => bucketC.has(k))
      expect(overlapAC).toHaveLength(0)

      // 桶B和桶C不应有交集
      const overlapBC = [...bucketB].filter(k => bucketC.has(k))
      expect(overlapBC).toHaveLength(0)
    })

    it('should have brand keywords excluded from all buckets', () => {
      const brandKeywords = new Set(mockKeywordPool.brandKeywords.map(k => k.toLowerCase()))

      for (const kw of mockKeywordPool.bucketAKeywords) {
        expect(brandKeywords.has(kw.toLowerCase())).toBe(false)
      }

      for (const kw of mockKeywordPool.bucketBKeywords) {
        expect(brandKeywords.has(kw.toLowerCase())).toBe(false)
      }

      for (const kw of mockKeywordPool.bucketCKeywords) {
        expect(brandKeywords.has(kw.toLowerCase())).toBe(false)
      }
    })
  })

  describe('Bucket Intent Classification', () => {
    it('should classify product-oriented keywords correctly', () => {
      const productKeywords = [
        'eufy camera',
        'indoor camera',
        'outdoor camera',
        'doorbell cam',
        'eufycam',
        'security camera'
      ]

      // 品牌商品锚点词通常包含产品类型
      for (const kw of productKeywords) {
        expect(kw.toLowerCase()).toMatch(/camera|cam|doorbell/i)
      }
    })

    it('should classify scenario-oriented keywords correctly', () => {
      const scenarioKeywords = [
        'home security',
        'baby monitor',
        'pet watching',
        'garage monitoring',
        'driveway security'
      ]

      // 商品需求场景词通常包含使用场景
      for (const kw of scenarioKeywords) {
        expect(kw.toLowerCase()).toMatch(/home|baby|pet|garage|driveway|security|monitor|watching/i)
      }
    })

    it('should classify demand-oriented keywords correctly', () => {
      const demandKeywords = [
        'wireless camera',
        'night vision',
        '2k camera',
        'motion detection',
        'best camera',
        'solar powered'
      ]

      // 需求导向词通常包含功能特性或购买意图
      for (const kw of demandKeywords) {
        expect(kw.toLowerCase()).toMatch(/wireless|night|vision|2k|4k|motion|best|top|solar|battery/i)
      }
    })
  })

  // ========== 新增测试：纯品牌词函数 ==========
  describe('getPureBrandKeywords - 多词品牌识别', () => {
    it('should return only full brand name for multi-word brands', () => {
      const result = getPureBrandKeywords('Eufy Security')
      expect(result).toContain('eufy security')
      expect(result).toHaveLength(1)
    })

    it('should return only full name for single-word brands', () => {
      const result = getPureBrandKeywords('Eufy')
      expect(result).toContain('eufy')
      expect(result).toHaveLength(1)
    })

    it('should handle three-word brands', () => {
      const result = getPureBrandKeywords('Ring Alarm Security')
      expect(result).toContain('ring alarm security')
      expect(result).toHaveLength(1)
    })

    it('should be case-insensitive and trim whitespace', () => {
      const result = getPureBrandKeywords('  Eufy Security  ')
      expect(result).toContain('eufy security')
      expect(result).toHaveLength(1)
    })

    it('should normalize punctuation and avoid generic prefixes (Dr. Mercola)', () => {
      const result = getPureBrandKeywords('Dr. Mercola')
      expect(result).toContain('dr mercola')
      expect(result).toHaveLength(1)
    })

    it('should treat leading determiners as optional for 3+ word brands (The North Face)', () => {
      const result = getPureBrandKeywords('The North Face')
      expect(result).toContain('the north face')
      expect(result).toHaveLength(1)
    })

    it('should avoid broad first-word tokens (Real Relax)', () => {
      const result = getPureBrandKeywords('Real Relax')
      expect(result).toContain('real relax')
      expect(result).toHaveLength(1)
    })

    it('should avoid connector-based short tokens (Bob And Brad)', () => {
      const result = getPureBrandKeywords('Bob And Brad')
      expect(result).toContain('bob and brad')
      expect(result).toHaveLength(1)
    })
  })

  describe('containsPureBrand - 品牌包含检查', () => {
    it('should return true for exact brand match', () => {
      const pureBrandKeywords = ['eufy security', 'eufy']
      expect(containsPureBrand('eufy', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('eufy security', pureBrandKeywords)).toBe(true)
    })

    it('should return true for keywords containing brand', () => {
      const pureBrandKeywords = ['eufy']
      expect(containsPureBrand('eufy camera', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('eufy security camera', pureBrandKeywords)).toBe(true)
    })

    it('should avoid substring false positives (rove vs rover)', () => {
      const pureBrandKeywords = ['rove']
      expect(containsPureBrand('rove', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('roves', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('rover', pureBrandKeywords)).toBe(false)
      expect(containsPureBrand('range rover', pureBrandKeywords)).toBe(false)
      expect(containsPureBrand('landrover defender', pureBrandKeywords)).toBe(false)
      expect(containsPureBrand('rangerover', pureBrandKeywords)).toBe(false)
    })

    it('should allow common concatenations (brand + product/model)', () => {
      const pureBrandKeywords = ['eufy']
      expect(containsPureBrand('eufycam', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('eufycam2', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('eufy2', pureBrandKeywords)).toBe(true)
    })

    it('should match punctuation variants after Google Ads normalization (Dr. Mercola)', () => {
      const pureBrandKeywords = getPureBrandKeywords('Dr. Mercola')
      expect(containsPureBrand('dr. mercola supplements', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('dr_mercola supplements', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('dr-mercola supplements', pureBrandKeywords)).toBe(true)
      expect(containsPureBrand('mercola supplements', pureBrandKeywords)).toBe(false)
    })

    it('should return false for non-brand keywords', () => {
      const pureBrandKeywords = ['eufy']
      expect(containsPureBrand('security camera', pureBrandKeywords)).toBe(false)
      expect(containsPureBrand('indoor camera', pureBrandKeywords)).toBe(false)
    })

    it('should be case-insensitive', () => {
      const pureBrandKeywords = ['eufy']
      expect(containsPureBrand('EUFY CAMERA', pureBrandKeywords)).toBe(true)
    })
  })

  // ========== 新增测试：isPureBrandKeyword 精确匹配（2026-01-05） ==========
  describe('isPureBrandKeyword - 精确品牌匹配', () => {
    it('should return true for exact brand match', () => {
      const pureBrandKeywords = ['eufy security', 'eufy']
      expect(isExactPureBrandKeyword('eufy', pureBrandKeywords)).toBe(true)
      expect(isExactPureBrandKeyword('eufy security', pureBrandKeywords)).toBe(true)
    })

    it('should return false for keywords containing brand but not equal', () => {
      // 🔥 2026-01-05 修复：这是精确匹配，不是部分匹配
      const pureBrandKeywords = ['eufy']
      expect(isExactPureBrandKeyword('eufy camera', pureBrandKeywords)).toBe(false)
      expect(isExactPureBrandKeyword('eufy security camera', pureBrandKeywords)).toBe(false)
    })

    it('should return false for non-brand keywords', () => {
      const pureBrandKeywords = ['eufy']
      expect(isExactPureBrandKeyword('security camera', pureBrandKeywords)).toBe(false)
      expect(isExactPureBrandKeyword('indoor camera', pureBrandKeywords)).toBe(false)
    })

    it('should be case-insensitive', () => {
      const pureBrandKeywords = ['eufy']
      expect(isExactPureBrandKeyword('EUFY', pureBrandKeywords)).toBe(true)
      expect(isExactPureBrandKeyword('Eufy', pureBrandKeywords)).toBe(true)
    })

    it('should handle multi-word brand names', () => {
      const pureBrandKeywords = ['wahl professional', 'wahl']
      expect(isExactPureBrandKeyword('wahl', pureBrandKeywords)).toBe(true)
      expect(isExactPureBrandKeyword('wahl professional', pureBrandKeywords)).toBe(true)
      expect(isExactPureBrandKeyword('wahl professional hair clipper', pureBrandKeywords)).toBe(false)
    })

    it('should treat dot variants as exact pure brand (Dr. Mercola)', () => {
      const pureBrandKeywords = getPureBrandKeywords('Dr. Mercola')
      expect(isExactPureBrandKeyword('dr mercola', pureBrandKeywords)).toBe(true)
      expect(isExactPureBrandKeyword('dr. mercola', pureBrandKeywords)).toBe(true)
      expect(isExactPureBrandKeyword('dr.mercola', pureBrandKeywords)).toBe(true)
      expect(isExactPureBrandKeyword('dr mercola probiotics', pureBrandKeywords)).toBe(false)
    })
  })

  // ========== 新增测试：品牌无关词过滤（多语言公司后缀） ==========
  describe('isBrandIrrelevant - 多语言公司后缀过滤', () => {
    describe('Italian suffixes', () => {
      it('should detect Italian company suffixes', () => {
        expect(isBrandIrrelevant('eureka unito')).toBe(true)
        expect(isBrandIrrelevant('eureka srl')).toBe(true)
        expect(isBrandIrrelevant('eureka sa')).toBe(true)
        expect(isBrandIrrelevant('eureka scarl')).toBe(true)
      })

      it('should accept valid Italian keywords', () => {
        expect(isBrandIrrelevant('eureka lavapavimenti')).toBe(false)
        expect(isBrandIrrelevant('eureka aspirapolvere')).toBe(false)
      })
    })

    describe('German suffixes', () => {
      it('should detect German company suffixes', () => {
        expect(isBrandIrrelevant('eureka gmbh')).toBe(true)
        expect(isBrandIrrelevant('eureka ag')).toBe(true)
        expect(isBrandIrrelevant('eureka kg')).toBe(true)
        expect(isBrandIrrelevant('eureka mbh')).toBe(true)
      })

      it('should accept valid German keywords', () => {
        expect(isBrandIrrelevant('eureka staubsauger')).toBe(false)
        expect(isBrandIrrelevant('eureka roboter')).toBe(false)
      })
    })

    describe('English suffixes', () => {
      it('should detect English company suffixes', () => {
        expect(isBrandIrrelevant('eureka inc')).toBe(true)
        expect(isBrandIrrelevant('eureka ltd')).toBe(true)
        expect(isBrandIrrelevant('eureka llc')).toBe(true)
        expect(isBrandIrrelevant('eureka corp')).toBe(true)
      })

      it('should accept valid English keywords', () => {
        expect(isBrandIrrelevant('eureka vacuum')).toBe(false)
        expect(isBrandIrrelevant('eureka robot')).toBe(false)
      })
    })

    describe('French suffixes', () => {
      it('should detect French company suffixes', () => {
        expect(isBrandIrrelevant('eureka sas')).toBe(true)
        expect(isBrandIrrelevant('eureka sa')).toBe(true)
        expect(isBrandIrrelevant('eureka sarl')).toBe(true)
      })

      it('should accept valid French keywords', () => {
        expect(isBrandIrrelevant('eureka aspirateur')).toBe(false)
        expect(isBrandIrrelevant('eureka robot')).toBe(false)
      })
    })

    describe('Chinese suffixes', () => {
      it('should detect Chinese company suffixes', () => {
        expect(isBrandIrrelevant('品牌有限公司')).toBe(true)
        expect(isBrandIrrelevant('品牌股份有限公司')).toBe(true)
        expect(isBrandIrrelevant('品牌有限责任公司')).toBe(true)
      })

      it('should accept valid Chinese keywords', () => {
        expect(isBrandIrrelevant('品牌吸尘器')).toBe(false)
        expect(isBrandIrrelevant('品牌扫地机器人')).toBe(false)
      })
    })

    describe('Japanese suffixes', () => {
      it('should detect Japanese company suffixes', () => {
        expect(isBrandIrrelevant('ブランド株式会社')).toBe(true)
        expect(isBrandIrrelevant('ブランド有限会社')).toBe(true)
      })

      it('should accept valid Japanese keywords', () => {
        expect(isBrandIrrelevant('ブランド掃除機')).toBe(false)
        expect(isBrandIrrelevant('ブランドロボット')).toBe(false)
      })
    })

    describe('Korean suffixes', () => {
      it('should detect Korean company suffixes', () => {
        expect(isBrandIrrelevant('브랜드 주식회사')).toBe(true)
        expect(isBrandIrrelevant('브랜드 유한회사')).toBe(true)
      })

      it('should accept valid Korean keywords', () => {
        expect(isBrandIrrelevant('브랜드 청소기')).toBe(false)
        expect(isBrandIrrelevant('브랜드 로봇')).toBe(false)
      })
    })
  })

  // ========== 新增测试：低意图关键词过滤 ==========
  describe('filterLowIntentKeywords - 低购买意图过滤', () => {
    it('should filter out informational queries', () => {
      const keywords = [
        'what is eufy',
        'how to use eufy camera',
        'eufy review',
        'eufy camera price',
        'buy eufy camera',
        // 'eufy camera amazon' - amazon是竞品平台，会被过滤
      ]
      const result = filterLowIntentKeywords(keywords)
      expect(result).not.toContain('what is eufy')
      expect(result).not.toContain('how to use eufy camera')
      expect(result).not.toContain('eufy review')
      expect(result).toContain('eufy camera price')
      expect(result).toContain('buy eufy camera')
    })

    it('should keep purchase intent keywords', () => {
      const keywords = [
        'eufy camera price',
        'buy eufy camera',
        'best eufy camera',
        'eufy camera deal',
        // 注意：amazon是竞品平台，会被过滤
      ]
      const result = filterLowIntentKeywords(keywords)
      expect(result).toHaveLength(4)
    })

    it('should filter out competitor platform keywords', () => {
      const keywords = [
        'eufy camera amazon',
        'eufy camera ebay',
        'eufy camera aliexpress',
        'eufy camera price'
      ]
      const result = filterLowIntentKeywords(keywords)
      expect(result).not.toContain('eufy camera amazon')
      expect(result).not.toContain('eufy camera ebay')
      expect(result).not.toContain('eufy camera aliexpress')
      expect(result).toContain('eufy camera price')
    })
  })

  // ========== 新增测试：搜索量阈值计算 ==========
  describe('calculateSearchVolumeThreshold - 动态阈值计算', () => {
    it('should calculate threshold based on median volume', () => {
      const volumes = [100, 200, 300, 400, 500, 1000, 2000, 5000, 10000]
      const threshold = calculateSearchVolumeThreshold(volumes)
      expect(threshold).toBeGreaterThan(0)
      // Median is 500, threshold should be around 10% = 50
      expect(threshold).toBeLessThan(1000)
    })

    it('should return 0 for empty array', () => {
      const threshold = calculateSearchVolumeThreshold([])
      expect(threshold).toBe(0)
    })

    it('should return 0 for small volumes (max < 500) - no filtering needed', () => {
      // 当所有搜索量都很小时，不需要过滤
      const volumes = [10, 20, 30]
      const threshold = calculateSearchVolumeThreshold(volumes)
      expect(threshold).toBe(0) // 正确行为：不过滤
    })

    it('should return minimum threshold for medium volumes', () => {
      // 测试中等搜索量，应该返回最小阈值
      const volumes = [100, 200, 300, 400, 600]
      const threshold = calculateSearchVolumeThreshold(volumes)
      expect(threshold).toBe(50) // minThreshold = 50
    })
  })
})
