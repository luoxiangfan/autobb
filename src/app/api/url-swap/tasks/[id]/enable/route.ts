// POST /api/url-swap/tasks/[id]/enable - 启用任务

import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getUrlSwapTaskById, enableUrlSwapTask } from '@/lib/url-swap'
import { triggerUrlSwapScheduling } from '@/lib/url-swap/url-swap-scheduler'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST - 启用任务
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized', message: '未登录' }, { status: 401 })
    }

    // 验证任务存在
    const existingTask = await getUrlSwapTaskById(id, userId)
    if (!existingTask) {
      return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
    }

    // 检查状态
    if (existingTask.status === 'enabled') {
      return NextResponse.json(
        { error: 'invalid_state', message: '任务已经是启用状态' },
        { status: 400 }
      )
    }

    // 启用任务
    await enableUrlSwapTask(id, userId)

    // 立即触发调度
    const result = await triggerUrlSwapScheduling(id)

    console.log(`[url-swap] 启用任务成功: ${id}, result: ${result.status}`)

    return NextResponse.json({
      success: true,
      message: '任务已启用',
      scheduling: result,
    })
  } catch (error: any) {
    console.error('[url-swap] 启用任务失败:', error)
    return NextResponse.json(
      { error: 'internal_error', message: '启用任务失败: ' + error.message },
      { status: 500 }
    )
  }
}
