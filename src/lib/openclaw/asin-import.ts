import crypto from 'crypto'
import Papa from 'papaparse'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { decodeCsvTextSmart, normalizeCsvHeaderCell } from '@/lib/offers/batch-offer-csv'
import { toDbJsonObjectField } from '@/lib/json-field'

type ParsedAsinItem = {
  asin: string | null
  country_code?: string | null
  price?: string | null
  brand?: string | null
  title?: string | null
  affiliate_link?: string | null
  product_url?: string | null
  priority?: number | null
  source?: string | null
  data_json?: unknown
}

const HEADER_ALIASES: Record<string, string[]> = {
  asin: ['asin', 'asin_code', 'product_asin'],
  country_code: ['country', 'country_code', 'marketplace', 'region', 'countrycode'],
  price: ['price', 'product_price', 'original_price', 'discount_price'],
  brand: ['brand', 'brand_name', 'brandname'],
  title: ['title', 'product_name', 'name', 'product'],
  affiliate_link: ['affiliate_link', 'link', 'tracking_url', 'affiliate', 'trackinglink'],
  product_url: ['product_url', 'url', 'productlink', 'product_link'],
  priority: ['priority', 'priority_score', 'rank', 'score'],
}

function canonicalizeHeader(raw: string): string {
  const normalized = normalizeCsvHeaderCell(raw).toLowerCase()
  const cleaned = normalized.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned
}

function resolveFieldMap(headers: string[]): Record<string, number> {
  const headerMap: Record<string, number> = {}
  const normalized = headers.map(canonicalizeHeader)
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((h) => h === field || aliases.includes(h))
    if (index >= 0) {
      headerMap[field] = index
    }
  }
  return headerMap
}

function normalizeAsin(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return raw.toUpperCase()
}

function parsePriority(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function parseRows(rows: string[][], defaultCountry?: string | null): ParsedAsinItem[] {
  if (rows.length === 0) return []
  const headers = rows[0]
  const map = resolveFieldMap(headers)

  const items: ParsedAsinItem[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const rawAsin = map.asin !== undefined ? row[map.asin] : row[0]
    const asin = normalizeAsin(rawAsin)
    if (!asin) continue

    const item: ParsedAsinItem = {
      asin,
      country_code: (map.country_code !== undefined ? row[map.country_code] : defaultCountry) || defaultCountry || null,
      price: map.price !== undefined ? row[map.price] : null,
      brand: map.brand !== undefined ? row[map.brand] : null,
      title: map.title !== undefined ? row[map.title] : null,
      affiliate_link: map.affiliate_link !== undefined ? row[map.affiliate_link] : null,
      product_url: map.product_url !== undefined ? row[map.product_url] : null,
      priority: map.priority !== undefined ? parsePriority(row[map.priority]) : null,
      data_json: { row },
    }
    items.push(item)
  }

  return items
}

function parseCsvText(text: string, defaultCountry?: string | null): ParsedAsinItem[] {
  const parseResult = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  })
  const rows = parseResult.data as string[][]
  if (rows.length === 0) return []
  return parseRows(rows, defaultCountry)
}

function parseJsonText(text: string, defaultCountry?: string | null): ParsedAsinItem[] {
  const parsed = JSON.parse(text)
  const list: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : []

  const items: ParsedAsinItem[] = []
  for (const row of list) {
    const asin = normalizeAsin(row?.asin ?? row?.ASIN ?? row?.asin_code)
    if (!asin) continue
    items.push({
      asin,
      country_code: row?.country_code || row?.country || defaultCountry || null,
      price: row?.price ?? row?.product_price ?? null,
      brand: row?.brand ?? row?.brand_name ?? null,
      title: row?.title ?? row?.product_name ?? null,
      affiliate_link: row?.affiliate_link ?? row?.link ?? row?.tracking_url ?? null,
      product_url: row?.product_url ?? row?.url ?? null,
      priority: parsePriority(row?.priority ?? row?.priority_score),
      data_json: row,
    })
  }
  return items
}

async function parseXlsx(buffer: Buffer, defaultCountry?: string | null): Promise<ParsedAsinItem[]> {
  const { default: XLSX } = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][]
  return parseRows(rows, defaultCountry)
}

function computeChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function sanitizeString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

export async function importAsinFile(params: {
  userId: number
  source: string
  filename?: string | null
  fileType?: string | null
  fileSize?: number | null
  buffer: Buffer
  defaultCountry?: string | null
  metadata?: Record<string, any>
}): Promise<{ inputId: number; total: number; inserted: number }> {
  const db = await getDatabase()
  const checksum = computeChecksum(params.buffer)
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const insertSql = db.type === 'postgres'
    ? `INSERT INTO openclaw_asin_inputs
       (user_id, source, filename, file_type, file_size, checksum, status, total_items, parsed_items, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ${nowFunc}, ${nowFunc}) RETURNING id`
    : `INSERT INTO openclaw_asin_inputs
       (user_id, source, filename, file_type, file_size, checksum, status, total_items, parsed_items, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ${nowFunc}, ${nowFunc})`

  const result = await db.exec(insertSql, [
    params.userId,
    params.source,
    params.filename || null,
    params.fileType || null,
    params.fileSize ?? null,
    checksum,
    toDbJsonObjectField(params.metadata ?? null, db.type, null),
  ])

  const inputId = getInsertedId(result, db.type)

  let items: ParsedAsinItem[] = []
  const lowerName = (params.filename || '').toLowerCase()

  try {
    if (lowerName.endsWith('.json') || params.fileType?.includes('application/json')) {
      items = parseJsonText(params.buffer.toString('utf-8'), params.defaultCountry)
    } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      items = await parseXlsx(params.buffer, params.defaultCountry)
    } else {
      const text = decodeCsvTextSmart(new Uint8Array(params.buffer))
      items = parseCsvText(text, params.defaultCountry)
    }
  } catch (error: any) {
    await db.exec(
      `UPDATE openclaw_asin_inputs
       SET status = 'failed', error_message = ?, updated_at = ${nowFunc}
       WHERE id = ?`,
      [error?.message || '解析失败', inputId]
    )
    throw error
  }

  const deduped = new Map<string, ParsedAsinItem>()
  for (const item of items) {
    const key = `${item.asin || ''}:${item.country_code || ''}:${item.affiliate_link || ''}`
    if (!deduped.has(key)) {
      deduped.set(key, item)
    }
  }

  let inserted = 0
  for (const item of deduped.values()) {
    await db.exec(
      `INSERT INTO openclaw_asin_items
       (input_id, user_id, asin, country_code, price, brand, title, affiliate_link, product_url, priority, source, status, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ${nowFunc}, ${nowFunc})`,
      [
        inputId,
        params.userId,
        item.asin,
        sanitizeString(item.country_code),
        sanitizeString(item.price),
        sanitizeString(item.brand),
        sanitizeString(item.title),
        sanitizeString(item.affiliate_link),
        sanitizeString(item.product_url),
        item.priority ?? 0,
        params.source,
        toDbJsonObjectField(item.data_json ?? null, db.type, null),
      ]
    )
    inserted += 1
  }

  await db.exec(
    `UPDATE openclaw_asin_inputs
     SET status = 'parsed', total_items = ?, parsed_items = ?, updated_at = ${nowFunc}
     WHERE id = ?`,
    [items.length, inserted, inputId]
  )

  return { inputId, total: items.length, inserted }
}
