#!/usr/bin/env tsx
import process from 'process'
import { pauseClickFarmTasksWithoutEnabledCampaign } from '@/lib/click-farm/campaign-health-guard'

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.floor(parsed)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const userId = parseOptionalNumber(getArg('--user-id'))
  const limit = parseOptionalNumber(getArg('--limit'))

  if (getArg('--user-id') && userId === undefined) {
    throw new Error('--user-id 必须是数字')
  }

  if (getArg('--limit') && (!limit || limit <= 0)) {
    throw new Error('--limit 必须是正整数')
  }

  const result = await pauseClickFarmTasksWithoutEnabledCampaign({
    dryRun,
    userId,
    limit,
  })

  const mode = dryRun ? 'DRY_RUN' : 'APPLY'
  console.log(`[click-farm-audit-no-campaign] mode=${mode}`)
  console.log(
    `[click-farm-audit-no-campaign] scanned=${result.scanned}, paused=${result.paused}, queueRemoved=${result.queueRemoved}, queueScanned=${result.queueScanned}`
  )

  if (result.taskIds.length > 0) {
    console.log(`[click-farm-audit-no-campaign] taskIds=${result.taskIds.join(',')}`)
  }
}

main().catch((error) => {
  console.error('[click-farm-audit-no-campaign] failed:', error)
  process.exit(1)
})
