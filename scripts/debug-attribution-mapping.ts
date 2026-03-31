#!/usr/bin/env tsx
/**
 * Debug attribution logic - check asinToBrands mapping
 */

import { getDatabase } from '@/lib/db'

async function main() {
  const db = await getDatabase()

  console.log('🔍 Checking asinToBrands mapping for B0D9VZBWYV...\n')

  // Check affiliate_products
  const products = await db.query<{ asin: string; brand: string }>(`
    SELECT asin, brand
    FROM affiliate_products
    WHERE user_id = 1
      AND asin = 'B0D9VZBWYV'
  `)

  console.log('📦 affiliate_products:')
  console.log(products)

  // Check offers with Waterdrop brand
  const offers = await db.query<{ id: number; brand: string }>(`
    SELECT id, brand
    FROM offers
    WHERE user_id = 1
      AND LOWER(TRIM(brand)) = 'waterdrop'
      AND (is_deleted = false OR is_deleted IS NULL)
  `)

  console.log('\n🎯 Waterdrop offers:')
  console.log(offers)

  // Check campaigns for these offers
  const campaigns = await db.query<{
    campaign_id: number
    offer_id: number
    brand: string
    created_at: string
  }>(`
    SELECT
      c.id AS campaign_id,
      c.offer_id AS offer_id,
      o.brand AS brand,
      CAST(c.created_at AS TEXT) AS created_at
    FROM campaigns c
    INNER JOIN offers o ON o.id = c.offer_id
    WHERE c.user_id = 1
      AND LOWER(TRIM(o.brand)) = 'waterdrop'
      AND (c.is_deleted = false OR c.is_deleted IS NULL)
      AND (o.is_deleted = false OR o.is_deleted IS NULL)
    ORDER BY c.id
  `)

  console.log('\n🎪 Waterdrop campaigns:')
  console.log(campaigns)

  // Check campaign performance for 2026-03-03
  const performance = await db.query<{
    campaign_id: number
    date: string
    cost: number
    clicks: number
  }>(`
    SELECT
      cp.campaign_id,
      CAST(cp.date AS TEXT) as date,
      cp.cost,
      cp.clicks
    FROM campaign_performance cp
    WHERE cp.user_id = 1
      AND cp.campaign_id IN (${campaigns.map(c => c.campaign_id).join(',')})
      AND cp.date BETWEEN '2026-02-26' AND '2026-03-03'
    ORDER BY cp.campaign_id, cp.date
  `)

  console.log('\n📊 Campaign performance (2026-02-26 to 2026-03-03):')
  console.log(performance)

  await db.close()
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
