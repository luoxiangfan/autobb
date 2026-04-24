import { NextRequest, NextResponse } from 'next/server'
import { listCampaignBackups, getLatestBackupForOffer } from '@/lib/campaign-backups'

/**
 * GET /api/campaign-backups
 * 获取广告系列备份列表
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户 ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const offerId = searchParams.get('offerId')
    const backupSource = searchParams.get('backupSource') as 'autoads' | 'google_ads' | undefined
    const backupVersion = searchParams.get('backupVersion')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')

    const filters: any = {
      userId: parseInt(userId, 10),
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    }

    if (offerId) {
      filters.offerId = parseInt(offerId, 10)
    }

    if (backupSource) {
      filters.backupSource = backupSource
    }

    if (backupVersion) {
      filters.backupVersion = parseInt(backupVersion, 10)
    }

    const { backups, total } = await listCampaignBackups(filters)

    return NextResponse.json({
      success: true,
      backups,
      total,
      limit: filters.limit,
      offset: filters.offset,
    })
  } catch (error: any) {
    console.error('获取备份列表失败:', error)
    return NextResponse.json(
      { error: error.message || '获取备份列表失败' },
      { status: 500 }
    )
  }
}
