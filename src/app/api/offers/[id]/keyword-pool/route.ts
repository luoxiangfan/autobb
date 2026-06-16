import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers/server'
import {
  getKeywordPoolByOfferId,
  generateOfferKeywordPool,
  deleteKeywordPool,
  getAvailableBuckets,
  getUsedBuckets,
  getBucketInfo,
  determineClusteringStrategy,
  type OfferKeywordPool,
  type BucketType,
} from '@/lib/offer-keyword-pool'
import { POST as rebuildOfferPost } from '@/app/api/offers/[id]/rebuild/route'
import { getCreativeTypeForBucketSlot } from '@/lib/creatives'
import { loadKeywordPoolExpandCredentialsForOffer } from '@/lib/google-ads/accounts/auth/index'
import { parsePositiveIntegerOfferId } from '@/lib/offers/server'

type CanonicalBucketSlot = 'A' | 'B' | 'D'

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function getCreativeSlotDescription(
  slot: CanonicalBucketSlot,
  linkType: 'product' | 'store'
): string {
  if (slot === 'A') {
    return linkType === 'store'
      ? '品牌词必须与真实商品集合或核心品类一起出现'
      : '品牌词必须与当前商品或品类锚点一起出现'
  }
  if (slot === 'B') {
    return linkType === 'store'
      ? '聚焦店铺热门商品型号/产品族，统一按完全匹配投放'
      : '聚焦当前商品型号/产品族，统一按完全匹配投放'
  }
  return linkType === 'store'
    ? '覆盖品牌下商品需求、产品线、功能与场景'
    : '覆盖品牌+商品需求/功能/场景，扩大需求承接'
}

function buildCanonicalBucketDetails(params: {
  pool: OfferKeywordPool
  usedBuckets: BucketType[]
  availableBuckets: BucketType[]
}) {
  const linkType = params.pool.linkType === 'store' ? 'store' : 'product'
  const slots: CanonicalBucketSlot[] = ['A', 'B', 'D']

  return Object.fromEntries(
    slots.map((slot) => {
      const slotInfo = getBucketInfo(params.pool, slot)
      return [
        slot,
        {
          creativeType: getCreativeTypeForBucketSlot(slot),
          intent: slotInfo.intent,
          intentEn: slotInfo.intentEn,
          keywords: slotInfo.keywords,
          count: slotInfo.keywords.length,
          isUsed: params.usedBuckets.includes(slot),
          isAvailable: params.availableBuckets.includes(slot),
          description: getCreativeSlotDescription(slot, linkType),
        },
      ]
    })
  )
}

function buildRawBucketDetails(params: { pool: OfferKeywordPool; usedBuckets: BucketType[] }) {
  return {
    A: {
      intent: params.pool.bucketAIntent,
      intentEn: 'Brand Product Anchor',
      keywords: params.pool.bucketAKeywords,
      count: params.pool.bucketAKeywords.length,
      isUsed: params.usedBuckets.includes('A'),
      description: '内部 raw bucket：品牌与商品/型号锚点明确的候选词',
    },
    B: {
      intent: params.pool.bucketBIntent,
      intentEn: 'Demand Scenario',
      keywords: params.pool.bucketBKeywords,
      count: params.pool.bucketBKeywords.length,
      isUsed: params.usedBuckets.includes('B'),
      description: '内部 raw bucket：商品需求或使用场景候选词',
    },
    C: {
      intent: params.pool.bucketCIntent,
      intentEn: 'Feature / Spec',
      keywords: params.pool.bucketCKeywords,
      count: params.pool.bucketCKeywords.length,
      isUsed: params.usedBuckets.includes('C'),
      description: '内部 raw bucket：功能、规格、参数候选词',
    },
    D: {
      intent: params.pool.bucketDIntent,
      intentEn: 'Demand Expansion',
      keywords: params.pool.bucketDKeywords,
      count: params.pool.bucketDKeywords.length,
      isUsed: params.usedBuckets.includes('D'),
      description: '内部 raw bucket：用于补足商品需求覆盖的高相关候选词',
    },
  }
}

function buildRawBucketCounts(pool: OfferKeywordPool) {
  return {
    A: pool.bucketAKeywords.length,
    B: pool.bucketBKeywords.length,
    C: pool.bucketCKeywords.length,
    D: pool.bucketDKeywords.length,
  }
}

/**
 * GET /api/offers/:id/keyword-pool
 * 获取 Offer 的关键词池
 *
 * Query Parameters:
 * - includeBucketDetails: boolean - 是否包含各桶详情
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
      return NextResponse.json({ error: '无效的 Offer ID' }, { status: 400 })
    }
    const userIdNum = userId

    // 验证 Offer 存在且属于当前用户
    const offer = await findOfferById(offerId, userIdNum)
    if (!offer) {
      return NextResponse.json({ error: 'Offer 不存在或无权访问' }, { status: 404 })
    }

    // 获取关键词池
    const pool = await getKeywordPoolByOfferId(offerId)

    if (!pool) {
      return NextResponse.json({
        success: true,
        data: {
          offerId,
          exists: false,
          message: '关键词池尚未创建，请调用 POST 方法生成',
        },
      })
    }

    // 获取桶使用情况
    const usedBuckets = await getUsedBuckets(offerId)
    const availableBuckets = await getAvailableBuckets(offerId)
    const bucketA = getBucketInfo(pool, 'A')
    const bucketB = getBucketInfo(pool, 'B')
    const bucketD = getBucketInfo(pool, 'D')
    const rawBucketCounts = buildRawBucketCounts(pool)

    // 解析 query 参数
    const { searchParams } = new URL(request.url)
    const includeBucketDetails = searchParams.get('includeBucketDetails') === 'true'

    // 构建响应
    const response: any = {
      success: true,
      data: {
        id: pool.id,
        offerId: pool.offerId,
        exists: true,

        // 统计信息
        totalKeywords: pool.totalKeywords,
        brandKeywordsCount: pool.brandKeywords.length,
        bucketACount: bucketA.keywords.length,
        bucketBCount: bucketB.keywords.length,
        bucketCCount: rawBucketCounts.C,
        bucketDCount: bucketD.keywords.length,
        rawBucketCounts,

        // 桶使用情况
        usedBuckets,
        availableBuckets,
        creativesCount: usedBuckets.length,
        maxCreatives: 3,

        // 质量指标
        balanceScore: pool.balanceScore,
        clusteringModel: pool.clusteringModel,
        clusteringPromptVersion: pool.clusteringPromptVersion,

        // 时间戳
        createdAt: pool.createdAt,
        updatedAt: pool.updatedAt,
      },
    }

    // 如果请求包含桶详情
    if (includeBucketDetails) {
      response.data.buckets = {
        brand: {
          keywords: pool.brandKeywords,
          count: pool.brandKeywords.length,
          description: '纯品牌词（所有创意共享）',
        },
        A: {
          intent: bucketA.intent,
          intentEn: bucketA.intentEn,
          keywords: bucketA.keywords,
          count: bucketA.keywords.length,
          isUsed: usedBuckets.includes('A'),
          description: 'canonical creative slot：品牌意图关键词集合',
        },
        B: {
          intent: bucketB.intent,
          intentEn: bucketB.intentEn,
          keywords: bucketB.keywords,
          count: bucketB.keywords.length,
          isUsed: usedBuckets.includes('B'),
          description: 'canonical creative slot：商品型号/产品族意图关键词集合',
        },
        D: {
          intent: bucketD.intent,
          intentEn: bucketD.intentEn,
          keywords: bucketD.keywords,
          count: bucketD.keywords.length,
          isUsed: usedBuckets.includes('D'),
          description: 'canonical creative slot：商品需求意图关键词集合',
        },
      }

      response.data.rawBuckets = buildRawBucketDetails({
        pool,
        usedBuckets,
      })

      response.data.creativeSlots = buildCanonicalBucketDetails({
        pool,
        usedBuckets,
        availableBuckets,
      })
      response.data.slotOrder = ['A', 'B', 'D']
      response.data.slotNotes = {
        A: '品牌意图',
        B: '商品型号/产品族意图',
        D: '商品需求意图',
      }
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('获取关键词池失败:', error)
    return NextResponse.json({ error: error.message || '获取关键词池失败' }, { status: 500 })
  }
}

/**
 * POST /api/offers/:id/keyword-pool
 * 生成 Offer 的关键词池
 *
 * Request Body:
 * - forceRegenerate: boolean - 是否触发重建Offer（替代关键词池重建）
 * - keywords: string[] - 可选，指定关键词列表（否则自动提取）
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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
      return NextResponse.json({ error: '无效的 Offer ID' }, { status: 400 })
    }
    const userIdNum = userId

    // 验证 Offer 存在且属于当前用户
    const offer = await findOfferById(offerId, userIdNum)
    if (!offer) {
      return NextResponse.json({ error: 'Offer 不存在或无权访问' }, { status: 404 })
    }

    // 解析请求体
    const body = await request.json().catch(() => ({}))
    const forceRegenerate = parseBooleanFlag(body.forceRegenerate)
    const keywords = Array.isArray(body.keywords) ? body.keywords : undefined

    console.log(`📦 POST /api/offers/${offerId}/keyword-pool`)
    console.log(`   forceRegenerate: ${forceRegenerate}`)
    console.log(`   keywords: ${keywords ? `${keywords.length} 个` : '自动提取'}`)

    if (forceRegenerate) {
      console.log(`🔁 forceRegenerate=true，改为触发 /api/offers/${offerId}/rebuild`)
      return rebuildOfferPost(request, { params: props.params })
    }

    // 检查是否需要生成
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      return NextResponse.json({
        success: true,
        message: '关键词池已存在，跳过生成。如需重建，请调用 /api/offers/:id/rebuild',
        data: {
          id: existing.id,
          offerId: existing.offerId,
          totalKeywords: existing.totalKeywords,
          isNew: false,
        },
      })
    }

    const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userIdNum, offerId)
    const pool = await generateOfferKeywordPool(
      offerId,
      userIdNum,
      keywords,
      undefined,
      expandLoad.ok ? expandLoad : undefined
    )

    // 确定聚类策略
    const strategy = determineClusteringStrategy(pool.totalKeywords)

    // 获取可用桶
    const availableBuckets = await getAvailableBuckets(offerId)
    const bucketA = getBucketInfo(pool, 'A')
    const bucketB = getBucketInfo(pool, 'B')
    const bucketD = getBucketInfo(pool, 'D')
    const rawBucketCounts = buildRawBucketCounts(pool)

    return NextResponse.json({
      success: true,
      message: '关键词池创建成功',
      data: {
        id: pool.id,
        offerId: pool.offerId,
        totalKeywords: pool.totalKeywords,
        isNew: true,

        // 统计信息
        brandKeywordsCount: pool.brandKeywords.length,
        bucketACount: bucketA.keywords.length,
        bucketBCount: bucketB.keywords.length,
        bucketCCount: rawBucketCounts.C,
        bucketDCount: bucketD.keywords.length,
        rawBucketCounts,

        // 质量指标
        balanceScore: pool.balanceScore,
        clusteringModel: pool.clusteringModel,

        // 策略建议
        strategy: {
          bucketCount: strategy.bucketCount,
          strategyType: strategy.strategy,
          message: strategy.message,
        },

        // 可用桶
        availableBuckets,
      },
    })
  } catch (error: any) {
    console.error('生成关键词池失败:', error)
    return NextResponse.json({ error: error.message || '生成关键词池失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/offers/:id/keyword-pool
 * 删除 Offer 的关键词池
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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
      return NextResponse.json({ error: '无效的 Offer ID' }, { status: 400 })
    }
    const userIdNum = userId

    // 验证 Offer 存在且属于当前用户
    const offer = await findOfferById(offerId, userIdNum)
    if (!offer) {
      return NextResponse.json({ error: 'Offer 不存在或无权访问' }, { status: 404 })
    }

    // 检查是否存在
    const existing = await getKeywordPoolByOfferId(offerId)
    if (!existing) {
      return NextResponse.json({ error: '关键词池不存在' }, { status: 404 })
    }

    // 删除
    await deleteKeywordPool(offerId)

    return NextResponse.json({
      success: true,
      message: '关键词池已删除',
    })
  } catch (error: any) {
    console.error('删除关键词池失败:', error)
    return NextResponse.json({ error: error.message || '删除关键词池失败' }, { status: 500 })
  }
}
