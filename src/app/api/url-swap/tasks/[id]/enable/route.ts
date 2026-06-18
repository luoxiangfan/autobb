// POST /api/url-swap/tasks/[id]/enable - 启用任务

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapTaskById, enableUrlSwapTask } from '@/lib/url-swap'
import { triggerUrlSwapScheduling } from '@/lib/url-swap/url-swap-scheduler'

export const POST = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const existingTask = await getUrlSwapTaskById(id, user.userId)
  if (!existingTask) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  if (existingTask.status === 'enabled') {
    return NextResponse.json(
      { error: 'invalid_state', message: '任务已经是启用状态' },
      { status: 400 }
    )
  }

  await enableUrlSwapTask(id, user.userId)
  const result = await triggerUrlSwapScheduling(id)

  console.log(`[url-swap] 启用任务成功: ${id}, result: ${result.status}`)

  return NextResponse.json({
    success: true,
    message: '任务已启用',
    scheduling: result,
  })
})
