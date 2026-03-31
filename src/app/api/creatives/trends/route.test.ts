import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  getDatabase: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: mocks.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: mocks.getDatabase,
}))

describe('GET /api/creatives/trends', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })

    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY DATE(created_at)')) {
        return [
          {
            date: '2026-03-18',
            newcreatives: 2,
            avgscore: 82,
            highquality: 1,
            mediumquality: 1,
            lowquality: 0,
          },
        ]
      }

      if (sql.includes('GROUP BY status')) {
        return [
          { status: 'selected', count: 1 },
          { status: 'draft', count: 2 },
        ]
      }

      if (sql.includes('as ad_strength') && sql.includes('GROUP BY')) {
        return [
          { ad_strength: 'GOOD', count: 2 },
          { ad_strength: 'AVERAGE', count: 1 },
        ]
      }

      if (sql.includes('quality_level')) {
        return [
          { quality_level: 'good', count: 2 },
          { quality_level: 'average', count: 1 },
        ]
      }

      if (sql.includes('GROUP BY theme')) {
        return [
          { theme: '型号导向', count: 2 },
          { theme: '产品导向', count: 1 },
        ]
      }

      if (sql.includes('SELECT ad_strength_data')) {
        return [
          {
            ad_strength_data: JSON.stringify({
              rating: 'GOOD',
              score: 84,
              audit: {
                totalKeywords: 4,
                fallbackMode: false,
                noVolumeMode: true,
                contextFallbackStrategy: 'filtered',
                byRawSource: {
                  SEARCH_TERM: { count: 2, ratio: 0.5 },
                  AI: { count: 2, ratio: 0.5 },
                },
                bySourceSubtype: {
                  SEARCH_TERM_HIGH_PERFORMING: { count: 2, ratio: 0.5 },
                  AI_LLM_RAW: { count: 2, ratio: 0.5 },
                },
                bySourceField: {
                  search_terms: { count: 2, ratio: 0.5 },
                  ai: { count: 2, ratio: 0.5 },
                },
                sourceQuotaAudit: {
                  acceptedCount: 4,
                  deferredCount: 2,
                  deferredRefillTriggered: true,
                  deferredRefillCount: 1,
                  underfillBeforeRefill: 1,
                  blockedByCap: {
                    lowTrust: 2,
                    ai: 1,
                    aiLlmRaw: 1,
                  },
                },
              },
            }),
          },
          {
            ad_strength_data: JSON.stringify({
              rating: 'AVERAGE',
              score: 70,
              keywordSourceAudit: {
                totalKeywords: 3,
                fallbackMode: true,
                noVolumeMode: false,
                contextFallbackStrategy: 'keyword_pool',
                byRawSource: {
                  KEYWORD_PLANNER: { count: 3, ratio: 1 },
                },
                bySourceSubtype: {
                  KEYWORD_PLANNER_ENRICHED: { count: 3, ratio: 1 },
                },
                bySourceField: {
                  keyword_planner: { count: 3, ratio: 1 },
                },
                sourceQuotaAudit: {
                  acceptedCount: 3,
                  deferredCount: 0,
                  deferredRefillTriggered: false,
                  deferredRefillCount: 0,
                  underfillBeforeRefill: 0,
                  blockedByCap: {
                    lowTrust: 0,
                    ai: 0,
                    aiLlmRaw: 0,
                  },
                },
              },
            }),
          },
          {
            ad_strength_data: null,
          },
        ]
      }

      return []
    })

    mocks.queryOne.mockResolvedValue({
      selected: 1,
      notSelected: 2,
      total: 3,
    })

    mocks.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query: mocks.query,
      queryOne: mocks.queryOne,
    })
  })

  it('aggregates keyword source audit from ad_strength_data', async () => {
    const req = new NextRequest(
      'http://localhost/api/creatives/trends?start_date=2026-03-18&end_date=2026-03-19'
    )

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.distributions.audit).toMatchObject({
      creativesWithAudit: 2,
      totalKeywords: 7,
      byRawSource: {
        SEARCH_TERM: 2,
        AI: 2,
        KEYWORD_PLANNER: 3,
      },
    })
    expect(body.distributions.keywordSourceAudit).toMatchObject({
      creativesWithAudit: 2,
      totalKeywords: 7,
      byRawSource: {
        SEARCH_TERM: 2,
        AI: 2,
        KEYWORD_PLANNER: 3,
      },
      bySourceSubtype: {
        SEARCH_TERM_HIGH_PERFORMING: 2,
        AI_LLM_RAW: 2,
        KEYWORD_PLANNER_ENRICHED: 3,
      },
      bySourceField: {
        search_terms: 2,
        ai: 2,
        keyword_planner: 3,
      },
      fallbackMode: {
        false: 1,
        true: 1,
      },
      noVolumeMode: {
        true: 1,
        false: 1,
      },
      contextFallbackStrategy: {
        filtered: 1,
        keyword_pool: 1,
      },
      sourceQuotaAudit: {
        blockedByCap: {
          lowTrust: 2,
          ai: 1,
          aiLlmRaw: 1,
        },
        deferredRefillTriggeredCount: 1,
        deferredRefillCount: 1,
        underfillBeforeRefill: 1,
        deferredCount: 2,
        acceptedCount: 7,
      },
    })
  })
})
