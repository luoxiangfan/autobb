// POST /api/url-swap/tasks/[id]/swap-now - 立即执行换链（手动触发）

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapTaskById } from '@/lib/url-swap'
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

  if (existingTask.status === 'completed') {
    return NextResponse.json(
      { error: 'invalid_state', message: '已完成的任务无法立即执行' },
      { status: 400 }
    )
  }

  const result = await triggerUrlSwapScheduling(id)

  console.log(`[url-swap] 立即执行换链: ${id}, result: ${result.status}`)

  return NextResponse.json({
    success: true,
    scheduling: result,
    message: result.status === 'queued' ? '任务已加入队列' : result.message,
  })
})
