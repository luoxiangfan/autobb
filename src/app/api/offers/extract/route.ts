/**
 * POST /api/offers/extract
 *
 * 任务队列架构 - 创建Offer提取任务
 *
 * 流程：
 * 1. 验证用户身份
 * 2. 创建offer_tasks记录（状态：pending）
 * 3. 将任务加入UnifiedQueueManager
 * 4. 返回taskId给前端用于SSE订阅/轮询
 *
 * 参数：
 * - affiliate_link: 联盟链接（必填）
 * - target_country: 推广国家（必填）
 * - product_price: 产品价格（选填）
 * - commission_type + commission_value (+ commission_currency): 结构化佣金（推荐）
 * - commission_payout: 佣金（兼容旧字段）
 * - skipCache: 跳过缓存（选填）
 * - skipWarmup: 跳过预热（选填）
 *
 * 客户端使用：
 * - SSE订阅：GET /api/offers/extract/stream/[taskId]
 * - 轮询查询：GET /api/offers/extract/status/[taskId]
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import type { OfferExtractionTaskData } from '@/lib/queue/executors/offer-extraction-executor'
import { normalizeOfferExtractRequestBody } from '@/lib/autoads-request-normalizers'
import { normalizeOfferCommissionInput } from '@/lib/offer-monetization'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()
  const parentRequestId = req.headers.get('x-request-id') || undefined

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    // 1. 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 2. 解析请求参数
    const rawBody = await req.json()
    const body = normalizeOfferExtractRequestBody(rawBody) || rawBody
    // 🔥 修复（2025-12-08）：添加product_price和commission_payout参数支持
    const {
      affiliate_link,
      target_country,
      product_price,
      commission_payout,
      commission_type,
      commission_value,
      commission_currency,
      brand_name,
      page_type,
      store_product_links,
      skipCache,
      skipWarmup
    } = body

    // 参数验证
    if (!affiliate_link || typeof affiliate_link !== 'string' || affiliate_link.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid request', message: 'affiliate_link is required' },
        { status: 400 }
      )
    }

    // 🔥 2025-12-12修复：加强target_country验证，确保不是空字符串
    if (!target_country || typeof target_country !== 'string' || target_country.trim().length < 2) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'target_country is required (至少2个字符，如US、UK、DE)' },
        { status: 400 }
      )
    }

    // 可选：品牌名（用于独立站Google搜索补充）
    if (brand_name !== undefined && brand_name !== null) {
      if (typeof brand_name !== 'string') {
        return NextResponse.json(
          { error: 'Invalid request', message: 'brand_name must be a string' },
          { status: 400 }
        )
      }
      if (brand_name.trim().length > 120) {
        return NextResponse.json(
          { error: 'Invalid request', message: 'brand_name length must be <= 120' },
          { status: 400 }
        )
      }
    }

    // 可选：链接类型（店铺/单品）
    const pageType = (page_type === 'store' || page_type === 'product') ? page_type : 'product'
    let normalizedStoreProductLinks: string[] = []
    if (pageType === 'store') {
      if (store_product_links !== undefined && store_product_links !== null && !Array.isArray(store_product_links)) {
        return NextResponse.json(
          { error: 'Invalid request', message: 'store_product_links 必须为URL数组（最多3个）' },
          { status: 400 }
        )
      }
      const rawStoreLinks = Array.isArray(store_product_links) ? store_product_links : []
      normalizedStoreProductLinks = rawStoreLinks
        .map((link: any) => (typeof link === 'string' ? link.trim() : ''))
        .filter((link: string) => Boolean(link))
      normalizedStoreProductLinks = Array.from(new Set(normalizedStoreProductLinks)).slice(0, 3)
      for (const link of normalizedStoreProductLinks) {
        try {
          // eslint-disable-next-line no-new
          new URL(link)
        } catch {
          return NextResponse.json(
            { error: 'Invalid request', message: `单品推广链接无效: ${link}` },
            { status: 400 }
          )
        }
      }
    }

    let normalizedCommission: ReturnType<typeof normalizeOfferCommissionInput>
    try {
      normalizedCommission = normalizeOfferCommissionInput({
        targetCountry: target_country,
        commissionPayout: commission_payout,
        commissionType: commission_type,
        commissionValue: commission_value,
        commissionCurrency: commission_currency,
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Invalid request', message: error?.message || '佣金参数格式错误' },
        { status: 400 }
      )
    }

    // 3. 创建offer_tasks记录
    const taskId = crypto.randomUUID()

    // 🔥 修复（2025-12-08）：添加product_price和commission_payout字段
    await db.exec(`
      INSERT INTO offer_tasks (
        id,
        user_id,
        status,
        affiliate_link,
        target_country,
        page_type,
        store_product_links,
        product_price,
        commission_payout,
        brand_name,
        skip_cache,
        skip_warmup,
        created_at,
        updated_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `, [
      taskId,
      userIdNum,
      affiliate_link,
      target_country,
      pageType,
      normalizedStoreProductLinks.length > 0 ? JSON.stringify(normalizedStoreProductLinks) : null,
      product_price || null,
      normalizedCommission.commissionPayout || null,
      (typeof brand_name === 'string' && brand_name.trim()) ? brand_name.trim() : null,
      skipCache ?? false,
      skipWarmup ?? false
    ])

    console.log(`📝 Created offer_task: ${taskId} for user ${userIdNum}`)

    // 4. 将任务加入队列
    // 🔥 修复（2025-12-08）：传递product_price和commission_payout到执行器
    const taskData: OfferExtractionTaskData = {
      affiliateLink: affiliate_link,
      targetCountry: target_country,
      skipCache: skipCache ?? false,
      skipWarmup: skipWarmup ?? false,
      productPrice: product_price || undefined,
      commissionPayout: normalizedCommission.commissionPayout || undefined,
      commissionType: normalizedCommission.commissionType || undefined,
      commissionValue: normalizedCommission.commissionValue || undefined,
      commissionCurrency: normalizedCommission.commissionCurrency || undefined,
      brandName: (typeof brand_name === 'string' && brand_name.trim()) ? brand_name.trim() : undefined,
      pageType,
      storeProductLinks: normalizedStoreProductLinks.length > 0 ? normalizedStoreProductLinks : undefined,
    }

    await queue.enqueue(
      'offer-extraction',
      taskData,
      userIdNum,
      {
        parentRequestId,
        priority: 'normal',
        requireProxy: true, // Offer提取需要代理IP
        maxRetries: 2, // AI密集型任务，重试次数较少
        taskId  // 关键：传递预定义的taskId，确保队列任务ID与offer_tasks记录ID一致
      }
    )

    console.log(`🚀 Enqueued offer-extraction task: ${taskId}`)

    // 5. 返回taskId
    return NextResponse.json({
      success: true,
      taskId,
      message: '任务已创建，开始处理'
    })

  } catch (error: any) {
    console.error('❌ Create offer extraction task failed:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '创建任务失败'
      },
      { status: 500 }
    )
  }
}
