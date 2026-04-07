import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/kpis/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  getOrSet: vi.fn(),
  set: vi.fn(),
  generateCacheKey: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/api-cache', () => ({
  apiCache: {
    getOrSet: cacheFns.getOrSet,
    set: cacheFns.set,
  },
  generateCacheKey: cacheFns.generateCacheKey,
}))

vi.mock('@/lib/api-performance', () => ({
  withPerformanceMonitoring: (handler: any) => handler,
}))

describe('GET /api/dashboard/kpis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })
    cacheFns.generateCacheKey.mockReturnValue('kpis:test')
    cacheFns.getOrSet.mockResolvedValue({ success: true, data: { source: 'cache' } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('uses cache getOrSet in normal mode and keeps short TTL by default', async () => {
    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ success: true, data: { source: 'cache' } })
    expect(cacheFns.getOrSet).toHaveBeenCalledWith(
      'kpis:test',
      expect.any(Function),
      20 * 1000
    )
    expect(cacheFns.set).not.toHaveBeenCalled()
  })

  it('falls back to legacy TTL when FF_KPI_SHORT_TTL is explicitly disabled', async () => {
    vi.stubEnv('FF_KPI_SHORT_TTL', 'false')

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(cacheFns.getOrSet).toHaveBeenCalledWith(
      'kpis:test',
      expect.any(Function),
      5 * 60 * 1000
    )
  })

  it('applies short KPI TTL when FF_KPI_SHORT_TTL is enabled', async () => {
    vi.stubEnv('FF_KPI_SHORT_TTL', 'true')
    vi.stubEnv('KPI_SHORT_TTL_MS', '10000')

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(cacheFns.getOrSet).toHaveBeenCalledWith(
      'kpis:test',
      expect.any(Function),
      15 * 1000
    )
  })

  it('includes all unattributed failures when calculating commission totals', async () => {
    cacheFns.getOrSet.mockReset()

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT currency') && sql.includes('FROM campaign_performance')) {
        return [{ currency: 'USD' }]
      }
      if (sql.includes('GROUP BY COALESCE(currency, \'USD\')')) {
        return [{ currency: 'USD', impressions: 800, clicks: 80, cost: 40 }]
      }

      throw new Error(`unexpected query sql: ${sql}`)
    })

    let periodCallCount = 0
    let attributedCallCount = 0
    let unattributedCallCount = 0

    const queryOne = vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('SUM(impressions) as impressions')) {
        periodCallCount += 1
        if (periodCallCount === 1) {
          return { impressions: 1000, clicks: 100, cost: 50 }
        }
        return { impressions: 800, clicks: 80, cost: 40 }
      }

      if (sql.includes('FROM affiliate_commission_attributions')) {
        attributedCallCount += 1
        if (attributedCallCount === 1) {
          return { total_commission: 8 }
        }
        return { total_commission: 4 }
      }

      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        // Dashboard KPIs should align with campaigns performance/trends and
        // affiliate backend reconciliation. We now include all unattributed
        // failures (including campaign_mapping_miss) to match backend totals.
        expect(sql).toContain('1 = 1')
        expect(sql).not.toContain("COALESCE(reason_code, '') <> ?")
        expect(sql).not.toContain("COALESCE(reason_code, '') NOT IN")
        unattributedCallCount += 1
        if (unattributedCallCount === 1) {
          return { total_commission: 2 }
        }
        return { total_commission: 1 }
      }

      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7&refresh=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data?.current?.commission).toBe(10)
    expect(data.data?.current?.conversions).toBe(10)
    expect(data.data?.previous?.commission).toBe(5)
    expect(data.data?.changes?.commission).toBe(100)
    expect(data.data?.current?.currency).toBe('USD')
    expect(unattributedCallCount).toBe(2)
    expect(cacheFns.set).toHaveBeenCalledWith(
      'kpis:test',
      expect.objectContaining({ success: true }),
      expect.any(Number)
    )
    expect(cacheFns.getOrSet).not.toHaveBeenCalled()
  })

  it('bypasses read/write cache when noCache=true', async () => {
    cacheFns.getOrSet.mockReset()

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT currency') && sql.includes('FROM campaign_performance')) {
        return [{ currency: 'USD' }]
      }
      if (sql.includes('GROUP BY COALESCE(currency, \'USD\')')) {
        return [{ currency: 'USD', impressions: 800, clicks: 80, cost: 40 }]
      }

      throw new Error(`unexpected query sql: ${sql}`)
    })

    let periodCallCount = 0
    let attributedCallCount = 0
    let unattributedCallCount = 0

    const queryOne = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('SUM(impressions) as impressions')) {
        periodCallCount += 1
        if (periodCallCount === 1) {
          return { impressions: 1000, clicks: 100, cost: 50 }
        }
        return { impressions: 800, clicks: 80, cost: 40 }
      }

      if (sql.includes('FROM affiliate_commission_attributions')) {
        attributedCallCount += 1
        if (attributedCallCount === 1) {
          return { total_commission: 8 }
        }
        return { total_commission: 4 }
      }

      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        unattributedCallCount += 1
        if (unattributedCallCount === 1) {
          return { total_commission: 2 }
        }
        return { total_commission: 1 }
      }

      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7&noCache=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data?.current?.commission).toBe(10)
    expect(cacheFns.getOrSet).not.toHaveBeenCalled()
    expect(cacheFns.set).not.toHaveBeenCalled()
  })

  it('converts previous-period mixed currencies before calculating changes', async () => {
    cacheFns.getOrSet.mockReset()

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT currency') && sql.includes('FROM campaign_performance')) {
        return [{ currency: 'USD' }]
      }
      if (sql.includes('GROUP BY COALESCE(currency, \'USD\')')) {
        return [
          { currency: 'USD', impressions: 50, clicks: 5, cost: 20 },
          { currency: 'CNY', impressions: 50, clicks: 5, cost: 72 },
        ]
      }

      throw new Error(`unexpected query sql: ${sql}`)
    })

    let currentPeriodCalled = false
    let attributedCallCount = 0
    let unattributedCallCount = 0

    const queryOne = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('SUM(impressions) as impressions')) {
        if (!currentPeriodCalled) {
          currentPeriodCalled = true
          return { impressions: 1000, clicks: 100, cost: 50 }
        }
        throw new Error(`unexpected queryOne sql: ${sql}`)
      }

      if (sql.includes('FROM affiliate_commission_attributions')) {
        attributedCallCount += 1
        return attributedCallCount === 1
          ? { total_commission: 10 }
          : { total_commission: 5 }
      }

      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        unattributedCallCount += 1
        return unattributedCallCount === 1
          ? { total_commission: 0 }
          : { total_commission: 0 }
      }

      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7&refresh=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data?.previous?.cost).toBeGreaterThan(20)
    expect(data.data?.previous?.cost).toBeLessThan(40)
    expect(data.data?.previous?.cost).not.toBeCloseTo(92, 5)
    expect(data.data?.changes?.cost).toBeGreaterThan(0)
    expect(data.data?.changes?.cost).toBeLessThan(100)
  })
})
