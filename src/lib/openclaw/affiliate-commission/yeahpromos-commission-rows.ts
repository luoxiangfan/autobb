const YEAHPROMOS_COMMISSION_ALIASES = [
  'sale_comm',
  'saleComm',
  'commission',
  'commission_amount',
  'commissionAmount',
  'estCommission',
  'est_commission',
  'earnings',
  'earning',
]

const YEAHPROMOS_ADVERT_ID_ALIASES = [
  'advert_id',
  'advertId',
  'mid',
]

const YEAHPROMOS_ADVERT_NAME_ALIASES = [
  'advert_name',
  'advertName',
]

const YEAHPROMOS_ASIN_ALIASES = [
  'asin',
  'ASIN',
  'sku',
  'SKU',
]

const YEAHPROMOS_LINK_ALIASES = [
  'link',
  'url',
  'product_link',
  'productLink',
]

export type YeahPromosReportCommissionRow = {
  commission: number
  advertId: string | null
  brandName: string | null
  asin: string | null
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

export function getYeahPromosFieldValue(row: any, aliases: string[]): unknown {
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

export function normalizeYeahPromosCode(payload: any): number | null {
  const codeRaw = payload?.Code ?? payload?.code
  if (codeRaw === null || codeRaw === undefined || codeRaw === '') return null
  const code = Number(codeRaw)
  return Number.isFinite(code) ? code : null
}

export function normalizeYeahPromosPayloadRows(payload: any): { rows: any[]; pageTotal: number | null } {
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
    pageTotal: Number.isFinite(pageTotal) && pageTotal > 0 ? Math.floor(pageTotal) : null }
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

/** Match affiliate-revenue sync parsing for YeahPromos getorder rows. */
export function parseYeahPromosCommissionValue(row: any): number {
  const direct = parseNumberish(getYeahPromosFieldValue(row, YEAHPROMOS_COMMISSION_ALIASES), 0)
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
    if (normalizedKey.includes('salecomm')) {
      score = 4
    } else if (normalizedKey.includes('est') && normalizedKey.includes('commission')) {
      score = 3
    } else if (normalizedKey.includes('commission')) {
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

export function collectYeahPromosReportRows(payload: unknown): YeahPromosReportCommissionRow[] {
  const { rows } = normalizeYeahPromosPayloadRows(payload)
  const results: YeahPromosReportCommissionRow[] = []

  for (const row of rows) {
    const commission = parseYeahPromosCommissionValue(row)
    if (commission <= 0) continue

    const advertId = pickString(getYeahPromosFieldValue(row, YEAHPROMOS_ADVERT_ID_ALIASES))
    const brandName = pickString(getYeahPromosFieldValue(row, YEAHPROMOS_ADVERT_NAME_ALIASES))
    const asin = pickAsin(
      getYeahPromosFieldValue(row, YEAHPROMOS_ASIN_ALIASES),
      getYeahPromosFieldValue(row, YEAHPROMOS_LINK_ALIASES),
    )

    results.push({
      commission,
      advertId,
      brandName,
      asin })
  }

  return results
}
