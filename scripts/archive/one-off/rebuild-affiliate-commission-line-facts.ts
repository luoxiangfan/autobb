import { getDatabase } from '@/lib/db'
import { rebuildAffiliateCommissionLineFactsForUserDate } from '@/lib/openclaw/affiliate-commission-raw-report'

const DEFAULT_CONCURRENCY = 8

function normalizeReportDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return String(value ?? '')
    .trim()
    .slice(0, 10)
}

function parseConcurrencyArg(): number {
  const arg = process.argv.find((value) => value.startsWith('--concurrency='))
  if (!arg) return DEFAULT_CONCURRENCY
  const parsed = Number.parseInt(arg.split('=')[1] || '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CONCURRENCY
  return Math.min(parsed, 32)
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index]!)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  await Promise.all(workers)
}

async function main() {
  const concurrency = parseConcurrencyArg()
  const db = await getDatabase()
  const rows = await db.query<{ user_id: number; report_date: unknown }>(
    `
      SELECT DISTINCT user_id, report_date
      FROM openclaw_affiliate_commission_raw_sync_payloads
      ORDER BY report_date DESC, user_id ASC
    `
  )

  const jobs = rows
    .map((row) => ({
      userId: row.user_id,
      reportDate: normalizeReportDate(row.report_date),
    }))
    .filter((job) => Boolean(job.reportDate))

  let rebuilt = 0
  await runWithConcurrency(jobs, concurrency, async (job) => {
    await rebuildAffiliateCommissionLineFactsForUserDate({
      userId: job.userId,
      reportDate: job.reportDate,
    })
    rebuilt += 1
    if (rebuilt % 50 === 0) {
      console.log(`Rebuilt ${rebuilt}/${jobs.length} user-date pairs...`)
    }
  })

  console.log(
    `Rebuilt affiliate commission line facts for ${rebuilt} user-date pairs (concurrency=${concurrency}).`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
