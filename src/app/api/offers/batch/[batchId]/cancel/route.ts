/**
 * POST /api/offers/batch/[batchId]/cancel
 *
 * 取消批量Offer创建任务
 *
 * 功能：
 * 1. 验证用户权限（只能取消自己的任务）
 * 2. 检查任务状态（只能取消pending/running状态）
 * 3. 更新batch_tasks状态为cancelled
 * 4. 同步更新upload_records状态
 * 5. 从队列中移除未执行的子任务
 *
 * 使用场景：
 * - 代理质量差导致大量失败
 * - 上传错误的CSV文件
 * - 用户主动停止任务
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'

export const maxDuration = 30

interface CancelRequest {
  reason?: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { batchId: string } }
) {
  const db = getDatabase()
  const queue = getQueueManager()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    // 1. 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 2. 获取批量任务信息
    const { batchId } = params
    const task = await db.queryOne<{
      id: string
      user_id: number
      status: string
      total_count: number
      completed_count: number
      failed_count: number
    }>('SELECT id, user_id, status, total_count, completed_count, failed_count FROM batch_tasks WHERE id = ?', [batchId])

    if (!task) {
      return NextResponse.json(
        { error: 'Not found', message: '批量任务不存在' },
        { status: 404 }
      )
    }

    // 3. 验证权限
    if (task.user_id !== userIdNum) {
      return NextResponse.json(
        { error: 'Forbidden', message: '无权取消该任务' },
        { status: 403 }
      )
    }

    // 4. 检查状态（只能取消pending/running状态）
    if (task.status !== 'pending' && task.status !== 'running') {
      return NextResponse.json(
        {
          error: 'Invalid status',
          message: `任务状态为${task.status}，无法取消`,
          currentStatus: task.status
        },
        { status: 400 }
      )
    }

    // 5. 解析取消原因
    let reason = '用户主动取消'
    try {
      const body = await req.json() as CancelRequest
      if (body.reason) {
        reason = body.reason
      }
    } catch {
      // 如果没有提供body，使用默认原因
    }

    // 6. 更新batch_tasks状态
    await db.exec(`
      UPDATE batch_tasks
      SET
        status = 'cancelled',
        cancelled_at = ${nowFunc},
        cancelled_by = ?,
        cancellation_reason = ?,
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [userIdNum, reason, batchId])

    console.log(`❌ 批量任务已取消: ${batchId} (原因: ${reason})`)

    // 7. 同步更新upload_records状态
    await db.exec(`
      UPDATE upload_records
      SET
        status = 'cancelled',
        updated_at = ${nowFunc}
      WHERE batch_id = ? AND status IN ('pending', 'processing')
    `, [batchId])

    // 8. 从队列中移除未执行的子任务
    let cancelledTaskCount = 0
    try {
      // 获取队列管理器
      await queue.initialize()

      // 取消批量任务相关的所有子任务
      cancelledTaskCount = await queue.cancelBatchTasks(batchId)

      console.log(`🚫 已从队列移除 ${cancelledTaskCount} 个子任务`)
    } catch (queueError: any) {
      console.error('❌ 队列取消失败（任务可能仍会继续执行）:', queueError)
      // 不阻塞取消操作，继续返回
    }

    // 9. 返回取消结果
    const processedCount = task.completed_count + task.failed_count
    const remainingCount = task.total_count - processedCount

    return NextResponse.json({
      success: true,
      message: '批量任务已取消',
      batchId,
      stats: {
        total: task.total_count,
        completed: task.completed_count,
        failed: task.failed_count,
        cancelled: remainingCount,
        cancelledFromQueue: cancelledTaskCount
      }
    })

  } catch (error: any) {
    console.error('❌ 取消批量任务失败:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '取消批量任务失败'
      },
      { status: 500 }
    )
  }
}
