import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/common/server'
import { batchOfflineAffiliateProducts } from '@/lib/affiliate/products'
import { invalidateOfferCache } from '@/lib/common/server'
import { invalidateProductListCache } from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

const bodySchema = z.object({
  productIds: z
    .array(z.number().int(zErr.int).positive(zErr.positiveInt))
    .min(1, zErr.minItems(1))
    .max(200, zErr.maxItems(200)),
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

    const result = await batchOfflineAffiliateProducts({
      userId,
      productIds: parsed.data.productIds,
    })

    invalidateOfferCache(userId)
    await invalidateProductListCache(userId)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[POST /api/products/batch-offline] failed:', error)
    return NextResponse.json({ error: error?.message || '批量下线商品失败' }, { status: 500 })
  }
}
