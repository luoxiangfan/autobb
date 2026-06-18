import { withAuth } from '@/lib/auth'
import type { AuthenticatedUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getAffiliateProductById, setAffiliateProductBlacklist } from '@/lib/affiliate/products'
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

    const product = await getAffiliateProductById(resolved.userId, resolved.productId)
    if (!product) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 })
    }

    const updated = await setAffiliateProductBlacklist(resolved.userId, resolved.productId, true)
    await invalidateProductListCache(resolved.userId)

    return NextResponse.json({
      success: true,
      message: '已拉黑投放',
      product: updated,
    })
  } catch (error: any) {
    console.error('[POST /api/products/:id/blacklist] failed:', error)
    return NextResponse.json({ error: error?.message || '拉黑失败' }, { status: 500 })
  }
})

export const DELETE = withAuth(async (_request, user, context) => {
  try {
    const resolved = await resolveUserAndProductId(user, context)
    if (!resolved.ok) return resolved.response

    const product = await getAffiliateProductById(resolved.userId, resolved.productId)
    if (!product) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 })
    }

    const updated = await setAffiliateProductBlacklist(resolved.userId, resolved.productId, false)
    await invalidateProductListCache(resolved.userId)

    return NextResponse.json({
      success: true,
      message: '已取消拉黑',
      product: updated,
    })
  } catch (error: any) {
    console.error('[DELETE /api/products/:id/blacklist] failed:', error)
    return NextResponse.json({ error: error?.message || '取消拉黑失败' }, { status: 500 })
  }
})
