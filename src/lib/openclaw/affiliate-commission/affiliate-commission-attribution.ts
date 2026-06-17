import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'
import {
  resolveAffiliateAttributionFailureReasonCode,
  type AffiliateAttributionBaseFailureReasonCode,
  type AffiliateAttributionFailureReasonCode } from '@/lib/openclaw/affiliate-commission/affiliate-attribution-failures'

export type AffiliatePlatform = 'partnerboost' | 'yeahpromos'

export type AffiliateCommissionRawEntry = {
  platform: AffiliatePlatform
  reportDate: string
  commission: number
  currency?: string | null
  sourceOrderId?: string | null
  sourceMid?: string | null
  sourceAsin?: string | null
  sourceLink?: string | null
  sourceLinkId?: string | null
  raw?: unknown
}

export type AffiliateCommissionAttributionResult = {
  reportDate: string
  totalCommission: number
  attributedCommission: number
  unattributedCommission: number
  attributedOffers: number
  attributedCampaigns: number
  writtenRows: number
}

function normalizeAffiliatePlatforms(platforms: Array<AffiliatePlatform | null | undefined> | undefined): AffiliatePlatform[] {
  const result = new Set<AffiliatePlatform>()
  for (const platform of platforms || []) {
    if (platform === 'partnerboost' || platform === 'yeahpromos') {
      result.add(platform)
    }
  }
  return Array.from(result)
}

type AttributionRow = {
  userId: number
  reportDate: string
  platform: AffiliatePlatform
  sourceOrderId: string | null
  sourceMid: string | null
  sourceAsin: string | null
  offerId: number | null
  campaignId: number | null
  commissionAmount: number
  currency: string
  rawPayload: unknown
}

type AttributionFailureRow = {
  userId: number
  reportDate: string
  platform: AffiliatePlatform
  sourceOrderId: string | null
  sourceMid: string | null
  sourceAsin: string | null
  sourceLinkId: string | null
  offerId: number | null
  /** 审计用：在无法写入归因表时，尽量关联到唯一可推断的本地 campaigns.id */
  campaignId: number | null
  commissionAmount: number
  currency: string
  reasonCode: AffiliateAttributionFailureReasonCode
  reasonDetail: string | null
  rawPayload: unknown
}

type CampaignTarget = {
  campaignId: number
  offerId: number | null
  weight: number
}

type NormalizedCommissionEntry = {
  platform: AffiliatePlatform
  reportDate: string
  commission: number
  currency: string
  eventId: string
  normalizedBrand: string | null
  sourceOrderId: string | null
  sourceMid: string | null
  sourceAsin: string | null
  sourceLink: string | null
  sourceLinkId: string | null
  sourceNormId: string | null
  raw: unknown
}

type ExistingEventOutcome = {
  attributedCommission: number
  unattributedCommission: number
  offerIds: Set<number>
  campaignIds: Set<number>
}

type OfferContext = {
  offerId: number
  normalizedBrands: Set<string>
  asins: Set<string>
}

type CampaignAttributionCandidate = {
  campaignId: number
  offerId: number
  normalizedBrand: string | null
  campaignStatus: 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  cost: number
  clicks: number
}

const DEFAULT_REMOVED_CAMPAIGN_ATTRIBUTION_GRACE_DAYS = 30
const MIN_REMOVED_CAMPAIGN_ATTRIBUTION_GRACE_DAYS = 0
const MAX_REMOVED_CAMPAIGN_ATTRIBUTION_GRACE_DAYS = 90

function getRemovedCampaignAttributionGraceDays(value?: unknown): number {
  const parsed = Number(
    value ?? process.env.OPENCLAW_AFFILIATE_ATTRIBUTION_REMOVED_CAMPAIGN_GRACE_DAYS
  )
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REMOVED_CAMPAIGN_ATTRIBUTION_GRACE_DAYS
  }
  return Math.min(
    MAX_REMOVED_CAMPAIGN_ATTRIBUTION_GRACE_DAYS,
    Math.max(MIN_REMOVED_CAMPAIGN_ATTRIBUTION_GRACE_DAYS, Math.floor(parsed))
  )
}

function normalizeCampaignStatus(value: unknown): 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized === 'ENABLED' || normalized === 'PAUSED' || normalized === 'REMOVED') {
    return normalized
  }
  return 'UNKNOWN'
}

function preferOnlineCampaignCandidates(
  candidates: CampaignAttributionCandidate[],
  options?: {
    removedCampaignGraceDays?: number
  }
): CampaignAttributionCandidate[] {
  const onlineCandidates = candidates.filter((candidate) => (
    candidate.campaignStatus === 'ENABLED' || candidate.campaignStatus === 'PAUSED'
  ))
  if (onlineCandidates.length > 0) return onlineCandidates

  const removedCampaignGraceDays = getRemovedCampaignAttributionGraceDays(
    options?.removedCampaignGraceDays
  )
  if (removedCampaignGraceDays <= 0) {
    return candidates.filter((candidate) => candidate.campaignStatus !== 'REMOVED')
  }

  return candidates.filter((candidate) => {
    if (candidate.campaignStatus !== 'REMOVED') return true
    return candidate.cost > 0 || candidate.clicks > 0
  })
}

/**
 * 失败行写入前尽量解析 campaign_id（例如 ASIN 在 offer 下唯一、且该 offer 下仅有一个可投放 Campaign）。
 */
function resolveFailureAuditCampaignId(params: {
  offerContexts: Map<number, OfferContext>
  campaignCandidates: CampaignAttributionCandidate[]
  matchedAsinCandidates: CampaignAttributionCandidate[]
  sourceAsin: string | null
}): number | null {
  const asin = params.sourceAsin
  if (!asin) return null

  if (params.matchedAsinCandidates.length === 1) {
    const id = params.matchedAsinCandidates[0]?.campaignId
    return Number.isFinite(id) ? id : null
  }

  const offersWithAsin: number[] = []
  for (const [offerId, ctx] of params.offerContexts.entries()) {
    if (ctx.asins.has(asin)) offersWithAsin.push(offerId)
  }
  if (offersWithAsin.length !== 1) return null

  const offerId = offersWithAsin[0]
  const forOffer = params.campaignCandidates.filter((c) => c.offerId === offerId)
  const preferred = preferOnlineCampaignCandidates(forOffer)
  if (preferred.length !== 1) return null

  const id = preferred[0]?.campaignId
  return Number.isFinite(id) ? id : null
}

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const ATTRIBUTION_EPSILON = 0.0001

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function normalizeBrand(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null

  let normalized = text.toLowerCase().trim()

  // Remove common suffixes
  normalized = normalized
    .replace(/\s+(inc|llc|ltd|co|corp|corporation)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Remove trailing partner metadata wrappers, e.g. "Lefant UK(ZYG)" -> "lefant uk".
  while (/\s*[\(\[][^\)\]]*[\)\]]\s*$/.test(normalized)) {
    normalized = normalized
      .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Remove store-related suffixes first (before country suffixes)
  normalized = normalized
    .replace(/\s+vc\s+store$/i, '')
    .replace(/\s+official\s+store$/i, '')
    .replace(/\s+vc$/i, '')
    .replace(/\s+store$/i, '')
    .trim()

  // Remove country/region suffixes to handle affiliate platform variations
  // Examples: "Reolink DE" -> "reolink", "Roborock Amazon US" -> "roborock"
  normalized = normalized
    .replace(/\s+(de|fr|uk|us|it|es|ca|au|jp|cn|in|br|mx|nl|se|no|dk|fi|pl|cz|at|ch|be|ie|pt|gr|nz|sg|hk|tw|kr|th|my|ph|id|vn)$/i, '')
    .replace(/\s+amazon\s+(de|fr|uk|us|it|es|ca|au|jp|cn|in|br|mx|nl|se|no|dk|fi|pl|cz|at|ch|be|ie|pt|gr|nz|sg|hk|tw|kr|th|my|ph|id|vn)$/i, '')
    .replace(/[-_](de|fr|uk|us|it|es|ca|au|jp|cn|in|br|mx|nl|se|no|dk|fi|pl|cz|at|ch|be|ie|pt|gr|nz|sg|hk|tw|kr|th|my|ph|id|vn)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Remove common prefixes (e.g., "LT-Waterdrop" -> "waterdrop")
  normalized = normalized
    .replace(/^lt-/i, '')
    .replace(/^us-/i, '')
    .replace(/^uk-/i, '')
    .trim()

  // Brand alias mapping for known variations
  // This helps match brands like "Squatty" and "Squatty Potty"
  const aliases: Record<string, string> = {
    'squatty': 'squatty potty',
    'roborock amazon': 'roborock',
    'ringconn': 'ringconn',
    // Livionex rebranded to Livfresh, but affiliate platforms still use old name
    'livionex': 'livfresh',
    'livionex dental gel': 'livfresh',
    // Wahl variations
    'wahl clipper': 'wahl professional',
    'wahl': 'wahl professional' }

  return aliases[normalized] || normalized
}

function normalizeAsin(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!normalized) return null
  return normalized.length > 10 ? normalized.slice(0, 10) : normalized
}

function normalizeMidForPlatform(platform: AffiliatePlatform, value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  return platform === 'partnerboost' ? text.toLowerCase() : text
}

function normalizePartnerboostNormId(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  return text.toLowerCase()
}

function getObjectFieldByAliases(input: unknown, aliases: string[]): unknown {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>

  for (const alias of aliases) {
    const value = record[alias]
    if (value !== null && value !== undefined && String(value).trim() !== '') return value
  }

  const normalizedMap = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined || String(value).trim() === '') continue
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!normalizedKey || normalizedMap.has(normalizedKey)) continue
    normalizedMap.set(normalizedKey, value)
  }

  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '')
    const value = normalizedMap.get(normalizedAlias)
    if (value !== null && value !== undefined && String(value).trim() !== '') return value
  }

  return undefined
}

function extractPartnerboostNormIdFromRaw(raw: unknown): string | null {
  return normalizePartnerboostNormId(
    getObjectFieldByAliases(raw, ['norm_id', 'normId', 'normid'])
  )
}

export function extractBrandFromRaw(raw: unknown): string | null {
  return normalizeBrand(
    getObjectFieldByAliases(raw, [
      'brand',
      'brand_name',
      'brandName',
      'advert_name',
      'advertName',
      'merchant_name',
      'merchantName',
      'seller_name',
      'sellerName',
    ])
  )
}

function deriveAffiliateEventId(params: {
  platform: AffiliatePlatform
  reportDate: string
  commission: number
  sourceOrderId?: string | null
  sourceMid?: string | null
  sourceAsin?: string | null
  raw?: unknown
}): string {
  const rawId = normalizeText(getObjectFieldByAliases(params.raw, ['id', 'event_id', 'eventId']))
  if (rawId) return `${params.platform}|${rawId}`

  return [
    params.platform,
    normalizeText(params.reportDate) || '-',
    normalizeText(params.sourceOrderId) || '-',
    normalizeText(params.sourceMid) || '-',
    normalizeText(params.sourceAsin) || '-',
    roundTo(Number(params.commission) || 0).toFixed(4),
  ].join('|')
}

function buildStoredRawPayload(params: {
  raw: unknown
  eventId: string
  attributionRule?: string | null
  normalizedBrand?: string | null
}): unknown {
  const metadata = {
    _autoads_event_id: params.eventId,
    _autoads_attribution_rule: params.attributionRule || null,
    _autoads_attribution_brand: params.normalizedBrand || null }

  if (params.raw && typeof params.raw === 'object' && !Array.isArray(params.raw)) {
    return {
      ...(params.raw as Record<string, unknown>),
      ...metadata }
  }

  return {
    ...metadata,
    value: params.raw ?? null }
}

function extractYmdFromDateLike(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10)

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}


function expandEventIds(eventIds: string[]): string[] {
  const expanded = new Set<string>()
  for (const eventId of eventIds) {
    const normalized = normalizeText(eventId)
    if (!normalized) continue
    expanded.add(normalized)
    const separatorIndex = normalized.indexOf('|')
    if (separatorIndex > 0 && separatorIndex < normalized.length - 1) {
      expanded.add(normalized.slice(separatorIndex + 1))
    }
  }
  return Array.from(expanded)
}

function canonicalizeStoredEventId(platform: unknown, eventId: unknown): string | null {
  const normalizedEventId = normalizeText(eventId)
  if (!normalizedEventId) return null
  if (normalizedEventId.includes('|')) return normalizedEventId
  const normalizedPlatform = normalizeText(platform)
  if (!normalizedPlatform) return normalizedEventId
  return `${normalizedPlatform}|${normalizedEventId}`
}

function getStoredEventIdSql(rawColumn = 'raw_payload'): string {
  return `COALESCE(NULLIF(TRIM(${rawColumn}->>'_autoads_event_id'), ''), NULLIF(TRIM(${rawColumn}->>'id'), ''))`
}

function extractAsinFromUrlLike(value: unknown): string | null {
  const raw = normalizeText(value)
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) candidates.push(decoded)
    } catch {
      // ignore malformed percent-encoding
    }
  }

  const patterns = [
    /\/dp\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /\/gp\/product\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /[?&#]asin=([A-Za-z0-9]{10})(?=[&#]|$)/i,
  ]

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const matched = candidate.match(pattern)
      if (!matched?.[1]) continue
      const asin = normalizeAsin(matched[1])
      if (asin) return asin
    }
  }

  return null
}

function extractPartnerboostLinkId(value: unknown): string | null {
  const raw = normalizeText(value)
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) candidates.push(decoded)
    } catch {
      // ignore malformed percent-encoding
    }
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      const key = Array.from(url.searchParams.keys())
        .find((item) => item.toLowerCase() === 'aa_adgroupid')
      if (key) {
        const value = normalizeText(url.searchParams.get(key))
        if (value) return value
      }
    } catch {
      // ignore invalid urls
    }

    const matched = candidate.match(/[?&#]aa_adgroupid=([^&#]+)/i)
    if (matched?.[1]) {
      const value = normalizeText(matched[1])
      if (value) return value
    }
  }

  return null
}

function derivePartnerboostLinkId(params: {
  sourceLinkId: unknown
  sourceLink: string | null
  sourceMid: string | null
}): string | null {
  const explicit = normalizeText(params.sourceLinkId)?.toLowerCase()
  if (explicit) return explicit

  const fromLink = extractPartnerboostLinkId(params.sourceLink)?.toLowerCase()
  if (fromLink) return fromLink

  const fromMid = normalizeText(params.sourceMid)?.toLowerCase()
  if (!fromMid) return null

  // sourceMid may carry aa_adgroupid when transaction rows omit link fields.
  const asin = normalizeAsin(fromMid)
  if (asin && asin.toLowerCase() === fromMid) return null

  return fromMid
}

const IN_CLAUSE_CHUNK_SIZE = 300

function chunkArray<T>(items: T[], chunkSize = IN_CLAUSE_CHUNK_SIZE): T[][] {
  if (items.length === 0) return []
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit' }).format(date)
}

function isHistoricalReportDate(reportDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return false
  }
  return reportDate < formatLocalYmd(new Date())
}

function shiftYmd(reportDate: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return reportDate
  }
  const date = new Date(`${reportDate}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime())) {
    return reportDate
  }
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

function mergeCampaignTargets(targets: CampaignTarget[]): CampaignTarget[] {
  const byCampaign = new Map<number, CampaignTarget>()

  for (const target of targets) {
    const campaignId = Number(target.campaignId)
    if (!Number.isFinite(campaignId)) continue

    const weight = Math.max(0, Number(target.weight) || 0)
    if (weight <= 0) continue

    const offerIdRaw = Number(target.offerId)
    const offerId = Number.isFinite(offerIdRaw) ? offerIdRaw : null
    const existing = byCampaign.get(campaignId)
    if (!existing) {
      byCampaign.set(campaignId, {
        campaignId,
        offerId,
        weight })
      continue
    }

    existing.weight = roundTo(existing.weight + weight)
    if (existing.offerId === null && offerId !== null) {
      existing.offerId = offerId
    }
  }

  return Array.from(byCampaign.values())
    .sort((a, b) => (b.weight - a.weight) || (a.campaignId - b.campaignId))
}

type ExistingAttributionSummaryRow = {
  written_rows: number | string | null
  attributed_commission: number | string | null
  attributed_offers: number | string | null
  attributed_campaigns: number | string | null
}

async function queryExistingAttributionSummary(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
  totalCommission: number
  platforms?: AffiliatePlatform[]
}): Promise<AffiliateCommissionAttributionResult | null> {
  const platforms = normalizeAffiliatePlatforms(params.platforms)
  const hasPlatformFilter = platforms.length > 0
  const row = await params.db.queryOne<ExistingAttributionSummaryRow>(
    `
      SELECT
        COUNT(*) AS written_rows,
        COALESCE(SUM(commission_amount), 0) AS attributed_commission,
        COUNT(DISTINCT offer_id) AS attributed_offers,
        COUNT(DISTINCT campaign_id) AS attributed_campaigns
      FROM affiliate_commission_attributions
      WHERE user_id = ? AND report_date = ?
        ${hasPlatformFilter ? `AND platform IN (${platforms.map(() => '?').join(', ')})` : ''}
    `,
    hasPlatformFilter
      ? [params.userId, params.reportDate, ...platforms]
      : [params.userId, params.reportDate]
  )

  const writtenRows = Number(row?.written_rows) || 0
  if (writtenRows <= 0) {
    return null
  }

  const attributedCommission = roundTo(Number(row?.attributed_commission) || 0)
  const effectiveTotalCommission = roundTo(
    Math.max(Number(params.totalCommission) || 0, attributedCommission)
  )

  return {
    reportDate: params.reportDate,
    totalCommission: effectiveTotalCommission,
    attributedCommission,
    unattributedCommission: roundTo(
      Math.max(0, effectiveTotalCommission - attributedCommission)
    ),
    attributedOffers: Number(row?.attributed_offers) || 0,
    attributedCampaigns: Number(row?.attributed_campaigns) || 0,
    writtenRows }
}

function buildWeightedShares(total: number, weights: number[]): number[] {
  if (!Number.isFinite(total) || total <= 0 || weights.length === 0) {
    return weights.map(() => 0)
  }

  const positiveWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const sumWeights = positiveWeights.reduce((sum, item) => sum + item, 0)

  if (sumWeights <= 0) {
    const even = roundTo(total / weights.length)
    const shares = weights.map(() => even)
    const diff = roundTo(total - shares.reduce((sum, item) => sum + item, 0))
    if (shares.length > 0) {
      shares[shares.length - 1] = roundTo(shares[shares.length - 1] + diff)
    }
    return shares
  }

  const shares = positiveWeights.map((w) => roundTo((total * w) / sumWeights))
  const diff = roundTo(total - shares.reduce((sum, item) => sum + item, 0))
  if (shares.length > 0) {
    shares[shares.length - 1] = roundTo(shares[shares.length - 1] + diff)
  }
  return shares
}

function buildFailureReasonDetail(params: {
  reportDate: string
  sourceMid: string | null
  sourceAsin: string | null
  sourceLinkId: string | null
  sourceNormId?: string | null
  offerId?: number | null
}): string {
  const segments = [
    `reportDate=${params.reportDate}`,
    `sourceMid=${params.sourceMid || '-'}`,
    `sourceAsin=${params.sourceAsin || '-'}`,
    `sourceLinkId=${params.sourceLinkId || '-'}`,
    `sourceNormId=${params.sourceNormId || '-'}`,
  ]

  if (Number.isFinite(Number(params.offerId))) {
    segments.push(`offerId=${Number(params.offerId)}`)
  }

  return segments.join('; ')
}

async function queryExistingEventOutcomes(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
  eventIds: string[]
  excludePlatforms?: AffiliatePlatform[]
}): Promise<Map<string, ExistingEventOutcome>> {
  const result = new Map<string, ExistingEventOutcome>()
  if (params.eventIds.length === 0) return result

  const eventIdExpr = getStoredEventIdSql()
  const queryEventIds = expandEventIds(params.eventIds)
  const excludedPlatforms = normalizeAffiliatePlatforms(params.excludePlatforms)
  const excludePlatformSql = excludedPlatforms.length > 0
    ? `AND COALESCE(platform, '') NOT IN (${excludedPlatforms.map(() => '?').join(', ')})`
    : ''

  for (const eventIdChunk of chunkArray(queryEventIds, 100)) {
    const placeholders = eventIdChunk.map(() => '?').join(', ')
    const attributedRows = await params.db.query<{
      platform: string | null
      event_id: string | null
      offer_id: number | null
      campaign_id: number | null
      commission_amount: number
    }>(
      `
        SELECT
          platform,
          ${eventIdExpr} AS event_id,
          offer_id,
          campaign_id,
          commission_amount
        FROM affiliate_commission_attributions
        WHERE user_id = ?
          AND report_date = ?
          AND ${eventIdExpr} IN (${placeholders})
          ${excludePlatformSql}
      `,
      [params.userId, params.reportDate, ...eventIdChunk, ...excludedPlatforms]
    )

    for (const row of attributedRows) {
      const eventId = canonicalizeStoredEventId(row.platform, row.event_id)
      if (!eventId) continue

      const existing = result.get(eventId) || {
        attributedCommission: 0,
        unattributedCommission: 0,
        offerIds: new Set<number>(),
        campaignIds: new Set<number>() }
      existing.attributedCommission = roundTo(existing.attributedCommission + (Number(row.commission_amount) || 0))

      const offerId = Number(row.offer_id)
      if (Number.isFinite(offerId)) existing.offerIds.add(offerId)

      const campaignId = Number(row.campaign_id)
      if (Number.isFinite(campaignId)) existing.campaignIds.add(campaignId)

      result.set(eventId, existing)
    }

    try {
      const failureRows = await params.db.query<{
        platform: string | null
        event_id: string | null
        commission_amount: number
      }>(
        `
          SELECT
            platform,
            ${eventIdExpr} AS event_id,
            commission_amount
          FROM openclaw_affiliate_attribution_failures
          WHERE user_id = ?
            AND report_date = ?
            AND ${eventIdExpr} IN (${placeholders})
            ${excludePlatformSql}
        `,
        [params.userId, params.reportDate, ...eventIdChunk, ...excludedPlatforms]
      )

      for (const row of failureRows) {
        const eventId = canonicalizeStoredEventId(row.platform, row.event_id)
        if (!eventId) continue

        const existing = result.get(eventId) || {
          attributedCommission: 0,
          unattributedCommission: 0,
          offerIds: new Set<number>(),
          campaignIds: new Set<number>() }
        existing.unattributedCommission = roundTo(existing.unattributedCommission + (Number(row.commission_amount) || 0))
        result.set(eventId, existing)
      }
    } catch (error: any) {
      const message = String(error?.message || '')
      if (!/openclaw_affiliate_attribution_failures/i.test(message) || !/(no such table|does not exist)/i.test(message)) {
        throw error
      }
    }
  }

  return result
}

async function deleteExistingAttributionSnapshot(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
  platforms: AffiliatePlatform[]
}): Promise<void> {
  const platforms = normalizeAffiliatePlatforms(params.platforms)
  if (platforms.length === 0) return

  const placeholders = platforms.map(() => '?').join(', ')

  await params.db.exec(
    `
      DELETE FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date = ?
        AND platform IN (${placeholders})
    `,
    [params.userId, params.reportDate, ...platforms]
  )

  try {
    await params.db.exec(
      `
        DELETE FROM openclaw_affiliate_attribution_failures
        WHERE user_id = ?
          AND report_date = ?
          AND platform IN (${placeholders})
      `,
      [params.userId, params.reportDate, ...platforms]
    )
  } catch (error: any) {
    const message = String(error?.message || '')
    if (!/openclaw_affiliate_attribution_failures/i.test(message) || !/(no such table|does not exist)/i.test(message)) {
      throw error
    }
  }
}

function isStatementTimeoutError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message || '')
  if (!message) return false
  return /(statement timeout|query read timeout|canceling statement due to statement timeout)/i.test(message)
}

/**
 * Fetch ASIN brand information from affiliate platforms for ASINs not in user's Offers.
 * This enhances brand fallback attribution without requiring product sync.
 *
 * Uses global product pool (user_id=1) for both PartnerBoost and YeahPromos platforms.
 * This pool is maintained for commission attribution purposes only.
 */
async function fetchAsinBrandsFromAffiliatePlatform(params: {
  userId: number
  asins: string[]
  platform: AffiliatePlatform
  db: DatabaseAdapter
}): Promise<Map<string, string>> {
  const result = new Map<string, string>()

  if (params.asins.length === 0) {
    return result
  }

  try {
    // Query global product pool (user_id=1) for both platforms
    // This pool contains products from all affiliate platforms for attribution purposes
    const placeholders = params.asins.map(() => '?').join(',')
    const rows = await params.db.query<{ asin: string; brand: string }>(
      `
        SELECT DISTINCT asin, brand
        FROM affiliate_products
        WHERE platform = ?
          AND user_id = 1
          AND asin IN (${placeholders})
          AND brand IS NOT NULL
      `,
      [params.platform, ...params.asins]
    )

    for (const row of rows) {
      const normalizedAsin = normalizeAsin(row.asin)
      const brand = row.brand?.trim()
      if (normalizedAsin && brand) {
        result.set(normalizedAsin, brand)
      }
    }
  } catch (error) {
    // Log error but don't fail attribution - just skip enhancement
    console.warn(`[attribution] Failed to fetch ASIN brands from global pool (${params.platform}):`, error)
  }

  return result
}

async function queryOfferContexts(params: {
  db: DatabaseAdapter
  userId: number
}): Promise<Map<number, OfferContext>> {
  const contexts = new Map<number, OfferContext>()
  const offerNotDeletedCondition = '(is_deleted = false OR is_deleted IS NULL)'

  const offerRows = await params.db.query<{
    id: number
    brand: string | null
    url: string | null
    final_url: string | null
    affiliate_link: string | null
  }>(
    `
      SELECT id, brand, url, final_url, affiliate_link
      FROM offers
      WHERE user_id = ?
        AND ${offerNotDeletedCondition}
    `,
    [params.userId]
  )

  for (const row of offerRows) {
    const offerId = Number(row.id)
    if (!Number.isFinite(offerId)) continue

    const asins = new Set<string>()
    const urlAsin = extractAsinFromUrlLike(row.url)
    const finalUrlAsin = extractAsinFromUrlLike(row.final_url)
    const affiliateLinkAsin = extractAsinFromUrlLike(row.affiliate_link)

    if (urlAsin) asins.add(urlAsin)
    if (finalUrlAsin) asins.add(finalUrlAsin)
    if (affiliateLinkAsin) asins.add(affiliateLinkAsin)

    const normalizedBrand = normalizeBrand(row.brand)
    const normalizedBrands = new Set<string>()
    if (normalizedBrand) normalizedBrands.add(normalizedBrand)

    contexts.set(offerId, {
      offerId,
      normalizedBrands,
      asins })
  }

  const productRows = await params.db.query<{
    offer_id: number
    asin: string | null
    brand: string | null
  }>(
    `
      SELECT apol.offer_id, ap.asin, ap.brand
      FROM affiliate_product_offer_links apol
      INNER JOIN affiliate_products ap ON ap.id = apol.product_id
      WHERE apol.user_id = ?
        AND ap.user_id = ?
    `,
    [params.userId, params.userId]
  )

  for (const row of productRows) {
    const offerId = Number(row.offer_id)
    const asin = normalizeAsin(row.asin)
    if (!Number.isFinite(offerId) || !asin) continue

    const context = contexts.get(offerId)
    if (!context) continue
    context.asins.add(asin)

    const productBrand = normalizeBrand(row.brand)
    if (productBrand) context.normalizedBrands.add(productBrand)
  }

  return contexts
}

async function queryCampaignAttributionCandidates(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
  lookbackDays: number
}): Promise<CampaignAttributionCandidate[]> {
  const campaignNotDeletedCondition = '(c.is_deleted = false OR c.is_deleted IS NULL)'
  const offerNotDeletedCondition = '(o.is_deleted = false OR o.is_deleted IS NULL)'

  const startDate = shiftYmd(params.reportDate, -(Math.max(1, params.lookbackDays) - 1))
  const rows = await params.db.query<{
    campaign_id: number
    offer_id: number
    brand: string | null
    campaign_status: string | null
    created_at: string | null
    cost: number
    clicks: number
  }>(
    `
      SELECT
        c.id AS campaign_id,
        c.offer_id AS offer_id,
        o.brand AS brand,
        c.status AS campaign_status,
        CAST(c.created_at AS TEXT) AS created_at,
        COALESCE(SUM(cp.cost), 0) AS cost,
        COALESCE(SUM(cp.clicks), 0) AS clicks
      FROM campaigns c
      INNER JOIN offers o ON o.id = c.offer_id
      LEFT JOIN campaign_performance cp
        ON cp.campaign_id = c.id
       AND cp.user_id = ?
       AND cp.date >= ?
       AND cp.date <= ?
      WHERE c.user_id = ?
        AND ${campaignNotDeletedCondition}
        AND ${offerNotDeletedCondition}
        AND c.status IN ('ENABLED', 'PAUSED', 'REMOVED')
      GROUP BY c.id, c.offer_id, o.brand, c.status, c.created_at
    `,
    [params.userId, startDate, params.reportDate, params.userId]
  )

  return rows
    .filter((row) => {
      const createdYmd = extractYmdFromDateLike(row.created_at)
      return !createdYmd || createdYmd <= params.reportDate
    })
    .map((row) => ({
      campaignId: Number(row.campaign_id),
      offerId: Number(row.offer_id),
      normalizedBrand: normalizeBrand(row.brand),
      campaignStatus: normalizeCampaignStatus(row.campaign_status),
      cost: Math.max(0, Number(row.cost) || 0),
      clicks: Math.max(0, Number(row.clicks) || 0) }))
    .filter((row) => Number.isFinite(row.campaignId) && Number.isFinite(row.offerId))
}

export async function persistAffiliateCommissionAttributions(params: {
  userId: number
  reportDate: string
  entries: AffiliateCommissionRawEntry[]
  replaceExisting: boolean
  lockHistorical?: boolean
  replacePlatforms?: AffiliatePlatform[]
}): Promise<AffiliateCommissionAttributionResult> {
  const db = await getDatabase()

  const normalizedEntries: NormalizedCommissionEntry[] = params.entries
    .map((entry) => {
      const commission = roundTo(Number(entry.commission) || 0)
      if (commission <= 0) return null

      const sourceLink = normalizeText(entry.sourceLink)
      const sourceMid = normalizeMidForPlatform(entry.platform, entry.sourceMid)
      const sourceAsin = normalizeAsin(entry.sourceAsin)
      const sourceLinkId = entry.platform === 'partnerboost'
        ? derivePartnerboostLinkId({
            sourceLinkId: entry.sourceLinkId,
            sourceLink,
            sourceMid })
        : null
      const sourceNormId = entry.platform === 'partnerboost'
        ? extractPartnerboostNormIdFromRaw(entry.raw)
        : null
      const reportDate = normalizeText(entry.reportDate) || params.reportDate

      return {
        platform: entry.platform,
        reportDate,
        commission,
        currency: normalizeText(entry.currency)?.toUpperCase() || 'USD',
        eventId: deriveAffiliateEventId({
          platform: entry.platform,
          reportDate,
          commission,
          sourceOrderId: entry.sourceOrderId,
          sourceMid,
          sourceAsin,
          raw: entry.raw }),
        normalizedBrand: extractBrandFromRaw(entry.raw),
        sourceOrderId: normalizeText(entry.sourceOrderId),
        sourceMid,
        sourceAsin,
        sourceLink,
        sourceLinkId,
        sourceNormId,
        raw: entry.raw }
    })
    .filter((entry): entry is NormalizedCommissionEntry => Boolean(entry))

  const totalCommission = roundTo(
    normalizedEntries.reduce((sum, entry) => sum + entry.commission, 0)
  )
  const incomingPlatforms = normalizeAffiliatePlatforms(normalizedEntries.map((entry) => entry.platform))
  const replacePlatforms = normalizeAffiliatePlatforms(params.replacePlatforms)
  const shouldResetHistoricalSnapshot = params.replaceExisting
    && replacePlatforms.length > 0
    && isHistoricalReportDate(params.reportDate)

  if (params.lockHistorical && isHistoricalReportDate(params.reportDate) && !shouldResetHistoricalSnapshot) {
    const existingSummary = await queryExistingAttributionSummary({
      db,
      userId: params.userId,
      reportDate: params.reportDate,
      totalCommission,
      platforms: incomingPlatforms })

    if (existingSummary) {
      const shouldKeepExisting =
        totalCommission <= 0
        || existingSummary.attributedCommission + ATTRIBUTION_EPSILON >= totalCommission
      if (shouldKeepExisting) {
        return existingSummary
      }
    }
  }

  if (!params.replaceExisting) {
    return {
      reportDate: params.reportDate,
      totalCommission,
      attributedCommission: 0,
      unattributedCommission: totalCommission,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0 }
  }

  if (normalizedEntries.length === 0) {
    if (shouldResetHistoricalSnapshot) {
      await db.transaction(async () => {
        await deleteExistingAttributionSnapshot({
          db,
          userId: params.userId,
          reportDate: params.reportDate,
          platforms: replacePlatforms })
      })
    }

    return {
      reportDate: params.reportDate,
      totalCommission: 0,
      attributedCommission: 0,
      unattributedCommission: 0,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0 }
  }

  let existingOutcomes = new Map<string, ExistingEventOutcome>()
  try {
    existingOutcomes = await queryExistingEventOutcomes({
      db,
      userId: params.userId,
      reportDate: params.reportDate,
      eventIds: normalizedEntries.map((entry) => entry.eventId),
      excludePlatforms: shouldResetHistoricalSnapshot ? replacePlatforms : undefined })
  } catch (error: any) {
    if (!isStatementTimeoutError(error)) {
      throw error
    }
    // Prefer best-effort attribution over full fallback when dedupe lookup times out.
    console.warn(
      `[affiliate-attribution] existing event lookup timed out on ${params.reportDate}, continue without dedupe`
    )
  }

  const freshEntries: NormalizedCommissionEntry[] = []
  const attributedOfferIds = new Set<number>()
  const attributedCampaignIds = new Set<number>()
  let existingAttributedCommission = 0
  let existingUnattributedCommission = 0

  for (const entry of normalizedEntries) {
    const existingOutcome = existingOutcomes.get(entry.eventId)
    if (!existingOutcome) {
      freshEntries.push(entry)
      continue
    }

    existingAttributedCommission = roundTo(existingAttributedCommission + existingOutcome.attributedCommission)
    existingUnattributedCommission = roundTo(existingUnattributedCommission + existingOutcome.unattributedCommission)
    for (const offerId of existingOutcome.offerIds) {
      attributedOfferIds.add(offerId)
    }
    for (const campaignId of existingOutcome.campaignIds) {
      attributedCampaignIds.add(campaignId)
    }
  }

  const rowsToInsert: AttributionRow[] = []
  const failureRows: AttributionFailureRow[] = []

  if (freshEntries.length > 0) {
    const removedCampaignGraceDays = getRemovedCampaignAttributionGraceDays()
    const offerContexts = await queryOfferContexts({ db, userId: params.userId })
    const campaignCandidates = await queryCampaignAttributionCandidates({
      db,
      userId: params.userId,
      reportDate: params.reportDate,
      lookbackDays: Math.max(7, removedCampaignGraceDays) })

    const asinToCampaigns = new Map<string, CampaignAttributionCandidate[]>()
    const brandToCampaigns = new Map<string, CampaignAttributionCandidate[]>()
    const asinToBrands = new Map<string, Set<string>>()

    for (const [offerId, offerContext] of offerContexts.entries()) {
      for (const asin of offerContext.asins) {
        const brands = asinToBrands.get(asin) || new Set<string>()
        for (const brand of offerContext.normalizedBrands) {
          brands.add(brand)
        }
        asinToBrands.set(asin, brands)
      }

      const matchingCampaigns = campaignCandidates.filter((candidate) => candidate.offerId === offerId)
      for (const candidate of matchingCampaigns) {
        const campaignBrands = offerContext.normalizedBrands.size > 0
          ? Array.from(offerContext.normalizedBrands)
          : (candidate.normalizedBrand ? [candidate.normalizedBrand] : [])

        for (const brand of campaignBrands) {
          const current = brandToCampaigns.get(brand) || []
          current.push(candidate)
          brandToCampaigns.set(brand, current)
        }

        for (const asin of offerContext.asins) {
          const current = asinToCampaigns.get(asin) || []
          current.push(candidate)
          asinToCampaigns.set(asin, current)
        }
      }
    }

    // Collect ASINs observed in current commission entries.
    const commissionAsins = new Set<string>()
    for (const entry of freshEntries) {
      if (entry.sourceAsin) {
        const normalizedAsin = normalizeAsin(entry.sourceAsin)
        if (normalizedAsin) commissionAsins.add(normalizedAsin)
      }
    }

    // Enhance asinToBrands with brand info from affiliate_products table.
    // IMPORTANT: restrict lookup to commission-related ASINs to avoid full-table scans.
    const asinsMissingBrandInfo = Array.from(commissionAsins)
      .filter((asin) => (asinToBrands.get(asin)?.size || 0) === 0)

    for (const asinChunk of chunkArray(asinsMissingBrandInfo)) {
      const productBrandRows = await db.query<{ asin: string; brand: string }>(
        `
          SELECT asin, brand
          FROM affiliate_products
          WHERE user_id = ?
            AND asin IS NOT NULL
            AND brand IS NOT NULL
            AND UPPER(COALESCE(asin, '')) IN (${asinChunk.map(() => '?').join(', ')})
        `,
        [params.userId, ...asinChunk]
      )

      for (const row of productBrandRows) {
        const asin = normalizeAsin(row.asin)
        if (!asin) continue
        const brand = normalizeBrand(row.brand)
        if (!brand) continue

        const brands = asinToBrands.get(asin) || new Set<string>()
        brands.add(brand)
        asinToBrands.set(asin, brands)
      }
    }

    // Enhance asinToBrands with brand info from affiliate platform API as a final fallback.
    const missingAsins = asinsMissingBrandInfo
      .filter((asin) => (asinToBrands.get(asin)?.size || 0) === 0)

    if (missingAsins.length > 0) {
      const platformAsins = new Map<AffiliatePlatform, string[]>()
      const missingAsinSet = new Set(missingAsins)

      // Group ASINs by platform based on commission entries
      for (const entry of freshEntries) {
        if (!entry.sourceAsin) continue
        const normalizedAsin = normalizeAsin(entry.sourceAsin)
        if (!normalizedAsin || !missingAsinSet.has(normalizedAsin)) continue

        const asinsForPlatform = platformAsins.get(entry.platform) || []
        if (!asinsForPlatform.includes(normalizedAsin)) {
          asinsForPlatform.push(normalizedAsin)
        }
        platformAsins.set(entry.platform, asinsForPlatform)
      }

      // Fetch brand info from each platform
      for (const [platform, asins] of platformAsins.entries()) {
        const asinBrandMap = await fetchAsinBrandsFromAffiliatePlatform({
          userId: params.userId,
          asins,
          platform,
          db })

        // Merge into asinToBrands
        for (const [asin, brand] of asinBrandMap.entries()) {
          const normalizedBrand = normalizeBrand(brand)
          if (!normalizedBrand) continue

          const brands = asinToBrands.get(asin) || new Set<string>()
          brands.add(normalizedBrand)
          asinToBrands.set(asin, brands)
        }
      }
    }


    const appendAttributionRows = (paramsForAppend: {
      entry: NormalizedCommissionEntry
      candidates: CampaignAttributionCandidate[]
      attributionRule: 'asin_match' | 'brand_equal_split'
    }) => {
      const uniqueCandidates = mergeCampaignTargets(
        paramsForAppend.candidates.map((candidate) => ({
          campaignId: candidate.campaignId,
          offerId: candidate.offerId,
          weight: 1 }))
      ).map((target) => {
        const source = paramsForAppend.candidates.find((candidate) => candidate.campaignId === target.campaignId)
        return {
          campaignId: target.campaignId,
          offerId: Number(target.offerId),
          cost: Math.max(0, Number(source?.cost) || 0),
          clicks: Math.max(0, Number(source?.clicks) || 0) }
      })

      const totalCost = uniqueCandidates.reduce((sum, candidate) => sum + candidate.cost, 0)
      const totalClicks = uniqueCandidates.reduce((sum, candidate) => sum + candidate.clicks, 0)

      const weights = paramsForAppend.attributionRule === 'brand_equal_split'
        ? uniqueCandidates.map(() => 1)
        : uniqueCandidates.map((candidate) => {
            if (totalCost > 0) return candidate.cost
            if (totalClicks > 0) return candidate.clicks
            return 1
          })

      const shares = buildWeightedShares(paramsForAppend.entry.commission, weights)
      uniqueCandidates.forEach((candidate, index) => {
        const amount = shares[index] || 0
        if (amount <= 0) return

        attributedOfferIds.add(candidate.offerId)
        attributedCampaignIds.add(candidate.campaignId)
        rowsToInsert.push({
          userId: params.userId,
          reportDate: params.reportDate,
          platform: paramsForAppend.entry.platform,
          sourceOrderId: paramsForAppend.entry.sourceOrderId,
          sourceMid: paramsForAppend.entry.sourceMid,
          sourceAsin: paramsForAppend.entry.sourceAsin,
          offerId: candidate.offerId,
          campaignId: candidate.campaignId,
          commissionAmount: amount,
          currency: paramsForAppend.entry.currency,
          rawPayload: toDbJsonObjectField(buildStoredRawPayload({
            raw: paramsForAppend.entry.raw,
            eventId: paramsForAppend.entry.eventId,
            attributionRule: paramsForAppend.attributionRule,
            normalizedBrand: paramsForAppend.entry.normalizedBrand }), null) })
      })
    }

    for (const entry of freshEntries) {
      const sourceAsin = entry.sourceAsin
      const matchedAsinCandidates = sourceAsin
        ? [...(asinToCampaigns.get(sourceAsin) || [])]
        : []

      const brandFilteredAsinCandidates = entry.normalizedBrand
        ? matchedAsinCandidates.filter((candidate) => candidate.normalizedBrand === entry.normalizedBrand)
        : matchedAsinCandidates

      const directCandidates = brandFilteredAsinCandidates.length > 0
        ? brandFilteredAsinCandidates
        : matchedAsinCandidates
      const preferredDirectCandidates = preferOnlineCampaignCandidates(
        directCandidates,
        { removedCampaignGraceDays }
      )

      if (preferredDirectCandidates.length > 0) {
        appendAttributionRows({
          entry,
          candidates: preferredDirectCandidates,
          attributionRule: 'asin_match' })
        continue
      }

      const inferredBrands = new Set<string>()
      if (entry.normalizedBrand) inferredBrands.add(entry.normalizedBrand)
      if (sourceAsin) {
        for (const brand of asinToBrands.get(sourceAsin) || []) {
          inferredBrands.add(brand)
        }
      }

      const brandCandidates = Array.from(inferredBrands)
        .flatMap((brand) => brandToCampaigns.get(brand) || [])
        .filter((candidate, index, list) => list.findIndex((item) => item.campaignId === candidate.campaignId) === index)
      const preferredBrandCandidates = preferOnlineCampaignCandidates(
        brandCandidates,
        { removedCampaignGraceDays }
      )

      if (preferredBrandCandidates.length > 0) {
        appendAttributionRows({
          entry,
          candidates: preferredBrandCandidates,
          attributionRule: 'brand_equal_split' })
        continue
      }

      const hasIdentifier = Boolean(entry.sourceAsin || entry.normalizedBrand || entry.sourceMid || entry.sourceLinkId || entry.sourceLink)
      const baseReasonCode: AffiliateAttributionBaseFailureReasonCode = !hasIdentifier
        ? 'missing_identifier'
        : (sourceAsin ? 'campaign_mapping_miss' : 'offer_mapping_miss')

      failureRows.push({
        userId: params.userId,
        reportDate: params.reportDate,
        platform: entry.platform,
        sourceOrderId: entry.sourceOrderId,
        sourceMid: entry.sourceMid,
        sourceAsin: entry.sourceAsin,
        sourceLinkId: entry.sourceLinkId,
        offerId: null,
        campaignId: resolveFailureAuditCampaignId({
          offerContexts,
          campaignCandidates,
          matchedAsinCandidates,
          sourceAsin }),
        commissionAmount: entry.commission,
        currency: entry.currency,
        reasonCode: resolveAffiliateAttributionFailureReasonCode({
          baseReasonCode,
          reportDate: params.reportDate }),
        reasonDetail: buildFailureReasonDetail({
          reportDate: params.reportDate,
          sourceMid: entry.sourceMid,
          sourceAsin: entry.sourceAsin,
          sourceLinkId: entry.sourceLinkId,
          sourceNormId: entry.sourceNormId }),
        rawPayload: buildStoredRawPayload({
          raw: entry.raw,
          eventId: entry.eventId,
          attributionRule: 'unattributed',
          normalizedBrand: entry.normalizedBrand }) })
    }
  }

  await db.transaction(async () => {
    if (shouldResetHistoricalSnapshot) {
      await deleteExistingAttributionSnapshot({
        db,
        userId: params.userId,
        reportDate: params.reportDate,
        platforms: replacePlatforms })
    }

    for (const row of rowsToInsert) {
      await db.exec(
        `
          INSERT INTO affiliate_commission_attributions
            (user_id, report_date, platform, source_order_id, source_mid, source_asin, offer_id, campaign_id, commission_amount, currency, raw_payload)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          row.userId,
          row.reportDate,
          row.platform,
          row.sourceOrderId,
          row.sourceMid,
          row.sourceAsin,
          row.offerId,
          row.campaignId,
          row.commissionAmount,
          row.currency,
          row.rawPayload,
        ]
      )
    }

    try {
      for (const row of failureRows) {
        await db.exec(
          `
            INSERT INTO openclaw_affiliate_attribution_failures
              (user_id, report_date, platform, source_order_id, source_mid, source_asin, source_link_id, offer_id, campaign_id, commission_amount, currency, reason_code, reason_detail, raw_payload)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            row.userId,
            row.reportDate,
            row.platform,
            row.sourceOrderId,
            row.sourceMid,
            row.sourceAsin,
            row.sourceLinkId,
            row.offerId,
            row.campaignId,
            row.commissionAmount,
            row.currency,
            row.reasonCode,
            row.reasonDetail,
            toDbJsonObjectField(row.rawPayload ?? null, null),
          ]
        )
      }
    } catch (error: any) {
      const message = String(error?.message || '')
      if (/openclaw_affiliate_attribution_failures/i.test(message) && /(no such table|does not exist)/i.test(message)) {
        console.warn('[affiliate-attribution] failure audit table missing, skip failure reason logging')
      } else {
        throw error
      }
    }
  })

  const newAttributedCommission = roundTo(
    rowsToInsert.reduce((sum, row) => sum + (Number(row.commissionAmount) || 0), 0)
  )
  const newUnattributedCommission = roundTo(
    failureRows.reduce((sum, row) => sum + (Number(row.commissionAmount) || 0), 0)
  )

  if (shouldResetHistoricalSnapshot) {
    return {
      reportDate: params.reportDate,
      totalCommission,
      attributedCommission: newAttributedCommission,
      unattributedCommission: newUnattributedCommission,
      attributedOffers: attributedOfferIds.size,
      attributedCampaigns: attributedCampaignIds.size,
      writtenRows: rowsToInsert.length }
  }

  return {
    reportDate: params.reportDate,
    totalCommission,
    attributedCommission: roundTo(existingAttributedCommission + newAttributedCommission),
    unattributedCommission: roundTo(existingUnattributedCommission + newUnattributedCommission),
    attributedOffers: attributedOfferIds.size,
    attributedCampaigns: attributedCampaignIds.size,
    writtenRows: rowsToInsert.length }
}
