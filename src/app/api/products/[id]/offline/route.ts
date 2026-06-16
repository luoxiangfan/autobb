import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { offlineAffiliateProduct } from '@/lib/affiliate/products'
import { invalidateOfferCache } from '@/lib/common/server'
import { invalidateProductListCache } from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

type RouteParams = {
  id: string
}

async function resolveUserAndProductId(request: NextRequest, paramsPromise: Promise<RouteParams>) {
  const authResult = await verifyAuth(request)
  if (!authResult.authenticated || !authResult.user) {
    return { error: NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 }) }
  }
  const userId = authResult.user.userId

  const productManagementEnabled = await isProductManagementEnabledForUser(userId)
  if (!productManagementEnabled) {
    return { error: NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 }) }
  }

  const { id } = await paramsPromise
  const productId = Number(id)
  if (!Number.isFinite(productId) || productId <= 0) {
    return { error: NextResponse.json({ error: '无效的商品ID' }, { status: 400 }) }
  }

  return { userId, productId }
}

export async function POST(request: NextRequest, props: { params: Promise<RouteParams> }) {
  try {
    const resolved = await resolveUserAndProductId(request, props.params)
    if ('error' in resolved) return resolved.error

    const result = await offlineAffiliateProduct({
      userId: resolved.userId,
      productId: resolved.productId,
    })

    invalidateOfferCache(resolved.userId)
    await invalidateProductListCache(resolved.userId)

    if (!result.offlined) {
      return NextResponse.json(
        {
          success: false,
          error: `下线失败：${result.failedOffers.length}/${result.totalLinkedOffers} 个关联Offer删除失败`,
          ...result,
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      message: '商品已下线，关联Offer已删除',
      ...result,
    })
  } catch (error: any) {
    console.error('[POST /api/products/:id/offline] failed:', error)
    return NextResponse.json({ error: error?.message || '下线商品失败' }, { status: 500 })
  }
}
