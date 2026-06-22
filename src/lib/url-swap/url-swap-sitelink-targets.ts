/**
 * Url-swap Sitelink Asset target mapping (store_product_links ↔ Google Ads Sitelink).
 */
import { getDatabase } from '@/lib/db'
import { splitUrlBaseAndSuffix, type PublishSitelinkInput } from '@/lib/creatives/sitelink-utils'
import type { UrlSwapSitelinkTarget, UrlSwapSitelinkTargetStatus } from './url-swap-types'
import { getUrlSwapTaskByOfferId } from './url-swap-queries'

export type { UrlSwapSitelinkTarget, UrlSwapSitelinkTargetStatus } from './url-swap-types'

export interface SyncUrlSwapSitelinkTargetsInput {
  offerId: number
  userId: number
  googleAdsAccountId: number
  googleCustomerId: string
  googleCampaignId: string
  assetResourceNames: string[]
  publishedSitelinks: PublishSitelinkInput[]
  storeProductLinks: string[]
}

function parseStoreProductLinks(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim())
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parseStoreProductLinks(parsed)
    } catch {
      return []
    }
  }
  return []
}

function mapSitelinkTargetRow(row: any): UrlSwapSitelinkTarget {
  return {
    id: row.id,
    task_id: row.task_id,
    offer_id: row.offer_id,
    user_id: row.user_id,
    sort_index: row.sort_index,
    affiliate_link: row.affiliate_link,
    google_ads_account_id: row.google_ads_account_id,
    google_customer_id: row.google_customer_id,
    google_campaign_id: row.google_campaign_id,
    asset_resource_name: row.asset_resource_name,
    asset_id: row.asset_id,
    link_text: row.link_text,
    current_final_url: row.current_final_url ?? null,
    current_final_url_suffix: row.current_final_url_suffix ?? null,
    status: (row.status || 'active') as UrlSwapSitelinkTargetStatus,
    consecutive_failures: row.consecutive_failures ?? 0,
    last_success_at: row.last_success_at ?? null,
    last_error: row.last_error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * 发布 Sitelink 成功后，将 store_product_links 与 Asset 映射写入换链任务。
 * 若 Offer 无换链任务则跳过（不阻塞发布）。
 */
export async function syncUrlSwapSitelinkTargetsAfterPublish(
  input: SyncUrlSwapSitelinkTargetsInput
): Promise<number> {
  if (input.storeProductLinks.length === 0) return 0
  if (input.assetResourceNames.length === 0 || input.publishedSitelinks.length === 0) return 0

  const task = await getUrlSwapTaskByOfferId(input.offerId, input.userId)
  if (!task) {
    console.log(
      `[url-swap] 跳过 Sitelink 映射：Offer ${input.offerId} 尚无换链任务（可先创建任务后重新发布 Sitelink）`
    )
    return 0
  }

  const pairCount = Math.min(
    input.storeProductLinks.length,
    input.assetResourceNames.length,
    input.publishedSitelinks.length
  )
  if (pairCount === 0) return 0

  const db = await getDatabase()
  const now = new Date().toISOString()
  let upserted = 0

  for (let index = 0; index < pairCount; index++) {
    const affiliateLink = input.storeProductLinks[index]
    const assetResourceName = input.assetResourceNames[index]
    const sitelink = input.publishedSitelinks[index]
    const assetId = assetResourceName.split('/').pop() || ''

    if (!affiliateLink || !assetResourceName || !assetId || !sitelink.text) continue

    const explicitSuffix = sitelink.finalUrlSuffix?.trim()
    const split = splitUrlBaseAndSuffix(sitelink.url)
    const currentFinalUrl = split.base
    const currentFinalUrlSuffix = explicitSuffix ?? split.suffix

    await db.exec(
      `
      INSERT INTO url_swap_sitelink_targets (
        id, task_id, offer_id, user_id,
        sort_index, affiliate_link,
        google_ads_account_id, google_customer_id, google_campaign_id,
        asset_resource_name, asset_id, link_text,
        current_final_url, current_final_url_suffix,
        status, consecutive_failures, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, NULL, ?, ?)
      ON CONFLICT (task_id, sort_index) DO UPDATE SET
        affiliate_link = EXCLUDED.affiliate_link,
        google_ads_account_id = EXCLUDED.google_ads_account_id,
        google_customer_id = EXCLUDED.google_customer_id,
        google_campaign_id = EXCLUDED.google_campaign_id,
        asset_resource_name = EXCLUDED.asset_resource_name,
        asset_id = EXCLUDED.asset_id,
        link_text = EXCLUDED.link_text,
        current_final_url = EXCLUDED.current_final_url,
        current_final_url_suffix = EXCLUDED.current_final_url_suffix,
        status = 'active',
        consecutive_failures = 0,
        last_error = NULL,
        updated_at = EXCLUDED.updated_at
    `,
      [
        crypto.randomUUID().toLowerCase(),
        task.id,
        input.offerId,
        input.userId,
        index,
        affiliateLink,
        input.googleAdsAccountId,
        input.googleCustomerId,
        input.googleCampaignId,
        assetResourceName,
        assetId,
        sitelink.text,
        currentFinalUrl,
        currentFinalUrlSuffix,
        now,
        now,
      ]
    )
    upserted++
  }

  await db.exec(
    `
    UPDATE url_swap_sitelink_targets
    SET status = 'removed', updated_at = ?
    WHERE task_id = ?
      AND google_campaign_id = ?
      AND status = 'active'
      AND sort_index >= ?
  `,
    [now, task.id, input.googleCampaignId, pairCount]
  )

  console.log(
    `[url-swap] Sitelink 映射已同步: task=${task.id}, campaign=${input.googleCampaignId}, count=${upserted}`
  )
  return upserted
}

export async function loadOfferStoreProductLinksForUrlSwap(
  offerId: number,
  userId: number
): Promise<{ pageType: string | null; storeProductLinks: string[] }> {
  const db = await getDatabase()
  const row = await db.queryOne<{ page_type: string | null; store_product_links: unknown }>(
    `
    SELECT page_type, store_product_links
    FROM offers
    WHERE id = ? AND user_id = ?
      AND (is_deleted = FALSE OR is_deleted IS NULL)
  `,
    [offerId, userId]
  )
  if (!row) {
    return { pageType: null, storeProductLinks: [] }
  }
  return {
    pageType: row.page_type,
    storeProductLinks:
      row.page_type === 'store' ? parseStoreProductLinks(row.store_product_links) : [],
  }
}

export async function getActiveUrlSwapSitelinkTargets(
  taskId: string,
  userId?: number
): Promise<UrlSwapSitelinkTarget[]> {
  return getUrlSwapSitelinkTargets(taskId, userId, { includeRemoved: false })
}

export async function getUrlSwapSitelinkTargets(
  taskId: string,
  userId?: number,
  options?: { includeRemoved?: boolean }
): Promise<UrlSwapSitelinkTarget[]> {
  const db = await getDatabase()
  const params: unknown[] = [taskId]
  let userClause = ''
  if (userId && userId > 0) {
    userClause = 'AND ust.user_id = ?'
    params.push(userId)
  }

  const statusClause =
    options?.includeRemoved === true ? '' : "AND ust.status IN ('active', 'invalid')"

  const rows = await db.query<any>(
    `
    SELECT ust.*
    FROM url_swap_sitelink_targets ust
    WHERE ust.task_id = ?
      ${userClause}
      ${statusClause}
    ORDER BY ust.sort_index ASC
  `,
    params
  )

  return rows.map(mapSitelinkTargetRow)
}

export async function markUrlSwapSitelinkTargetSuccess(
  targetId: string,
  resolved: { finalUrl: string; finalUrlSuffix: string }
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.exec(
    `
    UPDATE url_swap_sitelink_targets
    SET current_final_url = ?,
        current_final_url_suffix = ?,
        consecutive_failures = 0,
        last_success_at = ?,
        last_error = NULL,
        updated_at = ?
    WHERE id = ?
  `,
    [resolved.finalUrl, resolved.finalUrlSuffix, now, now, targetId]
  )
}

export async function markUrlSwapSitelinkTargetFailure(
  targetId: string,
  errorMessage: string
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.exec(
    `
    UPDATE url_swap_sitelink_targets
    SET consecutive_failures = consecutive_failures + 1,
        last_error = ?,
        updated_at = ?
    WHERE id = ?
  `,
    [errorMessage.slice(0, 2000), now, targetId]
  )
}
