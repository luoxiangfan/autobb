#!/usr/bin/env tsx
import 'dotenv/config'
import { getDatabase } from '../src/lib/db'
import { getOpenclawSettingsMap } from '../src/lib/openclaw/settings'
import { fetchAffiliateCommissionRevenue } from '../src/lib/openclaw/affiliate-revenue'

type CliArgs = {
  userId: number
  days: number
  startDate?: string
  endDate?: string
}

function parseYmd(value: string): string {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`日期格式错误: ${value}（应为 YYYY-MM-DD）`)
  }
  return raw
}

function toLocalYmd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDays(date: Date, offset: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + offset)
  return next
}

function listDateRange(params: {
  timeZone: string
  startDate?: string
  endDate?: string
  days: number
}): string[] {
  if (params.startDate || params.endDate) {
    if (!params.startDate || !params.endDate) {
      throw new Error('startDate/endDate 需要同时提供')
    }

    const start = new Date(`${parseYmd(params.startDate)}T00:00:00Z`)
    const end = new Date(`${parseYmd(params.endDate)}T00:00:00Z`)
    if (start > end) {
      throw new Error(`startDate(${params.startDate}) 不能晚于 endDate(${params.endDate})`)
    }

    const dates: string[] = []
    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      dates.push(toLocalYmd(cursor, params.timeZone))
    }
    return dates
  }

  const today = new Date()
  const days = Math.max(1, params.days)
  const dates: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(toLocalYmd(addDays(today, -offset), params.timeZone))
  }
  return dates
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

  const days = Number(args['days'] || '7')
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`days 非法: ${args['days']}`)
  }

  return {
    userId: Math.floor(userId),
    days: Math.floor(days),
    startDate: args['start-date'],
    endDate: args['end-date'],
  }
}

async function loadTokenDiagnostics(userId: number): Promise<void> {
  const db = await getDatabase()
  const rows = await db.query<{
    key: string
    value: string | null
    encrypted_value: string | null
    is_sensitive: boolean | number
  }>(
    `
      SELECT key, value, encrypted_value, is_sensitive
      FROM system_settings
      WHERE user_id = ?
        AND category = 'openclaw'
        AND key IN ('partnerboost_token', 'yeahpromos_token', 'yeahpromos_site_id')
      ORDER BY key
    `,
    [userId]
  )

  const settings = await getOpenclawSettingsMap(userId)
  const settingsPbToken = String(settings.partnerboost_token || '').trim()
  const settingsYpToken = String(settings.yeahpromos_token || '').trim()
  const settingsYpSiteId = String(settings.yeahpromos_site_id || '').trim()

  console.log('🔍 OpenClaw 配置诊断:')
  console.log(`  - partnerboost_token(解密后): ${settingsPbToken ? '[set]' : '(empty)'}`)
  console.log(`  - yeahpromos_token(解密后): ${settingsYpToken ? '[set]' : '(empty)'}`)
  console.log(`  - yeahpromos_site_id(解密后): ${settingsYpSiteId || '(empty)'}`)

  for (const row of rows) {
    const hasEncrypted = Boolean(String(row.encrypted_value || '').trim())
    const hasPlainValue = Boolean(String(row.value || '').trim())
    console.log(`  - ${row.key}: plain=${hasPlainValue ? '[set]' : '(empty)'}, encrypted=${hasEncrypted ? '[set]' : '(empty)'}`)
  }

  const pbRow = rows.find((r) => r.key === 'partnerboost_token')
  const ypRow = rows.find((r) => r.key === 'yeahpromos_token')
  const hasEncryptedPb = Boolean(String(pbRow?.encrypted_value || '').trim())
  const hasEncryptedYp = Boolean(String(ypRow?.encrypted_value || '').trim())
  const decryptLikelyMismatch = (hasEncryptedPb && !settingsPbToken) || (hasEncryptedYp && !settingsYpToken)

  if (decryptLikelyMismatch) {
    console.warn('⚠️ 检测到 token 已加密存储但当前进程解密后为空，可能是 ENCRYPTION_KEY 与生产不一致。')
  }
}

async function queryDateAttribution(userId: number, reportDate: string) {
  const db = await getDatabase()
  const row = await db.queryOne<{
    rows: number
    rows_with_campaign: number
    commission_total: number
    commission_with_campaign: number
  }>(
    `
      SELECT
        COUNT(*) AS rows,
        COUNT(*) FILTER (WHERE campaign_id IS NOT NULL) AS rows_with_campaign,
        COALESCE(SUM(commission_amount), 0) AS commission_total,
        COALESCE(SUM(CASE WHEN campaign_id IS NOT NULL THEN commission_amount ELSE 0 END), 0) AS commission_with_campaign
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date = ?
    `,
    [userId, reportDate]
  )

  return {
    rows: Number(row?.rows) || 0,
    rowsWithCampaign: Number(row?.rows_with_campaign) || 0,
    commissionTotal: Number(row?.commission_total) || 0,
    commissionWithCampaign: Number(row?.commission_with_campaign) || 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const timeZone = process.env.TZ || 'Asia/Shanghai'
  const dates = listDateRange({
    timeZone,
    startDate: args.startDate,
    endDate: args.endDate,
    days: args.days,
  })

  console.log('═'.repeat(72))
  console.log('🧾 OpenClaw 联盟佣金按日期补拉')
  console.log('═'.repeat(72))
  console.log(`用户ID: ${args.userId}`)
  console.log(`时区: ${timeZone}`)
  console.log(`日期范围: ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length}天)`)
  console.log(`DB: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`)
  console.log('')

  await loadTokenDiagnostics(args.userId)
  console.log('')

  let successDates = 0
  let failDates = 0
  let totalCommission = 0
  let totalAttributed = 0
  let totalRows = 0

  for (const reportDate of dates) {
    try {
      console.log(`\n📅 [${reportDate}] 开始补拉...`)
      const revenue = await fetchAffiliateCommissionRevenue({
        userId: args.userId,
        reportDate,
      })

      const attrib = await queryDateAttribution(args.userId, reportDate)
      const platformSummary = revenue.breakdown
        .map((item) => `${item.platform}:${item.totalCommission}(${item.records})`)
        .join(' | ') || 'none'

      console.log(`  - configured: ${revenue.configuredPlatforms.join(', ') || '(none)'}`)
      console.log(`  - queried: ${revenue.queriedPlatforms.join(', ') || '(none)'}`)
      console.log(`  - breakdown: ${platformSummary}`)
      console.log(`  - totalCommission: ${revenue.totalCommission}`)
      console.log(`  - attribution(writtenRows): ${revenue.attribution.writtenRows}`)
      console.log(`  - dbRows: ${attrib.rows}, dbRowsWithCampaign: ${attrib.rowsWithCampaign}`)
      console.log(`  - dbCommissionTotal: ${attrib.commissionTotal.toFixed(2)}, dbCommissionWithCampaign: ${attrib.commissionWithCampaign.toFixed(2)}`)

      if (revenue.errors.length > 0) {
        for (const err of revenue.errors) {
          console.warn(`  - error[${err.platform}]: ${err.message}`)
        }
      }

      successDates += 1
      totalCommission += Number(revenue.totalCommission) || 0
      totalAttributed += Number(revenue.attribution.attributedCommission) || 0
      totalRows += attrib.rows
    } catch (error: any) {
      failDates += 1
      console.error(`  ❌ [${reportDate}] 失败: ${error?.message || error}`)
    }
  }

  console.log('\n' + '═'.repeat(72))
  console.log('✅ 补拉完成')
  console.log('═'.repeat(72))
  console.log(`成功日期: ${successDates}`)
  console.log(`失败日期: ${failDates}`)
  console.log(`汇总佣金(平台返回): ${totalCommission.toFixed(2)}`)
  console.log(`汇总佣金(归因到offer/campaign): ${totalAttributed.toFixed(2)}`)
  console.log(`归因表总写入行数(按日期快照后): ${totalRows}`)
}

main().catch((error) => {
  console.error('❌ 执行失败:', error?.message || error)
  process.exit(1)
})
