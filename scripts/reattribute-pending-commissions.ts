#!/usr/bin/env tsx
/**
 * Re-attribute pending commission failures that can now be attributed
 * via the enhanced brand fallback mechanism.
 *
 * This script:
 * 1. Finds pending attribution failures (within grace period)
 * 2. Re-runs attribution for those dates
 * 3. Reports the results
 */

import { getDatabase } from '@/lib/db'
import { persistAffiliateCommissionAttributions } from '@/lib/openclaw/affiliate-commission-attribution'

async function main() {
  const db = await getDatabase()

  console.log('🔍 Finding pending attribution failures...')

  const failures = await db.query<{
    id: number
    user_id: number
    report_date: string
    platform: string
    source_order_id: string | null
    source_mid: string | null
    source_asin: string | null
    commission_amount: number
    currency: string
    reason_code: string
  }>(`
    SELECT
      id,
      user_id,
      report_date,
      platform,
      source_order_id,
      source_mid,
      source_asin,
      commission_amount,
      currency,
      reason_code
    FROM openclaw_affiliate_attribution_failures
    WHERE reason_code IN ('pending_offer_mapping_miss', 'pending_product_mapping_miss')
    ORDER BY report_date DESC, user_id, commission_amount DESC
  `)

  if (failures.length === 0) {
    console.log('✅ No pending attribution failures found.')
    await db.close()
    return
  }

  console.log(`📊 Found ${failures.length} pending failures`)

  // Group by user_id and report_date
  const groupedByUserAndDate = new Map<string, typeof failures>()
  for (const failure of failures) {
    const key = `${failure.user_id}:${failure.report_date}`
    const existing = groupedByUserAndDate.get(key) || []
    existing.push(failure)
    groupedByUserAndDate.set(key, existing)
  }

  console.log(`📅 Processing ${groupedByUserAndDate.size} unique user-date combinations...\n`)

  let totalReattributed = 0
  let totalStillPending = 0

  for (const [key, groupFailures] of groupedByUserAndDate.entries()) {
    const [userId, reportDate] = key.split(':')
    const userIdNum = Number(userId)

    const totalCommission = groupFailures.reduce((sum, f) => sum + Number(f.commission_amount), 0)

    console.log(`\n👤 User ${userId}, Date ${reportDate}`)
    console.log(`   Pending: $${totalCommission.toFixed(2)} (${groupFailures.length} entries)`)

    // Delete existing failure records for these entries
    const failureIds = groupFailures.map(f => f.id)
    await db.exec(
      `DELETE FROM openclaw_affiliate_attribution_failures WHERE id IN (${failureIds.map(() => '?').join(',')})`,
      failureIds
    )

    // Re-run attribution for this date
    const result = await persistAffiliateCommissionAttributions({
      userId: userIdNum,
      reportDate,
      entries: groupFailures.map(f => ({
        platform: f.platform as 'partnerboost' | 'yeahpromos',
        reportDate: f.report_date,
        commission: Number(f.commission_amount),
        currency: f.currency,
        sourceOrderId: f.source_order_id,
        sourceMid: f.source_mid,
        sourceAsin: f.source_asin,
      })),
      replaceExisting: false, // Don't delete existing attributions
      lockHistorical: false,
    })

    const reattributed = totalCommission - result.unattributedCommission
    totalReattributed += reattributed
    totalStillPending += result.unattributedCommission

    if (reattributed > 0) {
      console.log(`   ✅ Re-attributed: $${reattributed.toFixed(2)}`)
    }
    if (result.unattributedCommission > 0) {
      console.log(`   ⏳ Still pending: $${result.unattributedCommission.toFixed(2)}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📈 Summary:')
  console.log(`   Total re-attributed: $${totalReattributed.toFixed(2)}`)
  console.log(`   Still pending: $${totalStillPending.toFixed(2)}`)
  console.log('='.repeat(60))

  await db.close()
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
