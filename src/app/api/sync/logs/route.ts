import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { dataSyncService } from '@/lib/data-sync-service'

/**
 * GET /api/sync/logs
 * 获取数据同步日志
 * Query参数: limit (可选，默认20)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20', 10)

    // 获取同步日志
    const logs = await dataSyncService.getSyncLogs(userId, limit)

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
}
