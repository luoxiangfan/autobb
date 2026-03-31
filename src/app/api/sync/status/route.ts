import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { dataSyncService } from '@/lib/data-sync-service'

// 强制动态渲染（使用了request.cookies）
export const dynamic = 'force-dynamic'

/**
 * GET /api/sync/status
 * 获取当前用户的数据同步状态
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取同步状态
    const status = dataSyncService.getSyncStatus(userId)

    return NextResponse.json({
      success: true,
      data: {
        isRunning: status.isRunning,
        lastSyncAt: status.lastSyncAt,
        nextSyncAt: status.nextSyncAt,
        lastSyncDuration: status.lastSyncDuration,
        lastSyncRecordCount: status.lastSyncRecordCount,
        lastSyncError: status.lastSyncError,
      },
    })
  } catch (error) {
    console.error('获取同步状态失败:', error)
    return NextResponse.json(
      {
        error: '获取同步状态失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
