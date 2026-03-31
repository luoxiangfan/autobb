/**
 * Test script to verify attribution enhancement for user lxl0333019
 *
 * This script simulates the enhanced attribution logic to see if it improves
 * commission attribution accuracy.
 */

import { getDatabase } from '../src/lib/db'

async function testAttributionEnhancement() {
  const db = await getDatabase()
  const userId = 62 // lxl0333019

  console.log('=== Testing Attribution Enhancement for User lxl0333019 ===\n')

  // 1. Get commission ASINs
  const commissionAsins = await db.query<{ source_asin: string; count: number; total: number }>(
    `
      SELECT
        source_asin,
        COUNT(*) as count,
        SUM(commission_amount) as total
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND source_asin IS NOT NULL
      GROUP BY source_asin
      ORDER BY count DESC
    `,
    [userId]
  )

  console.log('Commission ASINs:')
  console.table(commissionAsins)

  // 2. Get Offer ASINs
  const offerAsins = await db.query<{ offer_id: number; brand: string; asin: string }>(
    `
      SELECT
        id as offer_id,
        brand,
        CASE
          WHEN url ~ 'amazon.com/dp/([A-Z0-9]{10})' THEN substring(url from 'amazon.com/dp/([A-Z0-9]{10})')
          WHEN final_url ~ 'amazon.com/dp/([A-Z0-9]{10})' THEN substring(final_url from 'amazon.com/dp/([A-Z0-9]{10})')
        END as asin
      FROM offers
      WHERE user_id = ?
        AND (is_deleted = false OR is_deleted IS NULL)
        AND (url ~ 'amazon.com/dp/([A-Z0-9]{10})' OR final_url ~ 'amazon.com/dp/([A-Z0-9]{10})')
    `,
    [userId]
  )

  console.log('\nOffer ASINs:')
  console.table(offerAsins)

  // 3. Find missing ASINs
  const offerAsinSet = new Set(offerAsins.map(o => o.asin))
  const missingAsins = commissionAsins.filter(c => !offerAsinSet.has(c.source_asin))

  console.log('\nMissing ASINs (not in any Offer):')
  console.table(missingAsins)

  // 4. Check if we can get brand info from affiliate_products
  const productBrands = await db.query<{ asin: string; brand: string }>(
    `
      SELECT asin, brand
      FROM affiliate_products
      WHERE user_id = ?
        AND asin IN (${missingAsins.map(() => '?').join(',')})
    `,
    [userId, ...missingAsins.map(m => m.source_asin)]
  )

  console.log('\nBrand info from affiliate_products:')
  console.table(productBrands)

  // 5. Simulate API enhancement (we can't actually call the API without credentials)
  console.log('\n=== Simulation Results ===')
  console.log(`Total commission ASINs: ${commissionAsins.length}`)
  console.log(`ASINs in Offers: ${commissionAsins.length - missingAsins.length}`)
  console.log(`Missing ASINs: ${missingAsins.length}`)
  console.log(`Missing ASINs with product data: ${productBrands.length}`)
  console.log(`Missing ASINs needing API lookup: ${missingAsins.length - productBrands.length}`)

  const missingCommissionTotal = missingAsins.reduce((sum, m) => sum + Number(m.total), 0)
  const totalCommission = commissionAsins.reduce((sum, c) => sum + Number(c.total), 0)
  const missingPercentage = (missingCommissionTotal / totalCommission * 100).toFixed(1)

  console.log(`\nCommission from missing ASINs: $${missingCommissionTotal.toFixed(2)} (${missingPercentage}%)`)

  // 6. Check current attribution distribution
  const attributionDist = await db.query<{
    source_asin: string
    campaign_count: number
    total_amount: number
  }>(
    `
      SELECT
        source_asin,
        COUNT(DISTINCT campaign_id) as campaign_count,
        SUM(commission_amount) as total_amount
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND source_asin IN (${missingAsins.map(() => '?').join(',')})
      GROUP BY source_asin
      ORDER BY campaign_count DESC
    `,
    [userId, ...missingAsins.map(m => m.source_asin)]
  )

  console.log('\nCurrent attribution distribution for missing ASINs:')
  console.table(attributionDist)

  // 7. Analysis
  console.log('\n=== Analysis ===')
  console.log('Current situation:')
  console.log('- User is using YeahPromos platform')
  console.log('- Our API enhancement only supports PartnerBoost')
  console.log('- User has no product sync data (affiliate_products is empty)')
  console.log('- Missing ASINs are attributed using brand fallback only')

  console.log('\nPotential improvements:')
  console.log('1. Add YeahPromos API support (if available)')
  console.log('2. Implement historical learning (use past successful attributions)')
  console.log('3. Improve brand normalization (e.g., "Squatty" vs "Squatty Potty")')
  console.log('4. Suggest user to sync product data or create missing Offers')

  await db.close()
}

testAttributionEnhancement().catch(console.error)
