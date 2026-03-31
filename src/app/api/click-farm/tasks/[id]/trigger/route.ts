// POST /api/click-farm/tasks/[id]/trigger - 手动触发任务立即执行
// src/app/api/click-farm/tasks/[id]/trigger/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { enqueueClickFarmTriggerRequest } from '@/lib/click-farm/click-farm-scheduler-trigger';
import { getDatabase } from '@/lib/db';
import { getQueueManagerForTaskType } from '@/lib/queue';
import { getQueueRoutingDiagnostics } from '@/lib/queue/queue-routing';
import { getBackgroundWorkerHeartbeatKey, isBackgroundWorkerAlive } from '@/lib/queue/background-worker-heartbeat';
import { getHeapStatistics } from 'v8';

const CLICK_FARM_TRIGGER_HEAP_PRESSURE_PCT = (() => {
  const value = parseFloat(
    process.env.CLICK_FARM_TRIGGER_HEAP_PRESSURE_PCT ||
    process.env.CLICK_FARM_HEAP_PRESSURE_PCT ||
    '75'
  );
  if (!Number.isFinite(value)) return 75;
  return Math.min(95, Math.max(50, value));
})();

function getHeapUsagePercent(): number | null {
  try {
    const heapUsed = process.memoryUsage().heapUsed;
    const limit = getHeapStatistics().heap_size_limit;
    if (!limit || limit <= 0) return null;
    return (heapUsed / limit) * 100;
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    console.log(`[API] 手动触发任务 ${id} 执行`);

    const queueManager = getQueueManagerForTaskType('click-farm-trigger');
    await queueManager.ensureInitialized();

    const queueInfo = queueManager.getRuntimeInfo();
    const enforceRedis =
      process.env.NODE_ENV === 'production' &&
      process.env.CLICK_FARM_REQUIRE_REDIS_IN_PRODUCTION !== 'false';

    if (enforceRedis && queueInfo.adapter === 'MemoryQueueAdapter') {
      return NextResponse.json(
        {
          success: false,
          error: 'queue_unavailable',
          message: '队列后端暂不可用（Redis未就绪），已拒绝立即触发，请稍后重试'
        },
        { status: 503 }
      );
    }

    const routingDiagnostics = getQueueRoutingDiagnostics();
    if (routingDiagnostics.splitEnabled) {
      let backgroundAlive = false;
      try {
        backgroundAlive = await isBackgroundWorkerAlive();
      } catch (error) {
        console.warn('[API] 检查背景Worker心跳失败:', error);
        backgroundAlive = false;
      }
      if (!backgroundAlive) {
        return NextResponse.json(
          {
            success: false,
            error: 'worker_unavailable',
            message: '后台Worker未就绪，暂时无法立即触发，请稍后重试',
            heartbeatKey: getBackgroundWorkerHeartbeatKey()
          },
          { status: 503 }
        );
      }
    }

    const heapUsagePercent = getHeapUsagePercent();
    if (heapUsagePercent !== null && heapUsagePercent >= CLICK_FARM_TRIGGER_HEAP_PRESSURE_PCT) {
      return NextResponse.json(
        {
          success: false,
          error: 'server_busy',
          message: `服务器内存压力过高(${heapUsagePercent.toFixed(1)}%)，已拒绝立即触发，请稍后重试`
        },
        { status: 503 }
      );
    }

    // 🔧 修复(2026-01-05): 不要清空 next_run_at，这会导致任务在每次 cron job 执行时被重复选中
    // 而是设置为一个过去的值，让任务立即执行一次，然后在 triggerTaskScheduling 中正确更新 next_run_at
    const db = getDatabase();
    const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')";
    const oneHourAgoSql = db.type === 'postgres'
      ? "NOW() - INTERVAL '1 hour'"
      : "datetime('now', '-1 hour')";
    const updated = await db.exec(`
      UPDATE click_farm_tasks
      SET next_run_at = ${oneHourAgoSql}, updated_at = ${nowSql}
      WHERE id = ? AND user_id = ?
    `, [id, parseInt(userId, 10)]);

    if (updated.changes === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'not_found',
          message: '任务不存在或无权限触发'
        },
        { status: 404 }
      );
    }

    console.log(`[API] 已设置任务 ${id} 的 next_run_at 为过去时间，准备异步触发`);

    const requestId = request.headers.get('x-request-id') || undefined;
    const trigger = await enqueueClickFarmTriggerRequest({
      clickFarmTaskId: id,
      userId: parseInt(userId, 10),
      source: 'manual',
      priority: 'high',
      parentRequestId: requestId,
    });

    return NextResponse.json(
      {
        success: true,
        accepted: true,
        message: '触发请求已入队，系统将异步调度点击批次',
        data: {
          taskId: id,
          queueTaskId: trigger.queueTaskId,
          status: 'accepted',
        }
      },
      { status: 202 }
    );

  } catch (error: any) {
    console.error('[API] 触发任务失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: '触发任务失败',
        message: error.message
      },
      { status: 500 }
    );
  }
}
