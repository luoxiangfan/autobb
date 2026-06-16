import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativesByOfferId } from '@/lib/creatives/server'
import { findOfferById } from '@/lib/offers/server'
import {
  deriveCanonicalCreativeType,
  mapCreativeTypeToBucketSlot,
  normalizeCreativeBucketSlot,
} from '@/lib/creatives/server'
import { parsePositiveIntegerOfferId } from '@/lib/offers/server'

function resolveCreativeIdentity(creative: any): {
  creativeType: 'brand_intent' | 'model_intent' | 'product_intent' | null
  keywordBucket: 'A' | 'B' | 'D' | null
} {
  const creativeType = deriveCanonicalCreativeType({
    creativeType: creative.creative_type ?? creative.creativeType,
    keywordBucket: creative.keyword_bucket ?? creative.keywordBucket,
    keywords: creative.keywords,
    headlines: creative.headlines,
    descriptions: creative.descriptions,
    theme: creative.theme,
    bucketIntent: creative.bucket_intent ?? creative.bucketIntent,
  })
  const keywordBucket =
    mapCreativeTypeToBucketSlot(creativeType) ||
    normalizeCreativeBucketSlot(creative.keyword_bucket ?? creative.keywordBucket)

  return { creativeType, keywordBucket }
}

/**
 * GET /api/offers/:id/creatives
 * 获取指定Offer的所有创意
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const offerId = parsePositiveIntegerOfferId(id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json({ error: 'Offer不存在或无权访问' }, { status: 404 })
    }

    // 获取所有创意
    const creatives = await findAdCreativesByOfferId(offerId, userId)

    const creativesPayload = creatives.map((c: any) => {
      const { creativeType, keywordBucket } = resolveCreativeIdentity(c)
      const keywordsWithVolume = Array.isArray(c.keywordsWithVolume)
        ? c.keywordsWithVolume
            .map((item: any) => ({
              keyword: typeof item?.keyword === 'string' ? item.keyword : '',
              searchVolume: Number(item?.searchVolume || 0),
              matchType: typeof item?.matchType === 'string' ? item.matchType : undefined,
              competition: typeof item?.competition === 'string' ? item.competition : undefined,
              source: typeof item?.source === 'string' ? item.source : undefined,
            }))
            .filter((item: any) => item.keyword)
        : []

      const keywordVolumeTotal = keywordsWithVolume.reduce((sum: number, item: any) => {
        const volume = Number(item.searchVolume || 0)
        return sum + (Number.isFinite(volume) && volume > 0 ? volume : 0)
      }, 0)

      return {
        id: c.id,
        version: c.version,
        headlines: c.headlines,
        descriptions: c.descriptions,
        keywords: c.keywords,
        keywordsWithVolume,
        keywordVolumeTotal,
        keywordCount: Array.isArray(c.keywords) ? c.keywords.length : 0,
        creativeType,
        keywordBucket,
        finalUrl: c.final_url,
        score: c.score,
        generationMode: c.generation_mode ?? null,
        creationStatus: c.creation_status,
        createdAt: c.created_at,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        offerId,
        total: creativesPayload.length,
        creatives: creativesPayload,
      },
    })
  } catch (error: any) {
    console.error('获取Creatives失败:', error)
    return NextResponse.json({ error: error.message || '获取Creatives失败' }, { status: 500 })
  }
}
