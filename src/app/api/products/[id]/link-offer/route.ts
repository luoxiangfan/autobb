import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/common/server'
import { linkOfferToAffiliateProduct } from '@/lib/affiliate/products'
import { invalidateProductListCache } from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

const bodySchema = z.object({
  offerId: z.number().int(zErr.int).positive(zErr.positiveInt),
})

type RouteParams = {
  id: string
}

export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const { id } = await params
    const productId = Number(id)
    if (!Number.isFinite(productId) || productId <= 0) {
      return NextResponse.json({ error: '无效的商品ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 }
      )
    }

    const result = await linkOfferToAffiliateProduct({
      userId,
      productId,
      offerId: parsed.data.offerId,
    })

    await invalidateProductListCache(userId)

    return NextResponse.json({
      success: true,
      linked: result.linked,
      productId,
      offerId: result.offerId,
      message: result.linked ? 'product与offer链路已建立' : 'product与offer链路已存在',
    })
  } catch (error: any) {
    if (error?.message === '商品不存在' || error?.message === 'Offer不存在') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    console.error('[POST /api/products/:id/link-offer] failed:', error)
    return NextResponse.json(
      { error: error?.message || '建立product与offer链路失败' },
      { status: 500 }
    )
  }
}
