// POST /api/url-swap/tasks/[id]/disable - 禁用任务

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapTaskById, disableUrlSwapTask } from '@/lib/url-swap'

export const POST = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const existingTask = await getUrlSwapTaskById(id, user.userId)
  if (!existingTask) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  if (existingTask.status === 'disabled') {
    return NextResponse.json(
      { error: 'invalid_state', message: '任务已经是禁用状态' },
      { status: 400 }
    )
  }

  await disableUrlSwapTask(id, user.userId)

  console.log(`[url-swap] 禁用任务成功: ${id}`)

  return NextResponse.json({
    success: true,
    message: '任务已禁用',
  })
})
