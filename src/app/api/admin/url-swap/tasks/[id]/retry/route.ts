// POST /api/admin/url-swap/tasks/[id]/retry - 管理员重试失败任务

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapTaskById, updateTaskStatus } from '@/lib/url-swap'
import { triggerUrlSwapScheduling } from '@/lib/url-swap/url-swap-scheduler'

export const POST = withAuth(
  async (_request, _user, context) => {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json(
        { error: 'validation_error', message: '缺少任务 ID' },
        { status: 400 }
      )
    }

    const existingTask = await getUrlSwapTaskById(id, 0)
    if (!existingTask) {
      return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
    }

    if (existingTask.status !== 'error') {
      return NextResponse.json(
        { error: 'invalid_state', message: '只有错误状态的任务可以重试' },
        { status: 400 }
      )
    }

    await updateTaskStatus(id, 'enabled')
    const result = await triggerUrlSwapScheduling(id)

    console.log(`[admin/url-swap] 重试任务: ${id}, result: ${result.status}`)

    return NextResponse.json({
      success: true,
      scheduling: result,
      message: result.status === 'queued' ? '任务已重新加入队列' : result.message,
    })
  },
  { requireAdmin: true }
)
