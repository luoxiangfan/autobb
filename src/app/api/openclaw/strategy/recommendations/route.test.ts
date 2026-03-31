import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/openclaw/strategy/recommendations/route'

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

describe('openclaw strategy recommendations route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 7,
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
    queueFns.queue.enqueue.mockResolvedValue(`openclaw-report-send-manual:7:${TODAY}`)
    queueFns.queue.getTask.mockResolvedValue(null)
    queueFns.getQueueManagerForTaskType.mockImplementation((taskType: string) => {
      if (taskType === 'openclaw-report-send' || taskType === 'openclaw-strategy') {
        return queueFns.queue
      }
      return queueFns.queue
    })
  })

  it('supports GET list with refresh flag', async () => {
    const req = new NextRequest(`http://localhost/api/openclaw/strategy/recommendations?date=${TODAY}&refresh=1&limit=9`)
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(recommendationFns.getStrategyRecommendations).toHaveBeenCalledWith({
      userId: 7,
      reportDate: TODAY,
      forceRefresh: true,
      limit: 9,
    })
  })

  it('returns 400 when refreshing historical date', async () => {
    const req = new NextRequest(`http://localhost/api/openclaw/strategy/recommendations?date=${YESTERDAY}&refresh=1&limit=9`)
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.code).toBe('HISTORICAL_READONLY')
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })

  it('returns 400 when date format is invalid', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations?date=2026/02/23')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('YYYY-MM-DD')
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })

  it('hydrates queue runtime and persists miss state for queued recommendations', async () => {
    recommendationFns.getStrategyRecommendations.mockResolvedValue([
      {
        id: 'rec-1',
        status: 'pending',
        executionResult: {
          queueTaskId: 'task-1',
          queueTaskStatus: 'pending',
        },
      },
    ])
    queueFns.queue.getTask.mockResolvedValue(null)

    const req = new NextRequest(`http://localhost/api/openclaw/strategy/recommendations?date=${TODAY}`)
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.recommendations?.[0]?.executionResult?.queueTaskMissCount).toBe(1)
    expect(payload.recommendations?.[0]?.executionResult?.queued).toBe(true)
    expect(recommendationFns.persistStrategyRecommendationExecutionRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        recommendationId: 'rec-1',
      })
    )
  })

  it('returns 403 for unauthorized manual trigger', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: TODAY }),
    })
    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })

  it('manual trigger refreshes recommendations and enqueues Feishu report delivery', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: TODAY,
        limit: 500,
      }),
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.reportSent).toBe(true)
    expect(payload.reportDeliveryMode).toBe('queued')
    expect(recommendationFns.getStrategyRecommendations).toHaveBeenCalledWith({
      userId: 7,
      reportDate: TODAY,
      forceRefresh: true,
      limit: 200,
    })
    expect(reportFns.refreshOpenclawDailyReportSnapshot).toHaveBeenCalledWith({
      userId: 7,
      date: TODAY,
    })
    expect(settingsFns.getOpenclawSettingsMap).toHaveBeenCalledWith(7)
    expect(queueFns.queue.enqueue).toHaveBeenCalledWith(
      'openclaw-report-send',
      {
        userId: 7,
        target: 'ou_xxx',
        date: TODAY,
        trigger: 'manual',
      },
      7,
      expect.objectContaining({
        priority: 'high',
        maxRetries: 1,
        taskId: `openclaw-report-send-manual:7:${TODAY}`,
      })
    )
  })

  it('manual trigger keeps success when Feishu enqueue fails', async () => {
    queueFns.queue.enqueue.mockRejectedValueOnce(new Error('queue timeout'))

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: TODAY,
      }),
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.reportSent).toBe(false)
    expect(payload.reportSendError).toContain('queue timeout')
  })

  it('manual trigger returns 400 for historical date', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: YESTERDAY,
      }),
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.code).toBe('HISTORICAL_READONLY')
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })

  it('manual trigger returns 400 when date format is invalid', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: '2026/02/23',
      }),
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
  })
})
