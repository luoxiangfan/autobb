import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authState = vi.hoisted(() => ({
  authenticated: true,
  user: { userId: 7 },
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
  frontendErrorMonitor: perfFns.frontendErrorMonitor,
  isPerformanceReleaseEnabled: flagFns.isPerformanceReleaseEnabled,
}))

import { POST } from '@/app/api/monitoring/frontend-errors/route'

describe('POST /api/monitoring/frontend-errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    authState.user = { userId: 7 }
    flagFns.isPerformanceReleaseEnabled.mockReturnValue(true)
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
  })

  it('returns 401 when unauthorized', async () => {
    authState.authenticated = false
    authState.user = null as any

    const req = new NextRequest('http://localhost/api/monitoring/frontend-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'error', message: 'boom' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when payload is invalid', async () => {
    const req = new NextRequest('http://localhost/api/monitoring/frontend-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'invalid', message: '' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(perfFns.frontendErrorMonitor.record).not.toHaveBeenCalled()
  })

  it('records normalized frontend error payload', async () => {
    const req = new NextRequest('http://localhost/api/monitoring/frontend-errors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest-agent',
      },
      body: JSON.stringify({
        type: 'error',
        name: 'TypeError',
        message: 'Cannot read property',
        stack: 'at foo()',
        path: '/dashboard',
        buildId: 'build-1',
        ts: 1710000000000,
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
        message: 'Cannot read property',
        path: '/dashboard',
        userId: 7,
      })
    )
  })
})
