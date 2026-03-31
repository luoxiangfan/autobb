import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/monitoring/frontend-errors/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const perfFns = vi.hoisted(() => ({
  withPerformanceMonitoring: vi.fn((handler: any) => handler),
  frontendErrorMonitor: {
    record: vi.fn(),
  },
}))

const flagFns = vi.hoisted(() => ({
  isPerformanceReleaseEnabled: vi.fn(() => true),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/api-performance', () => ({
  withPerformanceMonitoring: perfFns.withPerformanceMonitoring,
  frontendErrorMonitor: perfFns.frontendErrorMonitor,
}))

vi.mock('@/lib/feature-flags', () => ({
  isPerformanceReleaseEnabled: flagFns.isPerformanceReleaseEnabled,
}))

describe('POST /api/monitoring/frontend-errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flagFns.isPerformanceReleaseEnabled.mockReturnValue(true)
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })
  })

  it('returns ignored when feature flag is disabled', async () => {
    flagFns.isPerformanceReleaseEnabled.mockReturnValue(false)

    const req = new NextRequest('http://localhost/api/monitoring/frontend-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'error', message: 'boom' }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ignored).toBe(true)
    expect(authFns.verifyAuth).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid payload', async () => {
    const req = new NextRequest('http://localhost/api/monitoring/frontend-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'invalid', message: '' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(perfFns.frontendErrorMonitor.record).not.toHaveBeenCalled()
  })

  it('records frontend error payload', async () => {
    const oversizedFlagSnapshot = 'f'.repeat(1500)
    const req = new NextRequest('http://localhost/api/monitoring/frontend-errors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest-agent',
      },
      body: JSON.stringify({
        type: 'error',
        name: 'TypeError',
        message: 'Cannot read properties of undefined',
        stack: 'TypeError: ...',
        path: '/offers',
        buildId: '  v20260303  ',
        flagSnapshot: ` ${oversizedFlagSnapshot} `,
        ts: 1710000000123,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(perfFns.frontendErrorMonitor.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        name: 'TypeError',
        message: 'Cannot read properties of undefined',
        stack: 'TypeError: ...',
        path: '/offers',
        buildId: 'v20260303',
        flagSnapshot: oversizedFlagSnapshot.slice(0, 1024),
        timestamp: 1710000000123,
        userId: 7,
        userAgent: 'vitest-agent',
      })
    )
  })
})
