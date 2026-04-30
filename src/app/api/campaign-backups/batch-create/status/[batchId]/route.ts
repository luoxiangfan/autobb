import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/campaign-backups/batch-create/status/[batchId]
 * 查询批量创建任务状态（轮询 fallback）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { batchId } = params

    const db = await getDatabase()

    const task = await db.queryOne(`
      SELECT 
        id,
        status,
        total_count,
        completed_count,
        failed_count,
        created_at,
        started_at,
        completed_at,
        metadata
      FROM batch_tasks
      WHERE id = ? AND user_id = ?
    `, [batchId, userId]) as any

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    const progress = task.total_count
      ? Math.round(((task.completed_count || 0) + (task.failed_count || 0)) / task.total_count * 100)
      : 0

    return NextResponse.json({
      batchId: task.id,
      status: task.status,
      total: task.total_count,
      completed: task.completed_count || 0,
      failed: task.failed_count || 0,
      progress,
      createdAt: task.created_at,
      startedAt: task.started_at,
      completedAt: task.completed_at,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    })
  } catch (error: any) {
    console.error('查询任务状态失败:', error)
    return NextResponse.json(
      { error: error.message || '查询失败' },
      { status: 500 }
    )
  }
}
