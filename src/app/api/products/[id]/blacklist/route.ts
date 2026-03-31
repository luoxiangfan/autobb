import { NextRequest, NextResponse } from 'next/server'
import { getAffiliateProductById, setAffiliateProductBlacklist } from '@/lib/affiliate-products'
import { invalidateProductListCache } from '@/lib/products-cache'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

type RouteParams = {
  id: string
}

async function resolveUserAndProductId(request: NextRequest, paramsPromise: Promise<RouteParams>) {
  const userIdRaw = request.headers.get('x-user-id')
  if (!userIdRaw) {
    return { error: NextResponse.json({ error: '未授权' }, { status: 401 }) }
  }

  const userId = Number(userIdRaw)
  if (!Number.isFinite(userId) || userId <= 0) {
    return { error: NextResponse.json({ error: '未授权' }, { status: 401 }) }
  }

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

export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  try {
    const resolved = await resolveUserAndProductId(request, params)
    if ('error' in resolved) return resolved.error

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
    return NextResponse.json(
      { error: error?.message || '拉黑失败' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  try {
    const resolved = await resolveUserAndProductId(request, params)
    if ('error' in resolved) return resolved.error

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
    return NextResponse.json(
      { error: error?.message || '取消拉黑失败' },
      { status: 500 }
    )
  }
}
