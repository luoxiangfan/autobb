import { withAuth } from '@/lib/auth'
import type { AuthenticatedUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { offlineAffiliateProduct } from '@/lib/affiliate/products'
import { invalidateOfferCache } from '@/lib/common/server'
import { invalidateProductListCache } from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/gateway/request-auth'

type ResolvedProductContext =
  | { ok: true; userId: number; productId: number }
  | { ok: false; response: Response }

async function resolveUserAndProductId(
  user: AuthenticatedUser,
  context?: { params?: Record<string, string> }
): Promise<ResolvedProductContext> {
  const userId = user.userId

  const productManagementEnabled = await isProductManagementEnabledForUser(userId)
  if (!productManagementEnabled) {
    return {
      ok: false,
      response: NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 }),
    }
  }

  const productId = Number(context?.params?.id)
  if (!Number.isFinite(productId) || productId <= 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: '无效的商品ID' }, { status: 400 }),
    }
  }

  return { ok: true, userId, productId }
}

export const POST = withAuth(async (_request, user, context) => {
  try {
    const resolved = await resolveUserAndProductId(user, context)
    if (!resolved.ok) return resolved.response

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
})
