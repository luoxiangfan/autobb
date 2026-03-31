#!/usr/bin/env tsx
/**
 * Test attribution for a single ASIN on a specific date
 */

import { getDatabase } from '@/lib/db'
import { persistAffiliateCommissionAttributions } from '@/lib/openclaw/affiliate-commission-attribution'

async function main() {
  const db = await getDatabase()

  console.log('🔍 Testing attribution for B0D9VZBWYV on 2026-03-03...')

  const result = await persistAffiliateCommissionAttributions({
    userId: 1,
    reportDate: '2026-03-03',
    entries: [
      {
        platform: 'partnerboost',
        reportDate: '2026-03-03',
        commission: 8.49,
        sourceAsin: 'B0D9VZBWYV',
        sourceMid: '1d5810609e87f538e30672b4d1a8dcd6',
      },
    ],
    replaceExisting: false, // Don't replace existing attributions
    lockHistorical: false,
  })

  console.log('\n📊 Result:')
  console.log(`   Total commission: $${result.totalCommission.toFixed(2)}`)
  console.log(`   Attributed: $${result.attributedCommission.toFixed(2)}`)
  console.log(`   Unattributed: $${result.unattributedCommission.toFixed(2)}`)
  console.log(`   Attributed campaigns: ${result.attributedCampaigns}`)
  console.log(`   Written rows: ${result.writtenRows}`)

  await db.close()
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
