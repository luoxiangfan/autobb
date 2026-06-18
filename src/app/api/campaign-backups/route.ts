import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { listCampaignBackups } from '@/lib/campaign/server'

/**
 * GET /api/campaign-backups
 * 获取广告系列备份列表
 */
export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId
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

    const {
      backups,
      total,
      limit: appliedLimit,
      offset: appliedOffset,
    } = await listCampaignBackups({
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
    return NextResponse.json({ error: error.message || '获取失败' }, { status: 500 })
  }
})
