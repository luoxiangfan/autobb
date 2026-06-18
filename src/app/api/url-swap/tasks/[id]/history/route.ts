// GET /api/url-swap/tasks/[id]/history - 获取换链历史

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapTaskById } from '@/lib/url-swap'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getUrlSwapTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  const history = [...task.swap_history].reverse()

  return NextResponse.json({
    taskId: id,
    history,
    total: history.length,
  })
})
