#!/usr/bin/env tsx
/**
 * 回填 url_swap_sitelink_targets（从 Google Ads 读取 Sitelink Asset 并建立映射）
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/backfill-url-swap-sitelink-targets.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-url-swap-sitelink-targets.ts --apply
 *   DATABASE_URL=... npx tsx scripts/backfill-url-swap-sitelink-targets.ts --apply --offer-id=123
 */

import 'dotenv/config'
import { closeDatabase } from '@/lib/db'
import { backfillUrlSwapSitelinkTargets } from '@/lib/url-swap/backfill-sitelink-targets'

function parseArgs(argv: string[]) {
  let apply = false
  let offerId: number | undefined
  let userId: number | undefined

  for (const arg of argv) {
    if (arg === '--apply') apply = true
    if (arg.startsWith('--offer-id=')) {
      offerId = parseInt(arg.split('=')[1] || '', 10)
    }
    if (arg.startsWith('--user-id=')) {
      userId = parseInt(arg.split('=')[1] || '', 10)
    }
  }

  return { apply, offerId, userId }
}

async function main() {
  const { apply, offerId, userId } = parseArgs(process.argv.slice(2))

  console.log('═'.repeat(60))
  console.log('🔗 回填 url_swap_sitelink_targets')
  console.log('═'.repeat(60))
  console.log(`模式: ${apply ? 'apply（写入数据库）' : 'dry-run（仅预览）'}`)
  if (offerId) console.log(`Offer 过滤: ${offerId}`)
  if (userId) console.log(`User 过滤: ${userId}`)
  console.log('')

  const result = await backfillUrlSwapSitelinkTargets({
    offerId,
    userId,
    dryRun: !apply,
  })

  console.log('\n结果:')
  console.log(`  扫描任务: ${result.scannedTasks}`)
  console.log(`  跳过任务（已有映射）: ${result.skippedTasks}`)
  console.log(`  扫描 Campaign: ${result.scannedCampaigns}`)
  console.log(`  映射条数: ${result.upsertedMappings}`)
  if (result.errors.length > 0) {
    console.log(`  错误 (${result.errors.length}):`)
    for (const err of result.errors.slice(0, 20)) {
      console.log(`    - ${err}`)
    }
    if (result.errors.length > 20) {
      console.log(`    ... 另有 ${result.errors.length - 20} 条`)
    }
  }

  await closeDatabase()
  process.exit(0)
}

main().catch(async (error) => {
  console.error('❌ 回填失败:', error)
  await closeDatabase()
  process.exit(1)
})
