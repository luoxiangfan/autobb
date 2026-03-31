import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/strategy/run/route'

function formatShanghaiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

const TODAY = formatShanghaiDate(new Date())
const YESTERDAY = formatShanghaiDate(new Date(Date.now() - 24 * 60 * 60 * 1000))

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const recommendationFns = vi.hoisted(() => ({
  getStrategyRecommendations: vi.fn(),
  persistStrategyRecommendationExecutionRuntime: vi.fn(),
}))

const reportFns = vi.hoisted(() => ({
  refreshOpenclawDailyReportSnapshot: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getOpenclawSettingsMap: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  getQueueManagerForTaskType: vi.fn(),
  queue: {
    initialize: vi.fn(),
    enqueue: vi.fn(),
    getTask: vi.fn(),
  },
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/strategy-recommendations', () => ({
  getStrategyRecommendations: recommendationFns.getStrategyRecommendations,
  persistStrategyRecommendationExecutionRuntime: recommendationFns.persistStrategyRecommendationExecutionRuntime,
}))

vi.mock('@/lib/openclaw/reports', () => ({
  refreshOpenclawDailyReportSnapshot: reportFns.refreshOpenclawDailyReportSnapshot,
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getOpenclawSettingsMap: settingsFns.getOpenclawSettingsMap,
}))

vi.mock('@/lib/queue/queue-routing', () => ({
  getQueueManagerForTaskType: queueFns.getQueueManagerForTaskType,
}))

describe('POST /api/openclaw/strategy/run (legacy alias)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 11,
      authType: 'session',
    })
    recommendationFns.getStrategyRecommendations.mockResolvedValue([])
    recommendationFns.persistStrategyRecommendationExecutionRuntime.mockResolvedValue(undefined)
    reportFns.refreshOpenclawDailyReportSnapshot.mockResolvedValue({
      date: TODAY,
    })
    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      feishu_target: 'ou_xxx',
    })
    queueFns.queue.initialize.mockResolvedValue(undefined)
    queueFns.queue.enqueue.mockResolvedValue(`openclaw-report-send-manual:11:${TODAY}`)
    queueFns.queue.getTask.mockResolvedValue(null)
    queueFns.getQueueManagerForTaskType.mockImplementation((taskType: string) => {
      if (taskType === 'openclaw-report-send' || taskType === 'openclaw-strategy') {
        return queueFns.queue
      }
      return queueFns.queue
    })
  })

  it('returns 403 when unauthorized', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/openclaw/strategy/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: TODAY }),
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })

  it('refreshes recommendations and enqueues report delivery', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: TODAY, limit: 500 }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('x-openclaw-deprecated')).toBe('true')
    expect(String(res.headers.get('x-openclaw-deprecated-message') || '')).toContain('/api/openclaw/strategy/recommendations')
    expect(payload.success).toBe(true)
    expect(payload.trigger).toBe('manual')
    expect(payload.reportSent).toBe(true)
    expect(payload.reportDeliveryMode).toBe('queued')
    expect(recommendationFns.getStrategyRecommendations).toHaveBeenCalledWith({
      userId: 11,
      reportDate: TODAY,
      forceRefresh: true,
      limit: 200,
    })
    expect(queueFns.queue.enqueue).toHaveBeenCalledWith(
      'openclaw-report-send',
      {
        userId: 11,
        target: 'ou_xxx',
        date: TODAY,
        trigger: 'manual',
      },
      11,
      expect.objectContaining({
        priority: 'high',
        maxRetries: 1,
        taskId: `openclaw-report-send-manual:11:${TODAY}`,
      })
    )
  })

  it('returns 400 for invalid date format', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026/02/23' }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('YYYY-MM-DD')
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })

  it('keeps success when report enqueue fails', async () => {
    queueFns.queue.enqueue.mockRejectedValueOnce(new Error('queue timeout'))
    const req = new NextRequest('http://localhost/api/openclaw/strategy/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: TODAY }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.reportSent).toBe(false)
    expect(payload.reportSendError).toContain('queue timeout')
  })

  it('returns 400 for historical date', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: YESTERDAY }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.code).toBe('HISTORICAL_READONLY')
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })
})
