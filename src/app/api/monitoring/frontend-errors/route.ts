import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { frontendErrorMonitor, withPerformanceMonitoring } from '@/lib/api-performance'
import { isPerformanceReleaseEnabled } from '@/lib/feature-flags'

type FrontendErrorPayload = {
  type?: unknown
  name?: unknown
  message?: unknown
  stack?: unknown
  path?: unknown
  buildId?: unknown
  flagSnapshot?: unknown
  ts?: unknown
  timestamp?: unknown
}

function normalizeType(value: unknown): 'error' | 'unhandledrejection' | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'error' || normalized === 'unhandledrejection') {
    return normalized
  }
  return null
}

function normalizePath(value: unknown): string {
  if (typeof value !== 'string') return '/'
  const path = value.trim()
  if (!path.startsWith('/')) return '/'
  return path.slice(0, 256) || '/'
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function normalizeBuildId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 64) : undefined
}

function normalizeFlagSnapshot(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 1024) : undefined
}

const postHandler = async (request: NextRequest) => {
  if (!isPerformanceReleaseEnabled('frontendErrorMonitoring')) {
    return NextResponse.json({ success: true, ignored: true })
  }

  const authResult = await verifyAuth(request)
  if (!authResult.authenticated || !authResult.user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as FrontendErrorPayload
  const type = normalizeType(body.type)
  if (!type) {
    return NextResponse.json({ error: '无效的错误类型' }, { status: 400 })
  }

  const message = String(body.message || '').trim()
  if (!message) {
    return NextResponse.json({ error: '无效的错误消息' }, { status: 400 })
  }

  const timestamp = toFiniteNumber(body.ts ?? body.timestamp)
  const userId = Number(authResult.user.userId)

  frontendErrorMonitor.record({
    type,
    name: typeof body.name === 'string' ? body.name.slice(0, 128) : undefined,
    message: message.slice(0, 1024),
    stack: typeof body.stack === 'string' ? body.stack.slice(0, 4000) : undefined,
    path: normalizePath(body.path),
    buildId: normalizeBuildId(body.buildId),
    flagSnapshot: normalizeFlagSnapshot(body.flagSnapshot),
    timestamp: timestamp !== null && timestamp > 0 ? Math.floor(timestamp) : Date.now(),
    userId: Number.isFinite(userId) && userId > 0 ? userId : undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 256),
  })

  return NextResponse.json({ success: true })
}

export const POST = withPerformanceMonitoring<any>(postHandler, {
  path: '/api/monitoring/frontend-errors',
})
