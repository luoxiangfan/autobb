const PARTNERBOOST_COMMISSION_ALIASES = [
  'estCommission',
  'est_commission',
  'EstCommission',
  'Est. Commission',
  'Est Commission',
  'est commission',
  'commission',
  'commission_amount',
  'commissionAmount',
  'sale_comm',
  'saleComm',
  'earnings',
  'earning',
]

const PARTNERBOOST_ORDER_ID_ALIASES = [
  'order_id',
  'orderId',
  'orderID',
  'oid',
  'Order ID',
  'order id',
]

const PARTNERBOOST_LINK_ID_ALIASES = [
  'aa_adgroupid',
  'aaAdgroupid',
  'adGroupId',
  'ad_group_id',
  'Ad Group Id',
  'click_ref',
  'clickRef',
  'Click Ref',
]

const PARTNERBOOST_LINK_ALIASES = [
  'link',
  'url',
  'product_link',
  'productLink',
  'landing_page',
  'landingPage',
  'final_url',
  'finalUrl',
  'Referrer URL',
  'referrer_url',
]

const PARTNERBOOST_SOURCE_ASIN_ALIASES = [
  'asin',
  'ASIN',
  'product_asin',
  'productAsin',
  'product_id',
  'productId',
  'Product ID',
  'product id',
  'prod_id',
  'prodId',
  'sku',
  'SKU',
]

const PARTNERBOOST_BRAND_ALIASES = [
  'brand',
  'brand_name',
  'brandName',
  'advert_name',
  'advertName',
  'merchant_name',
  'merchantName',
  'seller_name',
  'sellerName',
]

export type PartnerboostReportCommissionRow = {
  commission: number
  asin: string | null
  rawBrand: string | null
}

export function extractPartnerboostBrandFromRow(row: unknown): string | null {
  const value = getPartnerboostFieldValue(row, PARTNERBOOST_BRAND_ALIASES)
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
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

function isEmptyValue(value: unknown): boolean {
  return value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '')
}

function normalizeLookupKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function getPartnerboostFieldValue(row: any, aliases: string[]): unknown {
  if (!row || typeof row !== 'object') return undefined

  for (const alias of aliases) {
    const value = row?.[alias as keyof typeof row]
    if (!isEmptyValue(value)) return value
  }

  const normalizedValueMap = new Map<string, unknown>()
  for (const [key, value] of Object.entries(row)) {
    if (isEmptyValue(value)) continue
    const normalizedKey = normalizeLookupKey(key)
    if (!normalizedKey || normalizedValueMap.has(normalizedKey)) continue
    normalizedValueMap.set(normalizedKey, value)
  }

  for (const alias of aliases) {
    const value = normalizedValueMap.get(normalizeLookupKey(alias))
    if (!isEmptyValue(value)) return value
  }

  return undefined
}

export function normalizePartnerboostReportRows(payload: any): any[] {
  const data = payload?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.list)) return data.list
  if (Array.isArray(payload?.list)) return payload.list
  return []
}

export function normalizePartnerboostTransactionRows(payload: any): { rows: any[]; totalPages: number | null } {
  const data = payload?.data
  const rows = Array.isArray(data?.list)
    ? data.list
    : (Array.isArray(payload?.list) ? payload.list : [])

  const totalPagesRaw = data?.total_page ?? data?.totalPage ?? payload?.total_page ?? payload?.totalPage
  const totalPages = Number(totalPagesRaw)

  return {
    rows,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : null,
  }
}

function normalizeAsin(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return null
  const cleaned = text.replace(/[^A-Z0-9]/g, '')
  if (!cleaned) return null
  return cleaned.length > 10 ? cleaned.slice(0, 10) : cleaned
}

function extractAsinFromUrlLike(value: unknown): string | null {
  const raw = String(value || '').trim()
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

function pickAsin(...values: unknown[]): string | null {
  for (const value of values) {
    const asinFromUrl = extractAsinFromUrlLike(value)
    if (asinFromUrl) return asinFromUrl
    const asin = normalizeAsin(value)
    if (asin && asin.length === 10) return asin
  }
  return null
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

export function parsePartnerboostCommissionValue(row: any): number {
  const direct = parseNumberish(getPartnerboostFieldValue(row, PARTNERBOOST_COMMISSION_ALIASES), 0)
  if (direct > 0) return direct
  if (!row || typeof row !== 'object') return direct

  let bestScore = -1
  let bestValue = 0

  for (const [key, value] of Object.entries(row)) {
    if (isEmptyValue(value)) continue
    const normalizedKey = normalizeLookupKey(key)
    if (!normalizedKey) continue
    if (normalizedKey.includes('rate') || normalizedKey.includes('ratio') || normalizedKey.includes('percent') || normalizedKey.includes('pct')) {
      continue
    }

    let score = -1
    if (normalizedKey.includes('est') && normalizedKey.includes('commission')) {
      score = 4
    } else if (normalizedKey.includes('commission')) {
      score = 3
    } else if (normalizedKey.includes('salecomm')) {
      score = 2
    } else if (normalizedKey.includes('earning')) {
      score = 1
    }

    if (score < 0) continue

    const parsed = parseNumberish(value, 0)
    if (parsed <= 0) continue

    if (score > bestScore || (score === bestScore && parsed > bestValue)) {
      bestScore = score
      bestValue = parsed
    }
  }

  return bestValue > 0 ? bestValue : direct
}

function flattenPartnerboostReportRows(reportPayloads: unknown[]): any[] {
  const reportRows: any[] = []
  for (const payload of reportPayloads) {
    reportRows.push(...normalizePartnerboostReportRows(payload))
  }
  return reportRows
}

function flattenPartnerboostTransactionRows(transactionPayloads: unknown[]): any[] {
  const transactionRows: any[] = []
  for (const payload of transactionPayloads) {
    transactionRows.push(...normalizePartnerboostTransactionRows(payload).rows)
  }
  return transactionRows
}

function resolvePartnerboostRowAsin(params: {
  row: any
  matchedReportRow?: any | null
  fallbackReportRow?: any | null
  sourceLinkFallback?: string | null
}): string | null {
  const sourceLink = pickString(
    getPartnerboostFieldValue(params.row, PARTNERBOOST_LINK_ALIASES),
    getPartnerboostFieldValue(params.matchedReportRow, PARTNERBOOST_LINK_ALIASES),
    getPartnerboostFieldValue(params.fallbackReportRow, PARTNERBOOST_LINK_ALIASES),
    params.sourceLinkFallback,
  )

  return pickAsin(
    getPartnerboostFieldValue(params.row, PARTNERBOOST_SOURCE_ASIN_ALIASES),
    getPartnerboostFieldValue(params.matchedReportRow, PARTNERBOOST_SOURCE_ASIN_ALIASES),
    getPartnerboostFieldValue(params.fallbackReportRow, PARTNERBOOST_SOURCE_ASIN_ALIASES),
    sourceLink,
  )
}

function resolvePartnerboostRowRawBrand(params: {
  row: any
  matchedReportRow?: any | null
  fallbackReportRow?: any | null
}): string | null {
  return pickString(
    extractPartnerboostBrandFromRow(params.row),
    extractPartnerboostBrandFromRow(params.matchedReportRow),
    extractPartnerboostBrandFromRow(params.fallbackReportRow),
  )
}

/**
 * Match affiliate-revenue sync: transaction rows are primary; amazon_report is fallback.
 */
export function collectPartnerboostReportRows(params: {
  transactionPayloads: unknown[]
  reportPayloads: unknown[]
}): PartnerboostReportCommissionRow[] {
  const reportRows = flattenPartnerboostReportRows(params.reportPayloads)
  const transactionRows = flattenPartnerboostTransactionRows(params.transactionPayloads)

  const reportRowsByOrderId = new Map<string, any>()
  const reportRowsWithAdGroup: Array<{
    sourceLink: string | null
    sourceLinkId: string
    reportRow: any
  }> = []

  for (const row of reportRows) {
    const orderId = pickString(getPartnerboostFieldValue(row, PARTNERBOOST_ORDER_ID_ALIASES))
    if (orderId && !reportRowsByOrderId.has(orderId)) {
      reportRowsByOrderId.set(orderId, row)
    }

    const sourceLinkId = pickString(getPartnerboostFieldValue(row, PARTNERBOOST_LINK_ID_ALIASES))
    if (!sourceLinkId) continue

    const sourceLink = pickString(getPartnerboostFieldValue(row, PARTNERBOOST_LINK_ALIASES))
    reportRowsWithAdGroup.push({ sourceLink, sourceLinkId, reportRow: row })
  }

  const uniqueReportAdGroupIds = Array.from(
    new Set(reportRowsWithAdGroup.map((item) => item.sourceLinkId))
  )
  const singleAdGroupFallback = uniqueReportAdGroupIds.length === 1
    ? reportRowsWithAdGroup.find((item) => item.sourceLinkId === uniqueReportAdGroupIds[0]) || null
    : null

  const results: PartnerboostReportCommissionRow[] = []

  const appendRow = (paramsForRow: {
    row: any
    commission: number
    matchedReportRow?: any | null
    fallbackReportRow?: any | null
    sourceLinkFallback?: string | null
  }) => {
    results.push({
      commission: paramsForRow.commission,
      asin: resolvePartnerboostRowAsin({
        row: paramsForRow.row,
        matchedReportRow: paramsForRow.matchedReportRow,
        fallbackReportRow: paramsForRow.fallbackReportRow,
        sourceLinkFallback: paramsForRow.sourceLinkFallback,
      }),
      rawBrand: resolvePartnerboostRowRawBrand({
        row: paramsForRow.row,
        matchedReportRow: paramsForRow.matchedReportRow,
        fallbackReportRow: paramsForRow.fallbackReportRow,
      }),
    })
  }

  if (transactionRows.length > 0) {
    for (const row of transactionRows) {
      const commission = parsePartnerboostCommissionValue(row)
      if (commission <= 0) continue

      const orderId = pickString(getPartnerboostFieldValue(row, PARTNERBOOST_ORDER_ID_ALIASES))
      const matchedReportRow = orderId ? (reportRowsByOrderId.get(orderId) || null) : null

      appendRow({
        row,
        commission,
        matchedReportRow,
        fallbackReportRow: matchedReportRow ? null : singleAdGroupFallback?.reportRow || null,
        sourceLinkFallback: matchedReportRow ? null : singleAdGroupFallback?.sourceLink || null,
      })
    }
    return results
  }

  for (const row of reportRows) {
    const commission = parsePartnerboostCommissionValue(row)
    if (commission <= 0) continue
    appendRow({ row, commission })
  }

  return results
}

export const partnerboostCommissionFieldAliases = {
  commission: PARTNERBOOST_COMMISSION_ALIASES,
  orderId: PARTNERBOOST_ORDER_ID_ALIASES,
  linkId: PARTNERBOOST_LINK_ID_ALIASES,
  link: PARTNERBOOST_LINK_ALIASES,
  asin: PARTNERBOOST_SOURCE_ASIN_ALIASES,
  brand: PARTNERBOOST_BRAND_ALIASES,
}
