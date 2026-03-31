import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativesByOfferId } from '@/lib/ad-creative'
import { findOfferById } from '@/lib/offers'
import {
  deriveCanonicalCreativeType,
  mapCreativeTypeToBucketSlot,
  normalizeCreativeBucketSlot,
} from '@/lib/creative-type'

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
  const keywordBucket = mapCreativeTypeToBucketSlot(creativeType)
    || normalizeCreativeBucketSlot(creative.keyword_bucket ?? creative.keywordBucket)

  return { creativeType, keywordBucket }
}

/**
 * GET /api/offers/:id/creatives
 * 获取指定Offer的所有创意
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const offerId = parseInt(id, 10)

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, parseInt(userId, 10))
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取所有创意
    const creatives = await findAdCreativesByOfferId(offerId, parseInt(userId, 10))

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
    return NextResponse.json(
      { error: error.message || '获取Creatives失败' },
      { status: 500 }
    )
  }
}
