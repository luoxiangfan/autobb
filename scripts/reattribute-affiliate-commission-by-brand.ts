#!/usr/bin/env tsx
import 'dotenv/config'

import { getDatabase, type DatabaseAdapter } from '../src/lib/db'
import {
  type AffiliateCommissionRawEntry,
  type AffiliatePlatform,
  persistAffiliateCommissionAttributions,
} from '../src/lib/openclaw/affiliate-commission-attribution'

type CliArgs = {
  userId: number
  brand: string
  startDate: string
  endDate: string
  apply: boolean
}

type RawEventRow = {
  source: 'attribution' | 'failure'
  report_date: string
  platform: string
  source_order_id: string | null
  source_mid: string | null
  source_asin: string | null
  source_link_id?: string | null
  commission_amount: number
  currency: string | null
  offer_brand: string | null
  raw_payload: unknown
}

type ReattributionEvent = {
  eventId: string
  reportDate: string
  normalizedBrand: string | null
  commission: number
  entry: AffiliateCommissionRawEntry
}

function parseYmd(value: string): string {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`日期格式错误: ${value}（应为 YYYY-MM-DD）`)
  }
  return raw
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function normalizeBrand(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  return text.toLowerCase()
}

function normalizeAsin(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!normalized) return null
  return normalized.length > 10 ? normalized.slice(0, 10) : normalized
}

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      args[key.slice(2)] = 'true'
      continue
    }
    args[key.slice(2)] = value
    i += 1
  }

  const userId = Number(args['user-id'] || '1')
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error(`user-id 非法: ${args['user-id']}`)
  }

  const brand = normalizeText(args['brand'])
  if (!brand) {
    throw new Error('必须提供 --brand')
  }

  const startDate = parseYmd(args['start-date'] || '')
  const endDate = parseYmd(args['end-date'] || '')
  if (startDate > endDate) {
    throw new Error(`start-date(${startDate}) 不能晚于 end-date(${endDate})`)
  }

  return {
    userId: Math.floor(userId),
    brand,
    startDate,
    endDate,
    apply: args['apply'] === 'true',
  }
}

function getObjectFieldByAliases(input: unknown, aliases: string[]): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
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

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function extractEventId(rawPayload: unknown, row: RawEventRow): string | null {
  const raw = toObject(rawPayload)
  const payloadId = normalizeText(getObjectFieldByAliases(raw, ['_autoads_event_id', 'id', 'event_id', 'eventId']))
  if (payloadId) {
    return payloadId.includes('|') ? payloadId : `${row.platform}|${payloadId}`
  }

  const fallback = [
    row.platform,
    row.report_date,
    normalizeText(row.source_order_id) || '-',
    normalizeText(row.source_mid) || '-',
    normalizeAsin(row.source_asin) || '-',
    roundTo(Number(row.commission_amount) || 0).toFixed(4),
  ].join('|')
  return fallback
}


function parseRawCommission(rawPayload: unknown): number | null {
  const raw = toObject(rawPayload)
  const candidates = [
    getObjectFieldByAliases(raw, ['sale_comm', 'saleComm', 'commission', 'commission_amount', 'commissionAmount', 'estCommission', 'est_commission', 'earning', 'earnings']),
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return roundTo(value)
  }
  return null
}

function extractBrand(rawPayload: unknown, row: RawEventRow): string | null {
  const raw = toObject(rawPayload)
  return normalizeBrand(
    getObjectFieldByAliases(raw, [
      '_autoads_attribution_brand',
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
      ?? row.offer_brand
  )
}

function ensurePlatform(value: string): AffiliatePlatform {
  if (value === 'partnerboost' || value === 'yeahpromos') return value
  throw new Error(`未知平台: ${value}`)
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

function getStoredEventIdSql(dbType: DatabaseAdapter['type'], rawColumn = 'raw_payload'): string {
  if (dbType === 'postgres') {
    return `COALESCE(NULLIF(TRIM(${rawColumn}->>'_autoads_event_id'), ''), NULLIF(TRIM(${rawColumn}->>'id'), ''))`
  }
  return `COALESCE(NULLIF(TRIM(json_extract(${rawColumn}, '$._autoads_event_id')), ''), NULLIF(TRIM(json_extract(${rawColumn}, '$.id')), ''))`
}

async function loadRawRows(db: DatabaseAdapter, params: {
  userId: number
  startDate: string
  endDate: string
}): Promise<RawEventRow[]> {
  const attributedRows = await db.query<RawEventRow>(
    `
      SELECT
        'attribution' AS source,
        CAST(aca.report_date AS TEXT) AS report_date,
        aca.platform,
        aca.source_order_id,
        aca.source_mid,
        aca.source_asin,
        NULL AS source_link_id,
        aca.commission_amount,
        aca.currency,
        o.brand AS offer_brand,
        aca.raw_payload
      FROM affiliate_commission_attributions aca
      LEFT JOIN offers o ON o.id = aca.offer_id
      WHERE aca.user_id = ?
        AND aca.report_date >= ?
        AND aca.report_date <= ?
    `,
    [params.userId, params.startDate, params.endDate]
  )

  let failureRows: RawEventRow[] = []
  try {
    failureRows = await db.query<RawEventRow>(
      `
        SELECT
          'failure' AS source,
          CAST(f.report_date AS TEXT) AS report_date,
          f.platform,
          f.source_order_id,
          f.source_mid,
          f.source_asin,
          f.source_link_id,
          f.commission_amount,
          f.currency,
          o.brand AS offer_brand,
          f.raw_payload
        FROM openclaw_affiliate_attribution_failures f
        LEFT JOIN offers o ON o.id = f.offer_id
        WHERE f.user_id = ?
          AND f.report_date >= ?
          AND f.report_date <= ?
      `,
      [params.userId, params.startDate, params.endDate]
    )
  } catch (error: any) {
    const message = String(error?.message || '')
    if (!/openclaw_affiliate_attribution_failures/i.test(message) || !/(no such table|does not exist)/i.test(message)) {
      throw error
    }
  }

  return [...attributedRows, ...failureRows]
}

function groupEvents(rows: RawEventRow[], normalizedTargetBrand: string): ReattributionEvent[] {
  const grouped = new Map<string, ReattributionEvent>()

  for (const row of rows) {
    const eventId = extractEventId(row.raw_payload, row)
    if (!eventId) continue

    const normalizedBrand = extractBrand(row.raw_payload, row)
    if (normalizedBrand !== normalizedTargetBrand) continue

    const rawCommission = parseRawCommission(row.raw_payload)
    const resolvedCommission = rawCommission ?? roundTo(Number(row.commission_amount) || 0)

    const existing = grouped.get(eventId)
    if (existing) {
      existing.commission = rawCommission
        ? Math.max(existing.commission, resolvedCommission)
        : roundTo(existing.commission + resolvedCommission)
      existing.entry.commission = existing.commission
      continue
    }

    grouped.set(eventId, {
      eventId,
      reportDate: row.report_date,
      normalizedBrand,
      commission: resolvedCommission,
      entry: {
        platform: ensurePlatform(row.platform),
        reportDate: row.report_date,
        commission: resolvedCommission,
        currency: normalizeText(row.currency) || 'USD',
        sourceOrderId: normalizeText(row.source_order_id),
        sourceMid: normalizeText(row.source_mid),
        sourceAsin: normalizeAsin(row.source_asin),
        sourceLinkId: normalizeText(row.source_link_id),
        raw: toObject(row.raw_payload) || row.raw_payload,
      },
    })
  }

  return Array.from(grouped.values()).map((event) => ({
    ...event,
    entry: {
      ...event.entry,
      commission: event.commission,
    },
  }))
}

async function deleteEvents(db: DatabaseAdapter, params: {
  userId: number
  eventIds: string[]
}): Promise<void> {
  if (params.eventIds.length === 0) return
  const eventIdExpr = getStoredEventIdSql(db.type)
  const queryEventIds = expandEventIds(params.eventIds)

  for (let i = 0; i < queryEventIds.length; i += 100) {
    const chunk = queryEventIds.slice(i, i + 100)
    const placeholders = chunk.map(() => '?').join(', ')

    await db.exec(
      `
        DELETE FROM affiliate_commission_attributions
        WHERE user_id = ?
          AND ${eventIdExpr} IN (${placeholders})
      `,
      [params.userId, ...chunk]
    )

    try {
      await db.exec(
        `
          DELETE FROM openclaw_affiliate_attribution_failures
          WHERE user_id = ?
            AND ${eventIdExpr} IN (${placeholders})
        `,
        [params.userId, ...chunk]
      )
    } catch (error: any) {
      const message = String(error?.message || '')
      if (!/openclaw_affiliate_attribution_failures/i.test(message) || !/(no such table|does not exist)/i.test(message)) {
        throw error
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = await getDatabase()
  const normalizedTargetBrand = normalizeBrand(args.brand)
  if (!normalizedTargetBrand) {
    throw new Error(`品牌非法: ${args.brand}`)
  }

  const rows = await loadRawRows(db, {
    userId: args.userId,
    startDate: args.startDate,
    endDate: args.endDate,
  })
  const events = groupEvents(rows, normalizedTargetBrand)

  const eventsByDate = new Map<string, ReattributionEvent[]>()
  for (const event of events) {
    const list = eventsByDate.get(event.reportDate) || []
    list.push(event)
    eventsByDate.set(event.reportDate, list)
  }

  console.log('═'.repeat(72))
  console.log('🧭 联盟佣金按品牌重归因')
  console.log('═'.repeat(72))
  console.log(`用户ID: ${args.userId}`)
  console.log(`品牌: ${args.brand}`)
  console.log(`日期范围: ${args.startDate} ~ ${args.endDate}`)
  console.log(`模式: ${args.apply ? 'APPLY' : 'DRY RUN'}`)
  console.log(`命中事件数: ${events.length}`)
  console.log(`命中日期数: ${eventsByDate.size}`)

  if (events.length === 0) {
    console.log('未找到可重归因事件，退出。')
    return
  }

  for (const [reportDate, list] of Array.from(eventsByDate.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const total = roundTo(list.reduce((sum, item) => sum + item.commission, 0))
    console.log(`  - ${reportDate}: ${list.length} events / ${total.toFixed(4)} commission`)
  }

  if (!args.apply) {
    console.log('\nDry-run 完成；如需写库，请追加 `--apply true`。')
    return
  }

  await deleteEvents(db, {
    userId: args.userId,
    eventIds: events.map((event) => event.eventId),
  })

  for (const [reportDate, list] of Array.from(eventsByDate.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const result = await persistAffiliateCommissionAttributions({
      userId: args.userId,
      reportDate,
      entries: list.map((item) => item.entry),
      replaceExisting: true,
      lockHistorical: false,
    })

    console.log(
      `✅ ${reportDate}: total=${result.totalCommission.toFixed(4)}, attributed=${result.attributedCommission.toFixed(4)}, unattributed=${result.unattributedCommission.toFixed(4)}, writtenRows=${result.writtenRows}`
    )
  }

  console.log('\n已按新规则完成重归因。')
}

main().catch((error) => {
  console.error('❌ 执行失败:', error?.message || error)
  process.exit(1)
})
