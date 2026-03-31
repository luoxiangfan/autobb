import { formatOpenclawLocalDate, normalizeOpenclawReportDate } from '@/lib/openclaw/report-date'

const DEFAULT_PENDING_GRACE_DAYS = 7
const MIN_PENDING_GRACE_DAYS = 1
const MAX_PENDING_GRACE_DAYS = 30

export type AffiliateAttributionBaseFailureReasonCode =
  | 'missing_identifier'
  | 'product_mapping_miss'
  | 'offer_mapping_miss'
  | 'campaign_mapping_miss'

export type AffiliateAttributionPendingFailureReasonCode =
  | 'pending_product_mapping_miss'
  | 'pending_offer_mapping_miss'

export type AffiliateAttributionFailureReasonCode =
  | AffiliateAttributionBaseFailureReasonCode
  | AffiliateAttributionPendingFailureReasonCode

const PENDING_REASON_MAP: Record<
  Extract<AffiliateAttributionBaseFailureReasonCode, 'product_mapping_miss' | 'offer_mapping_miss'>,
  AffiliateAttributionPendingFailureReasonCode
> = {
  product_mapping_miss: 'pending_product_mapping_miss',
  offer_mapping_miss: 'pending_offer_mapping_miss',
}

export const ATTRIBUTION_ALWAYS_EXCLUDED_REASON_CODES = [
  'campaign_mapping_miss',
] as const

export const ATTRIBUTION_PENDING_REASON_CODES = [
  'pending_product_mapping_miss',
  'pending_offer_mapping_miss',
] as const

function parsePendingGraceDays(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PENDING_GRACE_DAYS
  }

  return Math.min(
    MAX_PENDING_GRACE_DAYS,
    Math.max(MIN_PENDING_GRACE_DAYS, Math.floor(parsed))
  )
}

function shiftYmdDate(ymd: string, daysOffset: number): string {
  const parsed = new Date(`${ymd}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return ymd
  parsed.setUTCDate(parsed.getUTCDate() + daysOffset)
  return parsed.toISOString().slice(0, 10)
}

function resolveReferenceDate(value?: string): string {
  const today = formatOpenclawLocalDate(new Date())
  if (!value) return today
  return normalizeOpenclawReportDate(value)
}

export function getAffiliateAttributionPendingGraceDays(customValue?: unknown): number {
  return parsePendingGraceDays(
    customValue ?? process.env.OPENCLAW_AFFILIATE_ATTRIBUTION_PENDING_DAYS
  )
}

export function isAffiliateAttributionPendingReasonCode(
  reasonCode: unknown
): reasonCode is AffiliateAttributionPendingFailureReasonCode {
  const normalized = String(reasonCode || '').trim().toLowerCase()
  return ATTRIBUTION_PENDING_REASON_CODES.includes(
    normalized as AffiliateAttributionPendingFailureReasonCode
  )
}

export function toFinalAffiliateAttributionReasonCode(
  reasonCode: AffiliateAttributionFailureReasonCode
): AffiliateAttributionBaseFailureReasonCode {
  if (reasonCode === 'pending_product_mapping_miss') return 'product_mapping_miss'
  if (reasonCode === 'pending_offer_mapping_miss') return 'offer_mapping_miss'
  return reasonCode
}

export function resolveAffiliateAttributionFailureReasonCode(params: {
  baseReasonCode: AffiliateAttributionBaseFailureReasonCode
  reportDate: string
  currentDate?: string
  pendingGraceDays?: number
}): AffiliateAttributionFailureReasonCode {
  const baseReasonCode = params.baseReasonCode

  if (baseReasonCode !== 'product_mapping_miss' && baseReasonCode !== 'offer_mapping_miss') {
    return baseReasonCode
  }

  const pendingGraceDays = getAffiliateAttributionPendingGraceDays(params.pendingGraceDays)
  const currentDate = resolveReferenceDate(params.currentDate)
  const reportDate = normalizeOpenclawReportDate(params.reportDate)
  const pendingCutoffDate = shiftYmdDate(currentDate, -(pendingGraceDays - 1))
  if (reportDate < pendingCutoffDate) {
    return baseReasonCode
  }

  return PENDING_REASON_MAP[baseReasonCode]
}

export function buildAffiliateUnattributedFailureFilter(params?: {
  currentDate?: string
  pendingGraceDays?: number
  includePendingWithinGrace?: boolean
  includeAllFailures?: boolean
}): {
  sql: string
  values: string[]
  currentDate: string
  pendingCutoffDate: string
  pendingGraceDays: number
} {
  const currentDate = resolveReferenceDate(params?.currentDate)
  const pendingGraceDays = getAffiliateAttributionPendingGraceDays(params?.pendingGraceDays)
  const pendingCutoffDate = shiftYmdDate(currentDate, -(pendingGraceDays - 1))
  const includePendingWithinGrace = params?.includePendingWithinGrace === true
  const includeAllFailures = params?.includeAllFailures === true

  // Include all failures (including campaign_mapping_miss)
  if (includeAllFailures) {
    if (includePendingWithinGrace) {
      return {
        sql: '1 = 1',
        values: [],
        currentDate,
        pendingCutoffDate,
        pendingGraceDays,
      }
    }

    const pendingReasonPlaceholders = ATTRIBUTION_PENDING_REASON_CODES.map(() => '?').join(', ')
    return {
      sql: `
        COALESCE(reason_code, '') NOT IN (${pendingReasonPlaceholders})
        OR report_date < ?
      `,
      values: [
        ...ATTRIBUTION_PENDING_REASON_CODES,
        pendingCutoffDate,
      ],
      currentDate,
      pendingCutoffDate,
      pendingGraceDays,
    }
  }

  // Original behavior: exclude campaign_mapping_miss
  if (includePendingWithinGrace) {
    return {
      sql: `
        COALESCE(reason_code, '') <> ?
      `,
      values: [
        ATTRIBUTION_ALWAYS_EXCLUDED_REASON_CODES[0],
      ],
      currentDate,
      pendingCutoffDate,
      pendingGraceDays,
    }
  }

  const pendingReasonPlaceholders = ATTRIBUTION_PENDING_REASON_CODES.map(() => '?').join(', ')

  return {
    sql: `
      COALESCE(reason_code, '') <> ?
      AND (
        COALESCE(reason_code, '') NOT IN (${pendingReasonPlaceholders})
        OR report_date < ?
      )
    `,
    values: [
      ATTRIBUTION_ALWAYS_EXCLUDED_REASON_CODES[0],
      ...ATTRIBUTION_PENDING_REASON_CODES,
      pendingCutoffDate,
    ],
    currentDate,
    pendingCutoffDate,
    pendingGraceDays,
  }
}
