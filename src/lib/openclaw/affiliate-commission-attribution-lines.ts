import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'
import {
  extractBrandFromRaw,
} from '@/lib/openclaw/affiliate-commission-attribution'
import type { AffiliateCommissionReportPlatformFilter } from '@/lib/openclaw/affiliate-commission-platform'
import type { AffiliateCommissionLineItem } from '@/lib/openclaw/affiliate-commission-types'
import { extractPartnerboostBrandFromRow } from '@/lib/openclaw/partnerboost-commission-rows'
import { getYeahPromosFieldValue } from '@/lib/openclaw/yeahpromos-commission-rows'

const YEAHPROMOS_ADVERT_ID_ALIASES = ['advert_id', 'advertId', 'mid']
const YEAHPROMOS_ADVERT_NAME_ALIASES = ['advert_name', 'advertName']

type AttributionCommissionRow = {
  user_id: number
  report_date: string
  platform: string
  source_mid: string | null
  source_asin: string | null
  commission_amount: number
  raw_payload: unknown
}

function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function normalizeReportDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return String(value ?? '').trim().slice(0, 10)
}

function normalizeAsin(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return null
  const cleaned = text.replace(/[^A-Z0-9]/g, '')
  if (!cleaned) return null
  return cleaned.length > 10 ? cleaned.slice(0, 10) : cleaned
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function scopeBrandKey(userId: number, brandKey: string, showUserScope: boolean): string {
  if (!showUserScope) return brandKey
  return `user:${userId}:${brandKey}`
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function buildPlatformClause(platform: AffiliateCommissionReportPlatformFilter): {
  clause: string
  params: unknown[]
} {
  if (platform === 'yeahpromos' || platform === 'partnerboost') {
    return { clause: 'AND platform = ?', params: [platform] }
  }
  return { clause: '', params: [] }
}

function parseAttributionRawPayload(rawPayload: unknown): unknown {
  const parsed = parseJsonField(rawPayload, null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed
  }

  const record = parsed as Record<string, unknown>
  if (record.value && typeof record.value === 'object' && !Array.isArray(record.value)) {
    return record.value
  }

  return parsed
}

function buildYeahPromosLineItem(params: {
  userId: number
  username: string
  reportDate: string
  showUserScope: boolean
  row: AttributionCommissionRow
}): AffiliateCommissionLineItem | null {
  const commission = roundTo4(Number(params.row.commission_amount) || 0)
  if (commission <= 0) return null

  const raw = parseAttributionRawPayload(params.row.raw_payload)
  const advertId = pickString(
    params.row.source_mid,
    getYeahPromosFieldValue(raw, YEAHPROMOS_ADVERT_ID_ALIASES),
  )
  const brandName = pickString(
    getYeahPromosFieldValue(raw, YEAHPROMOS_ADVERT_NAME_ALIASES),
    extractBrandFromRaw(raw),
  ) || (advertId ? `Advert ${advertId}` : 'Unknown Brand')
  const baseBrandKey = advertId
    ? `yeahpromos:advert:${advertId}`
    : `yeahpromos:brand:${brandName.toLowerCase()}`

  return {
    userId: params.userId,
    username: params.username,
    reportDate: params.reportDate,
    platform: 'yeahpromos',
    brandKey: scopeBrandKey(params.userId, baseBrandKey, params.showUserScope),
    brandName,
    commission,
    advertId,
    asin: normalizeAsin(params.row.source_asin),
  }
}

function buildPartnerboostLineItem(params: {
  userId: number
  username: string
  reportDate: string
  showUserScope: boolean
  row: AttributionCommissionRow
}): AffiliateCommissionLineItem | null {
  const commission = roundTo4(Number(params.row.commission_amount) || 0)
  if (commission <= 0) return null

  const raw = parseAttributionRawPayload(params.row.raw_payload)
  const asin = normalizeAsin(params.row.source_asin)
  const brandName = pickString(
    extractPartnerboostBrandFromRow(raw),
    extractBrandFromRaw(raw),
  ) || (asin ? `ASIN ${asin}` : 'Unknown Brand')
  const brandSlug = brandName.trim().toLowerCase() || 'unknown brand'
  const baseBrandKey = asin
    ? `partnerboost:${asin}:${brandSlug}`
    : `partnerboost:brand:${brandSlug}`

  return {
    userId: params.userId,
    username: params.username,
    reportDate: params.reportDate,
    platform: 'partnerboost',
    brandKey: scopeBrandKey(params.userId, baseBrandKey, params.showUserScope),
    brandName,
    commission,
    asin,
  }
}

function buildLineItemFromAttributionRow(params: {
  row: AttributionCommissionRow
  username: string
  showUserScope: boolean
}): AffiliateCommissionLineItem | null {
  const reportDate = normalizeReportDate(params.row.report_date)
  const platform = params.row.platform === 'partnerboost' ? 'partnerboost' : 'yeahpromos'

  if (platform === 'yeahpromos') {
    return buildYeahPromosLineItem({
      userId: params.row.user_id,
      username: params.username,
      reportDate,
      showUserScope: params.showUserScope,
      row: params.row,
    })
  }

  return buildPartnerboostLineItem({
    userId: params.row.user_id,
    username: params.username,
    reportDate,
    showUserScope: params.showUserScope,
    row: params.row,
  })
}

async function loadAttributionCommissionRows(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
}): Promise<AttributionCommissionRow[]> {
  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)
  const rows: AttributionCommissionRow[] = []

  for (const userIdChunk of chunkArray(params.userIds, 100)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const chunkRows = await db.query<AttributionCommissionRow>(
      `
        SELECT
          user_id,
          report_date,
          platform,
          source_mid,
          source_asin,
          commission_amount,
          raw_payload
        FROM affiliate_commission_attributions
        WHERE user_id IN (${placeholders})
          AND report_date >= ?
          AND report_date <= ?
          ${platformFilter.clause}
          AND commission_amount > 0
      `,
      [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
    )
    rows.push(...chunkRows)
  }

  return rows
}

async function loadFailureCommissionRows(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
}): Promise<AttributionCommissionRow[]> {
  const db = await getDatabase()
  const platformFilter = buildPlatformClause(params.platform)
  const rows: AttributionCommissionRow[] = []

  try {
    for (const userIdChunk of chunkArray(params.userIds, 100)) {
      const placeholders = userIdChunk.map(() => '?').join(', ')
      const chunkRows = await db.query<AttributionCommissionRow>(
        `
          SELECT
            user_id,
            report_date,
            platform,
            source_mid,
            source_asin,
            commission_amount,
            raw_payload
          FROM openclaw_affiliate_attribution_failures
          WHERE user_id IN (${placeholders})
            AND report_date >= ?
            AND report_date <= ?
            ${platformFilter.clause}
            AND commission_amount > 0
        `,
        [...userIdChunk, params.startDate, params.endDate, ...platformFilter.params]
      )
      rows.push(...chunkRows)
    }
  } catch (error: unknown) {
    const message = String((error as Error)?.message || '')
    if (
      /openclaw_affiliate_attribution_failures/i.test(message)
      && /(no such table|does not exist|no such column|column .* does not exist)/i.test(message)
    ) {
      return []
    }
    throw error
  }

  return rows
}

export function sumAffiliateCommissionLineItems(items: AffiliateCommissionLineItem[]): number {
  return roundTo4(items.reduce((sum, item) => sum + (Number(item.commission) || 0), 0))
}

/**
 * Build commission line items from persisted sync attributions (same rows campaigns uses).
 * Includes both attributed rows and unattributed failure audit rows.
 */
export async function loadAffiliateCommissionLineItemsFromAttributions(params: {
  userIds: number[]
  userLabels: Map<number, string>
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
  showUserScope: boolean
}): Promise<AffiliateCommissionLineItem[]> {
  if (params.userIds.length === 0) return []

  const [attributionRows, failureRows] = await Promise.all([
    loadAttributionCommissionRows(params),
    loadFailureCommissionRows(params),
  ])

  const items: AffiliateCommissionLineItem[] = []

  for (const row of [...attributionRows, ...failureRows]) {
    if (row.platform !== 'yeahpromos' && row.platform !== 'partnerboost') continue
    const username = params.userLabels.get(row.user_id) || `User ${row.user_id}`
    const item = buildLineItemFromAttributionRow({
      row,
      username,
      showUserScope: params.showUserScope,
    })
    if (item) items.push(item)
  }

  return items
}

export function preferAttributionLineItemsIfHigher(params: {
  rawDerived: AffiliateCommissionLineItem[]
  attributionDerived: AffiliateCommissionLineItem[]
}): AffiliateCommissionLineItem[] {
  if (params.attributionDerived.length === 0) {
    return params.rawDerived
  }

  const rawTotal = sumAffiliateCommissionLineItems(params.rawDerived)
  const attributionTotal = sumAffiliateCommissionLineItems(params.attributionDerived)

  if (attributionTotal > rawTotal + 0.001) {
    return params.attributionDerived
  }

  return params.rawDerived
}
