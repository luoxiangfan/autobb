import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { triggerDataSync } from '@/lib/queue/queue-triggers'

/**
 * POST /api/sync/trigger
 * 手动触发数据同步（通过统一队列系统）
 */
export const POST = withAuth(async (_request, user) => {
  try {
    const taskId = await triggerDataSync(user.userId, {
      syncType: 'manual',
      priority: 'high',
    })

    return NextResponse.json({
      success: true,
      message: '数据同步任务已加入队列',
      taskId,
      status: 'queued',
    })
  } catch (error) {
    console.error('触发数据同步失败:', error)
    return NextResponse.json(
      {
        error: '触发数据同步失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
})
