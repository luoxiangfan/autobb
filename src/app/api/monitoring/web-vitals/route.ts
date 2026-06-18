import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { withPerformanceMonitoring, webVitalsMonitor } from '@/lib/common/server'
import { isPerformanceReleaseEnabled } from '@/lib/common/server'

type WebVitalPayload = {
  id?: unknown
  name?: unknown
  value?: unknown
  delta?: unknown
  rating?: unknown
  navigationType?: unknown
  path?: unknown
  buildId?: unknown
  flagSnapshot?: unknown
  ts?: unknown
  timestamp?: unknown
}

function normalizeRating(value: unknown): 'good' | 'needs-improvement' | 'poor' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'good' || normalized === 'needs-improvement' || normalized === 'poor') {
    return normalized
  }
  return undefined
}

function normalizePath(value: unknown): string {
  if (typeof value !== 'string') return '/'
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return '/'
  return trimmed.slice(0, 256) || '/'
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

const authenticatedPostHandler = withAuth(async (request: NextRequest, user) => {
  const body = (await request.json().catch(() => ({}))) as WebVitalPayload
  const name = String(body.name || '')
    .trim()
    .toUpperCase()
  if (!name || name.length > 32) {
    return NextResponse.json({ error: '无效的指标名称' }, { status: 400 })
  }

  const value = toFiniteNumber(body.value)
  if (value === null) {
    return NextResponse.json({ error: '无效的指标值' }, { status: 400 })
  }

  const delta = toFiniteNumber(body.delta)
  const timestamp = toFiniteNumber(body.ts ?? body.timestamp)
  const userId = Number(user.userId)

  webVitalsMonitor.record({
    id: typeof body.id === 'string' ? body.id.slice(0, 64) : undefined,
    name,
    value,
    delta: delta === null ? undefined : delta,
    rating: normalizeRating(body.rating),
    navigationType:
      typeof body.navigationType === 'string' ? body.navigationType.trim().slice(0, 32) : undefined,
    path: normalizePath(body.path),
    buildId: normalizeBuildId(body.buildId),
    flagSnapshot: normalizeFlagSnapshot(body.flagSnapshot),
    timestamp: timestamp !== null && timestamp > 0 ? Math.floor(timestamp) : Date.now(),
    userId: Number.isFinite(userId) && userId > 0 ? userId : undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 256),
  })

  return NextResponse.json({ success: true })
})

const postHandler = async (request: NextRequest) => {
  if (!isPerformanceReleaseEnabled('webVitalsMonitoring')) {
    return NextResponse.json({ success: true, ignored: true })
  }

  return authenticatedPostHandler(request)
}

export const POST = withPerformanceMonitoring(
  postHandler as (request: NextRequest) => Promise<NextResponse>,
  {
    path: '/api/monitoring/web-vitals',
  }
)
