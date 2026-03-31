import { describe, expect, it } from 'vitest'
import { filterKeywordQuality, isBrandVariant } from '../keyword-quality-filter'

describe('keyword-quality-filter', () => {
  describe('isBrandVariant', () => {
    it('should treat concatenated suffix as brand variant', () => {
      expect(isBrandVariant('eurekaddl', 'eureka')).toBe(true)
      expect(isBrandVariant('EURekaDDL', 'Eureka')).toBe(true)
    })

    it('should not treat spaced/hyphenated brand+product terms as variants', () => {
      expect(isBrandVariant('auxito led', 'auxito')).toBe(false)
      expect(isBrandVariant('auxito led lights', 'auxito')).toBe(false)
      expect(isBrandVariant('auxito-led', 'auxito')).toBe(false)
      expect(isBrandVariant('auxito_led', 'auxito')).toBe(false)
      expect(isBrandVariant('eureka j15', 'eureka')).toBe(false)
      expect(isBrandVariant('eureka-j15', 'eureka')).toBe(false)
    })
  })

  describe('filterKeywordQuality', () => {
    it('should keep valid brand+product keywords (regression)', () => {
      const input = [
        { keyword: 'auxito', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
        { keyword: 'auxito led', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
        { keyword: 'auxito led lights', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
        { keyword: 'auxito led headlights', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, { brandName: 'auxito', mustContainBrand: true })
      expect(result.removed).toHaveLength(0)
      expect(result.filtered.map(k => k.keyword)).toEqual([
        'auxito',
        'auxito led',
        'auxito led lights',
        'auxito led headlights',
      ])
    })

    it('should remove ambiguous-brand unrelated topics when context filter enabled', () => {
      const input = [
        { keyword: 'rove', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove r2 4k', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove r2 4k dash cam', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove beetle larvae', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove concept', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove concept miami', searchVolume: 0, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Rove',
        category: 'On-Dash Cameras',
        productName: 'ROVE R2-4K DUAL Dash Cam Front and Rear',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'rove',
        'rove r2 4k',
        'rove r2 4k dash cam',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'rove beetle larvae',
        'rove concept',
        'rove concept miami',
      ])
    })

    it('should enforce context relevance even for high-volume ambiguous-brand keywords', () => {
      const input = [
        { keyword: 'moes', searchVolume: 450000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes sprinkler timer', searchVolume: 12000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes cafe', searchVolume: 3600, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes tacos', searchVolume: 1300, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes barbeque', searchVolume: 33100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes sw grill menu', searchVolume: 49500, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Moes',
        category: 'Hose Timers',
        productName: 'MOES 3 Outlet Sprinkler Timer',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'moes',
        'moes sprinkler timer',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'moes cafe',
        'moes tacos',
        'moes barbeque',
        'moes sw grill menu',
      ])
      expect(result.removed.every(r => r.reason.includes('与商品无关'))).toBe(true)
    })

    it('should keep audio synonym variants for context relevance', () => {
      const input = [
        { keyword: 'sonos', searchVolume: 246000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos speaker', searchVolume: 49500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos soundbar', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos jobs', searchVolume: 3600, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Sonos',
        category: 'Wireless Home Audio Systems',
        productName: 'SONOS Arc',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'sonos',
        'sonos speaker',
        'sonos soundbar',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['sonos jobs'])
    })

    it('should rescue short model terms when supported by multiple kept context keywords', () => {
      const input = [
        { keyword: 'sonos', searchVolume: 246000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos arc soundbar', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos arc surround sound', searchVolume: 6600, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos beam soundbar', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos beam surround sound', searchVolume: 4400, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos arc', searchVolume: 40500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos beam', searchVolume: 14800, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'ikea sonos', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Sonos',
        category: 'Wireless Home Audio Systems',
        productName: 'Home sound system',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'sonos',
        'sonos arc soundbar',
        'sonos arc surround sound',
        'sonos beam soundbar',
        'sonos beam surround sound',
        'sonos arc',
        'sonos beam',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['ikea sonos'])
    })

    it('should not restore visual-noise keywords via context support fallback', () => {
      const input = [
        { keyword: 'running girl sports bra purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl sports bras purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl bra purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl sports bra buy', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl gif purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Running Girl',
        category: 'Sports Bras',
        productName: 'RUNNING GIRL Sports Bras for Women Seamless Padded Yoga Bra',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'running girl sports bra purchase',
        'running girl sports bras purchase',
        'running girl bra purchase',
        'running girl sports bra buy',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['running girl gif purchase'])
    })

    it('should keep robotic vacuum variants like robovac', () => {
      const input = [
        { keyword: 'eufy', searchVolume: 60500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy robovac', searchVolume: 14800, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy robot vacuum', searchVolume: 9900, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy vacuum cleaner', searchVolume: 5400, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy security camera', searchVolume: 6600, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Eufy',
        category: 'Robotic Vacuum Cleaners',
        productName: 'Eufy X10 Pro Omni',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'eufy',
        'eufy robovac',
        'eufy robot vacuum',
        'eufy vacuum cleaner',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['eufy security camera'])
    })

    it('should not treat broad room tokens as sufficient context when a sibling product noun drifts outside the offer', () => {
      const input = [
        { keyword: 'mellanni', searchVolume: 60500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'mellanni king size sheet set', searchVolume: 14800, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'mellanni king comforter bed sets', searchVolume: 2400, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Mellanni',
        category: 'Sheet & Pillowcase Sets',
        productName: 'Mellanni King Sheets Set - 4 PC Iconic Collection Bedding',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'mellanni',
        'mellanni king size sheet set',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'mellanni king comforter bed sets',
      ])
      expect(result.removed[0]?.reason).toContain('与商品无关')
    })

    it('should still keep valid category demand terms when a broad room token appears alongside a specific context match', () => {
      const input = [
        { keyword: 'sunaofe', searchVolume: 60500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sunaofe office furniture', searchVolume: 1200, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Sunaofe',
        category: 'Office Furniture',
        productName: 'Sunaofe Office Furniture',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'sunaofe',
        'sunaofe office furniture',
      ])
      expect(result.removed).toHaveLength(0)
    })

    it('filters split brand distortions using lexical integrity anchors', () => {
      const input = [
        { keyword: 'waterdrop', searchVolume: 1200, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'waterdrop x16', searchVolume: 320, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'wat erdrop', searchVolume: 0, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'water drop', searchVolume: 0, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Waterdrop',
        productName: 'Waterdrop X16 reverse osmosis system',
        targetLanguage: 'de',
        minWordCount: 1,
        maxWordCount: 6,
      })

      expect(result.filtered.map((item) => item.keyword)).toEqual([
        'waterdrop',
        'waterdrop x16',
      ])
      expect(result.removed.map((item) => item.keyword.keyword)).toEqual([
        'wat erdrop',
        'water drop',
      ])
      expect(result.removed.every((item) => item.reason.includes('锚点裂词/拆写变体'))).toBe(true)
    })

    it('filters same-script wrong-language leakage for latin-market campaigns', () => {
      const input = [
        { keyword: 'waterdrop x12', searchVolume: 90, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'waterdrop modellnummer x12', searchVolume: 0, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Waterdrop',
        productName: 'Waterdrop X12 sistema osmosi inversa alcalina',
        targetLanguage: 'it',
        minWordCount: 1,
        maxWordCount: 6,
      })

      expect(result.filtered.map((item) => item.keyword)).toEqual(['waterdrop x12'])
      expect(result.removed.map((item) => item.keyword.keyword)).toEqual(['waterdrop modellnummer x12'])
      expect(result.removed[0]?.reason).toContain('语言脚本错配')
    })

    it('should drop store-brand noise and weak fragments while keeping valid office furniture demand', () => {
      const input = [
        { keyword: 'sunaofe', searchVolume: 60500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sunaofe office furniture', searchVolume: 1200, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sunaofe office security', searchVolume: 300, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sunaofe home security', searchVolume: 300, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sunaofe website', searchVolume: 250, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sunaofe legit', searchVolume: 200, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sunaofe problem', searchVolume: 180, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'Sunaofe There was', searchVolume: 120, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Sunaofe',
        category: 'Office Furniture',
        productName: 'Sunaofe ergonomic office chair standing desk monitor arm',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'sunaofe',
        'sunaofe office furniture',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'sunaofe office security',
        'sunaofe home security',
        'sunaofe website',
        'sunaofe legit',
        'sunaofe problem',
        'Sunaofe There was',
      ])
      expect(result.removed[0]?.reason).toContain('与商品无关')
      expect(result.removed[1]?.reason).toContain('与商品无关')
      expect(result.removed[2]?.reason).toContain('低意图支持查询词')
      expect(result.removed[3]?.reason).toContain('低意图支持查询词')
      expect(result.removed[4]?.reason).toContain('低意图支持查询词')
      expect(result.removed[5]?.reason).toContain('弱语义残片词')
    })

    it('should restore limited commercial terms when context filter removes almost all candidates', () => {
      const input = [
        { keyword: 'acme', searchVolume: 9000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme charger', searchVolume: 2400, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme charging adapter', searchVolume: 1800, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme powerbank', searchVolume: 1200, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme cafe', searchVolume: 1500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme food', searchVolume: 1300, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Acme',
        category: 'Portable Energy Devices',
        productName: 'Acme Home Battery Station',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'acme',
        'acme charger',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'acme charging adapter',
        'acme powerbank',
        'acme cafe',
        'acme food',
      ])
    })

    it('should skip context gating when context is placeholder text', () => {
      const input = [
        { keyword: 'anker charger power bank', searchVolume: 90500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'anker portable charger', searchVolume: 27100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'anker nano power bank', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Anker',
        category: 'Data not available',
        productName: undefined,
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'anker charger power bank',
        'anker portable charger',
        'anker nano power bank',
      ])
      expect(result.removed).toHaveLength(0)
    })

    it('should not over-filter when context signals are insufficient', () => {
      const input = [
        { keyword: 'moes tacos', searchVolume: 1300, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes cafe', searchVolume: 3600, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Moes',
        category: 'Timer',
        productName: 'MOES Device',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'moes tacos',
        'moes cafe',
      ])
      expect(result.removed).toHaveLength(0)
    })

    it('should remove cross-category terms even when non-brand keywords are allowed', () => {
      const input = [
        { keyword: 'lampick', searchVolume: 50, source: 'KEYWORD_POOL' as const },
        { keyword: 'hair dryer', searchVolume: 90500, source: 'KEYWORD_POOL' as const },
        { keyword: 'best blow dryer', searchVolume: 6600, source: 'KEYWORD_POOL' as const },
        { keyword: 'cheap blender', searchVolume: 74000, source: 'KEYWORD_POOL' as const },
        { keyword: 'smoothie blender', searchVolume: 12100, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Lampick',
        category: 'Hair Dryers',
        productName: 'Lampick Ionic Hair Dryer',
        mustContainBrand: false,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'lampick',
        'hair dryer',
        'best blow dryer',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'cheap blender',
        'smoothie blender',
      ])
    })

    it('should remove marketplace rank noise and avoid using generic set tokens as context evidence', () => {
      const input = [
        { keyword: 'mt products', searchVolume: 2400, source: 'KEYWORD_POOL' as const },
        { keyword: 'mt products food container sets', searchVolume: 1200, source: 'KEYWORD_POOL' as const },
        { keyword: 'mt products bedroom sets', searchVolume: 900, source: 'KEYWORD_POOL' as const },
        { keyword: 'mt products best sellers rank health', searchVolume: 700, source: 'KEYWORD_POOL' as const },
        { keyword: 'mt products home kitchen see top', searchVolume: 600, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Mt Products',
        category: 'Container Sets',
        productName: 'MT Products PET Plastic Juice Bottles 16 oz',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'mt products',
        'mt products food container sets',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'mt products bedroom sets',
        'mt products best sellers rank health',
        'mt products home kitchen see top',
      ])
      expect(result.removed[0]?.reason).toContain('与商品无关')
      expect(result.removed[1]?.reason).toContain('低意图支持查询词')
      expect(result.removed[2]?.reason).toContain('低意图支持查询词')
    })

    it('should not let size tokens alone satisfy context relevance for adjacent-category phrases', () => {
      const input = [
        { keyword: 'mellanni king sheets', searchVolume: 2400, source: 'KEYWORD_POOL' as const },
        { keyword: 'mellanni king bedroom furniture sets', searchVolume: 900, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Mellanni',
        category: 'Sheet & Pillowcase Sets',
        productName: 'Mellanni King Sheets Set - 4 PC Iconic Collection Bedding',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'mellanni king sheets',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'mellanni king bedroom furniture sets',
      ])
      expect(result.removed[0]?.reason).toContain('与商品无关')
    })

    it('should hard-remove obvious template garbage keywords only', () => {
      const input = [
        { keyword: 'novilla mattress buy buy', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as const },
        { keyword: 'novilla mattress buy purchase', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as const },
        { keyword: 'buy novilla mattress', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as const },
        { keyword: 'novilla mattress price', searchVolume: 0, source: 'GLOBAL_KEYWORDS' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Novilla',
        category: 'Mattresses',
        productName: 'Novilla Mattress',
        mustContainBrand: true,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'buy novilla mattress',
        'novilla mattress price',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'novilla mattress buy buy',
        'novilla mattress buy purchase',
      ])
      expect(result.removed.every(r => r.reason.includes('模板垃圾词'))).toBe(true)
    })

    it('should filter rescue fragment keywords but keep allowed trailing bigrams', () => {
      const input = [
        { keyword: 'dreo 000 btu doe', searchVolume: 0, source: 'DERIVED_RESCUE' as const, sourceType: 'BUILDER_NON_EMPTY_RESCUE' },
        { keyword: 'dreo quiet smart ac by', searchVolume: 0, source: 'DERIVED_RESCUE' as const, sourceType: 'BUILDER_NON_EMPTY_RESCUE' },
        { keyword: 'dreo 10', searchVolume: 0, source: 'DERIVED_RESCUE' as const, sourceType: 'BUILDER_NON_EMPTY_RESCUE' },
        { keyword: 'dreo 14000 btu ashrae 10', searchVolume: 0, source: 'DERIVED_RESCUE' as const, sourceType: 'BUILDER_NON_EMPTY_RESCUE' },
        { keyword: 'dreo sign in', searchVolume: 0, source: 'DERIVED_RESCUE' as const, sourceType: 'BUILDER_NON_EMPTY_RESCUE' },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Dreo',
        category: 'Portable Air Conditioners',
        productName: 'Dreo Portable Air Conditioner 10000 BTU DOE',
        mustContainBrand: true,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'dreo sign in',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'dreo 000 btu doe',
        'dreo quiet smart ac by',
        'dreo 10',
        'dreo 14000 btu ashrae 10',
      ])
      expect(result.removed[0]?.reason).toContain('模板垃圾词: 数字残片')
      expect(result.removed[1]?.reason).toContain('尾部连接残片词')
      expect(result.removed[2]?.reason).toContain('品牌短数字残片词')
      expect(result.removed[3]?.reason).toContain('尾部短数字残片词')
    })

    it('should soft-downgrade context mismatch instead of deleting when contextMismatchMode=soft', () => {
      const input = [
        { keyword: 'moes sprinkler timer', searchVolume: 12000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes tacos', searchVolume: 1300, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Moes',
        category: 'Hose Timers',
        productName: 'MOES 3 Outlet Sprinkler Timer',
        mustContainBrand: true,
        minContextTokenMatches: 1,
        contextMismatchMode: 'soft',
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'moes sprinkler timer',
        'moes tacos',
      ])
      expect(result.removed).toHaveLength(0)

      const timerScore = result.filtered.find(k => k.keyword === 'moes sprinkler timer')?.relevanceScore || 0
      const tacosScore = result.filtered.find(k => k.keyword === 'moes tacos')?.relevanceScore || 0
      expect(timerScore).toBeGreaterThan(tacosScore)
    })

    it('should not treat weight units like "10 kg" as German legal suffix KG', () => {
      const input = [
        { keyword: 'midea a3 wärmepumpentrockner 10 kg', searchVolume: 0, source: 'AI_GENERATED' as const },
        { keyword: 'midea gmbh', searchVolume: 0, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Midea',
        category: 'Wärmepumpentrockner',
        productName: 'Midea MD20EH100WB-A3 Wärmepumpentrockner 10 kg',
        mustContainBrand: false,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'midea a3 wärmepumpentrockner 10 kg',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['midea gmbh'])
      expect(result.removed[0]?.reason).toContain('品牌无关词')
    })

    it('should remove obvious script-mismatch keywords for latin-language campaigns', () => {
      const input = [
        { keyword: 'solarbrand outdoor lights', searchVolume: 1200, source: 'KEYWORD_POOL' as const },
        { keyword: '太阳能庭院灯', searchVolume: 900, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'SolarBrand',
        category: 'Outdoor Lights',
        productName: 'SolarBrand Outdoor Path Lights',
        targetLanguage: 'English',
        mustContainBrand: false,
        minContextTokenMatches: 0,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual(['solarbrand outdoor lights'])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['太阳能庭院灯'])
      expect(result.removed[0]?.reason).toContain('语言脚本错配')
    })

    it('should remove explicit foreign-country keywords when targetCountry is set', () => {
      const input = [
        { keyword: 'ringconn smart ring price', searchVolume: 1200, source: 'KEYWORD_POOL' as const },
        { keyword: 'ringconn smart ring price in pakistan', searchVolume: 800, source: 'KEYWORD_POOL' as const },
        { keyword: 'ringconn smart ring price in bangladesh', searchVolume: 700, source: 'KEYWORD_POOL' as const },
        { keyword: 'ringconn smart ring price in uk', searchVolume: 900, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Ringconn',
        category: 'Smart Rings',
        productName: 'Ringconn Gen 2 Smart Ring',
        targetCountry: 'GB',
        mustContainBrand: true,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'ringconn smart ring price',
        'ringconn smart ring price in uk',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'ringconn smart ring price in pakistan',
        'ringconn smart ring price in bangladesh',
      ])
      expect(result.removed.every(r => r.reason.includes('国家不匹配'))).toBe(true)
    })

    it('should still apply semantic query filtering when targetCountry has no geo mismatch', () => {
      const input = [
        { keyword: 'ringconn smart ring review', searchVolume: 1200, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Ringconn',
        category: 'Smart Rings',
        productName: 'Ringconn Gen 2 Smart Ring',
        targetCountry: 'GB',
        mustContainBrand: true,
      })

      expect(result.filtered).toHaveLength(0)
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['ringconn smart ring review'])
      expect(result.removed[0]?.reason).toContain('语义查询词')
    })

    it('should not remove pure brand fallback due to script checks', () => {
      const input = [
        { keyword: 'anker', searchVolume: 24000, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Anker',
        targetLanguage: 'Russian',
        mustContainBrand: true,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual(['anker'])
      expect(result.removed).toHaveLength(0)
    })

    it('allows only planner non-brand keywords covered by the policy object', () => {
      const input = [
        { keyword: 'novilla', searchVolume: 9000, source: 'KEYWORD_PLANNER' as const },
        {
          keyword: 'king mattress',
          searchVolume: 2600,
          source: 'KEYWORD_PLANNER' as const,
          sourceType: 'KEYWORD_PLANNER',
          sourceSubtype: 'KEYWORD_PLANNER_MODEL_FAMILY',
          rawSource: 'KEYWORD_PLANNER',
          derivedTags: ['PLANNER_NON_BRAND', 'PLANNER_NON_BRAND_MODEL_FAMILY'],
        },
        {
          keyword: 'memory foam mattress',
          searchVolume: 2200,
          source: 'KEYWORD_PLANNER' as const,
          sourceType: 'KEYWORD_PLANNER',
          sourceSubtype: 'KEYWORD_PLANNER_DEMAND',
          rawSource: 'KEYWORD_PLANNER',
          derivedTags: ['PLANNER_NON_BRAND', 'PLANNER_NON_BRAND_DEMAND'],
        },
        {
          keyword: 'mattress',
          searchVolume: 5400,
          source: 'KEYWORD_PLANNER' as const,
          sourceType: 'KEYWORD_PLANNER',
          sourceSubtype: 'KEYWORD_PLANNER_POOL',
          rawSource: 'KEYWORD_PLANNER',
          derivedTags: ['PLANNER_NON_BRAND', 'PLANNER_NON_BRAND_POOL'],
        },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Novilla',
        category: 'Mattress',
        productName: 'Novilla 10 inch memory foam mattress',
        mustContainBrand: true,
        allowNonBrandFromPlanner: {
          pageType: 'product',
          allowNonBrandForPool: false,
          allowNonBrandForDemand: true,
          allowNonBrandForModelFamily: true,
        },
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'novilla',
        'king mattress',
        'memory foam mattress',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['mattress'])
      expect(result.removed[0]?.reason).toContain('不含纯品牌词')
    })
  })
})
