/**
 * Offer and campaign target lookup for url-swap tasks.
 */
import { getDatabase } from '@/lib/db'

export type UrlSwapTargetInput = {
  google_ads_account_id: number
  google_customer_id: string
  google_campaign_id: string
}

/**
 * 辅助函数：获取Offer信息
 */
export async function getOfferById(offerId: number): Promise<any | null> {
  const db = await getDatabase()
  const isDeletedCondition = '(is_deleted = FALSE OR is_deleted IS NULL)'

  return db.queryOne(
    `
    SELECT id, user_id, affiliate_link, target_country, final_url, final_url_suffix
    FROM offers
    WHERE id = ? AND ${isDeletedCondition}
  `,
    [offerId]
  )
}
export async function getOfferCampaignTargets(
  offerId: number,
  userId: number
): Promise<UrlSwapTargetInput[]> {
  const db = await getDatabase()
  const isDeletedCondition = 'c.is_deleted = FALSE'

  const params: any[] = [offerId]
  let userCondition = ''
  if (userId && userId > 0) {
    userCondition = 'AND c.user_id = ?'
    params.push(userId)
  }

  const rows = await db.query<any>(
    `
    SELECT
      c.google_ads_account_id as google_ads_account_id,
      gaa.customer_id as google_customer_id,
      COALESCE(NULLIF(c.google_campaign_id, ''), NULLIF(c.campaign_id, '')) as google_campaign_id
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id = ?
      ${userCondition}
      AND ${isDeletedCondition}
      AND c.status != 'REMOVED'
      AND c.google_ads_account_id IS NOT NULL
      AND (
        (c.google_campaign_id IS NOT NULL AND c.google_campaign_id != '')
        OR (c.campaign_id IS NOT NULL AND c.campaign_id != '')
      )
    ORDER BY c.created_at DESC
  `,
    params
  )

  const deduped = new Map<string, UrlSwapTargetInput>()
  for (const row of rows) {
    if (!row.google_ads_account_id || !row.google_customer_id || !row.google_campaign_id) continue
    const key = `${row.google_ads_account_id}-${row.google_campaign_id}`
    if (deduped.has(key)) continue
    deduped.set(key, {
      google_ads_account_id: row.google_ads_account_id,
      google_customer_id: row.google_customer_id,
      google_campaign_id: row.google_campaign_id,
    })
  }

  return Array.from(deduped.values())
}

export async function findGoogleAdsAccountIdByCustomerId(
  customerId: string,
  userId: number
): Promise<number | null> {
  const db = await getDatabase()
  const isDeletedCondition = 'is_deleted = FALSE'
  const row = await db.queryOne<{ id: number }>(
    `
    SELECT id
    FROM google_ads_accounts
    WHERE user_id = ? AND customer_id = ? AND ${isDeletedCondition}
    ORDER BY created_at DESC
    LIMIT 1
  `,
    [userId, customerId]
  )
  return row?.id ?? null
}
