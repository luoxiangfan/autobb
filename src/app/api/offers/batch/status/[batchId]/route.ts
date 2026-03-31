/**
 * GET /api/offers/batch/status/[batchId]
 *
 * 查询批量任务状态
 *
 * 功能：
 * 1. 验证用户身份和任务所有权
 * 2. 返回批量任务状态和进度统计
 * 3. 支持SSE失败后的fallback
 *
 * 返回格式：
 * {
 *   batchId: string
 *   status: 'pending' | 'running' | 'completed' | 'failed' | 'partial'
 *   total_count: number
 *   completed_count: number
 *   failed_count: number
 *   progress: number (0-100)
 *   source_file: string
 *   createdAt: string
 *   updatedAt: string
 *   startedAt?: string
 *   completedAt?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'

interface BatchTask {
  id: string
  user_id: number
  task_type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial'
  total_count: number
  completed_count: number
  failed_count: number
  source_file: string | null
  metadata: unknown
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { batchId: string } }
) {
  const db = getDatabase()
  const { batchId } = params

  try {
    // 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 查询批量任务
    const rows = await db.query<BatchTask>(
      'SELECT * FROM batch_tasks WHERE id = ? AND user_id = ?',
      [batchId, userIdNum]
    )

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'Not found', message: '批量任务不存在或无权访问' },
        { status: 404 }
      )
    }

    const batch = rows[0]

    // 计算进度百分比
    const progress = batch.total_count > 0
      ? Math.round(((batch.completed_count + batch.failed_count) / batch.total_count) * 100)
      : 0

    // 构造响应
    return NextResponse.json({
      batchId: batch.id,
      status: batch.status,
      taskType: batch.task_type,
      totalCount: batch.total_count,
      completedCount: batch.completed_count,
      failedCount: batch.failed_count,
      progress,
      sourceFile: batch.source_file,
      metadata: parseJsonField(batch.metadata, null),
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      startedAt: batch.started_at,
      completedAt: batch.completed_at,
    })

  } catch (error: any) {
    console.error('查询批量任务状态失败:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '查询失败'
      },
      { status: 500 }
    )
  }
}
