import { getDatabase } from '@/lib/db'
import { rebuildAffiliateCommissionLineFactsForUserDate } from '@/lib/openclaw/affiliate-commission-raw-report'

function normalizeReportDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return String(value ?? '').trim().slice(0, 10)
}

async function main() {
  const db = await getDatabase()
  const rows = await db.query<{ user_id: number; report_date: unknown }>(
    `
      SELECT DISTINCT user_id, report_date
      FROM openclaw_affiliate_commission_raw_sync_payloads
      ORDER BY report_date DESC, user_id ASC
    `
  )

  let rebuilt = 0
  for (const row of rows) {
    const reportDate = normalizeReportDate(row.report_date)
    if (!reportDate) continue
    await rebuildAffiliateCommissionLineFactsForUserDate({
      userId: row.user_id,
      reportDate,
    })
    rebuilt += 1
  }

  console.log(`Rebuilt affiliate commission line facts for ${rebuilt} user-date pairs.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
