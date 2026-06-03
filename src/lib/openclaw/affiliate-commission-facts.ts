import { getDatabase } from '@/lib/db'
import { nowFunc } from '@/lib/db-helpers'
import type { AffiliateCommissionLineItem } from '@/lib/openclaw/affiliate-commission-types'
import type { AffiliatePlatform } from '@/lib/openclaw/affiliate-commission-attribution'

type LineFactRow = {
  user_id: number
  report_date: string
  platform: string
  brand_key: string
  brand_name: string
  commission: number
  advert_id: string | null
  asin: string | null
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function normalizeReportDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return String(value ?? '').trim().slice(0, 10)
}

function scopeBrandKey(userId: number, brandKey: string, showUserScope: boolean): string {
  if (!showUserScope) return brandKey
  return `user:${userId}:${brandKey}`
}

export function lineItemsToFactRows(lineItems: AffiliateCommissionLineItem[]): LineFactRow[] {
  return lineItems.map((item) => ({
    user_id: item.userId,
    report_date: normalizeReportDate(item.reportDate),
    platform: item.platform,
    brand_key: item.brandKey,
    brand_name: item.brandName,
    commission: item.commission,
    advert_id: item.advertId ?? null,
    asin: item.asin ?? null,
  }))
}

export function factRowsToLineItems(
  rows: LineFactRow[],
  userLabels: Map<number, string>,
  showUserScope: boolean
): AffiliateCommissionLineItem[] {
  return rows.map((row) => ({
    userId: row.user_id,
    username: userLabels.get(row.user_id) || `User ${row.user_id}`,
    reportDate: normalizeReportDate(row.report_date),
    platform: row.platform as AffiliatePlatform,
    brandKey: scopeBrandKey(row.user_id, row.brand_key, showUserScope),
    brandName: row.brand_name,
    commission: row.commission,
    advertId: row.advert_id,
    asin: row.asin,
  }))
}

export async function replaceAffiliateCommissionLineFacts(params: {
  userId: number
  reportDates: string[]
  lineItems: AffiliateCommissionLineItem[]
}): Promise<void> {
  const uniqueDates = Array.from(new Set(
    params.reportDates.map((date) => normalizeReportDate(date)).filter(Boolean)
  ))
  if (uniqueDates.length === 0) return

  const db = await getDatabase()
  const factRows = lineItemsToFactRows(
    params.lineItems.filter((item) => item.userId === params.userId)
  )

  await db.transaction(async () => {
    for (const reportDate of uniqueDates) {
      await db.exec(
        `
          DELETE FROM openclaw_affiliate_commission_line_facts
          WHERE user_id = ?
            AND report_date = ?
        `,
        [params.userId, reportDate]
      )
    }

    for (const row of factRows) {
      await db.exec(
        `
          INSERT INTO openclaw_affiliate_commission_line_facts
            (user_id, report_date, platform, brand_key, brand_name, commission, advert_id, asin, rebuilt_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc(db.type)})
        `,
        [
          row.user_id,
          row.report_date,
          row.platform,
          row.brand_key,
          row.brand_name,
          row.commission,
          row.advert_id,
          row.asin,
        ]
      )
    }
  })
}

function buildPlatformClause(platform: string): { clause: string; params: unknown[] } {
  if (platform === 'yeahpromos' || platform === 'partnerboost') {
    return { clause: 'AND platform = ?', params: [platform] }
  }
  return { clause: '', params: [] }
}

export async function loadAffiliateCommissionLineFacts(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
}): Promise<LineFactRow[]> {
  if (params.userIds.length === 0) return []

  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)
  const rows: LineFactRow[] = []

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const chunkRows = await db.query<LineFactRow>(
      `
        SELECT user_id, report_date, platform, brand_key, brand_name, commission, advert_id, asin
        FROM openclaw_affiliate_commission_line_facts
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${platformFilter.clause}
        ORDER BY user_id ASC, report_date ASC, platform ASC, brand_key ASC
      `,
      [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
    )
    rows.push(...chunkRows.map((row) => ({
      ...row,
      report_date: normalizeReportDate(row.report_date),
    })))
  }

  return rows
}

export async function getAffiliateCommissionLineFactsRebuiltAt(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
}): Promise<string | null> {
  if (params.userIds.length === 0) return null

  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)
  let maxRebuiltAt: string | null = null

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const row = await db.queryOne<{ max_rebuilt_at: unknown }>(
      `
        SELECT MAX(rebuilt_at) AS max_rebuilt_at
        FROM openclaw_affiliate_commission_line_facts
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${platformFilter.clause}
      `,
      [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
    )
    const candidate = row?.max_rebuilt_at ? String(row.max_rebuilt_at) : null
    if (!candidate) continue
    if (!maxRebuiltAt || candidate > maxRebuiltAt) {
      maxRebuiltAt = candidate
    }
  }

  return maxRebuiltAt
}

export async function hasAffiliateCommissionLineFacts(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
}): Promise<boolean> {
  if (params.userIds.length === 0) return false

  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const row = await db.queryOne<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM openclaw_affiliate_commission_line_facts
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${platformFilter.clause}
      `,
      [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
    )
    if ((row?.count ?? 0) > 0) {
      return true
    }
  }

  return false
}

export async function getAffiliateCommissionRawSourceUpdatedAt(params: {
  userIds: number[]
  startDate: string
  endDate: string
}): Promise<string | null> {
  if (params.userIds.length === 0) return null

  const db = await getDatabase()
  let maxUpdatedAt: string | null = null

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const row = await db.queryOne<{ max_updated_at: unknown }>(
      `
        SELECT MAX(updated_at) AS max_updated_at
        FROM openclaw_affiliate_commission_raw_sync_payloads
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
      `,
      [...userIdChunk, params.startDate, params.endDate]
    )
    const candidate = row?.max_updated_at ? String(row.max_updated_at) : null
    if (!candidate) continue
    if (!maxUpdatedAt || candidate > maxUpdatedAt) {
      maxUpdatedAt = candidate
    }
  }

  return maxUpdatedAt
}
