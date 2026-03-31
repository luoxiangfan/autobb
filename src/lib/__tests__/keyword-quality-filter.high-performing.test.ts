import { filterKeywordQuality } from '../keyword-quality-filter'
import type { PoolKeywordData } from '../offer-keyword-pool'

describe('filterKeywordQuality - High Performing Search Terms', () => {
  it('should keep high-performing search terms when they satisfy brand gate', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'solarbrand best solar lights outdoor',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'cheap solar lights', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: true, // 要求必须包含品牌
      minWordCount: 1,
      maxWordCount: 8
    })

    // 高性能搜索词保留（满足品牌门禁）
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0].keyword).toBe('solarbrand best solar lights outdoor')

    // 普通关键词应该被过滤（不含品牌）
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].keyword.keyword).toBe('cheap solar lights')
  })

  it('should filter high-performing search terms that are review/compare informational terms', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'solar lights review',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'solar lights comparison', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: false,
      minWordCount: 1,
      maxWordCount: 8
    })

    expect(result.filtered).toHaveLength(0)
    expect(result.removed).toHaveLength(2)
    expect(result.removed.map(item => item.keyword.keyword)).toEqual([
      'solar lights review',
      'solar lights comparison',
    ])
  })

  it('should NOT filter high-performing search terms with "free" or "cheap"', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'free solar lights',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'cheap solar lights',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'discount solar lights', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: false,
      minWordCount: 1,
      maxWordCount: 8
    })

    // 高性能搜索词应该全部保留
    expect(result.filtered).toHaveLength(2)
    expect(result.filtered.map(k => k.keyword)).toContain('free solar lights')
    expect(result.filtered.map(k => k.keyword)).toContain('cheap solar lights')

    // 普通关键词应该被过滤
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].keyword.keyword).toBe('discount solar lights')
  })

  it('should NOT filter high-performing search terms exceeding word count', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'best outdoor solar lights for garden path and driveway',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'outdoor solar lights for garden path and driveway', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: false,
      minWordCount: 1,
      maxWordCount: 5 // 限制最多5个单词
    })

    // 高性能搜索词应该保留（即使超过5个单词）
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0].keyword).toBe('best outdoor solar lights for garden path and driveway')

    // 普通关键词应该被过滤（超过5个单词）
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].reason).toContain('单词数不匹配')
  })

  it('should preserve high-performing commercial terms and block risky high-performing terms in mixed list', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'SolarBrand lights',
        searchVolume: 1000,
        source: 'KEYWORD_POOL',
        priority: 'HIGH'
      },
      {
        keyword: 'solarbrand best solar lights',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'solar lights review',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'cheap lights', // 不含品牌，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: true,
      minWordCount: 1,
      maxWordCount: 8
    })

    // 保留品牌词 + 高表现商业词；拦截高风险词
    expect(result.filtered).toHaveLength(2)
    expect(result.filtered.map(k => k.keyword)).toContain('SolarBrand lights')
    expect(result.filtered.map(k => k.keyword)).toContain('solarbrand best solar lights')

    expect(result.removed).toHaveLength(2)
    expect(result.removed.map(item => item.keyword.keyword)).toEqual([
      'solar lights review',
      'cheap lights',
    ])
  })

  it('should handle empty high-performing search terms list', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'SolarBrand lights',
        searchVolume: 1000,
        source: 'KEYWORD_POOL',
        priority: 'HIGH'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: true,
      minWordCount: 1,
      maxWordCount: 8
    })

    expect(result.filtered).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })
})
