import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { clearAllAffiliateProducts } from '@/lib/affiliate/products'
import { invalidateOfferCache } from '@/lib/common/server'
import { invalidateProductListCache } from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/gateway/request-auth'

export const POST = withAuth(async (_request, user) => {
  try {
    const userId = user.userId

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
    return NextResponse.json({ error: error?.message || '清空商品失败' }, { status: 500 })
  }
})
