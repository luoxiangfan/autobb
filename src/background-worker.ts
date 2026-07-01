/**
 * Background Queue Worker (非核心任务)
 *
 * 目标
 * 将 click-farm / url-swap 等非核心任务放到独立进程执行
 * 通过独立 Redis key prefix 隔离 pending/running 集合，避免与核心任务互相争抢
 *
 * 运行方式（生产建议由 supervisord 管理）
 * `QUEUE_BACKGROUND_WORKER=1 node dist/background-worker.js`
 */

import { getBackgroundQueueManager } from './lib/queue/unified-queue-manager'
import { registerBackgroundExecutors } from './lib/queue/executors/background-executors'
import type { QueueConfig } from './lib/queue/types'
import { getDatabase } from './lib/db/database'
import { getQueueRoutingDiagnostics } from './lib/queue/queue-routing'
import { logger } from './lib/common/structured-logger'
import { queueVerboseLog } from './lib/queue/queue-log'
import {
  setBackgroundWorkerHeartbeat,
  getBackgroundWorkerHeartbeatKey,
  getBackgroundWorkerHeartbeatTtlSeconds,
} from './lib/queue/background-worker-heartbeat'
import { getHeapStatistics } from 'v8'
import { parseBooleanEnv } from './lib/common/parse-env'
function parsePositiveIntEnv(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

async function detectClickFarmStall(overdueMinutes: number): Promise<number> {
  const db = await getDatabase()
  const minutes = Math.max(1, Math.floor(overdueMinutes))

  const query = `
      SELECT COUNT(*)::int AS count
      FROM click_farm_tasks
      WHERE status IN ('pending', 'running')
        AND is_deleted = false
        AND next_run_at <= CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes'
    `

  const row = await db.queryOne<{ count?: number | string }>(query)
  return Number(row?.count || 0)
}

async function loadQueueConfigFromDB(): Promise<Partial<QueueConfig> | null> {
  try {
    const db = await getDatabase()
    const row = await db.queryOne<{ value: string }>(`
      SELECT value FROM system_settings
      WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
      LIMIT 1
    `)
    if (!row?.value) return null

    const parsed = JSON.parse(row.value) as Partial<QueueConfig>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    console.warn(
      '⚠️ Background worker: failed to load queue config from DB, using defaults/env:',
      error
    )
    return null
  }
}

async function main() {
  queueVerboseLog('background_worker_boot', getQueueRoutingDiagnostics())
  const heapLimitMb = Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024)
  queueVerboseLog('background_worker_runtime', {
    pid: process.pid,
    heapLimitMb,
    nodeOptions: process.env.NODE_OPTIONS || null,
  })

  const queue = getBackgroundQueueManager({
    // worker 进程：不依赖 enqueue 自动 start，避免误触发全量执行器注册
    autoStartOnEnqueue: false,
  })

  const dbConfig = await loadQueueConfigFromDB()
  if (dbConfig) {
    queue.updateConfig(dbConfig)
  }

  await queue.initialize()
  queueVerboseLog('queue_runtime_status', {
    ...queue.getRuntimeInfo(),
    ...getQueueRoutingDiagnostics(),
  })
  registerBackgroundExecutors(queue)
  // 标记“执行器已注册”，避免后续 ensureStarted() 触发全量注册
  queue.registerAllExecutors()

  await queue.start()
  logger.debug('background_worker_started')

  const heartbeatKey = getBackgroundWorkerHeartbeatKey()
  const heartbeatTtl = getBackgroundWorkerHeartbeatTtlSeconds()
  const sendHeartbeat = async () => {
    const ok = await setBackgroundWorkerHeartbeat({
      instanceId: process.env.HOSTNAME || process.env.INSTANCE_ID,
      pid: process.pid,
      env: process.env.NODE_ENV || 'development',
      ts: new Date().toISOString(),
    })
    if (!ok) {
      logger.warn('background_worker_heartbeat_failed', { heartbeatKey })
    }
  }
  await sendHeartbeat()
  const heartbeatTimer = setInterval(
    sendHeartbeat,
    Math.max(1000, Math.floor((heartbeatTtl * 1000) / 3))
  )
  heartbeatTimer.unref?.()

  const clickFarmSelfHealEnabled = parseBooleanEnv(process.env.CLICK_FARM_SELF_HEAL_ENABLED, true)
  const clickFarmSelfHealIntervalMs = parsePositiveIntEnv(
    process.env.CLICK_FARM_SELF_HEAL_INTERVAL_MS,
    5 * 60 * 1000
  )
  const clickFarmSelfHealOverdueMinutes = parsePositiveIntEnv(
    process.env.CLICK_FARM_SELF_HEAL_OVERDUE_MINUTES,
    20
  )
  let clickFarmSelfHealRunning = false

  const runClickFarmSelfHeal = async (source: 'startup' | 'interval') => {
    if (!clickFarmSelfHealEnabled || clickFarmSelfHealRunning) return
    clickFarmSelfHealRunning = true
    try {
      const stalledCount = await detectClickFarmStall(clickFarmSelfHealOverdueMinutes)
      if (stalledCount <= 0) return

      const { triggerAllPendingTasks } =
        await import('./lib/click-farm/click-farm-scheduler-trigger')
      const result = await triggerAllPendingTasks()
      logger.warn('background_click_farm_self_heal_triggered', {
        source,
        stalledCount,
        result,
      })
    } catch (error: any) {
      logger.error('background_click_farm_self_heal_failed', {
        source,
        message: error?.message || String(error),
      })
    } finally {
      clickFarmSelfHealRunning = false
    }
  }

  const inactiveQueueSweepEnabled = parseBooleanEnv(
    process.env.INACTIVE_SOURCE_QUEUE_SWEEP_ENABLED,
    true
  )
  const runInactiveSourceQueueSweep = async (source: 'startup' | 'interval') => {
    if (!inactiveQueueSweepEnabled) return
    try {
      const { sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap } =
        await import('./lib/queue/inactive-source-queue-sweep')
      const sweep = await sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap()
      if (sweep.clickFarmQueueRemoved > 0 || sweep.urlSwapQueueRemoved > 0) {
        queueVerboseLog('background_inactive_source_queue_sweep', { source, ...sweep })
      }
    } catch (error: any) {
      logger.warn('background_inactive_source_queue_sweep_failed', {
        source,
        message: error?.message || String(error),
      })
    }
  }

  if (clickFarmSelfHealEnabled) {
    queueVerboseLog('background_click_farm_self_heal_enabled', {
      intervalMs: clickFarmSelfHealIntervalMs,
      overdueMinutes: clickFarmSelfHealOverdueMinutes,
    })
  }
  if (inactiveQueueSweepEnabled) {
    queueVerboseLog('background_inactive_source_queue_sweep_enabled', {
      intervalMs: clickFarmSelfHealIntervalMs,
    })
  }

  setTimeout(() => {
    if (clickFarmSelfHealEnabled) void runClickFarmSelfHeal('startup')
    if (inactiveQueueSweepEnabled) void runInactiveSourceQueueSweep('startup')
  }, 15_000).unref?.()

  const clickFarmSelfHealTimer = setInterval(() => {
    if (clickFarmSelfHealEnabled) void runClickFarmSelfHeal('interval')
    if (inactiveQueueSweepEnabled) void runInactiveSourceQueueSweep('interval')
  }, clickFarmSelfHealIntervalMs)
  clickFarmSelfHealTimer.unref?.()

  // 可选：定期刷新DB配置（多实例环境下避免配置漂移）
  let lastConfigJson: string | null = dbConfig ? JSON.stringify(dbConfig) : null
  const refreshTimer = setInterval(async () => {
    const latest = await loadQueueConfigFromDB()
    if (!latest) return
    const latestJson = JSON.stringify(latest)
    if (latestJson === lastConfigJson) return
    queue.updateConfig(latest)
    lastConfigJson = latestJson
  }, 60_000)

  const shutdown = async (signal: string) => {
    try {
      logger.debug('background_worker_stopping', { signal })
      clearInterval(refreshTimer)
      clearInterval(heartbeatTimer)
      clearInterval(clickFarmSelfHealTimer)
      await queue.stop()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('❌ Background queue worker failed:', error)
  process.exit(1)
})
