#!/usr/bin/env tsx
/**
 * Discover new products from unattributed commissions
 *
 * This script:
 * 1. Finds ASINs in attribution failures that don't exist in affiliate_products
 * 2. Attempts to fetch product info from affiliate platform API
 * 3. Creates records in affiliate_products
 *
 * Run daily or when unattributed commission is detected
 */

import { getDatabase } from '@/lib/db'

interface UnknownAsin {
  asin: string
  platform: string
  mid: string | null
  totalCommission: number
  occurrences: number
}

async function findUnknownAsins(userId: number): Promise<UnknownAsin[]> {
  const db = await getDatabase()

  const results = await db.query<UnknownAsin>(`
    SELECT
      f.source_asin as asin,
      f.platform,
      f.source_mid as mid,
      SUM(f.commission_amount) as totalCommission,
      COUNT(*) as occurrences
    FROM openclaw_affiliate_attribution_failures f
    LEFT JOIN affiliate_products ap
      ON ap.user_id = f.user_id
      AND ap.asin = f.source_asin
      AND ap.platform = f.platform
    WHERE f.user_id = ?
      AND f.source_asin IS NOT NULL
      AND f.reason_code IN ('pending_product_mapping_miss', 'product_mapping_miss')
      AND ap.id IS NULL
    GROUP BY f.source_asin, f.platform, f.source_mid
    ORDER BY SUM(f.commission_amount) DESC
  `, [userId])

  return results
}

async function fetchProductInfo(asin: string, platform: string, mid: string | null): Promise<any> {
  // TODO: Implement actual API calls to affiliate platforms
  // For now, return null to indicate product info not available
  console.log(`   ⚠️  API fetch not implemented for ${platform}`)
  return null
}

async function createProductRecord(
  userId: number,
  asin: string,
  platform: string,
  mid: string | null,
  productInfo: any
): Promise<void> {
  const db = await getDatabase()

  // Check if product already exists
  const existing = await db.queryOne<{ id: number }>(`
    SELECT id
    FROM affiliate_products
    WHERE user_id = ?
      AND asin = ?
      AND platform = ?
  `, [userId, asin, platform])

  if (existing) {
    console.log(`   ℹ️  Product ${asin} already exists`)
    return
  }

  // Create placeholder record if API info not available
  await db.exec(`
    INSERT INTO affiliate_products
      (user_id, platform, asin, mid, brand, product_name, last_synced_at, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [
    userId,
    platform,
    asin,
    mid,
    productInfo?.brand || 'Unknown',
    productInfo?.name || `Product ${asin}`,
  ])

  console.log(`   ✅ Created product record for ${asin}`)
}

async function main() {
  const db = await getDatabase()

  // Get all users
  const users = await db.query<{ id: number }>('SELECT DISTINCT user_id as id FROM openclaw_affiliate_attribution_failures')

  console.log(`🔍 Discovering new products from unattributed commissions...\n`)

  let totalDiscovered = 0
  let totalCreated = 0

  for (const user of users) {
    console.log(`👤 User ${user.id}:`)

    const unknownAsins = await findUnknownAsins(user.id)

    if (unknownAsins.length === 0) {
      console.log(`   ✅ No unknown ASINs found\n`)
      continue
    }

    console.log(`   Found ${unknownAsins.length} unknown ASIN(s):`)

    for (const item of unknownAsins) {
      console.log(`   📦 ${item.asin} (${item.platform}):`)
      console.log(`      Commission: $${item.totalCommission.toFixed(2)} (${item.occurrences} occurrences)`)

      totalDiscovered++

      // Try to fetch product info from API
      const productInfo = await fetchProductInfo(item.asin, item.platform, item.mid)

      // Create product record
      try {
        await createProductRecord(user.id, item.asin, item.platform, item.mid, productInfo)
        totalCreated++
      } catch (error: any) {
        console.log(`   ❌ Failed to create product: ${error.message}`)
      }
    }

    console.log('')
  }

  await db.close()

  console.log('=' .repeat(60))
  console.log(`📊 Summary:`)
  console.log(`   Unknown ASINs discovered: ${totalDiscovered}`)
  console.log(`   Product records created: ${totalCreated}`)
  console.log('=' .repeat(60))

  if (totalDiscovered > 0) {
    console.log(`\n💡 Next steps:`)
    console.log(`   1. Run product sync to fetch full product details`)
    console.log(`   2. Run auto-link script to link products to offers`)
    console.log(`   3. Run reattribution script to attribute pending commissions`)
  }
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
