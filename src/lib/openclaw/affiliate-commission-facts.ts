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

function lineItemsToFactRows(lineItems: AffiliateCommissionLineItem[]): LineFactRow[] {
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

const RAW_SUPPORTED_SOURCE_SQL = `
  (
    (platform = 'yeahpromos' AND source_api = 'getorder')
    OR (platform = 'partnerboost' AND source_api IN ('amazon_report', 'transaction'))
  )
`

function buildRawSourcePlatformClause(platform: string): { clause: string; params: unknown[] } {
  if (platform === 'yeahpromos') {
    return { clause: `AND platform = 'yeahpromos'`, params: [] }
  }
  if (platform === 'partnerboost') {
    return { clause: `AND platform = 'partnerboost'`, params: [] }
  }
  return { clause: '', params: [] }
}

/**
 * Facts fast-path is safe only when every raw-sync date in range has fresh rebuilt facts.
 * Partial coverage (e.g. facts for May 10+ but raw for May 1-4) must fall back to raw parse.
 */
export async function affiliateCommissionFactsCoverRawRange(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
  minRebuiltAt?: string | null
}): Promise<boolean> {
  if (params.userIds.length === 0) return false

  const db = await getDatabase()
  const rawPlatformFilter = buildRawSourcePlatformClause(params.platform)
  const factPlatformFilter = buildPlatformClause(params.platform)
  const rawDatesByKey = new Map<string, { maxUpdatedAt: string | null }>()

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const rows = await db.query<{
      user_id: number
      report_date: unknown
      max_updated_at: unknown
    }>(
      `
        SELECT user_id, report_date, MAX(updated_at) AS max_updated_at
        FROM openclaw_affiliate_commission_raw_sync_payloads
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${rawPlatformFilter.clause}
          AND ${RAW_SUPPORTED_SOURCE_SQL}
        GROUP BY user_id, report_date
      `,
      [...userIdChunk, params.startDate, params.endDate, ...rawPlatformFilter.params]
    )

    for (const row of rows) {
      const reportDate = normalizeReportDate(row.report_date)
      rawDatesByKey.set(`${row.user_id}:${reportDate}`, {
        maxUpdatedAt: row.max_updated_at ? String(row.max_updated_at) : null,
      })
    }
  }

  if (rawDatesByKey.size === 0) return false

  const factRebuiltByKey = new Map<string, string>()

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const rows = await db.query<{
      user_id: number
      report_date: unknown
      max_rebuilt_at: unknown
    }>(
      `
        SELECT user_id, report_date, MAX(rebuilt_at) AS max_rebuilt_at
        FROM openclaw_affiliate_commission_line_facts
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${factPlatformFilter.clause}
        GROUP BY user_id, report_date
      `,
      [...userIdChunk, params.startDate, params.endDate, ...factPlatformFilter.params]
    )

    for (const row of rows) {
      const reportDate = normalizeReportDate(row.report_date)
      const rebuiltAt = row.max_rebuilt_at ? String(row.max_rebuilt_at) : null
      if (!rebuiltAt) continue
      factRebuiltByKey.set(`${row.user_id}:${reportDate}`, rebuiltAt)
    }
  }

  const minRebuiltAt = params.minRebuiltAt || null

  for (const [key, raw] of rawDatesByKey.entries()) {
    const rebuiltAt = factRebuiltByKey.get(key)
    if (!rebuiltAt) return false
    if (minRebuiltAt && rebuiltAt < minRebuiltAt) return false
    if (raw.maxUpdatedAt && rebuiltAt < raw.maxUpdatedAt) return false
  }

  return true
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

export type AffiliateCommissionFactsBrandAggregate = {
  user_id: number
  platform: string
  brand_key: string
  brand_name: string
  total_commission: number
}

export type AffiliateCommissionFactsDateAggregate = {
  report_date: string
  total_commission: number
}

export async function sumAffiliateCommissionFromFacts(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
}): Promise<number> {
  if (params.userIds.length === 0) return 0

  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)
  let total = 0

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const row = await db.queryOne<{ total_commission: unknown }>(
      `
        SELECT COALESCE(SUM(commission), 0) AS total_commission
        FROM openclaw_affiliate_commission_line_facts
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${platformFilter.clause}
      `,
      [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
    )
    total += Number(row?.total_commission) || 0
  }

  return Math.round(total * 100) / 100
}

export async function loadAffiliateCommissionBrandAggregatesFromFacts(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
}): Promise<AffiliateCommissionFactsBrandAggregate[]> {
  if (params.userIds.length === 0) return []

  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)
  const rows: AffiliateCommissionFactsBrandAggregate[] = []

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const chunkRows = await db.query<AffiliateCommissionFactsBrandAggregate>(
      `
        SELECT
          user_id,
          platform,
          brand_key,
          brand_name,
          SUM(commission) AS total_commission
        FROM openclaw_affiliate_commission_line_facts
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${platformFilter.clause}
        GROUP BY user_id, platform, brand_key, brand_name
      `,
      [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
    )
    rows.push(...chunkRows.map((row) => ({
      ...row,
      total_commission: Number(row.total_commission) || 0,
    })))
  }

  return rows
}

export async function loadAffiliateCommissionDateAggregatesFromFacts(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
}): Promise<AffiliateCommissionFactsDateAggregate[]> {
  if (params.userIds.length === 0) return []

  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)
  const summaryMap = new Map<string, number>()

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const chunkRows = await db.query<AffiliateCommissionFactsDateAggregate>(
      `
        SELECT report_date, SUM(commission) AS total_commission
        FROM openclaw_affiliate_commission_line_facts
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${platformFilter.clause}
        GROUP BY report_date
      `,
      [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
    )

    for (const row of chunkRows) {
      const reportDate = normalizeReportDate(row.report_date)
      const commission = Number(row.total_commission) || 0
      summaryMap.set(reportDate, (summaryMap.get(reportDate) || 0) + commission)
    }
  }

  return Array.from(summaryMap.entries()).map(([report_date, total_commission]) => ({
    report_date,
    total_commission,
  }))
}
