import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, GET } from '@/app/api/admin/performance/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const perfFns = vi.hoisted(() => ({
  performanceMonitor: {
    getStats: vi.fn(),
    getRecentMetrics: vi.fn(),
    clear: vi.fn(),
  },
  webVitalsMonitor: {
    getSummary: vi.fn(),
    getRecentMetrics: vi.fn(),
    clear: vi.fn(),
  },
  frontendErrorMonitor: {
    getSummary: vi.fn(),
    getRecentMetrics: vi.fn(),
    clear: vi.fn(),
  },
}))

const cacheFns = vi.hoisted(() => ({
  apiCache: {
    getStats: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/api-performance', () => ({
  performanceMonitor: perfFns.performanceMonitor,
  webVitalsMonitor: perfFns.webVitalsMonitor,
  frontendErrorMonitor: perfFns.frontendErrorMonitor,
}))

vi.mock('@/lib/api-cache', () => ({
  apiCache: cacheFns.apiCache,
}))

describe('admin performance api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1, role: 'admin' },
    })

    perfFns.performanceMonitor.getStats.mockReturnValue({
      avgDuration: 100,
      minDuration: 20,
      maxDuration: 300,
      totalRequests: 10,
      slowRequests: 1,
    })
    perfFns.performanceMonitor.getRecentMetrics.mockReturnValue([
      { path: '/api/a', method: 'GET', duration: 100, timestamp: Date.now(), statusCode: 200 },
    ])

    perfFns.webVitalsMonitor.getSummary.mockReturnValue({
      total: 2,
      byMetric: {
        LCP: {
          count: 2,
          avg: 1500,
          min: 1000,
          max: 2000,
          p75: 1900,
          p95: 2000,
          good: 1,
          needsImprovement: 1,
          poor: 0,
        },
      },
    })
    perfFns.webVitalsMonitor.getRecentMetrics.mockReturnValue([
      { name: 'LCP', value: 1500, path: '/dashboard', timestamp: Date.now() },
    ])
    perfFns.frontendErrorMonitor.getSummary.mockReturnValue({
      total: 1,
      byType: { error: 1, unhandledrejection: 0 },
      byPath: { '/dashboard': 1 },
    })
    perfFns.frontendErrorMonitor.getRecentMetrics.mockReturnValue([
      { type: 'error', message: 'boom', path: '/dashboard', timestamp: Date.now() },
    ])

    cacheFns.apiCache.getStats.mockReturnValue({
      totalKeys: 20,
      validKeys: 18,
      expiredKeys: 2,
    })
  })

  it('returns frontend vitals in GET response', async () => {
    const req = new NextRequest('http://localhost/api/admin/performance', {
      method: 'GET',
    })

    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data).toHaveProperty('frontendVitals')
    expect(data.data).toHaveProperty('recentFrontendVitals')
    expect(data.data).toHaveProperty('frontendErrors')
    expect(data.data).toHaveProperty('recentFrontendErrors')
  })

  it('clears api and web vital monitors on DELETE', async () => {
    const req = new NextRequest('http://localhost/api/admin/performance', {
      method: 'DELETE',
    })

    const res = await DELETE(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(perfFns.performanceMonitor.clear).toHaveBeenCalledTimes(1)
    expect(perfFns.webVitalsMonitor.clear).toHaveBeenCalledTimes(1)
    expect(perfFns.frontendErrorMonitor.clear).toHaveBeenCalledTimes(1)
  })
})
