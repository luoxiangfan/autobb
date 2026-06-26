/**
 * 将 offer-extraction 的 scraped_data 同步到 scraped_products 表
 * （原 scrape 管线中的 saveScrapedProducts 逻辑）
 */

import { logger } from '@/lib/common/server'
import { getDatabase } from '../db'

export type ScrapedProductSource = 'amazon_store' | 'independent_store' | 'amazon_product'

async function saveScrapedProducts(
  offerId: number,
  userId: number,
  products: any[],
  source: ScrapedProductSource
): Promise<void> {
  if (!Array.isArray(products) || products.length === 0) return

  const db = await getDatabase()
  await db.exec(
    `
    UPDATE scraped_products
    SET is_deleted = true,
        deleted_at = NOW()
    WHERE offer_id = ? AND user_id = ?
  `,
    [offerId, userId]
  )

  for (const product of products) {
    await db.exec(
      `
      INSERT INTO scraped_products (
        user_id, offer_id, name, asin, price, rating, review_count, image_url,
        promotion, badge, is_prime,
        hot_score, rank, is_hot, hot_label,
        product_url, scrape_source,
        sales_volume, discount, delivery_info,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        NOW(), NOW()
      )
    `,
      [
        userId,
        offerId,
        product.name,
        product.asin || null,
        product.price || null,
        product.rating || null,
        product.reviewCount || null,
        product.imageUrl || null,
        product.promotion || null,
        product.badge || null,
        product.isPrime ? 1 : 0,
        product.hotScore || null,
        product.rank || null,
        product.isHot ? 1 : 0,
        product.hotLabel || null,
        product.productUrl || null,
        source,
        product.salesVolume || null,
        product.discount || null,
        product.deliveryInfo || null,
      ]
    )
  }

  logger.debug(
    `📊 scraped_products 已同步 ${products.length} 条 (offer_id=${offerId}, source=${source})`
  )
}

function buildSingleProductRow(extractData: Record<string, unknown>): any[] | null {
  const productName = typeof extractData.productName === 'string' ? extractData.productName : null
  if (!productName) return null

  const rating = parseFloat(String(extractData.rating ?? '0'))
  const reviewCount = parseInt(String(extractData.reviewCount ?? '0'), 10)
  const hotScore = rating > 0 && reviewCount > 0 ? rating * Math.log10(reviewCount + 1) : 0
  const imageUrls = Array.isArray(extractData.imageUrls) ? extractData.imageUrls : []

  return [
    {
      name: productName,
      asin: typeof extractData.asin === 'string' ? extractData.asin : null,
      price: typeof extractData.productPrice === 'string' ? extractData.productPrice : null,
      rating: extractData.rating ?? null,
      reviewCount: extractData.reviewCount ?? null,
      imageUrl: typeof imageUrls[0] === 'string' ? imageUrls[0] : null,
      promotion: extractData.discount ?? null,
      badge: null,
      isPrime: extractData.primeEligible === true,
      hotScore,
      rank: 1,
      isHot: true,
      hotLabel: '🔥 主推商品',
      productUrl: typeof extractData.finalUrl === 'string' ? extractData.finalUrl : null,
    },
  ]
}

/**
 * 从 extractOffer 结果同步店铺/单品商品列表到 scraped_products
 */
export async function syncScrapedProductsFromExtractData(
  offerId: number,
  userId: number,
  extractData: unknown
): Promise<void> {
  if (!extractData || typeof extractData !== 'object') return

  const data = extractData as Record<string, unknown>
  const debug =
    data.debug && typeof data.debug === 'object' ? (data.debug as Record<string, unknown>) : {}

  const isAmazonProductPage = debug.isAmazonProductPage === true
  const isIndependentStore = debug.isIndependentStore === true

  try {
    const storeProducts = Array.isArray(data.products) ? data.products : []
    if (storeProducts.length > 0) {
      const source: ScrapedProductSource = isIndependentStore ? 'independent_store' : 'amazon_store'
      await saveScrapedProducts(offerId, userId, storeProducts, source)
      return
    }

    const single = buildSingleProductRow(data)
    if (single) {
      const source: ScrapedProductSource = isAmazonProductPage
        ? 'amazon_product'
        : isIndependentStore
          ? 'independent_store'
          : 'amazon_store'
      await saveScrapedProducts(offerId, userId, single, source)
    }
  } catch (error: any) {
    console.warn(
      `⚠️ scraped_products 同步失败（非致命） offer_id=${offerId}:`,
      error?.message || error
    )
  }
}
