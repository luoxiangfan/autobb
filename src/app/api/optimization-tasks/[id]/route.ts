/**
 * PATCH /api/optimization-tasks/:id - 更新任务状态
 * DELETE /api/optimization-tasks/:id - 删除任务
 */

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { updateTaskStatus } from '@/lib/campaign/optimization'
import { getDatabase } from '@/lib/db'

/**
 * PATCH - 更新任务状态
 */
export const PATCH = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const taskId = parseInt(id, 10)
    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const body = await request.json()
    const { status, note } = body

    if (!['in_progress', 'completed', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const updated = await updateTaskStatus(taskId, user.userId, status, note)

    if (!updated) {
      return NextResponse.json({ error: 'Task not found or no permission' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Task updated successfully',
    })
  } catch (error) {
    console.error('Update task error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

/**
 * DELETE - 删除任务
 */
export const DELETE = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const taskId = parseInt(id, 10)
    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const db = await getDatabase()
    const result = await db.exec(
      `
      DELETE FROM optimization_tasks
      WHERE id = ? AND user_id = ?
    `,
      [taskId, user.userId]
    )

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Task not found or no permission' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Task deleted successfully',
    })
  } catch (error) {
    console.error('Delete task error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
