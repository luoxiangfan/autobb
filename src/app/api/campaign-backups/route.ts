import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { listCampaignBackups } from '@/lib/campaign-backups'

/**
 * GET /api/campaign-backups
 * 获取广告系列备份列表
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)

    const startDate = searchParams.get('startDate') || undefined
    const endDate = searchParams.get('endDate') || undefined
    const backupSourceParam = searchParams.get('backupSource')
    const backupSource =
      backupSourceParam === 'autoads' || backupSourceParam === 'google_ads'
        ? backupSourceParam
        : undefined
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const { backups, total, limit: appliedLimit, offset: appliedOffset } =
      await listCampaignBackups({
        userId,
        startDate,
        endDate,
        backupSource,
        limit,
        offset,
        withOfferInfo: true,
      })

    return NextResponse.json({
      success: true,
      backups,
      total,
      limit: appliedLimit,
      offset: appliedOffset,
    })
  } catch (error: any) {
    console.error('获取备份列表失败:', error)
    return NextResponse.json(
      { error: error.message || '获取失败' },
      { status: 500 }
    )
  }
}
