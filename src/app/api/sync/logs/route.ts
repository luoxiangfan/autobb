import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { dataSyncService } from '@/lib/campaign/server'

/**
 * GET /api/sync/logs
 * 获取数据同步日志
 * Query参数: limit (可选，默认20)
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20', 10)

    const logs = await dataSyncService.getSyncLogs(user.userId, limit)

    return NextResponse.json({
      success: true,
      data: logs,
      total: logs.length,
    })
  } catch (error) {
    console.error('获取同步日志失败:', error)
    return NextResponse.json(
      {
        error: '获取同步日志失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
})
