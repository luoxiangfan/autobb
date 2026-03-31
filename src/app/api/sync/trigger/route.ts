import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { triggerDataSync } from '@/lib/queue-triggers'

/**
 * POST /api/sync/trigger
 * 手动触发数据同步（通过统一队列系统）
 *
 * 🔄 优化 (2025-12-28): 统一使用队列系统，替代直接调用 dataSyncService
 *
 * 优势:
 * - ✅ 统一在 /admin/queue 监控
 * - ✅ 自动重试机制
 * - ✅ 并发控制
 * - ✅ 任务持久化 (Redis)
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 🔄 通过队列系统触发同步（替代直接调用）
    const taskId = await triggerDataSync(userId, {
      syncType: 'manual',
      priority: 'high',  // 手动触发优先级高
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
}
