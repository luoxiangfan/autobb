import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/db'
import { parseStoredJsonPayload } from '@/lib/common/server'
import type { AffiliatePlatform } from '@/lib/openclaw/affiliate-commission/affiliate-commission-platform'
import {
  affiliateCommissionFactsCoverRawRange,
  factRowsToLineItems,
  getAffiliateCommissionRawSourceUpdatedAt,
  loadAffiliateCommissionBrandAggregatesFromFacts,
  loadAffiliateCommissionDateAggregatesFromFacts,
  loadAffiliateCommissionLineFacts,
  replaceAffiliateCommissionLineFacts,
  sumAffiliateCommissionFromFacts,
  type AffiliateCommissionFactsBrandAggregate } from '@/lib/openclaw/affiliate-commission/affiliate-commission-facts'
import type {
  AffiliateCommissionReportPlatformFilter,
  AffiliateCommissionReportViewMode } from '@/lib/openclaw/affiliate-commission/affiliate-commission-platform'
import {
  buildAffiliateCommissionDateBoundsCacheKey,
  buildAffiliateCommissionLineItemsCacheKey,
  readAffiliateCommissionDateBoundsMemoryCache,
  readAffiliateCommissionLineItemsDbCache,
  readAffiliateCommissionLineItemsMemoryCache,
  writeAffiliateCommissionDateBoundsMemoryCache,
  writeAffiliateCommissionLineItemsDbCache,
  writeAffiliateCommissionLineItemsMemoryCache } from '@/lib/openclaw/affiliate-commission/affiliate-commission-report-cache'
import type {
  ActiveNonAdminUser,
  AffiliateCommissionBrandDetailRow,
  AffiliateCommissionBrandSummary,
  AffiliateCommissionDateBounds,
  AffiliateCommissionDateDetailRow,
  AffiliateCommissionDateSummary,
  AffiliateCommissionLineItem,
  AffiliateCommissionReportResult } from '@/lib/openclaw/affiliate-commission/affiliate-commission-types'
import { normalizeOfferAsin } from '@/lib/openclaw/offers/offer-asin'
import { collectPartnerboostReportRows } from '@/lib/openclaw/affiliate-commission/partnerboost-commission-rows'
import { collectYeahPromosReportRows } from '@/lib/openclaw/affiliate-commission/yeahpromos-commission-rows'
import {
  reconcileAffiliateCommissionLineItems,
  sumAttributionCommissionTotals } from '@/lib/openclaw/affiliate-commission/affiliate-commission-attribution-lines'

// Facts built before aligned PartnerBoost/YeahPromos parsing under-count commission vs campaigns.
const AFFILIATE_COMMISSION_FACTS_MIN_REBUILT_AT = '2026-06-05T00:00:00.000Z'
/** Admin multi-user reports use SQL aggregates from facts when user count exceeds this threshold. */
const ADMIN_FACTS_AGGREGATED_REPORT_MIN_USER_IDS = 15

const SUPPORTED_SOURCES: Array<{ platform: AffiliatePlatform; sourceApi: string }> = [
  { platform: 'yeahpromos', sourceApi: 'getorder' },
  { platform: 'partnerboost', sourceApi: 'amazon_report' },
  { platform: 'partnerboost', sourceApi: 'transaction' },
]

type RawSyncPayloadRow = {
  user_id: number
  report_date: string
  platform: string
  source_api: string
  response_payload: unknown
  response_payload_codec?: string | null
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function roundTo4(value: number): number {
  return roundTo(value, 4)
}

function roundTo2(value: number): number {
  return roundTo(value, 2)
}

export function normalizeReportDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const text = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  if (text) {
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }

  return text.slice(0, 10)
}

function compareReportDatesDesc(left: string, right: string): number {
  return normalizeReportDate(right).localeCompare(normalizeReportDate(left))
}

function normalizeAsin(value: unknown): string | null {
  return normalizeOfferAsin(value)
}

function normalizeBrand(value: unknown): string | null {
  const text = String(value || '').trim()
  return text || null
}

export function offerUrlsContainAsin(
  url: unknown,
  finalUrl: unknown,
  asin: string
): boolean {
  const normalizedAsin = normalizeAsin(asin)
  if (!normalizedAsin) return false

  for (const value of [url, finalUrl]) {
    const text = String(value ?? '').trim()
    if (!text) continue

    const candidates = [text.toUpperCase()]
    if (/%[0-9A-Fa-f]{2}/.test(text)) {
      try {
        candidates.push(decodeURIComponent(text).toUpperCase())
      } catch {
        // ignore malformed percent-encoding
      }
    }

    if (candidates.some((candidate) => candidate.includes(normalizedAsin))) {
      return true
    }
  }

  return false
}

function stripPartnerboostRegionSuffix(brand: string): string {
  return brand.replace(/_([A-Z]{2})$/i, '').trim()
}

function isCompositePartnerboostBrand(brand: string): boolean {
  return /[/|]/.test(brand)
}

function splitPartnerboostBrandParts(brand: string): string[] {
  return brand
    .split(/[/|]/)
    .map((part) => stripPartnerboostRegionSuffix(part.trim()))
    .filter(Boolean)
}

export function resolvePartnerboostDisplayBrand(params: {
  productBrand?: string | null
  offerBrand?: string | null
}): string | null {
  const productBrand = normalizeBrand(params.productBrand)
  const offerBrand = normalizeBrand(params.offerBrand)

  if (offerBrand && !isCompositePartnerboostBrand(offerBrand)) {
    const productBase = productBrand ? stripPartnerboostRegionSuffix(productBrand) : null
    if (!productBase || isCompositePartnerboostBrand(productBase)) {
      return offerBrand
    }
  }

  if (productBrand) {
    const productBase = stripPartnerboostRegionSuffix(productBrand)
    if (isCompositePartnerboostBrand(productBase) && offerBrand) {
      const offerLower = offerBrand.toLowerCase()
      const matchedPart = splitPartnerboostBrandParts(productBase)
        .find((part) => part.toLowerCase() === offerLower)
      if (matchedPart) return matchedPart
      if (!isCompositePartnerboostBrand(offerBrand)) {
        return offerBrand
      }
    }
    return productBase
  }

  return offerBrand ? stripPartnerboostRegionSuffix(offerBrand) : null
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

function buildPartnerboostBrandSummaryKey(params: {
  userId: number
  brandName: string
  showUserScope: boolean
}): string {
  const brandSlug = params.brandName.trim().toLowerCase() || 'unknown brand'
  return scopeBrandKey(params.userId, `partnerboost:brand:${brandSlug}`, params.showUserScope)
}

function resolveBrandSummaryKey(
  item: AffiliateCommissionLineItem,
  showUserScope: boolean
): string {
  if (item.platform === 'partnerboost') {
    return buildPartnerboostBrandSummaryKey({
      userId: item.userId,
      brandName: item.brandName,
      showUserScope })
  }
  return item.brandKey
}

function lineItemMatchesBrandDetailKey(
  item: AffiliateCommissionLineItem,
  brandKey: string,
  showUserScope: boolean
): boolean {
  if (item.brandKey === brandKey) return true
  return resolveBrandSummaryKey(item, showUserScope) === brandKey
}

function parseYeahPromosLineItems(params: {
  userId: number
  username: string
  reportDate: string
  payload: unknown
  showUserScope: boolean
}): AffiliateCommissionLineItem[] {
  const rows = collectYeahPromosReportRows(params.payload)
  const items: AffiliateCommissionLineItem[] = []

  for (const row of rows) {
    const advertId = row.advertId
    const brandName = row.brandName
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
      commission: roundTo4(row.commission),
      advertId,
      asin: normalizeAsin(row.asin) })
  }

  return items
}

function parsePartnerboostLineItems(params: {
  userId: number
  username: string
  reportDate: string
  transactionPayloads: unknown[]
  reportPayloads: unknown[]
  showUserScope: boolean
}): {
  items: AffiliateCommissionLineItem[]
  rawBrandByUserAsin: Map<string, string>
} {
  const rows = collectPartnerboostReportRows({
    transactionPayloads: params.transactionPayloads,
    reportPayloads: params.reportPayloads })
  const items: AffiliateCommissionLineItem[] = []
  const rawBrandByUserAsin = new Map<string, string>()

  rows.forEach((row, index) => {
    const asin = normalizeAsin(row.asin)
    const baseBrandKey = asin
      ? `partnerboost:asin:${asin}`
      : `partnerboost:row:${index}`

    if (asin && row.rawBrand) {
      const mapKey = `${params.userId}:${asin}`
      if (!rawBrandByUserAsin.has(mapKey)) {
        rawBrandByUserAsin.set(mapKey, row.rawBrand)
      }
    }

    items.push({
      userId: params.userId,
      username: params.username,
      reportDate: params.reportDate,
      platform: 'partnerboost',
      brandKey: scopeBrandKey(params.userId, baseBrandKey, params.showUserScope),
      brandName: asin ? `ASIN ${asin}` : 'Unknown Brand',
      commission: roundTo4(row.commission),
      asin })
  })

  return { items, rawBrandByUserAsin }
}

type PartnerboostBrandLookupEntry = {
  userId: number
  asin: string
}

function buildPartnerboostBrandLookupEntries(
  lineItems: AffiliateCommissionLineItem[]
): PartnerboostBrandLookupEntry[] {
  const entries = new Map<string, PartnerboostBrandLookupEntry>()

  for (const item of lineItems) {
    if (item.platform !== 'partnerboost' || !item.asin) continue
    const normalizedAsin = normalizeAsin(item.asin)
    if (!normalizedAsin) continue
    entries.set(`${item.userId}:${normalizedAsin}`, {
      userId: item.userId,
      asin: normalizedAsin })
  }

  return Array.from(entries.values())
}

function flattenUserAsinTupleParams(entries: PartnerboostBrandLookupEntry[]): unknown[] {
  return entries.flatMap((entry) => [entry.userId, entry.asin])
}

function buildUserAsinTupleClause(entryCount: number): string {
  return Array(entryCount).fill('(?, ?)').join(', ')
}

function buildOfferBrandByUserAsin(
  offerRows: Array<{
    user_id: number
    brand: string | null
    asin?: string | null
    url: string | null
    final_url: string | null
  }>,
  entries: PartnerboostBrandLookupEntry[]
): Map<string, string> {
  const offerBrandByUserAsin = new Map<string, string>()
  if (entries.length === 0) {
    return offerBrandByUserAsin
  }

  const neededKeys = new Set(entries.map((entry) => `${entry.userId}:${entry.asin}`))

  for (const row of offerRows) {
    const brand = normalizeBrand(row.brand)
    if (!brand) continue

    const rowAsin = normalizeAsin(row.asin)
    if (rowAsin) {
      const mapKey = `${row.user_id}:${rowAsin}`
      if (neededKeys.has(mapKey) && !offerBrandByUserAsin.has(mapKey)) {
        offerBrandByUserAsin.set(mapKey, brand)
      }
    }
  }

  for (const entry of entries) {
    const mapKey = `${entry.userId}:${entry.asin}`
    if (offerBrandByUserAsin.has(mapKey)) continue

    for (const row of offerRows) {
      if (row.user_id !== entry.userId) continue
      if (!offerUrlsContainAsin(row.url, row.final_url, entry.asin)) continue

      const brand = normalizeBrand(row.brand)
      if (!brand) continue

      offerBrandByUserAsin.set(mapKey, brand)
      break
    }
  }

  return offerBrandByUserAsin
}

async function loadPartnerboostProductBrandsByEntries(
  entries: PartnerboostBrandLookupEntry[]
): Promise<Map<string, string>> {
  const productBrandByUserAsin = new Map<string, string>()
  if (entries.length === 0) {
    return productBrandByUserAsin
  }

  const db = await getDatabase()

  for (const entryChunk of chunkArray(entries, 100)) {
    const tupleClause = buildUserAsinTupleClause(entryChunk.length)
    const tupleParams = flattenUserAsinTupleParams(entryChunk)

    const affiliateProductRows = await db.query<{ user_id: number; asin: string; brand: string }>(
      `
        SELECT DISTINCT user_id, asin, brand
        FROM affiliate_products
        WHERE platform = 'partnerboost'
          AND asin IS NOT NULL
          AND brand IS NOT NULL
          AND (user_id, UPPER(asin)) IN (${tupleClause})
      `,
      tupleParams
    )

    for (const row of affiliateProductRows) {
      const asin = normalizeAsin(row.asin)
      const brand = normalizeBrand(row.brand)
      if (!asin || !brand) continue
      const mapKey = `${row.user_id}:${asin}`
      if (!productBrandByUserAsin.has(mapKey)) {
        productBrandByUserAsin.set(mapKey, brand)
      }
    }

    const openclawProductRows = await db.query<{ user_id: number; asin: string; brand: string }>(
      `
        SELECT DISTINCT user_id, asin, brand_name AS brand
        FROM openclaw_affiliate_products
        WHERE platform = 'partnerboost'
          AND asin IS NOT NULL
          AND brand_name IS NOT NULL
          AND (user_id, UPPER(asin)) IN (${tupleClause})
      `,
      tupleParams
    )

    for (const row of openclawProductRows) {
      const asin = normalizeAsin(row.asin)
      const brand = normalizeBrand(row.brand)
      if (!asin || !brand) continue
      const mapKey = `${row.user_id}:${asin}`
      if (!productBrandByUserAsin.has(mapKey)) {
        productBrandByUserAsin.set(mapKey, brand)
      }
    }
  }

  return productBrandByUserAsin
}

function normalizePartnerboostRawBrandFallback(rawBrand: string | null | undefined): string | null {
  const brand = normalizeBrand(rawBrand)
  if (!brand) return null
  return stripPartnerboostRegionSuffix(brand)
}

async function loadPartnerboostGlobalProductBrandsByAsins(
  asins: string[]
): Promise<Map<string, string>> {
  const globalBrandByAsin = new Map<string, string>()
  if (asins.length === 0) {
    return globalBrandByAsin
  }

  const db = await getDatabase()

  for (const asinChunk of chunkArray(asins, 200)) {
    const asinPlaceholders = asinChunk.map(() => '?').join(', ')
    const rows = await db.query<{ asin: string; brand: string }>(
      `
        SELECT DISTINCT asin, brand
        FROM affiliate_products
        WHERE platform = 'partnerboost'
          AND user_id = 1
          AND asin IS NOT NULL
          AND brand IS NOT NULL
          AND UPPER(asin) IN (${asinPlaceholders})
      `,
      asinChunk
    )

    for (const row of rows) {
      const asin = normalizeAsin(row.asin)
      const brand = normalizeBrand(row.brand)
      if (!asin || !brand || globalBrandByAsin.has(asin)) continue
      globalBrandByAsin.set(asin, brand)
    }
  }

  return globalBrandByAsin
}

async function loadPartnerboostOfferBrandByAsin(params: {
  entries: PartnerboostBrandLookupEntry[]
}): Promise<Map<string, string>> {
  if (params.entries.length === 0) {
    return new Map()
  }

  const userIds = Array.from(new Set(params.entries.map((entry) => entry.userId)))
  const asins = Array.from(new Set(params.entries.map((entry) => entry.asin)))
  const db = await getDatabase()
  const offerNotDeletedCondition = '(is_deleted = false OR is_deleted IS NULL)'

  const offerRows: Array<{
    user_id: number
    brand: string | null
    asin: string | null
    url: string | null
    final_url: string | null
  }> = []

  for (const userIdChunk of chunkArray(userIds, 100)) {
    const userPlaceholders = userIdChunk.map(() => '?').join(', ')

    for (const asinChunk of chunkArray(asins, 200)) {
      const asinPlaceholders = asinChunk.map(() => '?').join(', ')
      const chunkRows = await db.query<{
        user_id: number
        brand: string | null
        asin: string | null
        url: string | null
        final_url: string | null
      }>(
        `
          SELECT user_id, brand, asin, url, final_url
          FROM offers
          WHERE user_id IN (${userPlaceholders})
            AND ${offerNotDeletedCondition}
            AND brand IS NOT NULL
            AND (
              (asin IS NOT NULL AND UPPER(asin) IN (${asinPlaceholders}))
              OR url IS NOT NULL
              OR final_url IS NOT NULL
            )
        `,
        [...userIdChunk, ...asinChunk]
      )
      offerRows.push(...chunkRows)
    }
  }

  return buildOfferBrandByUserAsin(offerRows, params.entries)
}

async function loadPartnerboostBrandMap(params: {
  entries: PartnerboostBrandLookupEntry[]
  rawBrandByUserAsin: Map<string, string>
}): Promise<Map<string, string>> {
  if (params.entries.length === 0) {
    return new Map()
  }

  const asins = Array.from(new Set(params.entries.map((entry) => entry.asin)))
  const productBrandByUserAsin = await loadPartnerboostProductBrandsByEntries(params.entries)
  const offerBrandByUserAsin = await loadPartnerboostOfferBrandByAsin({ entries: params.entries })
  const globalBrandByAsin = await loadPartnerboostGlobalProductBrandsByAsins(asins)

  const brandByUserAsin = new Map<string, string>()
  for (const entry of params.entries) {
    const mapKey = `${entry.userId}:${entry.asin}`
    const resolvedBrand = resolvePartnerboostDisplayBrand({
      productBrand: productBrandByUserAsin.get(mapKey) ?? globalBrandByAsin.get(entry.asin),
      offerBrand: offerBrandByUserAsin.get(mapKey) }) ?? normalizePartnerboostRawBrandFallback(params.rawBrandByUserAsin.get(mapKey))
    if (resolvedBrand) {
      brandByUserAsin.set(mapKey, resolvedBrand)
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
      brandName }
  })
}

async function loadRawSyncPayloadRowsChunk(params: {
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

  return db.query<{
    user_id: number
    report_date: string
    platform: string
    source_api: string
    response_payload: unknown
    response_payload_codec?: string | null
  }>(
    `
      SELECT user_id, report_date, platform, source_api, response_payload, response_payload_codec
      FROM openclaw_affiliate_commission_raw_sync_payloads
      WHERE user_id IN (${userPlaceholders})
        AND report_date >= ?
        AND report_date <= ?
        ${platformClause}
        AND (
          (platform = 'yeahpromos' AND source_api = 'getorder')
          OR (platform = 'partnerboost' AND source_api IN ('amazon_report', 'transaction'))
        )
      ORDER BY user_id ASC, report_date ASC, platform ASC, source_api ASC, page_no ASC
    `,
    queryParams
  ).then((rows) => rows.map((row) => ({
    user_id: row.user_id,
    report_date: normalizeReportDate(row.report_date),
    platform: row.platform,
    source_api: row.source_api,
    response_payload: parseStoredJsonPayload(
      row.response_payload,
      row.response_payload_codec || 'json'
    ),
    response_payload_codec: row.response_payload_codec })))
}

function compareRawSyncPayloadRows(left: RawSyncPayloadRow, right: RawSyncPayloadRow): number {
  if (left.user_id !== right.user_id) return left.user_id - right.user_id

  const dateCompare = normalizeReportDate(left.report_date).localeCompare(normalizeReportDate(right.report_date))
  if (dateCompare !== 0) return dateCompare

  const platformCompare = left.platform.localeCompare(right.platform)
  if (platformCompare !== 0) return platformCompare

  return left.source_api.localeCompare(right.source_api)
}

async function loadRawSyncPayloadRows(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
}): Promise<RawSyncPayloadRow[]> {
  if (params.userIds.length === 0) return []

  const USER_ID_CHUNK_SIZE = 100
  if (params.userIds.length <= USER_ID_CHUNK_SIZE) {
    return loadRawSyncPayloadRowsChunk(params)
  }

  const chunkResults = await Promise.all(
    chunkArray(params.userIds, USER_ID_CHUNK_SIZE).map((userIds) => loadRawSyncPayloadRowsChunk({
      ...params,
      userIds }))
  )

  return chunkResults.flat().sort(compareRawSyncPayloadRows)
}

function buildSupportedSourceClause(platform: AffiliateCommissionReportPlatformFilter): {
  clause: string
  params: unknown[]
} {
  if (platform === 'yeahpromos') {
    return {
      clause: `AND platform = 'yeahpromos' AND source_api = 'getorder'`,
      params: [] }
  }
  if (platform === 'partnerboost') {
    return {
      clause: `AND platform = 'partnerboost' AND source_api IN ('amazon_report', 'transaction')`,
      params: [] }
  }

  return {
    clause: `
      AND (
        (platform = 'yeahpromos' AND source_api = 'getorder')
        OR (platform = 'partnerboost' AND source_api IN ('amazon_report', 'transaction'))
      )
    `,
    params: [] }
}

export async function getAffiliateCommissionDateBounds(params: {
  userIds: number[]
  platform?: AffiliateCommissionReportPlatformFilter
}): Promise<AffiliateCommissionDateBounds> {
  if (params.userIds.length === 0) {
    return { minDate: null, maxDate: null }
  }

  const db = await getDatabase()
  const userPlaceholders = params.userIds.map(() => '?').join(', ')
  const platform = params.platform || 'all'
  const sourceFilter = buildSupportedSourceClause(platform)

  const row = await db.queryOne<{ min_date: unknown; max_date: unknown }>(
    `
      SELECT MIN(report_date) AS min_date, MAX(report_date) AS max_date
      FROM openclaw_affiliate_commission_raw_sync_payloads
      WHERE user_id IN (${userPlaceholders})
        ${sourceFilter.clause}
    `,
    [...params.userIds, ...sourceFilter.params]
  )

  const minDateRaw = row?.min_date
  const maxDateRaw = row?.max_date
  const minDate = minDateRaw ? normalizeReportDate(minDateRaw) : null
  const maxDate = maxDateRaw ? normalizeReportDate(maxDateRaw) : null

  return {
    minDate: minDate || null,
    maxDate: maxDate || null }
}

export async function getAffiliateCommissionDateBoundsCached(params: {
  userIds: number[]
  platform?: AffiliateCommissionReportPlatformFilter
}): Promise<AffiliateCommissionDateBounds> {
  const platform = params.platform || 'all'
  const cacheKey = buildAffiliateCommissionDateBoundsCacheKey({
    userIds: params.userIds,
    platform })
  const cached = readAffiliateCommissionDateBoundsMemoryCache(cacheKey)
  if (cached) {
    return cached
  }

  const dateBounds = await getAffiliateCommissionDateBounds(params)
  writeAffiliateCommissionDateBoundsMemoryCache(cacheKey, dateBounds)
  return dateBounds
}

export function clampDateRangeToBounds(params: {
  startDate: string
  endDate: string
  bounds: AffiliateCommissionDateBounds
}): { startDate: string; endDate: string } {
  const { bounds } = params
  if (!bounds.minDate || !bounds.maxDate) {
    return { startDate: params.startDate, endDate: params.endDate }
  }

  let startDate = params.startDate
  let endDate = params.endDate

  if (startDate < bounds.minDate) startDate = bounds.minDate
  if (endDate > bounds.maxDate) endDate = bounds.maxDate
  if (startDate > endDate) {
    startDate = bounds.minDate
    endDate = bounds.maxDate
  }

  return { startDate, endDate }
}

export async function listActiveNonAdminUsers(): Promise<ActiveNonAdminUser[]> {
  const db = await getDatabase()

  return db.query<ActiveNonAdminUser>(
    `
      SELECT id, username
      FROM users
      WHERE role != 'admin'
        AND is_active = true
      ORDER BY username ASC
    `
  )
}

async function filterActiveNonAdminUserIds(userIds: number[]): Promise<Set<number>> {
  if (userIds.length === 0) return new Set()

  const db = await getDatabase()
  const allowedIds = new Set<number>()

  for (const userIdChunk of chunkArray(userIds, 200)) {
    const placeholders = userIdChunk.map(() => '?').join(', ')
    const rows = await db.query<{ id: number }>(
      `
        SELECT id
        FROM users
        WHERE id IN (${placeholders})
          AND role != 'admin'
          AND is_active = true
      `,
      userIdChunk
    )

    for (const row of rows) {
      allowedIds.add(row.id)
    }
  }

  return allowedIds
}

export async function resolveTargetUserIds(params: {
  isAdmin: boolean
  currentUserId: number
  requestedUserIds: number[]
}): Promise<number[]> {
  if (!params.isAdmin) {
    return [params.currentUserId]
  }

  if (params.requestedUserIds.length > 0) {
    const allowedIds = await filterActiveNonAdminUserIds(params.requestedUserIds)
    const filtered = params.requestedUserIds.filter((userId) => allowedIds.has(userId))
    if (filtered.length === 0) {
      throw new Error('未选择有效的活跃用户')
    }
    return filtered
  }

  const allowedUsers = await listActiveNonAdminUsers()
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

async function buildAffiliateCommissionLineItemsFromRawRows(params: {
  rows: RawSyncPayloadRow[]
  userLabels: Map<number, string>
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
  showUserScope: boolean
}): Promise<AffiliateCommissionLineItem[]> {
  const lineItems: AffiliateCommissionLineItem[] = []
  const partnerboostGroups = new Map<string, {
    userId: number
    username: string
    reportDate: string
    transactionPayloads: unknown[]
    reportPayloads: unknown[]
  }>()

  for (const row of params.rows) {
    const username = params.userLabels.get(row.user_id) || `User ${row.user_id}`
    const payload = parseJsonField(row.response_payload, null)
    if (!payload) continue

    if (row.platform === 'yeahpromos' && row.source_api === 'getorder') {
      lineItems.push(...parseYeahPromosLineItems({
        userId: row.user_id,
        username,
        reportDate: row.report_date,
        payload,
        showUserScope: params.showUserScope }))
      continue
    }

    if (row.platform === 'partnerboost') {
      const reportDate = normalizeReportDate(row.report_date)
      const groupKey = `${row.user_id}:${reportDate}`
      let group = partnerboostGroups.get(groupKey)
      if (!group) {
        group = {
          userId: row.user_id,
          username,
          reportDate,
          transactionPayloads: [],
          reportPayloads: [] }
        partnerboostGroups.set(groupKey, group)
      }

      if (row.source_api === 'transaction') {
        group.transactionPayloads.push(payload)
      } else if (row.source_api === 'amazon_report') {
        group.reportPayloads.push(payload)
      }
    }
  }

  const partnerboostRawBrandByUserAsin = new Map<string, string>()

  for (const group of partnerboostGroups.values()) {
    const parsed = parsePartnerboostLineItems({
      userId: group.userId,
      username: group.username,
      reportDate: group.reportDate,
      transactionPayloads: group.transactionPayloads,
      reportPayloads: group.reportPayloads,
      showUserScope: params.showUserScope })
    lineItems.push(...parsed.items)
    for (const [mapKey, rawBrand] of parsed.rawBrandByUserAsin) {
      if (!partnerboostRawBrandByUserAsin.has(mapKey)) {
        partnerboostRawBrandByUserAsin.set(mapKey, rawBrand)
      }
    }
  }

  const partnerboostEntries = params.platform === 'yeahpromos'
    ? []
    : buildPartnerboostBrandLookupEntries(lineItems)

  if (partnerboostEntries.length === 0) {
    return lineItems
  }

  const brandByUserAsin = await loadPartnerboostBrandMap({
    entries: partnerboostEntries,
    rawBrandByUserAsin: partnerboostRawBrandByUserAsin })

  return applyPartnerboostBrandNames(lineItems, brandByUserAsin, params.showUserScope)
}

function schedulePersistAffiliateCommissionLineFactsFromLineItems(params: {
  lineItems: AffiliateCommissionLineItem[]
}): void {
  void persistAffiliateCommissionLineFactsFromLineItems(params).catch(() => {
    // Facts persistence is best-effort on the request path; sync/rebuild scripts backfill gaps.
  })
}

async function writeAffiliateCommissionLineItemsCaches(params: {
  cacheKey: string
  lineItems: AffiliateCommissionLineItem[]
  sourceUpdatedAt: string | null
  attributionUpdatedAt: string | null
}): Promise<void> {
  writeAffiliateCommissionLineItemsMemoryCache(params.cacheKey, {
    lineItems: params.lineItems,
    sourceUpdatedAt: params.sourceUpdatedAt,
    attributionUpdatedAt: params.attributionUpdatedAt })

  try {
    await writeAffiliateCommissionLineItemsDbCache({
      cacheKey: params.cacheKey,
      lineItems: params.lineItems,
      sourceUpdatedAt: params.sourceUpdatedAt })
  } catch {
    // ignore cache write failures
  }
}

async function persistAffiliateCommissionLineFactsFromLineItems(params: {
  lineItems: AffiliateCommissionLineItem[]
}): Promise<void> {
  const factsByUserDate = new Map<string, { userId: number; reportDate: string; items: AffiliateCommissionLineItem[] }>()

  for (const item of params.lineItems) {
    const reportDate = normalizeReportDate(item.reportDate)
    const mapKey = `${item.userId}:${reportDate}`
    const unscopedItem = {
      ...item,
      brandKey: item.brandKey.replace(/^user:\d+:/, '') }
    const existing = factsByUserDate.get(mapKey)
    if (existing) {
      existing.items.push(unscopedItem)
      continue
    }
    factsByUserDate.set(mapKey, {
      userId: item.userId,
      reportDate,
      items: [unscopedItem] })
  }

  for (const group of factsByUserDate.values()) {
    try {
      await replaceAffiliateCommissionLineFacts({
        userId: group.userId,
        reportDates: [group.reportDate],
        lineItems: group.items })
    } catch {
      // Facts table may not exist before migration 253.
    }
  }
}

export async function rebuildAffiliateCommissionLineFactsForUserDate(params: {
  userId: number
  reportDate: string
  userLabels?: Map<number, string>
  platform?: AffiliateCommissionReportPlatformFilter
}): Promise<void> {
  const platform = params.platform || 'all'
  const userLabels = params.userLabels ?? await buildUserLabelMap([params.userId])
  const rows = await loadRawSyncPayloadRows({
    userIds: [params.userId],
    startDate: params.reportDate,
    endDate: params.reportDate,
    platform })

  const lineItems = await buildAffiliateCommissionLineItemsFromRawRows({
    rows,
    userLabels,
    startDate: params.reportDate,
    endDate: params.reportDate,
    platform,
    showUserScope: false })

  await replaceAffiliateCommissionLineFacts({
    userId: params.userId,
    reportDates: [params.reportDate],
    lineItems })
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
  const cacheKey = buildAffiliateCommissionLineItemsCacheKey({
    userIds: params.userIds,
    startDate: params.startDate,
    endDate: params.endDate,
    platform: params.platform,
    showUserScope })

  const reconcileCtx = {
    userIds: params.userIds,
    userLabels,
    startDate: params.startDate,
    endDate: params.endDate,
    platform: params.platform,
    showUserScope }

  const memoryCached = readAffiliateCommissionLineItemsMemoryCache(cacheKey)
  if (memoryCached) {
    return memoryCached.lineItems
  }

  let sourceUpdatedAt: string | null = null
  try {
    sourceUpdatedAt = await getAffiliateCommissionRawSourceUpdatedAt({
      userIds: params.userIds,
      startDate: params.startDate,
      endDate: params.endDate })
  } catch {
    sourceUpdatedAt = null
  }

  try {
    const dbCached = await readAffiliateCommissionLineItemsDbCache({
      cacheKey,
      sourceUpdatedAt })
    if (dbCached) {
      const reconciled = await reconcileAffiliateCommissionLineItems({
        rawDerived: dbCached,
        ...reconcileCtx })
      await writeAffiliateCommissionLineItemsCaches({
        cacheKey,
        lineItems: reconciled.lineItems,
        sourceUpdatedAt,
        attributionUpdatedAt: reconciled.attributionUpdatedAt })
      return reconciled.lineItems
    }
  } catch {
    // Cache table may not exist before migration 253.
  }

  let lineItems: AffiliateCommissionLineItem[]

  try {
    const factsAreFresh = await affiliateCommissionFactsCoverRawRange({
      userIds: params.userIds,
      startDate: params.startDate,
      endDate: params.endDate,
      platform: params.platform,
      minRebuiltAt: AFFILIATE_COMMISSION_FACTS_MIN_REBUILT_AT })

    if (factsAreFresh) {
      const factRows = await loadAffiliateCommissionLineFacts({
        userIds: params.userIds,
        startDate: params.startDate,
        endDate: params.endDate,
        platform: params.platform })
      lineItems = factRowsToLineItems(factRows, userLabels, showUserScope)
    } else {
      lineItems = await buildAffiliateCommissionLineItemsFromRawRows({
        rows: await loadRawSyncPayloadRows({
          userIds: params.userIds,
          startDate: params.startDate,
          endDate: params.endDate,
          platform: params.platform }),
        userLabels,
        startDate: params.startDate,
        endDate: params.endDate,
        platform: params.platform,
        showUserScope })
    }
  } catch {
    // Facts table may not exist before migration 253.
    lineItems = await buildAffiliateCommissionLineItemsFromRawRows({
      rows: await loadRawSyncPayloadRows({
        userIds: params.userIds,
        startDate: params.startDate,
        endDate: params.endDate,
        platform: params.platform }),
      userLabels,
      startDate: params.startDate,
      endDate: params.endDate,
      platform: params.platform,
      showUserScope })
  }

  const reconciled = await reconcileAffiliateCommissionLineItems({
    rawDerived: lineItems,
    ...reconcileCtx })

  schedulePersistAffiliateCommissionLineFactsFromLineItems({ lineItems: reconciled.lineItems })

  await writeAffiliateCommissionLineItemsCaches({
    cacheKey,
    lineItems: reconciled.lineItems,
    sourceUpdatedAt,
    attributionUpdatedAt: reconciled.attributionUpdatedAt })

  return reconciled.lineItems
}

function buildBrandSummaries(
  items: AffiliateCommissionLineItem[],
  showUserScope: boolean
): AffiliateCommissionBrandSummary[] {
  const summaryMap = new Map<string, AffiliateCommissionBrandSummary>()

  for (const item of items) {
    const summaryKey = resolveBrandSummaryKey(item, showUserScope)
    const existing = summaryMap.get(summaryKey)
    if (existing) {
      existing.totalCommission += item.commission
      continue
    }

    summaryMap.set(summaryKey, {
      brandKey: summaryKey,
      brandName: item.brandName,
      platform: item.platform,
      totalCommission: item.commission,
      ...(showUserScope
        ? { userId: item.userId, username: item.username }
        : {}) })
  }

  return Array.from(summaryMap.values())
    .map((summary) => ({
      ...summary,
      totalCommission: roundTo2(summary.totalCommission) }))
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
    const reportDate = normalizeReportDate(item.reportDate)
    const existing = summaryMap.get(reportDate)
    if (existing) {
      existing.totalCommission += item.commission
      continue
    }

    summaryMap.set(reportDate, {
      reportDate,
      totalCommission: item.commission })
  }

  return Array.from(summaryMap.values())
    .map((summary) => ({
      ...summary,
      totalCommission: roundTo2(summary.totalCommission) }))
    .sort((left, right) => compareReportDatesDesc(left.reportDate, right.reportDate))
}

function brandFactAggregatesToPseudoLineItems(params: {
  aggregates: AffiliateCommissionFactsBrandAggregate[]
  userLabels: Map<number, string>
  startDate: string
  showUserScope: boolean
}): AffiliateCommissionLineItem[] {
  return params.aggregates.map((row) => ({
    userId: row.user_id,
    username: params.userLabels.get(row.user_id) || `User ${row.user_id}`,
    reportDate: params.startDate,
    platform: row.platform === 'partnerboost' ? 'partnerboost' : 'yeahpromos',
    brandKey: scopeBrandKey(row.user_id, row.brand_key, params.showUserScope),
    brandName: row.brand_name,
    commission: roundTo4(Number(row.total_commission) || 0) }))
}

function buildBrandSummariesFromFactAggregates(params: {
  aggregates: AffiliateCommissionFactsBrandAggregate[]
  userLabels: Map<number, string>
  startDate: string
  showUserScope: boolean
}): AffiliateCommissionBrandSummary[] {
  return buildBrandSummaries(
    brandFactAggregatesToPseudoLineItems(params),
    params.showUserScope
  )
}

function buildDateSummariesFromFactAggregates(params: {
  aggregates: Array<{ report_date: string; total_commission: number }>
}): AffiliateCommissionDateSummary[] {
  return params.aggregates
    .map((row) => ({
      reportDate: normalizeReportDate(row.report_date),
      totalCommission: roundTo2(Number(row.total_commission) || 0) }))
    .sort((left, right) => compareReportDatesDesc(left.reportDate, right.reportDate))
}

async function tryBuildAffiliateCommissionReportFromFactsAggregates(params: {
  userIds: number[]
  userLabels: Map<number, string>
  startDate: string
  endDate: string
  platform: AffiliateCommissionReportPlatformFilter
  viewMode: AffiliateCommissionReportViewMode
  showUserScope: boolean
  dateBounds: AffiliateCommissionDateBounds
}): Promise<AffiliateCommissionReportResult | null> {
  if (params.userIds.length < ADMIN_FACTS_AGGREGATED_REPORT_MIN_USER_IDS) {
    return null
  }

  let factsAreFresh = false
  try {
    factsAreFresh = await affiliateCommissionFactsCoverRawRange({
      userIds: params.userIds,
      startDate: params.startDate,
      endDate: params.endDate,
      platform: params.platform,
      minRebuiltAt: AFFILIATE_COMMISSION_FACTS_MIN_REBUILT_AT })
  } catch {
    return null
  }

  if (!factsAreFresh) {
    return null
  }

  const aggregateCtx = {
    userIds: params.userIds,
    startDate: params.startDate,
    endDate: params.endDate,
    platform: params.platform }

  const [factsTotal, attributionTotals, brandAggregates, dateAggregates] = await Promise.all([
    sumAffiliateCommissionFromFacts(aggregateCtx),
    sumAttributionCommissionTotals(aggregateCtx),
    loadAffiliateCommissionBrandAggregatesFromFacts(aggregateCtx),
    loadAffiliateCommissionDateAggregatesFromFacts(aggregateCtx),
  ])

  if (attributionTotals.combinedTotal > factsTotal + 0.001) {
    return null
  }

  const brandSummaries = buildBrandSummariesFromFactAggregates({
    aggregates: brandAggregates,
    userLabels: params.userLabels,
    startDate: params.startDate,
    showUserScope: params.showUserScope })
  const dateSummaries = buildDateSummariesFromFactAggregates({ aggregates: dateAggregates })

  return {
    startDate: params.startDate,
    endDate: params.endDate,
    platform: params.platform,
    viewMode: params.viewMode,
    currency: 'USD',
    totalCommission: roundTo2(factsTotal),
    showUserScope: params.showUserScope,
    dateBounds: params.dateBounds,
    brandSummaries,
    dateSummaries }
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
  const userLabels = params.userLabels ?? await buildUserLabelMap(params.userIds)

  const dateBounds = await getAffiliateCommissionDateBoundsCached({
    userIds: params.userIds,
    platform })
  const clampedRange = clampDateRangeToBounds({
    startDate: params.startDate,
    endDate: params.endDate,
    bounds: dateBounds })

  const aggregatedReport = await tryBuildAffiliateCommissionReportFromFactsAggregates({
    userIds: params.userIds,
    userLabels,
    startDate: clampedRange.startDate,
    endDate: clampedRange.endDate,
    platform,
    viewMode,
    showUserScope,
    dateBounds })
  if (aggregatedReport) {
    return aggregatedReport
  }

  const lineItems = await loadAffiliateCommissionLineItems({
    userIds: params.userIds,
    userLabels,
    startDate: clampedRange.startDate,
    endDate: clampedRange.endDate,
    platform,
    showUserScope })

  const totalCommission = roundTo2(
    lineItems.reduce((sum, item) => sum + item.commission, 0)
  )

  return {
    startDate: clampedRange.startDate,
    endDate: clampedRange.endDate,
    platform,
    viewMode,
    currency: 'USD',
    totalCommission,
    showUserScope,
    dateBounds,
    brandSummaries: buildBrandSummaries(lineItems, showUserScope),
    dateSummaries: buildDateSummaries(lineItems) }
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
    showUserScope })

  const detailMap = new Map<string, number>()
  for (const item of lineItems) {
    if (!lineItemMatchesBrandDetailKey(item, params.brandKey, showUserScope)) continue
    const reportDate = normalizeReportDate(item.reportDate)
    detailMap.set(reportDate, (detailMap.get(reportDate) || 0) + item.commission)
  }

  return Array.from(detailMap.entries())
    .map(([reportDate, commission]) => ({ reportDate, commission: roundTo2(commission) }))
    .sort((left, right) => compareReportDatesDesc(left.reportDate, right.reportDate))
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
    showUserScope })

  const detailMap = new Map<string, AffiliateCommissionDateDetailRow>()
  for (const item of lineItems) {
    const existing = detailMap.get(item.brandKey)
    if (existing) {
      existing.commission += item.commission
      continue
    }

    detailMap.set(item.brandKey, {
      brandKey: item.brandKey,
      brandName: item.brandName,
      platform: item.platform,
      commission: item.commission,
      ...(showUserScope
        ? { userId: item.userId, username: item.username }
        : {}) })
  }

  return Array.from(detailMap.values())
    .map((row) => ({
      ...row,
      commission: roundTo2(row.commission) }))
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
