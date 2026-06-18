import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/common/server'
import { createOfferFromAffiliateProduct } from '@/lib/affiliate/products'
import { repairOfferAffiliateLinksFromProducts } from '@/lib/offers/server'
import { invalidateOfferCache } from '@/lib/common/server'
import { invalidateProductListCache } from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/gateway/request-auth'

const bodySchema = z.object({
  targetCountry: z.string().min(2, zErr.targetCountryMin).max(8, zErr.countryCode).optional(),
})

export const POST = withAuth(async (request, user, context) => {
  try {
    const userId = user.userId

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const productId = Number(context?.params?.id)
    if (!Number.isFinite(productId) || productId <= 0) {
      return NextResponse.json({ error: '无效的商品ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 }
      )
    }

    const result = await createOfferFromAffiliateProduct({
      userId,
      productId,
      targetCountry: parsed.data.targetCountry,
      createdVia: 'single',
    })

    try {
      await repairOfferAffiliateLinksFromProducts({
        userId,
        offerIds: [result.offerId],
        productIds: [productId],
      })
    } catch (repairError: any) {
      console.warn(
        `[POST /api/products/:id/create-offer] affiliate link repair skipped: ${repairError?.message || repairError}`
      )
    }

    invalidateOfferCache(userId)
    await invalidateProductListCache(userId)

    return NextResponse.json({
      success: true,
      offerId: result.offerId,
      taskId: result.taskId,
      productId,
      message: 'Offer创建成功，完整流程任务已入队',
    })
  } catch (error: any) {
    console.error('[POST /api/products/:id/create-offer] failed:', error)
    return NextResponse.json({ error: error?.message || '创建Offer失败' }, { status: 500 })
  }
})
