import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authState = vi.hoisted(() => ({
  authenticated: true,
  user: { userId: 7 },
}))

const perfFns = vi.hoisted(() => ({
  withPerformanceMonitoring: vi.fn((handler: any) => handler),
  webVitalsMonitor: {
    record: vi.fn(),
  },
}))

const flagFns = vi.hoisted(() => ({
  isPerformanceReleaseEnabled: vi.fn(() => true),
}))

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => {
    return async (request: NextRequest) => {
      if (!authState.authenticated || !authState.user) {
        return NextResponse.json({ error: '未授权' }, { status: 401 })
      }
      return handler(request, authState.user)
    }
  },
}))

vi.mock('@/lib/common/server', () => ({
  withPerformanceMonitoring: perfFns.withPerformanceMonitoring,
  webVitalsMonitor: perfFns.webVitalsMonitor,
  isPerformanceReleaseEnabled: flagFns.isPerformanceReleaseEnabled,
}))

import { POST } from '@/app/api/monitoring/web-vitals/route'

describe('POST /api/monitoring/web-vitals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    authState.user = { userId: 7 }
    flagFns.isPerformanceReleaseEnabled.mockReturnValue(true)
  })

  it('returns ignored when feature flag is disabled', async () => {
    flagFns.isPerformanceReleaseEnabled.mockReturnValue(false)

    const req = new NextRequest('http://localhost/api/monitoring/web-vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'LCP', value: 1200 }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ignored).toBe(true)
  })

  it('returns 401 when unauthorized', async () => {
    authState.authenticated = false
    authState.user = null as any

    const req = new NextRequest('http://localhost/api/monitoring/web-vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'LCP', value: 1200 }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when payload is invalid', async () => {
    const req = new NextRequest('http://localhost/api/monitoring/web-vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', value: 'abc' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(perfFns.webVitalsMonitor.record).not.toHaveBeenCalled()
  })

  it('records normalized web vital payload', async () => {
    const oversizedFlagSnapshot = 'x'.repeat(1300)
    const req = new NextRequest('http://localhost/api/monitoring/web-vitals', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest-agent',
      },
      body: JSON.stringify({
        id: 'metric-1',
        name: 'lcp',
        value: 2200.55,
        delta: 350,
        rating: 'good',
        navigationType: 'navigate',
        path: '/dashboard',
        buildId: '  build-20260303  ',
        flagSnapshot: `  ${oversizedFlagSnapshot}  `,
        ts: 1710000000000,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(perfFns.webVitalsMonitor.record).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'metric-1',
        name: 'LCP',
        value: 2200.55,
        delta: 350,
        rating: 'good',
        navigationType: 'navigate',
        path: '/dashboard',
        buildId: 'build-20260303',
        flagSnapshot: oversizedFlagSnapshot.slice(0, 1024),
        timestamp: 1710000000000,
        userId: 7,
        userAgent: 'vitest-agent',
      })
    )
  })
})
