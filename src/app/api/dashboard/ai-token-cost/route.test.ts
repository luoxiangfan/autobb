import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/ai-token-cost/route'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

describe('GET /api/dashboard/ai-token-cost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('returns 401 when x-user-id is missing', async () => {
    const req = new NextRequest('http://localhost/api/dashboard/ai-token-cost?days=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('uses UTC date boundaries for today and trend queries', async () => {
    // 2026-03-26 17:15 UTC = 2026-03-27 01:15 in Asia/Shanghai.
    vi.setSystemTime(new Date('2026-03-26T17:15:39.053Z'))
    vi.stubEnv('TZ', 'Asia/Shanghai')

    const query = vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('GROUP BY model, operation_type')) {
        expect(params).toEqual([1, '2026-03-26'])
        return [
          {
            model: 'gemini-3-flash-preview',
            operation_type: 'ad_creative_generation_main',
            input_tokens: 1200,
            output_tokens: 800,
            total_tokens: 2000,
            call_count: 1,
          },
          {
            model: 'gpt-5.2',
            operation_type: 'review_analysis',
            input_tokens: 1000,
            output_tokens: 100,
            total_tokens: 1100,
            call_count: 1,
          }
        ]
      }

      if (sql.includes('GROUP BY date, model')) {
        expect(params).toEqual([1, '2026-03-20'])
        return [
          {
            date: '2026-03-26',
            model: 'gemini-3-flash-preview',
            input_tokens: 1200,
            output_tokens: 800,
            total_tokens: 2000,
          },
          {
            date: '2026-03-26',
            model: 'gpt-5.2',
            input_tokens: 1000,
            output_tokens: 100,
            total_tokens: 1100,
          },
        ]
      }

      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      query,
    })

    const req = new NextRequest('http://localhost/api/dashboard/ai-token-cost?days=7', {
      headers: new Headers({
        'x-user-id': '1',
      }),
    })
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.today.totalCost).toBe(0.04)
    expect(payload.data.today.totalTokens).toBe(3100)
    expect(payload.data.today.totalCalls).toBe(2)
    expect(payload.data.trend).toEqual([
      { date: '2026-03-26', totalTokens: 3100, totalCost: 0.04 },
    ])
    expect(query).toHaveBeenCalledTimes(2)
  })
})
