#!/usr/bin/env tsx
/**
 * 批量重建（重抓取）已处理过的 Offer，重新生成干净的竞品分析。
 *
 * 默认目标：
 * - 2026-02-23 本次“竞品不相关”修复涉及的 offer 集合（45个）
 *
 * 运行示例：
 *   NODE_ENV=production \
 *   DATABASE_URL='postgresql://...' \
 *   REDIS_URL='redis://...' \
 *   tsx scripts/rebuild-processed-offers.ts --apply
 *
 * 可选参数：
 *   --user-id=1
 *   --offer-ids=1,2,3
 *   --apply            实际执行（默认 dry-run）
 *   --dry-run          仅检查并输出计划
 */

import { closeDatabase, getDatabase } from '@/lib/db'
import { createOfferExtractionTaskForExistingOffer } from '@/lib/offer-extraction-task'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'

type PageType = 'store' | 'product'

type Args = {
  userId: number
  offerIds: number[]
  apply: boolean
}

type OfferRow = {
  id: number
  user_id: number
  offer_name: string | null
  brand: string | null
  affiliate_link: string | null
  target_country: string | null
  product_price: string | null
  commission_payout: string | null
  page_type: string | null
  store_product_links: unknown
  is_deleted: unknown
}

type ResultRow =
  | { offerId: number; status: 'enqueued'; taskId: string }
  | { offerId: number; status: 'skipped'; reason: string }
  | { offerId: number; status: 'failed'; reason: string }

const DEFAULT_PROCESSED_OFFER_IDS: number[] = [
  2, 11, 12, 16, 30, 31, 46, 47, 150, 155, 158, 165, 193, 239, 248, 2403,
  3692, 3694, 3695, 3696, 3697, 3698, 3699, 3702, 3708, 3720, 3721, 3733,
  3734, 3736, 3737, 3738, 3739, 3740, 3741, 3742, 3747, 3750, 3751, 3754,
  3774, 3775, 3776, 3777, 3778,
]

function parseArgs(argv: string[]): Args {
  const out: Args = {
    userId: 1,
    offerIds: [...DEFAULT_PROCESSED_OFFER_IDS],
    apply: false,
  }

  for (const arg of argv) {
    if (arg.startsWith('--user-id=')) {
      out.userId = Number(arg.slice('--user-id='.length))
      continue
    }
    if (arg.startsWith('--offer-ids=')) {
      const raw = arg.slice('--offer-ids='.length)
      const ids = raw
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isInteger(v) && v > 0)
      out.offerIds = Array.from(new Set(ids))
      continue
    }
    if (arg === '--apply') {
      out.apply = true
      continue
    }
    if (arg === '--dry-run') {
      out.apply = false
      continue
    }
  }

  if (!Number.isInteger(out.userId) || out.userId <= 0) {
    throw new Error(`Invalid --user-id: ${String(out.userId)}`)
  }
  if (out.offerIds.length === 0) {
    throw new Error('No valid offer IDs to process')
  }

  out.offerIds.sort((a, b) => a - b)
  return out
}

function isDeletedFlag(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized || normalized === '0' || normalized === 'f' || normalized === 'false' || normalized === 'null') {
      return false
    }
    return true
  }
  return Boolean(value)
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStoreProductLinks(raw: unknown): string[] | null {
  const normalizeArray = (arr: unknown[]): string[] => {
    const list = arr
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => Boolean(v))
    return Array.from(new Set(list)).slice(0, 3)
  }

  if (!raw) return null

  if (Array.isArray(raw)) {
    const out = normalizeArray(raw)
    return out.length > 0 ? out : null
  }

  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        const out = normalizeArray(parsed)
        return out.length > 0 ? out : null
      }
    } catch {
      if (/^https?:\/\//i.test(text)) {
        return [text]
      }
    }
  }

  return null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.apply ? 'apply' : 'dry-run'

  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL in environment')
  }
  if (args.apply && !process.env.REDIS_URL) {
    throw new Error('Missing REDIS_URL in environment (required for enqueue)')
  }

  console.log('========================================')
  console.log('♻️ Batch Rebuild Processed Offers')
  console.log('========================================')
  console.log(`[mode] ${mode}`)
  console.log(`[node_env] ${process.env.NODE_ENV || '(empty)'}`)
  console.log(`[user_id] ${args.userId}`)
  console.log(`[offers] ${args.offerIds.length}`)
  console.log(`[offer_ids] ${args.offerIds.join(',')}`)

  const db = getDatabase()

  // 关键：显式关闭 autoStartOnEnqueue，避免脚本本地消费任务。
  const queue = getQueueManager({ autoStartOnEnqueue: false })

  try {
    await queue.ensureInitialized()
    const runtime = queue.getRuntimeInfo()

    console.log(`[queue] adapter=${runtime.adapter}, connected=${runtime.connected}, autoStartOnEnqueue=${runtime.autoStartOnEnqueue}`)
    console.log(`[queue] redisUrlPresent=${runtime.redisUrlPresent}, redisKeyPrefix=${runtime.redisKeyPrefix || '(none)'}`)

    if (args.apply && runtime.adapter !== 'RedisQueueAdapter') {
      throw new Error(`Queue adapter is not Redis (${runtime.adapter}); refusing to enqueue`)
    }
    if (args.apply && !runtime.connected) {
      throw new Error('Queue adapter is not connected; refusing to enqueue')
    }

    const placeholders = args.offerIds.map(() => '?').join(', ')
    const rows = await db.query<OfferRow>(
      `
        SELECT
          id, user_id, offer_name, brand, affiliate_link, target_country,
          product_price, commission_payout, page_type, store_product_links, is_deleted
        FROM offers
        WHERE id IN (${placeholders})
      `,
      args.offerIds
    )
    const rowMap = new Map<number, OfferRow>(rows.map((row) => [row.id, row]))

    const results: ResultRow[] = []
    const parentRequestId = `competitor-clean-rebuild-${new Date().toISOString()}`

    for (const offerId of args.offerIds) {
      const row = rowMap.get(offerId)
      if (!row) {
        results.push({ offerId, status: 'skipped', reason: 'offer_not_found' })
        continue
      }
      if (row.user_id !== args.userId) {
        results.push({ offerId, status: 'skipped', reason: `owner_mismatch(user_id=${row.user_id})` })
        continue
      }
      if (isDeletedFlag(row.is_deleted)) {
        results.push({ offerId, status: 'skipped', reason: 'offer_deleted' })
        continue
      }

      const affiliateLink = normalizeString(row.affiliate_link)
      if (!affiliateLink) {
        results.push({ offerId, status: 'skipped', reason: 'missing_affiliate_link' })
        continue
      }

      const targetCountry = normalizeString(row.target_country).toUpperCase()
      if (!targetCountry) {
        results.push({ offerId, status: 'skipped', reason: 'missing_target_country' })
        continue
      }

      const pageType: PageType = row.page_type === 'store' ? 'store' : 'product'
      const storeProductLinks = pageType === 'store'
        ? normalizeStoreProductLinks(row.store_product_links)
        : null

      if (!args.apply) {
        results.push({ offerId, status: 'skipped', reason: 'dry_run_ready' })
        continue
      }

      try {
        const taskId = await createOfferExtractionTaskForExistingOffer({
          userId: args.userId,
          offerId,
          affiliateLink,
          targetCountry,
          productPrice: normalizeString(row.product_price) || null,
          commissionPayout: normalizeString(row.commission_payout) || null,
          brandName: normalizeString(row.brand) || normalizeString(row.offer_name) || null,
          pageType,
          storeProductLinks,
          parentRequestId,
          priority: 'normal',
          skipCache: true,
          skipWarmup: false,
        })
        results.push({ offerId, status: 'enqueued', taskId })
      } catch (error: any) {
        results.push({
          offerId,
          status: 'failed',
          reason: error?.message || String(error),
        })
      }
    }

    const enqueued = results.filter((row) => row.status === 'enqueued') as Array<{ offerId: number; status: 'enqueued'; taskId: string }>
    const failed = results.filter((row) => row.status === 'failed')
    const skipped = results.filter((row) => row.status === 'skipped')

    console.log('\n========================================')
    console.log('📊 Summary')
    console.log('========================================')
    console.log(`total=${results.length}, enqueued=${enqueued.length}, failed=${failed.length}, skipped=${skipped.length}`)

    if (enqueued.length > 0) {
      console.log('\n[enqueued offer -> task]')
      for (const row of enqueued) {
        console.log(`${row.offerId}\t${row.taskId}`)
      }
    }

    if (failed.length > 0) {
      console.log('\n[failed]')
      for (const row of failed) {
        console.log(`${row.offerId}\t${row.reason}`)
      }
    }

    if (skipped.length > 0) {
      console.log('\n[skipped]')
      for (const row of skipped) {
        console.log(`${row.offerId}\t${row.reason}`)
      }
    }
  } finally {
    // stop() 在未启动循环时不会断开连接，这里做一次适配器级兜底释放。
    const adapter = (queue as any)?.adapter
    if (adapter && typeof adapter.disconnect === 'function') {
      try {
        await adapter.disconnect()
      } catch (error: any) {
        console.warn(`⚠️ queue adapter disconnect failed: ${error?.message || String(error)}`)
      }
    }
  }
}

main()
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    closeDatabase()
  })
