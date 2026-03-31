/**
 * POST /api/offers/[id]/rebuild
 *
 * 重建Offer - 重新抓取并更新所有Offer信息
 *
 * 功能：
 * 1. 验证用户身份和Offer所有权
 * 2. 获取Offer的必填参数（affiliate_link, target_country）
 * 3. 创建新的offer_tasks任务
 * 4. 将任务加入队列，重新走完整的抓取+AI分析流程
 * 5. 任务完成后更新原有Offer的所有字段
 *
 * 更新内容：
 * - 产品标识（brand, offer_name, category）
 * - 品牌信息（brand_description, unique_selling_points）
 * - 产品描述（product_highlights, target_audience）
 * - 评价分析（review_analysis, enhanced_review_analysis, ai_reviews）
 * - 竞品分析（competitor_analysis, ai_competitive_edges）
 * - 分类信息（product_categories, industry_code）
 * - AI分析（ai_analysis_v32, ai_keywords）
 * - 抓取数据（scraped_data, visual_analysis）
 * - 价格佣金（product_price, commission_payout）
 * - URL信息（final_url, final_url_suffix）
 *
 * 返回：
 * - taskId: 用于前端订阅SSE进度
 * - message: 提示信息
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import { deleteKeywordPool } from '@/lib/offer-keyword-pool'
import type { OfferExtractionTaskData } from '@/lib/queue/executors/offer-extraction-executor'

export const maxDuration = 120

interface Offer {
  id: number
  user_id: number
  brand: string | null
  affiliate_link: string | null
  target_country: string
  product_price: string | null
  commission_payout: string | null
  page_type: string | null
  store_product_links: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = getDatabase()
  const queue = getQueueManager()
  const parentRequestId = req.headers.get('x-request-id') || undefined
  const offerId = parseInt(params.id, 10)

  if (isNaN(offerId)) {
    return NextResponse.json(
      { error: 'Invalid request', message: 'Invalid offer ID' },
      { status: 400 }
    )
  }

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

    // 🔧 PostgreSQL兼容性：使用COALESCE避免类型转换问题
    // 问题根因：production数据库的is_deleted可能是INTEGER而非BOOLEAN
    // 解决方案：使用COALESCE(is_deleted, 0)::int = 0 模式，两种类型都兼容
    // 长期方案：运行迁移 077_fix_boolean_columns.pg.sql 将列转为BOOLEAN
    const notDeletedCondition = db.type === 'postgres'
      ? "(is_deleted IS NULL OR is_deleted::text IN ('0', 'f', 'false'))"
      : 'is_deleted = 0'

    // 2. 查询Offer并验证所有权
    const offers = await db.query<Offer>(
      `SELECT id, user_id, brand, affiliate_link, target_country, product_price, commission_payout, page_type, store_product_links FROM offers WHERE id = ? AND user_id = ? AND ${notDeletedCondition}`,
      [offerId, userIdNum]
    )

    if (!offers || offers.length === 0) {
      return NextResponse.json(
        { error: 'Not found', message: 'Offer不存在或无权限访问' },
        { status: 404 }
      )
    }

    const offer = offers[0]

    // 3. 验证必填参数
    if (!offer.affiliate_link) {
      return NextResponse.json(
        { error: 'Invalid data', message: 'Offer缺少推广链接，无法重建' },
        { status: 400 }
      )
    }

    if (!offer.target_country) {
      return NextResponse.json(
        { error: 'Invalid data', message: 'Offer缺少推广国家，无法重建' },
        { status: 400 }
      )
    }

    // 4. 🔧 修复(2026-01-21): 删除旧的关键词池
    // 重建 Offer 会更新 ai_keywords 等数据，旧关键词池不再准确
    // 下次生成广告创意时会自动创建新的关键词池
    try {
      await deleteKeywordPool(offerId)
      console.log(`🗑️ 已删除 Offer ${offerId} 的旧关键词池`)
    } catch (err: any) {
      // 关键词池可能不存在，忽略错误
      console.log(`ℹ️ Offer ${offerId} 无需删除关键词池: ${err.message}`)
    }

    // 5. 创建offer_tasks记录（关联到原有offer_id）
    const taskId = crypto.randomUUID()

    // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    await db.exec(`
      INSERT INTO offer_tasks (
        id,
        user_id,
        offer_id,
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
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ${db.type === 'postgres' ? 'true' : '1'}, ${db.type === 'postgres' ? 'false' : '0'}, ${nowFunc}, ${nowFunc})
    `, [
      taskId,
      userIdNum,
      offerId,  // 关键：关联到现有offer
      offer.affiliate_link,
      offer.target_country,
      offer.page_type || null,
      offer.store_product_links || null,
      offer.product_price,
      offer.commission_payout,
      offer.brand || null
    ])

    console.log(`📝 重建Offer任务已创建: taskId=${taskId}, offerId=${offerId}`)

    // 6. 将任务加入队列（强制跳过缓存）
    const storeProductLinks = (() => {
      if (!offer.store_product_links) return undefined
      try {
        const parsed = JSON.parse(offer.store_product_links)
        if (Array.isArray(parsed)) {
          return parsed.map((link) => (typeof link === 'string' ? link.trim() : ''))
            .filter((link) => Boolean(link))
            .slice(0, 3)
        }
      } catch {}
      return undefined
    })()

    const taskData: OfferExtractionTaskData = {
      affiliateLink: offer.affiliate_link,
      targetCountry: offer.target_country,
      skipCache: true,  // 重建时强制跳过缓存
      skipWarmup: false,
      productPrice: offer.product_price || undefined,
      commissionPayout: offer.commission_payout || undefined,
      brandName: offer.brand || undefined,
      pageType: offer.page_type === 'store' || offer.page_type === 'product' ? offer.page_type : undefined,
      storeProductLinks,
    }

    await queue.enqueue(
      'offer-extraction',
      taskData,
      userIdNum,
      {
        parentRequestId,
        priority: 'normal',
        requireProxy: true,
        maxRetries: 2,
        taskId  // 传递预定义的taskId
      }
    )

    console.log(`🚀 重建Offer任务已加入队列: taskId=${taskId}`)

    // 7. 返回taskId供前端订阅进度
    return NextResponse.json({
      success: true,
      taskId,
      offerId,
      message: 'Offer重建任务已创建，正在后台处理'
    })

  } catch (error: any) {
    console.error(`❌ 重建Offer失败 (offerId=${offerId}):`, error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '重建Offer失败'
      },
      { status: 500 }
    )
  }
}
