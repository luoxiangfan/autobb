#!/usr/bin/env tsx
/**
 * 回填 PostgreSQL 中被误写为 jsonb string 的字段。
 *
 * 默认 dry-run（仅扫描并输出统计）；仅当传入 --apply 才会实际更新。
 *
 * 用法:
 *   tsx scripts/backfill-jsonb-double-encoded.ts
 *   tsx scripts/backfill-jsonb-double-encoded.ts --apply
 *   tsx scripts/backfill-jsonb-double-encoded.ts --offer-id=3694
 *   tsx scripts/backfill-jsonb-double-encoded.ts --apply --table=offers,creative_tasks
 */

import { closeDatabase, getDatabase, type DatabaseAdapter } from '@/lib/db'

type ExpectedKind = 'array' | 'object' | 'array_or_object'

type BackfillColumnSpec = {
  table: string
  pkColumn: string
  offerIdColumn?: string
  column: string
  expected: ExpectedKind
}

type RowCandidate = {
  row_id: string | number
  offer_id: number | null
  raw_value: unknown
}

type BackfillOptions = {
  dryRun: boolean
  offerId?: number
  limitPerColumn: number
  selectedTables: Set<string>
  selectedColumns: Set<string>
}

type ColumnStats = {
  table: string
  column: string
  scanned: number
  parseable: number
  shapeMatched: number
  invalidJson: number
  unexpectedShape: number
  updated: number
  sampleRowIds: Array<string | number>
}

const UPDATE_CHUNK_SIZE = 500

const COLUMN_SPECS: BackfillColumnSpec[] = [
  { table: 'account_sharing_alerts', pkColumn: 'id', column: 'metadata', expected: 'array_or_object' },

  { table: 'ad_creatives', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'negative_keywords_match_type', expected: 'object' },

  { table: 'affiliate_commission_attributions', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'raw_payload', expected: 'array_or_object' },

  { table: 'audit_logs', pkColumn: 'id', column: 'details', expected: 'object' },

  { table: 'batch_tasks', pkColumn: 'id', column: 'metadata', expected: 'object' },

  { table: 'click_farm_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'hourly_distribution', expected: 'array' },
  { table: 'click_farm_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'daily_history', expected: 'array' },

  { table: 'creative_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'optimization_history', expected: 'array_or_object' },
  { table: 'creative_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'result', expected: 'object' },
  { table: 'creative_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'error', expected: 'object' },

  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'brand_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'bucket_a_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'bucket_b_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'bucket_c_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'bucket_d_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'store_bucket_a_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'store_bucket_b_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'store_bucket_c_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'store_bucket_d_keywords', expected: 'array' },
  { table: 'offer_keyword_pools', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'store_bucket_s_keywords', expected: 'array' },

  { table: 'offer_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'result', expected: 'object' },
  { table: 'offer_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'error', expected: 'object' },

  { table: 'offers', pkColumn: 'id', offerIdColumn: 'id', column: 'ai_reviews', expected: 'array_or_object' },
  { table: 'offers', pkColumn: 'id', offerIdColumn: 'id', column: 'ai_competitive_edges', expected: 'array_or_object' },
  { table: 'offers', pkColumn: 'id', offerIdColumn: 'id', column: 'ai_keywords', expected: 'array' },
  { table: 'offers', pkColumn: 'id', offerIdColumn: 'id', column: 'ai_analysis_v32', expected: 'object' },

  { table: 'openclaw_affiliate_products', pkColumn: 'id', column: 'raw_data', expected: 'array_or_object' },
  { table: 'openclaw_asin_inputs', pkColumn: 'id', column: 'metadata_json', expected: 'object' },
  { table: 'openclaw_asin_items', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'data_json', expected: 'object' },
  { table: 'openclaw_experiment_results', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'variant_a', expected: 'array_or_object' },
  { table: 'openclaw_experiment_results', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'variant_b', expected: 'array_or_object' },
  { table: 'openclaw_experiment_results', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'metrics_a', expected: 'object' },
  { table: 'openclaw_experiment_results', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'metrics_b', expected: 'object' },
  { table: 'openclaw_knowledge_base', pkColumn: 'id', column: 'summary_json', expected: 'object' },
  { table: 'openclaw_offer_scores', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'raw_data', expected: 'array_or_object' },
  { table: 'openclaw_strategy_actions', pkColumn: 'id', column: 'request_json', expected: 'object' },
  { table: 'openclaw_strategy_actions', pkColumn: 'id', column: 'response_json', expected: 'array_or_object' },
  { table: 'openclaw_strategy_runs', pkColumn: 'id', column: 'config_json', expected: 'object' },
  { table: 'openclaw_strategy_runs', pkColumn: 'id', column: 'stats_json', expected: 'object' },
  { table: 'openclaw_tokens', pkColumn: 'id', column: 'scopes', expected: 'array' },

  { table: 'upload_records', pkColumn: 'id', column: 'metadata', expected: 'object' },

  { table: 'url_swap_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'swap_history', expected: 'array' },
  { table: 'url_swap_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'manual_final_url_suffixes', expected: 'array' },
  { table: 'url_swap_tasks', pkColumn: 'id', offerIdColumn: 'offer_id', column: 'manual_affiliate_links', expected: 'array' },
]

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : undefined
}

function parseArgs(argv: string[]): BackfillOptions {
  const options: BackfillOptions = {
    dryRun: true,
    limitPerColumn: 10000,
    selectedTables: new Set<string>(),
    selectedColumns: new Set<string>(),
  }

  for (const arg of argv) {
    if (arg === '--apply') {
      options.dryRun = false
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg.startsWith('--offer-id=')) {
      options.offerId = parsePositiveInt(arg.split('=')[1])
      continue
    }
    if (arg.startsWith('--limit-per-column=')) {
      const parsed = parsePositiveInt(arg.split('=')[1])
      if (parsed) options.limitPerColumn = parsed
      continue
    }
    if (arg.startsWith('--table=')) {
      const tableValues = String(arg.split('=')[1] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      for (const table of tableValues) options.selectedTables.add(table)
      continue
    }
    if (arg.startsWith('--column=')) {
      const columnValues = String(arg.split('=')[1] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      for (const column of columnValues) options.selectedColumns.add(column)
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage:
  tsx scripts/backfill-jsonb-double-encoded.ts [--dry-run] [--apply] [--offer-id=N] [--table=t1,t2] [--column=c1,t2.c2] [--limit-per-column=N]

Options:
  --dry-run                 Preview only (default)
  --apply                   Execute updates
  --offer-id=N              Restrict to one offer chain (offers/offer_tasks/creative_tasks/offer_keyword_pools)
  --table=t1,t2             Restrict to specific tables (comma-separated)
  --column=c1,t2.c2         Restrict to columns (column name or table.column)
  --limit-per-column=N      Max rows scanned per column (default: 10000)
      `.trim())
      process.exit(0)
    }
  }

  return options
}

function detectKind(value: unknown): 'array' | 'object' | 'primitive' | 'null' {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return 'primitive'
}

function kindMatchesExpected(value: unknown, expected: ExpectedKind): boolean {
  const kind = detectKind(value)
  if (expected === 'array') return kind === 'array'
  if (expected === 'object') return kind === 'object'
  return kind === 'array' || kind === 'object'
}

function parseDoubleEncodedJson(rawValue: unknown): { ok: true; parsed: unknown } | { ok: false } {
  if (typeof rawValue !== 'string') return { ok: false }
  const trimmed = rawValue.trim()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return { ok: false }

  try {
    let parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'string') {
      const nested = parsed.trim()
      if (nested) {
        try {
          parsed = JSON.parse(nested)
        } catch {
          // 第一次 parse 后是普通字符串，不再强制解析
        }
      }
    }
    return { ok: true, parsed }
  } catch {
    return { ok: false }
  }
}

function sanitizeJsonString(value: string): string {
  // PostgreSQL JSON parser rejects lone surrogate code points.
  return value
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeJsonString(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item))

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const normalized: Record<string, unknown> = {}
    for (const [key, item] of entries) {
      normalized[key] = sanitizeJsonValue(item)
    }
    return normalized
  }

  return value
}

function buildSelectSql(spec: BackfillColumnSpec, options: BackfillOptions): { sql: string; params: any[] } {
  const whereClauses = [
    `${spec.column} IS NOT NULL`,
    `jsonb_typeof(${spec.column}) = 'string'`,
  ]
  const params: any[] = []

  if (options.offerId && spec.offerIdColumn) {
    whereClauses.push(`${spec.offerIdColumn} = ?`)
    params.push(options.offerId)
  }

  params.push(options.limitPerColumn)

  const sql = `
    SELECT
      ${spec.pkColumn} AS row_id,
      ${spec.offerIdColumn ? spec.offerIdColumn : 'NULL'} AS offer_id,
      ${spec.column} AS raw_value
    FROM ${spec.table}
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ${spec.pkColumn} ASC
    LIMIT ?
  `

  return { sql, params }
}

async function processOneColumn(
  db: DatabaseAdapter,
  spec: BackfillColumnSpec,
  options: BackfillOptions
): Promise<ColumnStats> {
  const { sql, params } = buildSelectSql(spec, options)
  const rows = await db.query<RowCandidate>(sql, params)

  const stats: ColumnStats = {
    table: spec.table,
    column: spec.column,
    scanned: rows.length,
    parseable: 0,
    shapeMatched: 0,
    invalidJson: 0,
    unexpectedShape: 0,
    updated: 0,
    sampleRowIds: [],
  }

  const updates: Array<{ rowId: string | number; parsed: unknown }> = []

  for (const row of rows) {
    const parsed = parseDoubleEncodedJson(row.raw_value)
    if (!parsed.ok) {
      stats.invalidJson += 1
      continue
    }

    stats.parseable += 1
    if (!kindMatchesExpected(parsed.parsed, spec.expected)) {
      stats.unexpectedShape += 1
      continue
    }

    stats.shapeMatched += 1
    if (stats.sampleRowIds.length < 10) {
      stats.sampleRowIds.push(row.row_id)
    }
    updates.push({
      rowId: row.row_id,
      parsed: sanitizeJsonValue(parsed.parsed),
    })
  }

  if (options.dryRun || updates.length === 0) {
    stats.updated = options.dryRun ? 0 : stats.updated
    return stats
  }

  await db.transaction(async () => {
    for (let start = 0; start < updates.length; start += UPDATE_CHUNK_SIZE) {
      const chunk = updates.slice(start, start + UPDATE_CHUNK_SIZE)
      const caseClauses = chunk.map(() => 'WHEN ? THEN ?').join(' ')
      const wherePlaceholders = chunk.map(() => '?').join(', ')
      const params: any[] = []

      for (const update of chunk) {
        params.push(update.rowId, update.parsed)
      }
      for (const update of chunk) {
        params.push(update.rowId)
      }

      const result = await db.exec(
        `
        UPDATE ${spec.table}
        SET ${spec.column} = CASE ${spec.pkColumn}
          ${caseClauses}
          ELSE ${spec.column}
        END
        WHERE ${spec.pkColumn} IN (${wherePlaceholders})
          AND jsonb_typeof(${spec.column}) = 'string'
        `,
        params
      )
      stats.updated += result.changes
    }
  })

  return stats
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const db = getDatabase()

  if (db.type !== 'postgres') {
    throw new Error('此脚本仅支持 PostgreSQL（当前数据库不是 PostgreSQL）')
  }

  const specs = COLUMN_SPECS.filter((spec) => {
    const tableMatched = options.selectedTables.size === 0 || options.selectedTables.has(spec.table)
    if (!tableMatched) return false

    if (options.selectedColumns.size === 0) return true

    return (
      options.selectedColumns.has(spec.column) ||
      options.selectedColumns.has(`${spec.table}.${spec.column}`)
    )
  })

  if (specs.length === 0) {
    throw new Error('未匹配到可执行的表，请检查 --table 参数')
  }

  console.log(`[jsonb-backfill] mode=${options.dryRun ? 'DRY_RUN' : 'APPLY'}`)
  console.log(`[jsonb-backfill] targetColumns=${specs.length}, offerId=${options.offerId ?? 'all'}, limitPerColumn=${options.limitPerColumn}`)

  const allStats: ColumnStats[] = []
  for (const spec of specs) {
    const stats = await processOneColumn(db, spec, options)
    allStats.push(stats)
    console.log(
      `[jsonb-backfill] ${spec.table}.${spec.column} scanned=${stats.scanned} parseable=${stats.parseable} shapeMatched=${stats.shapeMatched} invalidJson=${stats.invalidJson} unexpectedShape=${stats.unexpectedShape} updated=${stats.updated}`
    )
    if (stats.sampleRowIds.length > 0) {
      console.log(`[jsonb-backfill] ${spec.table}.${spec.column} sampleRowIds=${stats.sampleRowIds.join(',')}`)
    }
  }

  const summary = allStats.reduce(
    (acc, item) => {
      acc.scanned += item.scanned
      acc.parseable += item.parseable
      acc.shapeMatched += item.shapeMatched
      acc.invalidJson += item.invalidJson
      acc.unexpectedShape += item.unexpectedShape
      acc.updated += item.updated
      return acc
    },
    { scanned: 0, parseable: 0, shapeMatched: 0, invalidJson: 0, unexpectedShape: 0, updated: 0 }
  )

  console.log(
    `[jsonb-backfill] summary scanned=${summary.scanned} parseable=${summary.parseable} shapeMatched=${summary.shapeMatched} invalidJson=${summary.invalidJson} unexpectedShape=${summary.unexpectedShape} updated=${summary.updated}`
  )

  if (options.dryRun) {
    console.log('[jsonb-backfill] dry-run completed, no data changed')
  }
}

main()
  .catch((error) => {
    console.error('[jsonb-backfill] failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    closeDatabase()
  })
