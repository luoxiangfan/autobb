/**
 * PATCH /api/optimization-tasks/:id - 更新任务状态
 * DELETE /api/optimization-tasks/:id - 删除任务
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { updateTaskStatus } from '@/lib/optimization-tasks'
import { getDatabase } from '@/lib/db'

/**
 * PATCH - 更新任务状态
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const taskId = parseInt(params.id)
    if (isNaN(taskId)) {
      return NextResponse.json(
        { error: 'Invalid task ID' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { status, note } = body

    // 验证status
    if (!['in_progress', 'completed', 'dismissed'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      )
    }

    // 更新任务
    const updated = await updateTaskStatus(taskId, auth.user!.userId, status, note)

    if (!updated) {
      return NextResponse.json(
        { error: 'Task not found or no permission' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Task updated successfully'
    })

  } catch (error) {
    console.error('Update task error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE - 删除任务
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const taskId = parseInt(params.id)
    if (isNaN(taskId)) {
      return NextResponse.json(
        { error: 'Invalid task ID' },
        { status: 400 }
      )
    }

    const db = await getDatabase()
    const result = await db.exec(`
      DELETE FROM optimization_tasks
      WHERE id = ? AND user_id = ?
    `, [taskId, auth.user!.userId])

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Task not found or no permission' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Task deleted successfully'
    })

  } catch (error) {
    console.error('Delete task error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
