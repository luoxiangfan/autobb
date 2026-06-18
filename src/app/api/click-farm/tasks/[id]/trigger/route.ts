// POST /api/click-farm/tasks/[id]/trigger - 手动触发任务立即执行

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { enqueueClickFarmTriggerRequest } from '@/lib/click-farm/click-farm-scheduler-trigger'
import { getDatabase } from '@/lib/db'
import { getQueueManagerForTaskType } from '@/lib/queue'
import { getQueueRoutingDiagnostics } from '@/lib/queue/queue-routing'
import {
  getBackgroundWorkerHeartbeatKey,
  isBackgroundWorkerAlive,
} from '@/lib/queue/background-worker-heartbeat'
import { getHeapStatistics } from 'v8'

const CLICK_FARM_TRIGGER_HEAP_PRESSURE_PCT = (() => {
  const value = parseFloat(
    process.env.CLICK_FARM_TRIGGER_HEAP_PRESSURE_PCT ||
      process.env.CLICK_FARM_HEAP_PRESSURE_PCT ||
      '75'
  )
  if (!Number.isFinite(value)) return 75
  return Math.min(95, Math.max(50, value))
})()

function getHeapUsagePercent(): number | null {
  try {
    const heapUsed = process.memoryUsage().heapUsed
    const limit = getHeapStatistics().heap_size_limit
    if (!limit || limit <= 0) return null
    return (heapUsed / limit) * 100
  } catch {
    return null
  }
}

export const POST = withAuth(async (request: NextRequest, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  console.log(`[API] 手动触发任务 ${id} 执行`)

  const queueManager = getQueueManagerForTaskType('click-farm-trigger')
  await queueManager.ensureInitialized()

  const queueInfo = queueManager.getRuntimeInfo()
  const enforceRedis =
    process.env.NODE_ENV === 'production' &&
    process.env.CLICK_FARM_REQUIRE_REDIS_IN_PRODUCTION !== 'false'

  if (enforceRedis && queueInfo.adapter === 'MemoryQueueAdapter') {
    return NextResponse.json(
      {
        success: false,
        error: 'queue_unavailable',
        message: '队列后端暂不可用（Redis未就绪），已拒绝立即触发，请稍后重试',
      },
      { status: 503 }
    )
  }

  const routingDiagnostics = getQueueRoutingDiagnostics()
  if (routingDiagnostics.splitEnabled) {
    let backgroundAlive = false
    try {
      backgroundAlive = await isBackgroundWorkerAlive()
    } catch (error) {
      console.warn('[API] 检查背景Worker心跳失败:', error)
      backgroundAlive = false
    }
    if (!backgroundAlive) {
      return NextResponse.json(
        {
          success: false,
          error: 'worker_unavailable',
          message: '后台Worker未就绪，暂时无法立即触发，请稍后重试',
          heartbeatKey: getBackgroundWorkerHeartbeatKey(),
        },
        { status: 503 }
      )
    }
  }

  const heapUsagePercent = getHeapUsagePercent()
  if (heapUsagePercent !== null && heapUsagePercent >= CLICK_FARM_TRIGGER_HEAP_PRESSURE_PCT) {
    return NextResponse.json(
      {
        success: false,
        error: 'server_busy',
        message: `服务器内存压力过高(${heapUsagePercent.toFixed(1)}%)，已拒绝立即触发，请稍后重试`,
      },
      { status: 503 }
    )
  }

  const db = getDatabase()
  const nowSql = 'NOW()'
  const oneHourAgoSql = "NOW() - INTERVAL '1 hour'"
  const updated = await db.exec(
    `
      UPDATE click_farm_tasks
      SET next_run_at = ${oneHourAgoSql}, updated_at = ${nowSql}
      WHERE id = ? AND user_id = ?
    `,
    [id, user.userId]
  )

  if (updated.changes === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'not_found',
        message: '任务不存在或无权限触发',
      },
      { status: 404 }
    )
  }

  console.log(`[API] 已设置任务 ${id} 的 next_run_at 为过去时间，准备异步触发`)

  const requestId = request.headers.get('x-request-id') || undefined
  const trigger = await enqueueClickFarmTriggerRequest({
    clickFarmTaskId: id,
    userId: user.userId,
    source: 'manual',
    priority: 'high',
    parentRequestId: requestId,
  })

  return NextResponse.json(
    {
      success: true,
      accepted: true,
      message: '触发请求已入队，系统将异步调度点击批次',
      data: {
        taskId: id,
        queueTaskId: trigger.queueTaskId,
        status: 'accepted',
      },
    },
    { status: 202 }
  )
})
