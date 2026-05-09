import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import type {
  AffiliateCommissionRawEntry,
  AffiliatePlatform,
} from '@/lib/openclaw/affiliate-commission-attribution'

export type ReconciliationBreakdownRow = {
  platform: AffiliatePlatform
  totalCommission: number
  currency?: string
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

async function querySumOrZero(params: {
  db: DatabaseAdapter
  sql: string
  bind: Array<number | string>
}): Promise<number> {
  const row = await params.db.queryOne<{ s: number | string | null }>(params.sql, params.bind)
  return round4(Number(row?.s) || 0)
}

/**
 * 日维度对账快照：API 汇总、拉取条目合计、归因表与失败表合计及差值。
 */
export async function persistAffiliateCommissionReconciliation(params: {
  userId: number
  reportDate: string
  breakdown: ReconciliationBreakdownRow[]
  entries: AffiliateCommissionRawEntry[]
  queriedPlatforms: AffiliatePlatform[]
}): Promise<void> {
  const platforms = Array.from(
    new Set(
      (params.queriedPlatforms || []).filter(
        (p): p is AffiliatePlatform => p === 'partnerboost' || p === 'yeahpromos'
      )
    )
  )
  if (platforms.length === 0) return

  const db = await getDatabase()
  const reportDate = String(params.reportDate || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return

  for (const platform of platforms) {
    const apiRow = params.breakdown.find((b) => b.platform === platform)
    const apiTotal = round4(Number(apiRow?.totalCommission) || 0)
    const currency = String(apiRow?.currency || 'USD').trim().toUpperCase() || 'USD'

    const entriesSum = round4(
      params.entries
        .filter((e) => e.platform === platform)
        .reduce((sum, e) => sum + (Number(e.commission) || 0), 0)
    )

    let attributedSum = 0
    let failureSum = 0
    try {
      attributedSum = await querySumOrZero({
        db,
        sql: `
          SELECT COALESCE(SUM(commission_amount), 0) AS s
          FROM affiliate_commission_attributions
          WHERE user_id = ? AND report_date = ? AND platform = ?
        `,
        bind: [params.userId, reportDate, platform],
      })
    } catch {
      attributedSum = 0
    }

    try {
      failureSum = await querySumOrZero({
        db,
        sql: `
          SELECT COALESCE(SUM(commission_amount), 0) AS s
          FROM openclaw_affiliate_attribution_failures
          WHERE user_id = ? AND report_date = ? AND platform = ?
        `,
        bind: [params.userId, reportDate, platform],
      })
    } catch {
      failureSum = 0
    }

    const deltaEntriesVsApi = round4(entriesSum - apiTotal)
    const deltaPipeline = round4(entriesSum - attributedSum - failureSum)

    try {
      if (db.type === 'postgres') {
        await db.exec(
          `
            INSERT INTO openclaw_affiliate_commission_reconciliation (
              user_id, report_date, platform,
              api_total, entries_sum, attributed_sum, failure_sum, currency,
              delta_entries_vs_api, delta_pipeline
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, report_date, platform) DO UPDATE SET
              api_total = EXCLUDED.api_total,
              entries_sum = EXCLUDED.entries_sum,
              attributed_sum = EXCLUDED.attributed_sum,
              failure_sum = EXCLUDED.failure_sum,
              currency = EXCLUDED.currency,
              delta_entries_vs_api = EXCLUDED.delta_entries_vs_api,
              delta_pipeline = EXCLUDED.delta_pipeline,
              updated_at = NOW()
          `,
          [
            params.userId,
            reportDate,
            platform,
            apiTotal,
            entriesSum,
            attributedSum,
            failureSum,
            currency,
            deltaEntriesVsApi,
            deltaPipeline,
          ]
        )
      } else {
        await db.exec(
          `
            INSERT INTO openclaw_affiliate_commission_reconciliation (
              user_id, report_date, platform,
              api_total, entries_sum, attributed_sum, failure_sum, currency,
              delta_entries_vs_api, delta_pipeline
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, report_date, platform) DO UPDATE SET
              api_total = excluded.api_total,
              entries_sum = excluded.entries_sum,
              attributed_sum = excluded.attributed_sum,
              failure_sum = excluded.failure_sum,
              currency = excluded.currency,
              delta_entries_vs_api = excluded.delta_entries_vs_api,
              delta_pipeline = excluded.delta_pipeline,
              updated_at = datetime('now')
          `,
          [
            params.userId,
            reportDate,
            platform,
            apiTotal,
            entriesSum,
            attributedSum,
            failureSum,
            currency,
            deltaEntriesVsApi,
            deltaPipeline,
          ]
        )
      }
    } catch (error: any) {
      const message = String(error?.message || '')
      if (/openclaw_affiliate_commission_reconciliation/i.test(message) && /(no such table|does not exist)/i.test(message)) {
        continue
      }
      console.warn(`[affiliate-reconciliation] skip persist for ${platform} ${reportDate}: ${message}`)
    }
  }
}
