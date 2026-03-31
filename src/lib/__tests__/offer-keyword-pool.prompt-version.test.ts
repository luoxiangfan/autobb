import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: dbFns.getDatabase,
}))

import { saveKeywordPool } from '../offer-keyword-pool'

describe('saveKeywordPool prompt version resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      queryOne: dbFns.queryOne,
      exec: dbFns.exec,
    })
    dbFns.exec.mockResolvedValue({ lastInsertRowid: 901 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the active keyword_intent_clustering prompt version when promptVersion is omitted', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({ version: 'v4.20' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 901,
        offer_id: 77,
        user_id: 1,
        brand_keywords: JSON.stringify(['brandx']),
        bucket_a_keywords: JSON.stringify(['brandx vacuum']),
        bucket_b_keywords: JSON.stringify(['brandx x200 vacuum']),
        bucket_c_keywords: JSON.stringify(['robot vacuum']),
        bucket_d_keywords: JSON.stringify(['robot vacuum for pet hair']),
        bucket_a_intent: '品牌商品锚点',
        bucket_b_intent: '商品需求场景',
        bucket_c_intent: '功能规格特性',
        bucket_d_intent: '商品需求扩展',
        store_bucket_a_keywords: JSON.stringify([]),
        store_bucket_b_keywords: JSON.stringify([]),
        store_bucket_c_keywords: JSON.stringify([]),
        store_bucket_d_keywords: JSON.stringify([]),
        store_bucket_s_keywords: JSON.stringify([]),
        store_bucket_a_intent: '品牌商品集合',
        store_bucket_b_intent: '商品需求场景',
        store_bucket_c_intent: '热门商品线',
        store_bucket_d_intent: '信任服务信号',
        store_bucket_s_intent: '店铺全量覆盖',
        link_type: 'product',
        total_keywords: 4,
        clustering_model: 'gemini',
        clustering_prompt_version: 'v4.20',
        balance_score: 0.91,
        created_at: '2026-03-16T00:00:00.000Z',
        updated_at: '2026-03-16T00:00:00.000Z',
      })

    const result = await saveKeywordPool(
      77,
      1,
      ['brandx'],
      {
        bucketA: { intent: '品牌商品锚点', intentEn: 'Brand Product Anchor', description: 'brand', keywords: ['brandx vacuum'] },
        bucketB: { intent: '商品需求场景', intentEn: 'Demand Scenario', description: 'scenario', keywords: ['brandx x200 vacuum'] },
        bucketC: { intent: '功能规格特性', intentEn: 'Feature / Spec', description: 'feature', keywords: ['robot vacuum'] },
        bucketD: { intent: '商品需求扩展', intentEn: 'Demand Expansion', description: 'demand', keywords: ['robot vacuum for pet hair'] },
        statistics: {
          totalKeywords: 4,
          bucketACount: 1,
          bucketBCount: 1,
          bucketCCount: 1,
          bucketDCount: 1,
          balanceScore: 0.91,
        },
      }
    )

    expect(dbFns.exec).toHaveBeenCalledTimes(1)
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO offer_keyword_pools'),
      expect.arrayContaining(['v4.20'])
    )
    expect(result.clusteringPromptVersion).toBe('v4.20')
  })
})
