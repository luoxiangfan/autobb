import type { Task } from '../types'
import type { ClickFarmTaskData } from './click-farm-executor'
import type { ClickFarmBatchTaskData } from '@/lib/click-farm/queue-task-types'
import { createDateInTimezone, getDateInTimezone } from '@/lib/timezone-utils'
import { getQueueManagerForTaskType } from '@/lib/queue'
import { getDatabase } from '@/lib/db'
import { getHeapStatistics } from 'v8'

const DEFAULT_BATCH_SIZE = (() => {
  const n = parseInt(process.env.CLICK_FARM_BATCH_SIZE || '10', 10)
  return Number.isFinite(n) && n > 0 ? n : 10
})()

const MAX_BATCH_SIZE = (() => {
  const n = parseInt(process.env.CLICK_FARM_BATCH_SIZE_MAX || '100', 10)
  return Number.isFinite(n) && n > 0 ? n : 100
})()

const NEXT_BATCH_DELAY_MS = (() => {
  const n = parseInt(process.env.CLICK_FARM_BATCH_DELAY_MS || '500', 10)
  return Number.isFinite(n) && n >= 0 ? n : 500
})()

const CLICK_FARM_BATCH_HEAP_PRESSURE_PCT = (() => {
  const n = parseFloat(process.env.CLICK_FARM_BATCH_HEAP_PRESSURE_PCT || '90')
  if (!Number.isFinite(n)) return 90
  return Math.min(95, Math.max(50, n))
})()

function isHeapPressureHigh(): boolean {
  try {
    const heapUsed = process.memoryUsage().heapUsed
    const limit = getHeapStatistics().heap_size_limit
    if (!limit || limit <= 0) return false
    const pct = (heapUsed / limit) * 100
    return pct >= CLICK_FARM_BATCH_HEAP_PRESSURE_PCT
  } catch {
    return false
  }
}

function clampHour(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(23, Math.max(0, Math.floor(n)))
}

function normalizeCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

function normalizeBatchSize(value: unknown): number {
  const n = normalizeCount(value)
  const candidate = n > 0 ? n : DEFAULT_BATCH_SIZE
  return Math.min(MAX_BATCH_SIZE, Math.max(1, candidate))
}

function getBatchTaskId(data: ClickFarmBatchTaskData): string {
  const hour = String(clampHour(data.targetHour)).padStart(2, '0')
  const offset = normalizeCount(data.dispatchedClicks)
  return `click-farm-batch:${data.clickFarmTaskId}:${data.targetDate}:${hour}:${offset}`
}

function toSafeTargetDate(timezone: string, targetDate: unknown): string {
  const date = String(targetDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  return getDateInTimezone(new Date(), timezone)
}

function createRandomScheduledAt(targetDate: string, targetHour: number, timezone: string): string {
  const minute = Math.floor(Math.random() * 60)
  const second = Math.floor(Math.random() * 60)
  return createDateInTimezone(
    targetDate,
    `${String(targetHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    timezone,
    second
  ).toISOString()
}

async function requeueBatchTask(
  task: Task<ClickFarmBatchTaskData>,
  payload: ClickFarmBatchTaskData,
  delayMs: number
): Promise<void> {
  const queue = getQueueManagerForTaskType('click-farm-batch')
  const scheduledAt = new Date(Date.now() + Math.max(0, delayMs)).toISOString()
  await queue.enqueue(
    'click-farm-batch',
    {
      ...payload,
      scheduledAt,
    },
    task.userId,
    {
      priority: 'low',
      maxRetries: 0,
      taskId: getBatchTaskId(payload),
      parentRequestId: task.parentRequestId,
    }
  )
}

export async function executeClickFarmBatchTask(
  task: Task<ClickFarmBatchTaskData>
): Promise<{ dispatched: number; remaining: number; status: 'queued' | 'skipped' }> {
  const clickFarmTaskId = String(task.data?.clickFarmTaskId || '').trim()
  if (!clickFarmTaskId) {
    return { dispatched: 0, remaining: 0, status: 'skipped' }
  }

  const db = getDatabase()
  const row = await db.queryOne<{ status?: string }>(
    `
      SELECT status
      FROM click_farm_tasks
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [clickFarmTaskId, task.userId]
  )

  const taskStatus = String(row?.status || '').toLowerCase()
  if (!row || (taskStatus && taskStatus !== 'pending' && taskStatus !== 'running')) {
    return { dispatched: 0, remaining: 0, status: 'skipped' }
  }

  const totalClicks = normalizeCount(task.data?.totalClicks)
  const dispatchedClicks = normalizeCount(task.data?.dispatchedClicks)
  const remainingBefore = Math.max(0, totalClicks - dispatchedClicks)
  if (remainingBefore <= 0) {
    return { dispatched: 0, remaining: 0, status: 'skipped' }
  }

  const timezone = String(task.data?.timezone || 'America/New_York')
  const targetDate = toSafeTargetDate(timezone, task.data?.targetDate)
  const targetHour = clampHour(task.data?.targetHour)
  const batchSize = normalizeBatchSize(task.data?.batchSize)

  if (isHeapPressureHigh()) {
    const mem = process.memoryUsage()
    const heap = getHeapStatistics()
    const pct = ((mem.heapUsed / heap.heap_size_limit) * 100).toFixed(2)
    console.warn(`[BatchExecutor] 内存压力过高，延迟批次任务`, {
      clickFarmTaskId,
      targetDate,
      targetHour,
      totalClicks,
      dispatchedClicks,
      remaining: remainingBefore,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapLimit: `${(heap.heap_size_limit / 1024 / 1024).toFixed(2)} MB`,
      percentage: `${pct}%`,
      threshold: `${CLICK_FARM_BATCH_HEAP_PRESSURE_PCT}%`,
      delayMs: Math.max(1000, NEXT_BATCH_DELAY_MS)
    })
    await requeueBatchTask(
      task,
      {
        ...task.data,
        clickFarmTaskId,
        timezone,
        targetDate,
        targetHour,
        totalClicks,
        dispatchedClicks,
        batchSize,
      },
      Math.max(1000, NEXT_BATCH_DELAY_MS)
    )
    return { dispatched: 0, remaining: remainingBefore, status: 'skipped' }
  }

  const clickQueue = getQueueManagerForTaskType('click-farm')
  let dispatched = 0
  const chunkSize = Math.min(remainingBefore, batchSize)

  for (let i = 0; i < chunkSize; i++) {
    const clickTaskData: ClickFarmTaskData = {
      taskId: clickFarmTaskId,
      url: task.data.url,
      proxyUrl: task.data.proxyUrl,
      offerId: task.data.offerId,
      timezone,
      scheduledAt: createRandomScheduledAt(targetDate, targetHour, timezone),
      refererConfig: task.data.refererConfig,
    }

    await clickQueue.enqueue('click-farm', clickTaskData, task.userId, {
      priority: 'low',
      maxRetries: 0,
      parentRequestId: task.parentRequestId,
    })
    dispatched += 1
  }

  const newDispatched = dispatchedClicks + dispatched
  const remaining = Math.max(0, totalClicks - newDispatched)

  console.log(`[BatchExecutor] 批次分发完成`, {
    clickFarmTaskId,
    targetDate,
    targetHour,
    totalClicks,
    dispatchedThisBatch: dispatched,
    totalDispatched: newDispatched,
    remaining,
    progress: `${((newDispatched / totalClicks) * 100).toFixed(1)}%`
  })

  if (remaining > 0) {
    await requeueBatchTask(
      task,
      {
        ...task.data,
        clickFarmTaskId,
        timezone,
        targetDate,
        targetHour,
        totalClicks,
        dispatchedClicks: newDispatched,
        batchSize,
      },
      NEXT_BATCH_DELAY_MS
    )
  }

  return { dispatched, remaining, status: 'queued' }
}

