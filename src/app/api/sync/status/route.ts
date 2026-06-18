import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { dataSyncService } from '@/lib/campaign/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sync/status
 * 获取当前用户的数据同步状态
 */
export const GET = withAuth(async (_request, user) => {
  try {
    const status = dataSyncService.getSyncStatus(user.userId)

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
})
