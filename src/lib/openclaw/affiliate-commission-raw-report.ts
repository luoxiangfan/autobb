import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'
import type { AffiliatePlatform } from '@/lib/openclaw/affiliate-commission-attribution'

export type AffiliateCommissionReportViewMode = 'brand' | 'date'

export type AffiliateCommissionReportPlatformFilter = AffiliatePlatform | 'all'

export type AffiliateCommissionLineItem = {
  userId: number
  username: string
  reportDate: string
  platform: AffiliatePlatform
  brandKey: string
  brandName: string
  commission: number
  advertId?: string | null
  asin?: string | null
}

export type AffiliateCommissionBrandSummary = {
  brandKey: string
  brandName: string
  platform: AffiliatePlatform
  totalCommission: number
  userId?: number
  username?: string
}

export type AffiliateCommissionDateSummary = {
  reportDate: string
  totalCommission: number
}

export type AffiliateCommissionBrandDetailRow = {
  reportDate: string
  commission: number
}

export type AffiliateCommissionDateDetailRow = {
  brandKey: string
  brandName: string
  platform: AffiliatePlatform
  commission: number
  userId?: number
  username?: string
}

export type AffiliateCommissionReportResult = {
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
  viewMode: AffiliateCommissionReportViewMode
  currency: string
  totalCommission: number
  showUserScope: boolean
  brandSummaries: AffiliateCommissionBrandSummary[]
  dateSummaries: AffiliateCommissionDateSummary[]
}

export type ActiveNonAdminUser = {
  id: number
  username: string
}

const SUPPORTED_SOURCES: Array<{ platform: AffiliatePlatform; sourceApi: string }> = [
  { platform: 'yeahpromos', sourceApi: 'getorder' },
  { platform: 'partnerboost', sourceApi: 'amazon_report' },
]

type RawSyncPayloadRow = {
  user_id: number
  report_date: string
  platform: string
  source_api: string
  response_payload: unknown
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function parseNumberish(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '').trim()
    if (!normalized) return fallback
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeAsin(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return null
  const cleaned = text.replace(/[^A-Z0-9]/g, '')
  if (!cleaned) return null
  return cleaned.length > 10 ? cleaned.slice(0, 10) : cleaned
}

function normalizeBrand(value: unknown): string | null {
  const text = String(value || '').trim()
  return text || null
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function scopeBrandKey(userId: number, brandKey: string, showUserScope: boolean): string {
  if (!showUserScope) return brandKey
  return `user:${userId}:${brandKey}`
}

function normalizeYeahPromosRows(payload: unknown): any[] {
  const parsed = payload as any
  const container = parsed?.Data ?? parsed?.data ?? parsed

  if (Array.isArray(container)) return container
  if (Array.isArray(container?.Data)) return container.Data
  if (Array.isArray(container?.data)) return container.data
  if (Array.isArray(container?.list)) return container.list
  if (Array.isArray(parsed?.Data)) return parsed.Data
  if (Array.isArray(parsed?.data)) return parsed.data
  return []
}

function normalizePartnerboostRows(payload: unknown): any[] {
  const parsed = payload as any
  const data = parsed?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.list)) return data.list
  if (Array.isArray(parsed?.list)) return parsed.list
  return []
}

function parseYeahPromosLineItems(params: {
  userId: number
  username: string
  reportDate: string
  payload: unknown
  showUserScope: boolean
}): AffiliateCommissionLineItem[] {
  const rows = normalizeYeahPromosRows(params.payload)
  const items: AffiliateCommissionLineItem[] = []

  for (const row of rows) {
    const commission = parseNumberish(row?.sale_comm ?? row?.saleComm, 0)
    if (commission <= 0) continue

    const advertId = pickString(row?.advert_id, row?.advertId)
    const brandName = pickString(row?.advert_name, row?.advertName)
      || (advertId ? `Advert ${advertId}` : 'Unknown Brand')
    const baseBrandKey = advertId
      ? `yeahpromos:advert:${advertId}`
      : `yeahpromos:brand:${brandName.toLowerCase()}`

    items.push({
      userId: params.userId,
      username: params.username,
      reportDate: params.reportDate,
      platform: 'yeahpromos',
      brandKey: scopeBrandKey(params.userId, baseBrandKey, params.showUserScope),
      brandName,
      commission: roundTo2(commission),
      advertId,
      asin: normalizeAsin(pickString(row?.sku, row?.asin, row?.ASIN)),
    })
  }

  return items
}

function parsePartnerboostLineItems(params: {
  userId: number
  username: string
  reportDate: string
  payload: unknown
  showUserScope: boolean
}): AffiliateCommissionLineItem[] {
  const rows = normalizePartnerboostRows(params.payload)
  const items: AffiliateCommissionLineItem[] = []

  for (const row of rows) {
    const commission = parseNumberish(row?.estCommission ?? row?.est_commission, 0)
    if (commission <= 0) continue

    const asin = normalizeAsin(pickString(row?.asin, row?.ASIN, row?.product_id, row?.productId))
    const baseBrandKey = asin
      ? `partnerboost:asin:${asin}`
      : `partnerboost:row:${items.length}`

    items.push({
      userId: params.userId,
      username: params.username,
      reportDate: params.reportDate,
      platform: 'partnerboost',
      brandKey: scopeBrandKey(params.userId, baseBrandKey, params.showUserScope),
      brandName: asin ? `ASIN ${asin}` : 'Unknown Brand',
      commission: roundTo2(commission),
      asin,
    })
  }

  return items
}

async function loadPartnerboostBrandMap(params: {
  userIds: number[]
  asins: string[]
}): Promise<Map<string, string>> {
  const brandByUserAsin = new Map<string, string>()
  if (params.userIds.length === 0 || params.asins.length === 0) {
    return brandByUserAsin
  }

  const db = await getDatabase()

  for (const asinChunk of chunkArray(params.asins, 200)) {
    const asinPlaceholders = asinChunk.map(() => '?').join(', ')
    const userPlaceholders = params.userIds.map(() => '?').join(', ')

    const affiliateProductRows = await db.query<{ user_id: number; asin: string; brand: string }>(
      `
        SELECT DISTINCT user_id, asin, brand
        FROM affiliate_products
        WHERE user_id IN (${userPlaceholders})
          AND platform = 'partnerboost'
          AND asin IS NOT NULL
          AND brand IS NOT NULL
          AND UPPER(asin) IN (${asinPlaceholders})
      `,
      [...params.userIds, ...asinChunk]
    )

    for (const row of affiliateProductRows) {
      const asin = normalizeAsin(row.asin)
      const brand = normalizeBrand(row.brand)
      if (!asin || !brand) continue
      const mapKey = `${row.user_id}:${asin}`
      if (!brandByUserAsin.has(mapKey)) {
        brandByUserAsin.set(mapKey, brand)
      }
    }

    const openclawProductRows = await db.query<{ user_id: number; asin: string; brand: string }>(
      `
        SELECT DISTINCT user_id, asin, brand_name AS brand
        FROM openclaw_affiliate_products
        WHERE user_id IN (${userPlaceholders})
          AND platform = 'partnerboost'
          AND asin IS NOT NULL
          AND brand_name IS NOT NULL
          AND UPPER(asin) IN (${asinPlaceholders})
      `,
      [...params.userIds, ...asinChunk]
    )

    for (const row of openclawProductRows) {
      const asin = normalizeAsin(row.asin)
      const brand = normalizeBrand(row.brand)
      if (!asin || !brand) continue
      const mapKey = `${row.user_id}:${asin}`
      if (!brandByUserAsin.has(mapKey)) {
        brandByUserAsin.set(mapKey, brand)
      }
    }
  }

  return brandByUserAsin
}

function applyPartnerboostBrandNames(
  items: AffiliateCommissionLineItem[],
  brandByUserAsin: Map<string, string>,
  showUserScope: boolean
): AffiliateCommissionLineItem[] {
  return items.map((item) => {
    if (item.platform !== 'partnerboost' || !item.asin) {
      return item
    }

    const brandName = brandByUserAsin.get(`${item.userId}:${item.asin}`) || item.brandName
    const baseBrandKey = `partnerboost:${item.asin}:${brandName.toLowerCase()}`
    return {
      ...item,
      brandKey: scopeBrandKey(item.userId, baseBrandKey, showUserScope),
      brandName,
    }
  })
}

async function loadRawSyncPayloadRows(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
}): Promise<RawSyncPayloadRow[]> {
  if (params.userIds.length === 0) return []

  const db = await getDatabase()
  const userPlaceholders = params.userIds.map(() => '?').join(', ')
  const queryParams: unknown[] = [...params.userIds, params.startDate, params.endDate]
  let platformClause = ''

  if (params.platform !== 'all') {
    platformClause = 'AND platform = ?'
    queryParams.push(params.platform)
  }

  return db.query<RawSyncPayloadRow>(
    `
      SELECT user_id, report_date, platform, source_api, response_payload
      FROM openclaw_affiliate_commission_raw_sync_payloads
      WHERE user_id IN (${userPlaceholders})
        AND report_date >= ?
        AND report_date <= ?
        ${platformClause}
        AND (
          (platform = 'yeahpromos' AND source_api = 'getorder')
          OR (platform = 'partnerboost' AND source_api = 'amazon_report')
        )
      ORDER BY user_id ASC, report_date ASC, platform ASC, source_api ASC, page_no ASC
    `,
    queryParams
  )
}

export async function listActiveNonAdminUsers(): Promise<ActiveNonAdminUser[]> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = TRUE' : 'is_active = 1'

  return db.query<ActiveNonAdminUser>(
    `
      SELECT id, username
      FROM users
      WHERE role != 'admin'
        AND ${isActiveCondition}
      ORDER BY username ASC
    `
  )
}

export async function resolveTargetUserIds(params: {
  isAdmin: boolean
  currentUserId: number
  requestedUserIds: number[]
}): Promise<number[]> {
  if (!params.isAdmin) {
    return [params.currentUserId]
  }

  const allowedUsers = await listActiveNonAdminUsers()
  const allowedIds = new Set(allowedUsers.map((user) => user.id))

  if (params.requestedUserIds.length > 0) {
    const filtered = params.requestedUserIds.filter((userId) => allowedIds.has(userId))
    if (filtered.length === 0) {
      throw new Error('未选择有效的活跃用户')
    }
    return filtered
  }

  return allowedUsers.map((user) => user.id)
}

export async function buildUserLabelMap(userIds: number[]): Promise<Map<number, string>> {
  if (userIds.length === 0) return new Map()

  const db = await getDatabase()
  const placeholders = userIds.map(() => '?').join(', ')
  const rows = await db.query<{ id: number; username: string }>(
    `SELECT id, username FROM users WHERE id IN (${placeholders})`,
    userIds
  )

  return new Map(rows.map((row) => [row.id, row.username]))
}

export async function loadAffiliateCommissionLineItems(params: {
  userIds: number[]
  userLabels?: Map<number, string>
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
  showUserScope?: boolean
}): Promise<AffiliateCommissionLineItem[]> {
  const showUserScope = params.showUserScope ?? params.userIds.length > 1
  const userLabels = params.userLabels ?? await buildUserLabelMap(params.userIds)
  const rows = await loadRawSyncPayloadRows({
    userIds: params.userIds,
    startDate: params.startDate,
    endDate: params.endDate,
    platform: params.platform,
  })

  const lineItems: AffiliateCommissionLineItem[] = []

  for (const row of rows) {
    const username = userLabels.get(row.user_id) || `User ${row.user_id}`
    const payload = parseJsonField(row.response_payload, null)
    if (!payload) continue

    if (row.platform === 'yeahpromos' && row.source_api === 'getorder') {
      lineItems.push(...parseYeahPromosLineItems({
        userId: row.user_id,
        username,
        reportDate: row.report_date,
        payload,
        showUserScope,
      }))
      continue
    }

    if (row.platform === 'partnerboost' && row.source_api === 'amazon_report') {
      lineItems.push(...parsePartnerboostLineItems({
        userId: row.user_id,
        username,
        reportDate: row.report_date,
        payload,
        showUserScope,
      }))
    }
  }

  const partnerboostAsins = Array.from(new Set(
    lineItems
      .filter((item) => item.platform === 'partnerboost' && item.asin)
      .map((item) => item.asin as string)
  ))

  const brandByUserAsin = await loadPartnerboostBrandMap({
    userIds: params.userIds,
    asins: partnerboostAsins,
  })

  return applyPartnerboostBrandNames(lineItems, brandByUserAsin, showUserScope)
}

function buildBrandSummaries(
  items: AffiliateCommissionLineItem[],
  showUserScope: boolean
): AffiliateCommissionBrandSummary[] {
  const summaryMap = new Map<string, AffiliateCommissionBrandSummary>()

  for (const item of items) {
    const existing = summaryMap.get(item.brandKey)
    if (existing) {
      existing.totalCommission = roundTo2(existing.totalCommission + item.commission)
      continue
    }

    summaryMap.set(item.brandKey, {
      brandKey: item.brandKey,
      brandName: item.brandName,
      platform: item.platform,
      totalCommission: item.commission,
      ...(showUserScope
        ? { userId: item.userId, username: item.username }
        : {}),
    })
  }

  return Array.from(summaryMap.values())
    .sort((left, right) => {
      if (showUserScope) {
        const usernameCompare = String(left.username || '').localeCompare(String(right.username || ''))
        if (usernameCompare !== 0) return usernameCompare
      }
      if (right.totalCommission !== left.totalCommission) {
        return right.totalCommission - left.totalCommission
      }
      return left.brandName.localeCompare(right.brandName)
    })
}

function buildDateSummaries(items: AffiliateCommissionLineItem[]): AffiliateCommissionDateSummary[] {
  const summaryMap = new Map<string, AffiliateCommissionDateSummary>()

  for (const item of items) {
    const existing = summaryMap.get(item.reportDate)
    if (existing) {
      existing.totalCommission = roundTo2(existing.totalCommission + item.commission)
      continue
    }

    summaryMap.set(item.reportDate, {
      reportDate: item.reportDate,
      totalCommission: item.commission,
    })
  }

  return Array.from(summaryMap.values())
    .sort((left, right) => right.reportDate.localeCompare(left.reportDate))
}

export async function getAffiliateCommissionReport(params: {
  userIds: number[]
  userLabels?: Map<number, string>
  startDate: string
  endDate: string
  platform?: AffiliateCommissionReportPlatformFilter
  viewMode?: AffiliateCommissionReportViewMode
  showUserScope?: boolean
}): Promise<AffiliateCommissionReportResult> {
  const platform = params.platform || 'all'
  const viewMode = params.viewMode || 'brand'
  const showUserScope = params.showUserScope ?? params.userIds.length > 1
  const lineItems = await loadAffiliateCommissionLineItems({
    userIds: params.userIds,
    userLabels: params.userLabels,
    startDate: params.startDate,
    endDate: params.endDate,
    platform,
    showUserScope,
  })

  const totalCommission = roundTo2(
    lineItems.reduce((sum, item) => sum + item.commission, 0)
  )

  return {
    startDate: params.startDate,
    endDate: params.endDate,
    platform,
    viewMode,
    currency: 'USD',
    totalCommission,
    showUserScope,
    brandSummaries: buildBrandSummaries(lineItems, showUserScope),
    dateSummaries: buildDateSummaries(lineItems),
  }
}

export async function getAffiliateCommissionBrandDetail(params: {
  userIds: number[]
  userLabels?: Map<number, string>
  startDate: string
  endDate: string
  platform?: AffiliateCommissionReportPlatformFilter
  brandKey: string
  showUserScope?: boolean
}): Promise<AffiliateCommissionBrandDetailRow[]> {
  const platform = params.platform || 'all'
  const showUserScope = params.showUserScope ?? params.userIds.length > 1
  const lineItems = await loadAffiliateCommissionLineItems({
    userIds: params.userIds,
    userLabels: params.userLabels,
    startDate: params.startDate,
    endDate: params.endDate,
    platform,
    showUserScope,
  })

  const detailMap = new Map<string, number>()
  for (const item of lineItems) {
    if (item.brandKey !== params.brandKey) continue
    detailMap.set(item.reportDate, roundTo2((detailMap.get(item.reportDate) || 0) + item.commission))
  }

  return Array.from(detailMap.entries())
    .map(([reportDate, commission]) => ({ reportDate, commission }))
    .sort((left, right) => right.reportDate.localeCompare(left.reportDate))
}

export async function getAffiliateCommissionDateDetail(params: {
  userIds: number[]
  userLabels?: Map<number, string>
  reportDate: string
  platform?: AffiliateCommissionReportPlatformFilter
  showUserScope?: boolean
}): Promise<AffiliateCommissionDateDetailRow[]> {
  const platform = params.platform || 'all'
  const showUserScope = params.showUserScope ?? params.userIds.length > 1
  const lineItems = await loadAffiliateCommissionLineItems({
    userIds: params.userIds,
    userLabels: params.userLabels,
    startDate: params.reportDate,
    endDate: params.reportDate,
    platform,
    showUserScope,
  })

  const detailMap = new Map<string, AffiliateCommissionDateDetailRow>()
  for (const item of lineItems) {
    const existing = detailMap.get(item.brandKey)
    if (existing) {
      existing.commission = roundTo2(existing.commission + item.commission)
      continue
    }

    detailMap.set(item.brandKey, {
      brandKey: item.brandKey,
      brandName: item.brandName,
      platform: item.platform,
      commission: item.commission,
      ...(showUserScope
        ? { userId: item.userId, username: item.username }
        : {}),
    })
  }

  return Array.from(detailMap.values())
    .sort((left, right) => {
      if (showUserScope) {
        const usernameCompare = String(left.username || '').localeCompare(String(right.username || ''))
        if (usernameCompare !== 0) return usernameCompare
      }
      if (right.commission !== left.commission) {
        return right.commission - left.commission
      }
      return left.brandName.localeCompare(right.brandName)
    })
}

export function isSupportedAffiliateCommissionSource(platform: string, sourceApi: string): boolean {
  return SUPPORTED_SOURCES.some((item) => item.platform === platform && item.sourceApi === sourceApi)
}

export function parseRequestedUserIds(value: string | null | undefined): number[] {
  const raw = String(value || '').trim()
  if (!raw) return []

  return Array.from(new Set(
    raw
      .split(',')
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((userId) => Number.isFinite(userId) && userId > 0)
  ))
}
