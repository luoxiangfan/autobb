// POST /api/click-farm/tasks/[id]/stop - 暂停任务

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getClickFarmTaskById, stopClickFarmTask } from '@/lib/click-farm'

export const POST = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getClickFarmTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  if (!['pending', 'running', 'paused'].includes(task.status)) {
    return NextResponse.json(
      { error: 'invalid_status', message: '任务当前状态无法暂停' },
      { status: 400 }
    )
  }

  const updatedTask = await stopClickFarmTask(id, user.userId)

  return NextResponse.json({
    success: true,
    data: updatedTask,
    message: '任务已暂停',
  })
})
