import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/common/server'
import { batchCreateOffersFromAffiliateProducts } from '@/lib/affiliate/products/index'
import { repairOfferAffiliateLinksFromProducts } from '@/lib/offers/server'
import { invalidateOfferCache } from '@/lib/common/server'
import { invalidateProductListCache } from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

const itemSchema = z.object({
  productId: z.number().int(zErr.int).positive(zErr.positiveInt),
  targetCountry: z.string().min(2, zErr.targetCountryMin).max(8, zErr.countryCode).optional(),
})

const bodySchema = z.object({
  items: z.array(itemSchema).min(1, zErr.minItems(1)).max(200, zErr.maxItems(200)),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 }
      )
    }

    const result = await batchCreateOffersFromAffiliateProducts({
      userId,
      items: parsed.data.items,
    })

    const successfulOfferIds = result.results
      .map((item) => item.offerId)
      .filter(
        (offerId): offerId is number =>
          typeof offerId === 'number' && Number.isInteger(offerId) && offerId > 0
      )
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
    return NextResponse.json({ error: error?.message || '批量创建Offer失败' }, { status: 500 })
  }
}
