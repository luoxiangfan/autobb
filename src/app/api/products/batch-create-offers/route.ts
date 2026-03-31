import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { batchCreateOffersFromAffiliateProducts } from '@/lib/affiliate-products'
import { repairOfferAffiliateLinksFromProducts } from '@/lib/offer-affiliate-link-repair'
import { invalidateOfferCache } from '@/lib/api-cache'
import { invalidateProductListCache } from '@/lib/products-cache'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

const itemSchema = z.object({
  productId: z.number().int().positive(),
  targetCountry: z.string().min(2).max(8).optional(),
})

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(200),
})

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

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || '参数错误' }, { status: 400 })
    }

    const result = await batchCreateOffersFromAffiliateProducts({
      userId,
      items: parsed.data.items,
    })

    const successfulOfferIds = result.results
      .map((item) => item.offerId)
      .filter((offerId): offerId is number => typeof offerId === 'number' && Number.isInteger(offerId) && offerId > 0)
    const successfulProductIds = result.results
      .filter((item) => item.success)
      .map((item) => item.productId)
      .filter((productId): productId is number => Number.isInteger(productId) && productId > 0)

    if (successfulOfferIds.length > 0) {
      try {
        await repairOfferAffiliateLinksFromProducts({
          userId,
          offerIds: successfulOfferIds,
          productIds: successfulProductIds,
        })
      } catch (repairError: any) {
        console.warn(
          `[POST /api/products/batch-create-offers] affiliate link repair skipped: ${repairError?.message || repairError}`
        )
      }
    }

    invalidateOfferCache(userId)
    await invalidateProductListCache(userId)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[POST /api/products/batch-create-offers] failed:', error)
    return NextResponse.json(
      { error: error?.message || '批量创建Offer失败' },
      { status: 500 }
    )
  }
}
