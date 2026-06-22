import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, GET } from '@/app/api/admin/performance/route'

const authUser = {
  userId: 1,
  email: 'admin@autoads.dev',
  role: 'admin',
  packageType: 'enterprise',
}

const perfFns = vi.hoisted(() => ({
  performanceMonitor: {
    getStats: vi.fn(),
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
  withAuth: (handler: any) => {
    return async (request: NextRequest) => handler(request, authUser)
  },
}))

vi.mock('@/lib/common/server', () => ({
  performanceMonitor: perfFns.performanceMonitor,
  apiCache: cacheFns.apiCache,
}))

describe('admin performance api', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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

    cacheFns.apiCache.getStats.mockReturnValue({
      totalKeys: 20,
      validKeys: 18,
      expiredKeys: 2,
    })
  })

  it('returns api performance stats in GET response', async () => {
    const req = new NextRequest('http://localhost/api/admin/performance', {
      method: 'GET',
    })

    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data).toHaveProperty('overall')
    expect(data.data).toHaveProperty('cache')
    expect(data.data).toHaveProperty('byPath')
    expect(data.data).toHaveProperty('recentRequests')
    expect(data.data).not.toHaveProperty('frontendVitals')
    expect(data.data).not.toHaveProperty('frontendErrors')
  })

  it('clears api performance monitor on DELETE', async () => {
    const req = new NextRequest('http://localhost/api/admin/performance', {
      method: 'DELETE',
    })

    const res = await DELETE(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(perfFns.performanceMonitor.clear).toHaveBeenCalledTimes(1)
  })
})
