import { NextRequest, NextResponse } from 'next/server'
import { clearAllAffiliateProducts } from '@/lib/affiliate-products'
import { invalidateOfferCache } from '@/lib/api-cache'
import { invalidateProductListCache } from '@/lib/products-cache'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

export async function POST(request: NextRequest) {
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

    const result = await clearAllAffiliateProducts(userId)
    invalidateOfferCache(userId)
    await invalidateProductListCache(userId)

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
    })
  } catch (error: any) {
    console.error('[POST /api/products/clear] failed:', error)
    return NextResponse.json(
      { error: error?.message || '清空商品失败' },
      { status: 500 }
    )
  }
}
