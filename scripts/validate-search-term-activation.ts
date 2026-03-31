#!/usr/bin/env tsx

import { getDatabase } from '../src/lib/db'
import { getSearchTermFeedbackHints } from '../src/lib/search-term-feedback-hints'
import { normalizeGoogleAdsKeyword } from '../src/lib/google-ads-keyword-normalizer'

interface Args {
  offerId: number
  userId: number
  creativeId?: number
  minOverlap: number
  maxAgeMinutes: number
}

interface CreativeKeywordRow {
  keyword: string
  source?: string
  sourceType?: string
  sourceSubtype?: string
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  tsx scripts/validate-search-term-activation.ts --offer-id <id> --user-id <id> [options]',
      '',
      'Options:',
      '  --creative-id <id>       指定创意ID；不传则自动取该 offer 最新创意',
      '  --min-overlap <n>        最低命中词数（默认: 1）',
      '  --max-age-minutes <n>    最新创意允许最大分钟数（默认: 120）',
      '  --help, -h               显示帮助',
      '',
      'Example:',
      '  DATABASE_URL=postgresql://... tsx scripts/validate-search-term-activation.ts --offer-id 3166 --user-id 62',
    ].join('\n')
  )
}

function parseIntArg(raw: string | undefined, name: string): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`invalid ${name}: ${raw}`)
  }
  return value
}

function parseArgs(argv: string[]): Args {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  const getArg = (name: string): string | undefined => {
    const idx = argv.indexOf(name)
    if (idx === -1) return undefined
    return argv[idx + 1]
  }

  const offerId = parseIntArg(getArg('--offer-id'), '--offer-id')
  const userId = parseIntArg(getArg('--user-id'), '--user-id')
  const creativeIdRaw = getArg('--creative-id')
  const minOverlapRaw = getArg('--min-overlap')
  const maxAgeRaw = getArg('--max-age-minutes')

  return {
    offerId,
    userId,
    creativeId: creativeIdRaw ? parseIntArg(creativeIdRaw, '--creative-id') : undefined,
    minOverlap: minOverlapRaw ? parseIntArg(minOverlapRaw, '--min-overlap') : 1,
    maxAgeMinutes: maxAgeRaw ? parseIntArg(maxAgeRaw, '--max-age-minutes') : 120,
  }
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean)
  if (typeof raw !== 'string') return []
  const text = raw.trim()
  if (!text) return []

  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x || '').trim()).filter(Boolean)
    }
  } catch {
    // ignore
  }

  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseKeywordsWithVolume(raw: unknown): CreativeKeywordRow[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((row) => ({
        keyword: String((row as any)?.keyword || '').trim(),
        source: typeof (row as any)?.source === 'string' ? (row as any).source : undefined,
        sourceType: typeof (row as any)?.sourceType === 'string' ? (row as any).sourceType : undefined,
        sourceSubtype: typeof (row as any)?.sourceSubtype === 'string' ? (row as any).sourceSubtype : undefined,
      }))
      .filter((row) => row.keyword.length > 0)
  } catch {
    return []
  }
}

function normalizeSet(items: string[]): Set<string> {
  return new Set(
    items
      .map((item) => normalizeGoogleAdsKeyword(item) || String(item || '').trim().toLowerCase())
      .filter(Boolean)
  )
}

function intersects(a: Set<string>, b: Set<string>): string[] {
  const result: string[] = []
  for (const item of a) {
    if (b.has(item)) result.push(item)
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const db = await getDatabase()
  const isDeletedFalse = db.type === 'postgres' ? 'COALESCE(is_deleted, FALSE) = FALSE' : 'COALESCE(is_deleted, 0) = 0'

  try {
    const hints = await getSearchTermFeedbackHints({
      offerId: args.offerId,
      userId: args.userId,
    })

    const creative = args.creativeId
      ? await db.queryOne<{
          id: number
          created_at: string
          keywords: string
          keywords_with_volume: string
          keyword_bucket?: string
        }>(
          `SELECT id, created_at, keywords, keywords_with_volume, keyword_bucket
           FROM ad_creatives
           WHERE id = ? AND offer_id = ? AND user_id = ? AND ${isDeletedFalse}
           LIMIT 1`,
          [args.creativeId, args.offerId, args.userId]
        )
      : await db.queryOne<{
          id: number
          created_at: string
          keywords: string
          keywords_with_volume: string
          keyword_bucket?: string
        }>(
          `SELECT id, created_at, keywords, keywords_with_volume, keyword_bucket
           FROM ad_creatives
           WHERE offer_id = ? AND user_id = ? AND ${isDeletedFalse}
           ORDER BY created_at DESC
           LIMIT 1`,
          [args.offerId, args.userId]
        )

    if (!creative) {
      console.error('❌ 未找到可验证创意')
      process.exit(2)
    }

    const kwsFromVolume = parseKeywordsWithVolume(creative.keywords_with_volume)
    const kwsFromText = parseStringArray(creative.keywords)
    const creativeKeywords = Array.from(new Set([
      ...kwsFromVolume.map((row) => row.keyword),
      ...kwsFromText,
    ]))

    const highTerms = hints.highPerformingTerms || []
    const highSet = normalizeSet(highTerms)
    const creativeSet = normalizeSet(creativeKeywords)
    const overlapNormalized = intersects(highSet, creativeSet)

    const markerRows = kwsFromVolume.filter((row) => {
      const sourceAll = `${row.source || ''} ${row.sourceType || ''} ${row.sourceSubtype || ''}`.toUpperCase()
      return sourceAll.includes('SEARCH_TERM')
    })

    const createdAtMs = Date.parse(String(creative.created_at || ''))
    const ageMinutes = Number.isFinite(createdAtMs)
      ? Math.max(0, Math.round((Date.now() - createdAtMs) / 60000))
      : null

    const passOverlap = overlapNormalized.length >= args.minOverlap
    const pass = passOverlap

    console.log('='.repeat(68))
    console.log('Search Term Activation Validation')
    console.log('='.repeat(68))
    console.log(`offer_id: ${args.offerId}`)
    console.log(`user_id: ${args.userId}`)
    console.log(`creative_id: ${creative.id}`)
    console.log(`creative_bucket: ${creative.keyword_bucket || 'N/A'}`)
    console.log(`creative_created_at: ${creative.created_at}`)
    if (ageMinutes !== null) {
      console.log(`creative_age_minutes: ${ageMinutes}`)
      if (ageMinutes > args.maxAgeMinutes) {
        console.log(`⚠️ 创意已超过 ${args.maxAgeMinutes} 分钟，建议使用最新创意复验`)
      }
    }
    console.log('-'.repeat(68))
    console.log(`high_performing_terms: ${highTerms.length}`)
    console.log(`creative_keywords: ${creativeKeywords.length}`)
    console.log(`overlap_terms: ${overlapNormalized.length}`)
    console.log(`search_term_source_markers_in_creative: ${markerRows.length}`)
    console.log('-'.repeat(68))
    if (highTerms.length > 0) {
      console.log(`high_terms_sample: ${highTerms.slice(0, 10).join(', ')}`)
    }
    if (overlapNormalized.length > 0) {
      console.log(`overlap_normalized_sample: ${overlapNormalized.slice(0, 10).join(', ')}`)
    }
    if (markerRows.length > 0) {
      console.log(
        `marker_keyword_sample: ${markerRows.slice(0, 10).map((row) => row.keyword).join(', ')}`
      )
    }

    if (pass) {
      console.log('✅ PASS: 新创意已命中高性能 search_term 词池')
      process.exit(0)
    }

    console.log('❌ FAIL: 新创意未达到 search_term 命中门槛')
    process.exit(2)
  } finally {
    await db.close()
  }
}

main().catch((error) => {
  console.error('❌ 验收脚本执行失败:', error)
  process.exit(1)
})

