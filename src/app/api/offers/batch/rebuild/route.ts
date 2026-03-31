/**
 * POST /api/offers/batch/rebuild
 *
 * 批量重建Offer - 批量重新抓取并更新所有Offer信息
 *
 * 功能：
 * 1. 验证用户身份和Offer所有权
 * 2. 验证每个Offer的必填参数（affiliate_link, target_country）
 * 3. 为每个Offer创建新的offer_tasks任务
 * 4. 将任务加入队列，重新走完整的抓取+AI分析流程
 * 5. 删除旧的关键词池
 *
 * 规则：
 * - 单次最多50个Offer
 * - 仅处理有 affiliate_link 的Offer；缺少推广链接的跳过
 * - 若该Offer已存在 pending/in_progress 的重建任务，则跳过
 *
 * 返回：
 * - enqueuedCount: 成功入队的任务数
 * - skippedCount: 跳过的Offer数
 * - failedCount: 失败的Offer数
 * - taskIds: 所有成功创建的taskId列表
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import { deleteKeywordPool } from '@/lib/offer-keyword-pool'
import type { OfferExtractionTaskData } from '@/lib/queue/executors/offer-extraction-executor'

export const maxDuration = 120

const requestSchema = z.object({
  offerIds: z.array(z.number().int().positive()).min(1).max(50),
})

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

export async function POST(request: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()
  const parentRequestId = request.headers.get('x-request-id') || undefined
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    // 1. 验证用户身份
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 2. 解析请求参数
    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'offerIds参数无效（1~50个数字ID）' },
        { status: 400 }
      )
    }

    const offerIds = Array.from(new Set(parsed.data.offerIds))
    if (offerIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request', message: '请选择Offer' },
        { status: 400 }
      )
    }
    if (offerIds.length > 50) {
      return NextResponse.json(
        { error: 'Too many offers', message: '单次最多支持50个Offer' },
        { status: 400 }
      )
    }

    console.log(`📦 批量重建Offer: ${offerIds.length}个, userId=${userIdNum}`)

    // 3. 查询所有Offer并验证所有权
    const notDeletedCondition = db.type === 'postgres'
      ? "(is_deleted IS NULL OR is_deleted::text IN ('0', 'f', 'false'))"
      : 'is_deleted = 0'

    const placeholders = offerIds.map(() => '?').join(',')
    const offers = await db.query<Offer>(
      `SELECT id, user_id, brand, affiliate_link, target_country, product_price, commission_payout, page_type, store_product_links
       FROM offers
       WHERE id IN (${placeholders}) AND user_id = ? AND ${notDeletedCondition}`,
      [...offerIds, userIdNum]
    )

    if (!offers || offers.length === 0) {
      return NextResponse.json(
        { error: 'Not found', message: '未找到可重建的Offer' },
        { status: 404 }
      )
    }

    console.log(`✅ 找到 ${offers.length} 个Offer`)

    // 4. 检查每个Offer是否已有pending/in_progress的重建任务
    const offerIdList = offers.map(o => o.id)
    const offerIdPlaceholders = offerIdList.map(() => '?').join(',')
    const existingTasks = await db.query<{ offer_id: number }>(
      `SELECT DISTINCT offer_id FROM offer_tasks
       WHERE offer_id IN (${offerIdPlaceholders})
       AND status IN ('pending', 'in_progress')`,
      offerIdList
    )

    const busyOfferIds = new Set(existingTasks.map(t => t.offer_id))
    console.log(`⏳ ${busyOfferIds.size} 个Offer已有进行中的任务`)

    // 5. 批量处理每个Offer
    let enqueuedCount = 0
    let skippedCount = 0
    let failedCount = 0
    const taskIds: string[] = []
    const errors: Array<{ offerId: number; reason: string }> = []

    for (const offer of offers) {
      try {
        // 跳过：已有进行中的任务
        if (busyOfferIds.has(offer.id)) {
          console.log(`⏭️ 跳过 Offer ${offer.id}: 已有进行中的重建任务`)
          skippedCount++
          continue
        }

        // 跳过：缺少推广链接
        if (!offer.affiliate_link) {
          console.log(`⏭️ 跳过 Offer ${offer.id}: 缺少推广链接`)
          errors.push({ offerId: offer.id, reason: '缺少推广链接' })
          skippedCount++
          continue
        }

        // 跳过：缺少目标国家
        if (!offer.target_country) {
          console.log(`⏭️ 跳过 Offer ${offer.id}: 缺少目标国家`)
          errors.push({ offerId: offer.id, reason: '缺少目标国家' })
          skippedCount++
          continue
        }

        // 删除旧的关键词池
        try {
          await deleteKeywordPool(offer.id)
          console.log(`🗑️ 已删除 Offer ${offer.id} 的旧关键词池`)
        } catch (err: any) {
          console.log(`ℹ️ Offer ${offer.id} 无需删除关键词池: ${err.message}`)
        }

        // 创建offer_tasks记录
        const taskId = crypto.randomUUID()

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
          offer.id,
          offer.affiliate_link,
          offer.target_country,
          offer.page_type || null,
          offer.store_product_links || null,
          offer.product_price,
          offer.commission_payout,
          offer.brand || null
        ])

        // 将任务加入队列
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
          skipCache: true,
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
            taskId
          }
        )

        taskIds.push(taskId)
        enqueuedCount++
        console.log(`✅ Offer ${offer.id} 重建任务已入队: taskId=${taskId}`)

      } catch (error: any) {
        console.error(`❌ Offer ${offer.id} 重建失败:`, error)
        errors.push({ offerId: offer.id, reason: error.message || '未知错误' })
        failedCount++
      }
    }

    console.log(`📊 批量重建完成: 入队=${enqueuedCount}, 跳过=${skippedCount}, 失败=${failedCount}`)

    return NextResponse.json({
      success: true,
      enqueuedCount,
      skippedCount,
      failedCount,
      taskIds,
      errors: errors.length > 0 ? errors : undefined,
      message: `已为 ${enqueuedCount} 个Offer创建重建任务${skippedCount > 0 ? `，跳过 ${skippedCount} 个` : ''}${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}`
    })

  } catch (error: any) {
    console.error('❌ 批量重建Offer失败:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '批量重建Offer失败'
      },
      { status: 500 }
    )
  }
}
