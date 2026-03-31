import { NextRequest, NextResponse } from 'next/server'
import { getAffiliateProductSyncRuns, getYeahPromosSyncMonitor } from '@/lib/affiliate-products'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userIdRaw = request.headers.get('x-user-id')
    if (!userIdRaw) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = Number(userIdRaw)
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const limit = Number(request.nextUrl.searchParams.get('limit') || '20')
    const [runs, ypMonitor] = await Promise.all([
      getAffiliateProductSyncRuns(userId, limit),
      getYeahPromosSyncMonitor(userId),
    ])

    return NextResponse.json({
      success: true,
      runs,
      ypMonitor,
    })
  } catch (error: any) {
    console.error('[GET /api/products/sync-runs] failed:', error)
    return NextResponse.json(
      { error: error?.message || '获取同步记录失败' },
      { status: 500 }
    )
  }
}
