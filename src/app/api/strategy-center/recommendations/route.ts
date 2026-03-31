import { NextRequest, NextResponse } from 'next/server'
import { resolveStrategyCenterRequestUser } from '@/lib/openclaw/request-auth'
import { formatOpenclawLocalDate, normalizeOpenclawReportDate } from '@/lib/openclaw/report-date'
import {
  getStrategyRecommendations,
  persistStrategyRecommendationExecutionRuntime,
} from '@/lib/openclaw/strategy-recommendations'
import { refreshOpenclawDailyReportSnapshot } from '@/lib/openclaw/reports'
import { getOpenclawSettingsMap } from '@/lib/openclaw/settings'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'

export const dynamic = 'force-dynamic'
const STRATEGY_QUEUE_TASK_MISS_THRESHOLD = 3

function parseBooleanParam(value: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function parseLimitParam(value: unknown, fallback = 100): number {
  if (value === null || value === undefined) return fallback
  const raw = String(value).trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), 200)
}

function parseReportDateParam(value: unknown): string | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('date 参数格式错误，应为 YYYY-MM-DD')
  }
  return raw
}

function parseExecutionResultObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, any>) }
}

function toIsoTimestampFromEpoch(value: unknown): string | null {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return new Date(num).toISOString()
}

async function hydrateStrategyQueueRuntime(params: {
  userId: number
  recommendations: Array<any>
}): Promise<Array<any>> {
  const recommendations = params.recommendations
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return recommendations
  }

  const candidates = recommendations
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const queueTaskId = String(item?.executionResult?.queueTaskId || '').trim()
      return item?.status !== 'executed' && Boolean(queueTaskId)
    })
    .slice(0, 20)

  if (candidates.length === 0) {
    return recommendations
  }

  const queue = getQueueManagerForTaskType('openclaw-strategy')
  await queue.initialize().catch(() => null)
  const hydratedByIndex = new Map<number, any>()
  const runtimeUpdates: Array<{ recommendationId: string; executionResult: Record<string, any> }> = []

  await Promise.all(
    candidates.map(async ({ item, index }) => {
      const recommendationId = String(item?.id || '').trim()
      const queueTaskId = String(item?.executionResult?.queueTaskId || '').trim()
      if (!queueTaskId) return
      const executionResult = parseExecutionResultObject(item.executionResult)
      const task = await queue.getTask(queueTaskId).catch(() => null)
      if (!task) {
        const rawMissCount = Number(executionResult.queueTaskMissCount)
        const currentMissCount = Number.isFinite(rawMissCount) && rawMissCount >= 0
          ? Math.floor(rawMissCount)
          : 0
        const nextMissCount = currentMissCount + 1
        const exceededMissThreshold = nextMissCount >= STRATEGY_QUEUE_TASK_MISS_THRESHOLD
        const nextExecutionResult = {
          ...executionResult,
          queueTaskMissCount: nextMissCount,
          queueTaskStatus: exceededMissThreshold
            ? 'unknown'
            : String(executionResult.queueTaskStatus || 'pending'),
          queueTaskError: exceededMissThreshold
            ? (executionResult.queueTaskError || '队列任务不存在或已过期，请重新执行建议')
            : executionResult.queueTaskError || null,
          queueUpdatedAt: new Date().toISOString(),
          queued: exceededMissThreshold ? false : true,
        }
        hydratedByIndex.set(index, {
          ...item,
          executionResult: nextExecutionResult,
        })
        if (recommendationId) {
          runtimeUpdates.push({
            recommendationId,
            executionResult: nextExecutionResult,
          })
        }
        return
      }
      const taskStatus = String(task.status || executionResult.queueTaskStatus || '')
      const nextExecutionResult = {
        ...executionResult,
        queueTaskStatus: taskStatus || executionResult.queueTaskStatus || 'pending',
        queueTaskMissCount: 0,
        queueRetryCount:
          typeof task.retryCount === 'number'
            ? task.retryCount
            : executionResult.queueRetryCount,
        queueTaskError: task.error || null,
        queueTaskCreatedAt:
          toIsoTimestampFromEpoch(task.createdAt)
          || executionResult.queueTaskCreatedAt
          || null,
        queueTaskStartedAt:
          toIsoTimestampFromEpoch(task.startedAt)
          || executionResult.queueTaskStartedAt
          || null,
        queueUpdatedAt: new Date().toISOString(),
        queued: taskStatus === 'pending' || taskStatus === 'running',
      }
      hydratedByIndex.set(index, {
        ...item,
        executionResult: nextExecutionResult,
      })
      if (recommendationId) {
        runtimeUpdates.push({
          recommendationId,
          executionResult: nextExecutionResult,
        })
      }
    })
  )

  if (runtimeUpdates.length > 0) {
    const uniqueUpdates = new Map<string, Record<string, any>>()
    for (const item of runtimeUpdates) {
      uniqueUpdates.set(item.recommendationId, item.executionResult)
    }
    await Promise.allSettled(
      Array.from(uniqueUpdates.entries()).map(async ([recommendationId, executionResult]) => {
        await persistStrategyRecommendationExecutionRuntime({
          userId: params.userId,
          recommendationId,
          executionResult,
        })
      })
    )
  }

  if (hydratedByIndex.size === 0) {
    return recommendations
  }

  return recommendations.map((item, index) => hydratedByIndex.get(index) || item)
}

export async function GET(request: NextRequest) {
  const auth = await resolveStrategyCenterRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: '策略中心功能未开启或未授权' }, { status: 403 })
  }

  let reportDate: string | undefined
  try {
    reportDate = parseReportDateParam(request.nextUrl.searchParams.get('date'))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'date 参数不合法' }, { status: 400 })
  }
  const forceRefresh = parseBooleanParam(request.nextUrl.searchParams.get('refresh'))
  const limit = parseLimitParam(request.nextUrl.searchParams.get('limit'), 100)
  const normalizedReportDate = normalizeOpenclawReportDate(reportDate)
  const serverDate = formatOpenclawLocalDate(new Date())
  const isHistoricalDate = normalizedReportDate < serverDate
  if (forceRefresh && isHistoricalDate) {
    return NextResponse.json(
      {
        error: `历史日期 ${normalizedReportDate} 仅支持查看，不支持重新分析。请切换到 ${serverDate}`,
        code: 'HISTORICAL_READONLY',
        reportDate: normalizedReportDate,
        serverDate,
      },
      { status: 400 }
    )
  }

  try {
    const recommendationsRaw = await getStrategyRecommendations({
      userId: auth.userId,
      reportDate: normalizedReportDate,
      forceRefresh,
      limit,
    })
    const recommendations = await hydrateStrategyQueueRuntime({
      userId: auth.userId,
      recommendations: recommendationsRaw,
    })

    return NextResponse.json({
      success: true,
      reportDate: normalizedReportDate,
      serverDate,
      historicalReadOnly: isHistoricalDate,
      recommendations,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '加载策略建议失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await resolveStrategyCenterRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: '策略中心功能未开启或未授权' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as {
    date?: string
    limit?: number
  }
  let reportDate: string | undefined
  try {
    reportDate = parseReportDateParam(body.date)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'date 参数不合法' }, { status: 400 })
  }
  const limit = parseLimitParam(body.limit, 100)
  const normalizedReportDate = normalizeOpenclawReportDate(reportDate)
  const serverDate = formatOpenclawLocalDate(new Date())
  const isHistoricalDate = normalizedReportDate < serverDate
  if (isHistoricalDate) {
    return NextResponse.json(
      {
        error: `历史日期 ${normalizedReportDate} 仅支持查看，不支持手动触发分析。请切换到 ${serverDate}`,
        code: 'HISTORICAL_READONLY',
        reportDate: normalizedReportDate,
        serverDate,
      },
      { status: 400 }
    )
  }

  try {
    const recommendationsRaw = await getStrategyRecommendations({
      userId: auth.userId,
      reportDate: normalizedReportDate,
      forceRefresh: true,
      limit,
    })
    const recommendations = await hydrateStrategyQueueRuntime({
      userId: auth.userId,
      recommendations: recommendationsRaw,
    })

    const report = await refreshOpenclawDailyReportSnapshot({
      userId: auth.userId,
      date: normalizedReportDate,
    })
    const settings = await getOpenclawSettingsMap(auth.userId)
    const feishuTarget = String(settings.feishu_target || '').trim() || undefined
    const deliveryTaskId = `openclaw-report-send-manual:${auth.userId}:${report.date}`
    let reportSent = true
    let reportSendError: string | null = null
    try {
      const queue = getQueueManagerForTaskType('openclaw-report-send')
      await queue.initialize()
      await queue.enqueue(
        'openclaw-report-send',
        {
          userId: auth.userId,
          target: feishuTarget,
          date: report.date,
          trigger: 'manual',
        },
        auth.userId,
        {
          priority: 'high',
          maxRetries: 1,
          taskId: deliveryTaskId,
          parentRequestId: request.headers.get('x-request-id') || undefined,
        }
      )
    } catch (error: any) {
      reportSent = false
      reportSendError = error?.message || 'Feishu 报告发送任务入队失败'
    }

    return NextResponse.json({
      success: true,
      reportDate: report.date || normalizedReportDate,
      serverDate,
      historicalReadOnly: false,
      recommendations,
      trigger: 'manual',
      reportSent,
      reportSendError,
      reportDeliveryTaskId: deliveryTaskId,
      reportDeliveryMode: 'queued',
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '手动触发策略分析失败' },
      { status: 500 }
    )
  }
}
