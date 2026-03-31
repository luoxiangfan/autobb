import {
  persistAffiliateCommissionAttributions,
  type AffiliateCommissionRawEntry,
  type AffiliatePlatform,
} from '@/lib/openclaw/affiliate-commission-attribution'
import { getOpenclawSettingsWithAffiliateSyncMap, parseNumber } from '@/lib/openclaw/settings'

type PlatformQueryError = {
  platform: AffiliatePlatform | 'attribution'
  message: string
}

type PlatformBreakdown = {
  platform: AffiliatePlatform
  totalCommission: number
  records: number
  currency: string
}

type AttributionSummary = {
  attributedCommission: number
  unattributedCommission: number
  attributedOffers: number
  attributedCampaigns: number
  writtenRows: number
}

export type AffiliateCommissionRevenue = {
  reportDate: string
  configuredPlatforms: AffiliatePlatform[]
  queriedPlatforms: AffiliatePlatform[]
  totalCommission: number
  breakdown: PlatformBreakdown[]
  errors: PlatformQueryError[]
  attribution: AttributionSummary
}

const DEFAULT_PARTNERBOOST_BASE_URL = 'https://app.partnerboost.com'
const PARTNERBOOST_PAGE_SIZE = 100
const PARTNERBOOST_MAX_PAGES = 20
const YEAHPROMOS_DEFAULT_LIMIT = 1000
const YEAHPROMOS_MAX_PAGES = 5
const PARTNERBOOST_COMMISSION_ALIASES = [
  'estCommission',
  'est_commission',
  'EstCommission',
  'Est. Commission',
  'Est Commission',
  'est commission',
  // Fallback aliases observed in some affiliate feeds
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

const PARTNERBOOST_SOURCE_MID_ALIASES = [
  'partnerboost_id',
  'PartnerBoost ID',
  'partnerboost id',
  'partnerboostid',
  'mcid',
  'MCID',
  'mid',
  'MID',
  'advert_id',
  'advertId',
  'product_mid',
  'productMid',
  'product_id',
  'productId',
  'brand_id',
  'brandId',
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

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeCurrency(value: unknown): string {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized || 'USD'
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

function getFieldValue(row: any, aliases: string[]): unknown {
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

function normalizeYmdDate(value: string): string {
  const trimmed = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.TZ || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed)
}

function toPartnerboostDate(ymd: string): string {
  return ymd.replace(/-/g, '')
}

function normalizePartnerboostReportRows(payload: any): any[] {
  const data = payload?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.list)) return data.list
  if (Array.isArray(payload?.list)) return payload.list
  return []
}

function normalizePartnerboostTransactionRows(payload: any): { rows: any[]; totalPages: number | null } {
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

function normalizeYeahPromosCode(payload: any): number | null {
  const codeRaw = payload?.Code ?? payload?.code
  if (codeRaw === null || codeRaw === undefined || codeRaw === '') return null
  const code = Number(codeRaw)
  return Number.isFinite(code) ? code : null
}

function normalizeYeahPromosPayloadRows(payload: any): { rows: any[]; pageTotal: number | null } {
  const container = payload?.Data ?? payload?.data ?? payload

  let rows: any[] = []
  if (Array.isArray(container)) {
    rows = container
  } else if (Array.isArray(container?.Data)) {
    rows = container.Data
  } else if (Array.isArray(container?.data)) {
    rows = container.data
  } else if (Array.isArray(container?.list)) {
    rows = container.list
  } else if (Array.isArray(container?.rows)) {
    rows = container.rows
  } else if (Array.isArray(payload?.Data)) {
    rows = payload.Data
  } else if (Array.isArray(payload?.data)) {
    rows = payload.data
  } else if (Array.isArray(payload?.List)) {
    rows = payload.List
  } else if (container && typeof container === 'object') {
    const indexedRows = Object.entries(container)
      .filter(([key, value]) => /^\d+$/.test(key) && value && typeof value === 'object' && !Array.isArray(value))
      .map(([, value]) => value)
    if (indexedRows.length > 0) {
      rows = indexedRows
    }
  }

  const pageTotalRaw =
    container?.PageTotal
    ?? container?.page_total
    ?? container?.pageTotal
    ?? payload?.PageTotal
    ?? payload?.page_total
    ?? payload?.pageTotal

  const pageTotal = Number(pageTotalRaw)
  return {
    rows,
    pageTotal: Number.isFinite(pageTotal) && pageTotal > 0 ? Math.floor(pageTotal) : null,
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

function isLikelyAsin(value: unknown): boolean {
  const text = String(value || '').trim()
  if (!/^[A-Za-z0-9]{10}$/.test(text)) {
    return false
  }
  const normalized = normalizeAsin(text)
  return Boolean(normalized && normalized.length === 10)
}

function pickMid(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (!text) continue
    if (isLikelyAsin(text)) continue
    return text
  }
  return null
}

function parsePartnerboostCommissionValue(row: any): number {
  const direct = parseNumberish(getFieldValue(row, PARTNERBOOST_COMMISSION_ALIASES), 0)
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

function pickPartnerboostCommissionSignals(row: any): Record<string, unknown> {
  if (!row || typeof row !== 'object') return {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeLookupKey(key)
    if (!normalizedKey) continue
    if (
      normalizedKey.includes('commission')
      || normalizedKey.includes('earning')
      || normalizedKey.includes('salecomm')
      || normalizedKey.includes('saleamount')
      || normalizedKey.includes('unitprice')
      || normalizedKey.includes('status')
      || normalizedKey.includes('orderid')
    ) {
      result[key] = value
    }
  }
  return result
}

type CommissionCollection = {
  totalCommission: number
  records: number
  entries: AffiliateCommissionRawEntry[]
}

async function fetchPartnerboostCommission(params: {
  token: string
  baseUrl: string
  reportDate: string
}): Promise<CommissionCollection> {
  const startDate = toPartnerboostDate(params.reportDate)
  const endDate = toPartnerboostDate(params.reportDate)

  const reportRows: any[] = []
  let reportPage = 1

  while (reportPage <= PARTNERBOOST_MAX_PAGES) {
    const response = await fetch(`${params.baseUrl}/api/datafeed/get_amazon_report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: params.token,
        page_size: PARTNERBOOST_PAGE_SIZE,
        page: reportPage,
        start_date: startDate,
        end_date: endDate,
        marketplace: '',
        asins: '',
        adGroupIds: '',
        order_ids: '',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`PartnerBoost report API ${response.status}: ${text}`)
    }

    const payload = await response.json() as any
    const statusCode = Number(payload?.status?.code)
    if (!Number.isFinite(statusCode) || statusCode !== 0) {
      throw new Error(`PartnerBoost report error: ${payload?.status?.msg || statusCode}`)
    }

    const rows = normalizePartnerboostReportRows(payload)
    if (process.env.OPENCLAW_AFFILIATE_SYNC_DEBUG === 'true' && rows.length > 0) {
      const firstRow = rows[0] || {}
      const keys = Object.keys(firstRow).slice(0, 50)
      const commissionSignals = pickPartnerboostCommissionSignals(firstRow)
      const parsedCommission = parsePartnerboostCommissionValue(firstRow)
      console.log(
        `[affiliate-revenue][debug] PartnerBoost amazon_report date=${params.reportDate} page=${reportPage} rows=${rows.length} parsedCommission(firstRow)=${parsedCommission} keys=${keys.join(',')} signals=${JSON.stringify(commissionSignals)}`
      )
    }

    reportRows.push(...rows)

    const hasMore = payload?.data?.has_more === true || payload?.data?.hasMore === true
    if (rows.length < PARTNERBOOST_PAGE_SIZE && !hasMore) {
      break
    }

    reportPage += 1
  }

  const reportRowsByOrderId = new Map<string, any>()
  const reportRowsWithAdGroup: Array<{
    sourceLink: string | null
    sourceLinkId: string
    reportRow: any
  }> = []

  for (const row of reportRows) {
    const orderId = pickString(getFieldValue(row, PARTNERBOOST_ORDER_ID_ALIASES))
    if (orderId && !reportRowsByOrderId.has(orderId)) {
      reportRowsByOrderId.set(orderId, row)
    }

    const sourceLinkId = pickString(getFieldValue(row, PARTNERBOOST_LINK_ID_ALIASES))
    if (!sourceLinkId) continue

    const sourceLink = pickString(getFieldValue(row, PARTNERBOOST_LINK_ALIASES))
    reportRowsWithAdGroup.push({ sourceLink, sourceLinkId, reportRow: row })
  }

  const uniqueReportAdGroupIds = Array.from(
    new Set(reportRowsWithAdGroup.map((item) => item.sourceLinkId))
  )
  const singleAdGroupFallback = uniqueReportAdGroupIds.length === 1
    ? reportRowsWithAdGroup.find((item) => item.sourceLinkId === uniqueReportAdGroupIds[0]) || null
    : null

  const transactionRows: any[] = []
  let transactionError: Error | null = null
  let txPage = 1
  let txTotalPages: number | null = null

  try {
    while (txPage <= PARTNERBOOST_MAX_PAGES) {
      const transactionUrl = new URL('/api.php?mod=medium&op=transaction', params.baseUrl)
      const body = new URLSearchParams({
        token: params.token,
        begin_date: params.reportDate,
        end_date: params.reportDate,
        status: 'All',
        page: String(txPage),
        limit: String(PARTNERBOOST_PAGE_SIZE),
      })

      const response = await fetch(transactionUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`PartnerBoost transaction API ${response.status}: ${text}`)
      }

      const payload = await response.json() as any
      const statusCode = Number(payload?.status?.code)
      if (!Number.isFinite(statusCode) || statusCode !== 0) {
        throw new Error(`PartnerBoost transaction error: ${payload?.status?.msg || statusCode}`)
      }

      const normalized = normalizePartnerboostTransactionRows(payload)
      const rows = normalized.rows
      if (process.env.OPENCLAW_AFFILIATE_SYNC_DEBUG === 'true' && rows.length > 0) {
        const firstRow = rows[0] || {}
        const keys = Object.keys(firstRow).slice(0, 50)
        const commissionSignals = pickPartnerboostCommissionSignals(firstRow)
        const parsedCommission = parsePartnerboostCommissionValue(firstRow)
        console.log(
          `[affiliate-revenue][debug] PartnerBoost medium.transaction date=${params.reportDate} page=${txPage} rows=${rows.length} parsedCommission(firstRow)=${parsedCommission} keys=${keys.join(',')} signals=${JSON.stringify(commissionSignals)}`
        )
      }

      transactionRows.push(...rows)

      txTotalPages = normalized.totalPages ?? txTotalPages
      if (rows.length === 0) {
        break
      }
      if (txTotalPages !== null && txPage >= txTotalPages) {
        break
      }
      if (rows.length < PARTNERBOOST_PAGE_SIZE && txTotalPages === null) {
        break
      }

      txPage += 1
    }
  } catch (error: any) {
    transactionError = error instanceof Error ? error : new Error(String(error))
    console.warn(
      `[affiliate-revenue] PartnerBoost transaction API failed on ${params.reportDate}; fallback to amazon_report commission. reason=${transactionError.message}`
    )
  }

  const entries: AffiliateCommissionRawEntry[] = []
  let totalCommission = 0
  let records = 0

  const appendPartnerboostEntry = (paramsForEntry: {
    row: any
    commission: number
    matchedReportRow?: any | null
    fallbackReportRow?: any | null
    sourceLinkFallback?: string | null
    sourceLinkIdFallback?: string | null
  }) => {
    const row = paramsForEntry.row
    const matchedReportRow = paramsForEntry.matchedReportRow || null
    const fallbackReportRow = paramsForEntry.fallbackReportRow || null
    const sourceLink = pickString(
      getFieldValue(row, PARTNERBOOST_LINK_ALIASES),
      getFieldValue(matchedReportRow, PARTNERBOOST_LINK_ALIASES),
      getFieldValue(fallbackReportRow, PARTNERBOOST_LINK_ALIASES),
      paramsForEntry.sourceLinkFallback,
    )

    const sourceLinkId = pickString(
      getFieldValue(row, PARTNERBOOST_LINK_ID_ALIASES),
      getFieldValue(matchedReportRow, PARTNERBOOST_LINK_ID_ALIASES),
      getFieldValue(fallbackReportRow, PARTNERBOOST_LINK_ID_ALIASES),
      paramsForEntry.sourceLinkIdFallback,
    )

    const sourceOrderId = pickString(
      getFieldValue(row, PARTNERBOOST_ORDER_ID_ALIASES),
      getFieldValue(matchedReportRow, PARTNERBOOST_ORDER_ID_ALIASES),
      getFieldValue(fallbackReportRow, PARTNERBOOST_ORDER_ID_ALIASES),
    )

    entries.push({
      platform: 'partnerboost',
      reportDate: params.reportDate,
      commission: paramsForEntry.commission,
      currency: normalizeCurrency(
        getFieldValue(row, ['payment_currency', 'paymentCurrency', 'currency'])
      ),
      sourceOrderId,
      sourceMid: pickMid(
        getFieldValue(row, PARTNERBOOST_SOURCE_MID_ALIASES),
        getFieldValue(matchedReportRow, PARTNERBOOST_SOURCE_MID_ALIASES),
        getFieldValue(fallbackReportRow, PARTNERBOOST_SOURCE_MID_ALIASES),
        sourceLinkId
      ),
      sourceAsin: normalizeAsin(
        pickAsin(
          getFieldValue(row, PARTNERBOOST_SOURCE_ASIN_ALIASES),
          getFieldValue(matchedReportRow, PARTNERBOOST_SOURCE_ASIN_ALIASES),
          getFieldValue(fallbackReportRow, PARTNERBOOST_SOURCE_ASIN_ALIASES),
          sourceLink
        )
      ),
      sourceLink,
      sourceLinkId,
      raw: row,
    })
  }

  if (transactionRows.length > 0) {
    records = transactionRows.length
    for (const row of transactionRows) {
      const commission = parsePartnerboostCommissionValue(row)
      totalCommission += commission

      if (commission <= 0) continue

      const orderId = pickString(getFieldValue(row, PARTNERBOOST_ORDER_ID_ALIASES))
      const matchedReportRow = orderId ? (reportRowsByOrderId.get(orderId) || null) : null

      appendPartnerboostEntry({
        row,
        commission,
        matchedReportRow,
        fallbackReportRow: matchedReportRow ? null : singleAdGroupFallback?.reportRow || null,
        sourceLinkFallback: matchedReportRow ? null : singleAdGroupFallback?.sourceLink || null,
        sourceLinkIdFallback: matchedReportRow ? null : singleAdGroupFallback?.sourceLinkId || null,
      })
    }
  }

  const useReportAsPrimary = transactionRows.length === 0
  if (useReportAsPrimary) {
    records = reportRows.length
    for (const row of reportRows) {
      const commission = parsePartnerboostCommissionValue(row)
      totalCommission += commission
      if (commission <= 0) {
        continue
      }
      appendPartnerboostEntry({
        row,
        commission,
        matchedReportRow: null,
      })
    }
  }

  if (transactionRows.length > 0 && transactionRows.every((row) => parsePartnerboostCommissionValue(row) <= 0)) {
    const firstRowKeys = Object.keys(transactionRows[0] || {}).slice(0, 30)
    console.warn(
      `[affiliate-revenue] PartnerBoost transaction returned ${transactionRows.length} rows on ${params.reportDate}, but commission resolved to 0. keys=${firstRowKeys.join(',')}`
    )
  } else if (transactionRows.length === 0 && reportRows.length > 0 && reportRows.every((row) => parsePartnerboostCommissionValue(row) <= 0)) {
    const firstRowKeys = Object.keys(reportRows[0] || {}).slice(0, 30)
    console.warn(
      `[affiliate-revenue] PartnerBoost amazon_report returned ${reportRows.length} rows on ${params.reportDate}, but commission resolved to 0. keys=${firstRowKeys.join(',')}`
    )
  }

  if (transactionError && transactionRows.length === 0 && reportRows.length === 0) {
    throw transactionError
  }

  return {
    totalCommission: roundTo2(totalCommission),
    records,
    entries,
  }
}

async function fetchYeahPromosCommission(params: {
  token: string
  siteId: string
  reportDate: string
  isAmazonOnly: boolean
  pageStart: number
  limit: number
}): Promise<CommissionCollection> {
  let page = params.pageStart
  let pageTotal: number | null = null
  let pagesFetched = 0
  let totalCommission = 0
  let records = 0
  const entries: AffiliateCommissionRawEntry[] = []

  while (pagesFetched < YEAHPROMOS_MAX_PAGES) {
    const url = new URL('https://yeahpromos.com/index/Getorder/getorder')
    url.searchParams.set('site_id', params.siteId)
    url.searchParams.set('startDate', params.reportDate)
    url.searchParams.set('endDate', params.reportDate)
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(params.limit))
    if (params.isAmazonOnly) {
      url.searchParams.set('is_amazon', '1')
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        token: params.token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`YeahPromos order API ${response.status}: ${text}`)
    }

    const payload = await response.json() as any
    const code = normalizeYeahPromosCode(payload)
    if (code !== null && code !== 100000) {
      throw new Error(`YeahPromos order error: ${code}`)
    }

    const normalized = normalizeYeahPromosPayloadRows(payload)
    const rows = normalized.rows

    for (const row of rows) {
      const commission = parseNumberish(row?.sale_comm, 0)
      totalCommission += commission

      if (commission > 0) {
        entries.push({
          platform: 'yeahpromos',
          reportDate: params.reportDate,
          commission,
          currency: 'USD',
          sourceOrderId: pickString(
            row?.oid,
            row?.order_id,
            row?.orderId,
            row?.id,
          ),
          sourceMid: pickString(
            row?.advert_id,
            row?.advertId,
            row?.mid,
          ),
          sourceAsin: normalizeAsin(
            pickAsin(
              row?.asin,
              row?.ASIN,
              row?.sku,
              row?.link,
              row?.url,
              row?.product_link,
              row?.productLink
            )
          ),
          sourceLink: pickString(
            row?.link,
            row?.url,
            row?.product_link,
            row?.productLink
          ),
          raw: row,
        })
      }
    }

    records += rows.length
    pagesFetched += 1
    pageTotal = normalized.pageTotal ?? pageTotal

    if (rows.length === 0) {
      break
    }

    if (pageTotal !== null && page >= pageTotal) {
      break
    }

    if (rows.length < params.limit) {
      break
    }

    page += 1
  }

  return {
    totalCommission: roundTo2(totalCommission),
    records,
    entries,
  }
}

export async function fetchAffiliateCommissionRevenue(params: {
  userId: number
  reportDate: string
}): Promise<AffiliateCommissionRevenue> {
  const settings = await getOpenclawSettingsWithAffiliateSyncMap(params.userId)
  const reportDate = normalizeYmdDate(params.reportDate)

  const configuredPlatforms: AffiliatePlatform[] = []
  const queriedPlatforms: AffiliatePlatform[] = []
  const breakdown: PlatformBreakdown[] = []
  const errors: PlatformQueryError[] = []
  const attributionEntries: AffiliateCommissionRawEntry[] = []

  const partnerboostToken = String(settings.partnerboost_token || '').trim()
  if (partnerboostToken) {
    configuredPlatforms.push('partnerboost')

    const baseUrl = String(settings.partnerboost_base_url || DEFAULT_PARTNERBOOST_BASE_URL)
      .trim()
      .replace(/\/+$/, '') || DEFAULT_PARTNERBOOST_BASE_URL

    try {
      const metrics = await fetchPartnerboostCommission({
        token: partnerboostToken,
        baseUrl,
        reportDate,
      })
      queriedPlatforms.push('partnerboost')
      breakdown.push({
        platform: 'partnerboost',
        totalCommission: metrics.totalCommission,
        records: metrics.records,
        currency: 'USD',
      })
      attributionEntries.push(...metrics.entries)
    } catch (error: any) {
      errors.push({
        platform: 'partnerboost',
        message: error?.message || 'PartnerBoost commission query failed',
      })
    }
  }

  const yeahPromosToken = String(settings.yeahpromos_token || '').trim()
  const yeahPromosSiteId = String(settings.yeahpromos_site_id || '').trim()
  if (yeahPromosToken && yeahPromosSiteId) {
    configuredPlatforms.push('yeahpromos')

    const pageStart = Math.max(1, parseNumber(settings.yeahpromos_page, 1) || 1)
    const limit = Math.max(1, parseNumber(settings.yeahpromos_limit, YEAHPROMOS_DEFAULT_LIMIT) || YEAHPROMOS_DEFAULT_LIMIT)
    const isAmazonOnly = String(settings.yeahpromos_is_amazon || '').trim() === '1'

    try {
      const metrics = await fetchYeahPromosCommission({
        token: yeahPromosToken,
        siteId: yeahPromosSiteId,
        reportDate,
        isAmazonOnly,
        pageStart,
        limit,
      })
      queriedPlatforms.push('yeahpromos')
      breakdown.push({
        platform: 'yeahpromos',
        totalCommission: metrics.totalCommission,
        records: metrics.records,
        currency: 'USD',
      })
      attributionEntries.push(...metrics.entries)
    } catch (error: any) {
      errors.push({
        platform: 'yeahpromos',
        message: error?.message || 'YeahPromos commission query failed',
      })
    }
  }

  const totalCommission = roundTo2(
    breakdown.reduce((sum, item) => sum + (Number(item.totalCommission) || 0), 0)
  )

  const shouldReplaceAttribution = queriedPlatforms.length > 0 || configuredPlatforms.length === 0
  let attribution: AttributionSummary = {
    attributedCommission: 0,
    unattributedCommission: totalCommission,
    attributedOffers: 0,
    attributedCampaigns: 0,
    writtenRows: 0,
  }

  try {
    const attributionResult = await persistAffiliateCommissionAttributions({
      userId: params.userId,
      reportDate,
      entries: attributionEntries,
      replaceExisting: shouldReplaceAttribution,
      lockHistorical: true,
    })

    attribution = {
      attributedCommission: roundTo2(attributionResult.attributedCommission),
      unattributedCommission: roundTo2(attributionResult.unattributedCommission),
      attributedOffers: attributionResult.attributedOffers,
      attributedCampaigns: attributionResult.attributedCampaigns,
      writtenRows: attributionResult.writtenRows,
    }
  } catch (error: any) {
    errors.push({
      platform: 'attribution',
      message: `[attribution] ${error?.message || 'Attribution persistence failed'}`,
    })
  }

  return {
    reportDate,
    configuredPlatforms,
    queriedPlatforms,
    totalCommission,
    breakdown,
    errors,
    attribution,
  }
}
