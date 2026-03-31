#!/usr/bin/env tsx
/**
 * Auto-link products to offers based on brand and ASIN matching
 *
 * This script:
 * 1. Finds products without offer links
 * 2. Attempts to match them with offers based on:
 *    - Brand exact match
 *    - ASIN in offer URL
 * 3. Creates affiliate_product_offer_links
 *
 * Run daily or after product sync
 */

import { getDatabase } from '@/lib/db'

interface Product {
  id: number
  asin: string
  brand: string
  product_name: string
}

interface Offer {
  id: number
  brand: string
  url: string | null
  final_url: string | null
  affiliate_link: string | null
  offer_name: string
}

interface LinkResult {
  productId: number
  offerId: number
  matchReason: string
}

function extractAsinFromUrl(url: string | null): string | null {
  if (!url) return null

  // Match Amazon ASIN pattern: /dp/B0XXXXXXXX or /gp/product/B0XXXXXXXX
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)
  return match ? match[1].toUpperCase() : null
}

function normalizeBrand(brand: string | null): string | null {
  if (!brand) return null
  return brand.trim().toLowerCase()
}

async function findUnlinkedProducts(userId: number): Promise<Product[]> {
  const db = await getDatabase()

  const products = await db.query<Product>(`
    SELECT
      ap.id,
      ap.asin,
      ap.brand,
      ap.product_name
    FROM affiliate_products ap
    LEFT JOIN affiliate_product_offer_links apol ON apol.product_id = ap.id
    WHERE ap.user_id = ?
      AND ap.asin IS NOT NULL
      AND ap.brand IS NOT NULL
      AND apol.id IS NULL
    ORDER BY ap.last_synced_at DESC
  `, [userId])

  return products
}

async function findMatchingOffers(userId: number): Promise<Offer[]> {
  const db = await getDatabase()
  const offerNotDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const offers = await db.query<Offer>(`
    SELECT
      id,
      brand,
      url,
      final_url,
      affiliate_link,
      offer_name
    FROM offers
    WHERE user_id = ?
      AND ${offerNotDeletedCondition}
      AND brand IS NOT NULL
  `, [userId])

  return offers
}

function matchProductToOffers(product: Product, offers: Offer[]): LinkResult[] {
  const results: LinkResult[] = []
  const productBrand = normalizeBrand(product.brand)
  const productAsin = product.asin.toUpperCase()

  for (const offer of offers) {
    const offerBrand = normalizeBrand(offer.brand)

    // Rule 1: Brand exact match
    if (productBrand && offerBrand && productBrand === offerBrand) {
      results.push({
        productId: product.id,
        offerId: offer.id,
        matchReason: 'brand_exact_match',
      })
      continue
    }

    // Rule 2: ASIN in offer URL
    const urlAsin = extractAsinFromUrl(offer.url)
    const finalUrlAsin = extractAsinFromUrl(offer.final_url)
    const affiliateLinkAsin = extractAsinFromUrl(offer.affiliate_link)

    if (
      (urlAsin && urlAsin === productAsin) ||
      (finalUrlAsin && finalUrlAsin === productAsin) ||
      (affiliateLinkAsin && affiliateLinkAsin === productAsin)
    ) {
      results.push({
        productId: product.id,
        offerId: offer.id,
        matchReason: 'asin_in_url',
      })
    }
  }

  return results
}

async function createProductOfferLink(
  userId: number,
  productId: number,
  offerId: number,
  createdVia: string
): Promise<void> {
  const db = await getDatabase()

  // Check if link already exists
  const existing = await db.queryOne<{ id: number }>(`
    SELECT id
    FROM affiliate_product_offer_links
    WHERE user_id = ?
      AND product_id = ?
      AND offer_id = ?
  `, [userId, productId, offerId])

  if (existing) {
    return // Link already exists
  }

  await db.exec(`
    INSERT INTO affiliate_product_offer_links
      (user_id, product_id, offer_id, created_via, created_at)
    VALUES
      (?, ?, ?, ?, datetime('now'))
  `, [userId, productId, offerId, createdVia])
}

async function main() {
  const db = await getDatabase()

  // Get all users
  const users = await db.query<{ id: number }>('SELECT DISTINCT user_id as id FROM affiliate_products')

  console.log(`🔗 Auto-linking products to offers for ${users.length} user(s)...\n`)

  let totalLinked = 0
  let totalProducts = 0

  for (const user of users) {
    console.log(`👤 User ${user.id}:`)

    const unlinkedProducts = await findUnlinkedProducts(user.id)
    const offers = await findMatchingOffers(user.id)

    console.log(`   Found ${unlinkedProducts.length} unlinked products`)
    console.log(`   Found ${offers.length} offers`)

    if (unlinkedProducts.length === 0) {
      console.log(`   ✅ All products are linked\n`)
      continue
    }

    const linksByReason = new Map<string, number>()

    for (const product of unlinkedProducts) {
      const matches = matchProductToOffers(product, offers)

      if (matches.length === 0) {
        continue
      }

      // Create links for all matches
      for (const match of matches) {
        await createProductOfferLink(
          user.id,
          match.productId,
          match.offerId,
          `auto_${match.matchReason}`
        )

        linksByReason.set(
          match.matchReason,
          (linksByReason.get(match.matchReason) || 0) + 1
        )

        totalLinked++
      }
    }

    totalProducts += unlinkedProducts.length

    console.log(`   ✅ Created ${totalLinked} links:`)
    for (const [reason, count] of linksByReason.entries()) {
      console.log(`      - ${reason}: ${count}`)
    }
    console.log('')
  }

  await db.close()

  console.log('=' .repeat(60))
  console.log(`📊 Summary:`)
  console.log(`   Total unlinked products: ${totalProducts}`)
  console.log(`   Total links created: ${totalLinked}`)
  console.log(`   Coverage improvement: ${totalProducts > 0 ? ((totalLinked / totalProducts) * 100).toFixed(1) : 0}%`)
  console.log('=' .repeat(60))
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
