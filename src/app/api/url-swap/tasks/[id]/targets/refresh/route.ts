// POST /api/url-swap/tasks/[id]/targets/refresh - 刷新任务目标（回填历史Campaign）

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  getUrlSwapTaskById,
  refreshUrlSwapTaskTargets,
  getUrlSwapTaskTargets,
} from '@/lib/url-swap'

export const POST = withAuth(async (request: NextRequest, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const existingTask = await getUrlSwapTaskById(id, user.userId)
  if (!existingTask) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  let body: { googleAdsAccountId?: number } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const result = await refreshUrlSwapTaskTargets({
    taskId: id,
    userId: user.userId,
    googleAdsAccountId: body.googleAdsAccountId,
  })

  const targets = await getUrlSwapTaskTargets(id, user.userId)

  return NextResponse.json({
    success: true,
    message: `已刷新目标，新增 ${result.inserted} 条`,
    ...result,
    targets,
  })
})
