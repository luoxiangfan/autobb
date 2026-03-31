import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeOpenclawStrategy } from '@/lib/queue/executors/openclaw-strategy-executor'
import type { Task } from '@/lib/queue/types'
import type { OpenclawStrategyTaskData } from '@/lib/queue/executors/openclaw-strategy-executor'

function formatShanghaiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

const TODAY = formatShanghaiDate(new Date())

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  db: {
    queryOne: vi.fn(),
  },
}))

const configFns = vi.hoisted(() => ({
  getOpenclawStrategyConfig: vi.fn(),
}))

const recommendationFns = vi.hoisted(() => ({
  getStrategyRecommendations: vi.fn(),
  executeStrategyRecommendation: vi.fn(),
  markStrategyRecommendationReviewQueued: vi.fn(),
  reviewStrategyRecommendationEffect: vi.fn(),
}))

const reportFns = vi.hoisted(() => ({
  refreshOpenclawDailyReportSnapshot: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getOpenclawSettingsMap: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  getQueueManagerForTaskType: vi.fn(),
  reportQueue: {
    initialize: vi.fn(),
    enqueue: vi.fn(),
  },
  strategyQueue: {
    initialize: vi.fn(),
    enqueue: vi.fn(),
  },
}))

const storeFns = vi.hoisted(() => ({
  createStrategyRun: vi.fn(),
  recordStrategyAction: vi.fn(),
  touchStrategyRun: vi.fn(),
  updateStrategyAction: vi.fn(),
  updateStrategyRun: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/openclaw/strategy-config', () => ({
  getOpenclawStrategyConfig: configFns.getOpenclawStrategyConfig,
}))

vi.mock('@/lib/openclaw/strategy-recommendations', () => ({
  getStrategyRecommendations: recommendationFns.getStrategyRecommendations,
  executeStrategyRecommendation: recommendationFns.executeStrategyRecommendation,
  markStrategyRecommendationReviewQueued: recommendationFns.markStrategyRecommendationReviewQueued,
  reviewStrategyRecommendationEffect: recommendationFns.reviewStrategyRecommendationEffect,
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

vi.mock('@/lib/openclaw/strategy-store', () => ({
  createStrategyRun: storeFns.createStrategyRun,
  recordStrategyAction: storeFns.recordStrategyAction,
  touchStrategyRun: storeFns.touchStrategyRun,
  updateStrategyAction: storeFns.updateStrategyAction,
  updateStrategyRun: storeFns.updateStrategyRun,
}))

function buildTask(data: OpenclawStrategyTaskData): Task<OpenclawStrategyTaskData> {
  return {
    id: 'task-openclaw-1',
    type: 'openclaw-strategy',
    data,
    userId: Number(data.userId || 9),
    parentRequestId: 'req-test-1',
    priority: 'normal',
    status: 'pending',
    createdAt: Date.now(),
  }
}

describe('executeOpenclawStrategy analyze-only mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    dbFns.db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT is_active, package_expires_at FROM users')) {
        return { is_active: 1, package_expires_at: null }
      }
      if (sql.includes('SELECT strategy_center_enabled FROM users')) {
        return { strategy_center_enabled: 1 }
      }
      return null
    })
    dbFns.getDatabase.mockReturnValue(dbFns.db as any)

    configFns.getOpenclawStrategyConfig.mockResolvedValue({
      enabled: true,
      cron: '0 9 * * *',
      maxOffersPerRun: 3,
      defaultBudget: 20,
      maxCpc: 1.2,
      minCpc: 0.1,
      dailyBudgetCap: 1000,
      dailySpendCap: 100,
      targetRoas: 1,
      priorityAsins: undefined,
      enableAutoPublish: true,
      enableAutoPause: true,
      enableAutoAdjustCpc: true,
      allowAffiliateFetch: true,
      enforceAutoadsOnly: true,
      dryRun: false,
    })

    recommendationFns.getStrategyRecommendations.mockResolvedValue([])
    recommendationFns.executeStrategyRecommendation.mockResolvedValue({
      data: { impactWindowDays: 3 },
    })
    recommendationFns.markStrategyRecommendationReviewQueued.mockResolvedValue(undefined)
    recommendationFns.reviewStrategyRecommendationEffect.mockResolvedValue(undefined)

    reportFns.refreshOpenclawDailyReportSnapshot.mockResolvedValue({
      date: TODAY,
    })
    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      feishu_target: 'ou_xxx',
    })

    queueFns.reportQueue.initialize.mockResolvedValue(undefined)
    queueFns.reportQueue.enqueue.mockResolvedValue(`openclaw-report-send-cron:9:${TODAY}`)
    queueFns.strategyQueue.initialize.mockResolvedValue(undefined)
    queueFns.strategyQueue.enqueue.mockResolvedValue('openclaw-review-task-1')
    queueFns.getQueueManagerForTaskType.mockImplementation((taskType: string) => {
      if (taskType === 'openclaw-report-send') return queueFns.reportQueue
      return queueFns.strategyQueue
    })
  })

  it('runs cron analyze task without entering legacy strategy run pipeline', async () => {
    const result = await executeOpenclawStrategy(buildTask({
      userId: 9,
      mode: 'auto',
      trigger: 'cron',
      kind: 'analyze_recommendations',
    }))

    expect(result.success).toBe(true)
    expect(result.skipped).not.toBe(true)
    expect(recommendationFns.getStrategyRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        forceRefresh: true,
        limit: 100,
      })
    )
    expect(reportFns.refreshOpenclawDailyReportSnapshot).toHaveBeenCalledWith({
      userId: 9,
      date: expect.any(String),
    })
    expect(queueFns.reportQueue.enqueue).toHaveBeenCalledWith(
      'openclaw-report-send',
      expect.objectContaining({
        userId: 9,
        target: 'ou_xxx',
        date: TODAY,
        trigger: 'cron',
      }),
      9,
      expect.objectContaining({
        priority: 'high',
        maxRetries: 1,
        taskId: `openclaw-report-send-cron:9:${TODAY}`,
      })
    )
    expect(storeFns.createStrategyRun).not.toHaveBeenCalled()
  })

  it('treats legacy cron task payload as analyze-only task', async () => {
    const result = await executeOpenclawStrategy(buildTask({
      userId: 9,
      mode: 'auto',
      trigger: 'cron',
    }))

    expect(result.success).toBe(true)
    expect(recommendationFns.getStrategyRecommendations).toHaveBeenCalledTimes(1)
    expect(storeFns.createStrategyRun).not.toHaveBeenCalled()
  })

  it('skips analyze task when strategy is disabled', async () => {
    configFns.getOpenclawStrategyConfig.mockResolvedValue({
      enabled: false,
      cron: '0 9 * * *',
    })

    const result = await executeOpenclawStrategy(buildTask({
      userId: 9,
      mode: 'auto',
      trigger: 'cron',
      kind: 'analyze_recommendations',
    }))

    expect(result.success).toBe(true)
    expect(result.skipped).toBe(true)
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
    expect(storeFns.createStrategyRun).not.toHaveBeenCalled()
  })

  it('skips analyze task when strategy center gate is disabled', async () => {
    dbFns.db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT is_active, package_expires_at FROM users')) {
        return { is_active: 1, package_expires_at: null }
      }
      if (sql.includes('SELECT strategy_center_enabled FROM users')) {
        return { strategy_center_enabled: 0 }
      }
      return null
    })

    const result = await executeOpenclawStrategy(buildTask({
      userId: 9,
      mode: 'auto',
      trigger: 'cron',
      kind: 'analyze_recommendations',
    }))

    expect(result.success).toBe(true)
    expect(result.skipped).toBe(true)
    expect(recommendationFns.getStrategyRecommendations).not.toHaveBeenCalled()
    expect(storeFns.createStrategyRun).not.toHaveBeenCalled()
  })
})
