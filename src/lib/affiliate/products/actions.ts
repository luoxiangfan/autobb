import { createOffer, deleteOffer, findOfferById } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
import { enqueueExistingOfferExtractionAndMarkQueued } from '@/lib/offers'

import { toBool } from '@/lib/db'
import type {
  AffiliateProduct,
  AffiliateProductOfferLinkCreatedVia,
  AffiliateProductOfflineFailure,
  AffiliateProductOfflineResult,
  BatchOfflineAffiliateProductsResult,
  OfferProductBackfillDecisionReason,
  OfferProductLinkBackfillReason,
  OfferProductLinkBackfillResult,
} from './types'
import {
  chooseOfferUrl,
  formatCommissionForOffer,
  formatPriceForOffer,
  resolveOfferAffiliateLinkForProduct,
} from './offer-link-helpers'
import {
  buildComparableUrlTokens,
  extractAsinFromUrlLike,
  extractPartnerboostLinkId,
  normalizeAsin,
  normalizeBrand,
  resolveOfferProductBackfillDecision,
} from './parsing'
import { parseAllowedCountries } from './parsing'

export async function getAffiliateProductById(
  userId: number,
  productId: number
): Promise<AffiliateProduct | null> {
  const db = await getDatabase()
  const row = await db.queryOne<AffiliateProduct>(
    `SELECT * FROM affiliate_products WHERE id = ? AND user_id = ? LIMIT 1`,
    [productId, userId]
  )
  return row || null
}

export async function clearAllAffiliateProducts(userId: number): Promise<{ deletedCount: number }> {
  const db = await getDatabase()

  const totalRow = await db.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM affiliate_products WHERE user_id = ?`,
    [userId]
  )

  await db.exec(`DELETE FROM affiliate_products WHERE user_id = ?`, [userId])

  return {
    deletedCount: Number(totalRow?.total || 0),
  }
}

export async function listActiveLinkedOfferIdsForProduct(
  userId: number,
  productId: number
): Promise<number[]> {
  const db = await getDatabase()
  const offerNotDeletedCondition = '(o.is_deleted = false OR o.is_deleted IS NULL)'

  const rows = await db.query<{ offer_id: number }>(
    `
      SELECT DISTINCT link.offer_id
      FROM affiliate_product_offer_links link
      INNER JOIN offers o ON o.id = link.offer_id AND o.user_id = link.user_id
      WHERE link.user_id = ?
        AND link.product_id = ?
        AND ${offerNotDeletedCondition}
      ORDER BY link.offer_id ASC
    `,
    [userId, productId]
  )

  return rows
    .map((row) => Number(row.offer_id))
    .filter((value) => Number.isFinite(value) && value > 0)
}

export async function offlineAffiliateProduct(params: {
  userId: number
  productId: number
}): Promise<AffiliateProductOfflineResult> {
  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  const linkedOfferIds = await listActiveLinkedOfferIdsForProduct(params.userId, params.productId)
  const deletedOfferIds: number[] = []
  const failedOffers: AffiliateProductOfflineFailure[] = []

  for (const offerId of linkedOfferIds) {
    try {
      const result = await deleteOffer(offerId, params.userId, true, true)
      if (!result.success) {
        throw new Error(result.message || '删除Offer失败')
      }
      deletedOfferIds.push(offerId)
    } catch (error: any) {
      failedOffers.push({
        offerId,
        error: error?.message || '删除Offer失败',
      })
    }
  }

  const offlined = failedOffers.length === 0
  const updatedProduct = offlined
    ? await setAffiliateProductBlacklist(params.userId, params.productId, true)
    : product

  return {
    productId: params.productId,
    totalLinkedOffers: linkedOfferIds.length,
    deletedOfferCount: deletedOfferIds.length,
    deletedOfferIds,
    failedOffers,
    offlined,
    product: updatedProduct,
  }
}

export async function batchOfflineAffiliateProducts(params: {
  userId: number
  productIds: number[]
}): Promise<BatchOfflineAffiliateProductsResult> {
  const dedupedProductIds = Array.from(
    new Set(params.productIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  )

  const results: BatchOfflineAffiliateProductsResult['results'] = []
  let successCount = 0
  let failureCount = 0

  for (const productId of dedupedProductIds) {
    try {
      const result = await offlineAffiliateProduct({
        userId: params.userId,
        productId,
      })

      if (!result.offlined) {
        failureCount += 1
        results.push({
          productId,
          success: false,
          deletedOfferCount: result.deletedOfferCount,
          totalLinkedOffers: result.totalLinkedOffers,
          offlined: result.offlined,
          failedOffers: result.failedOffers,
          error: `下线失败：${result.failedOffers.length}/${result.totalLinkedOffers} 个关联Offer删除失败`,
        })
        continue
      }

      successCount += 1
      results.push({
        productId,
        success: true,
        deletedOfferCount: result.deletedOfferCount,
        totalLinkedOffers: result.totalLinkedOffers,
        offlined: result.offlined,
      })
    } catch (error: any) {
      failureCount += 1
      results.push({
        productId,
        success: false,
        error: error?.message || '下线商品失败',
      })
    }
  }

  return {
    total: dedupedProductIds.length,
    successCount,
    failureCount,
    results,
  }
}

export async function setAffiliateProductBlacklist(
  userId: number,
  productId: number,
  blacklisted: boolean
): Promise<AffiliateProduct | null> {
  const db = await getDatabase()
  const value = blacklisted
  const nowIso = new Date().toISOString()

  await db.exec(
    `
      UPDATE affiliate_products
      SET is_blacklisted = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `,
    [value, nowIso, productId, userId]
  )

  return await getAffiliateProductById(userId, productId)
}

export async function recordAffiliateProductOfferLink(params: {
  userId: number
  productId: number
  offerId: number
  createdVia?: AffiliateProductOfferLinkCreatedVia
}): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
      INSERT INTO affiliate_product_offer_links (user_id, product_id, offer_id, created_via)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, product_id, offer_id) DO NOTHING
    `,
    [params.userId, params.productId, params.offerId, params.createdVia || 'single']
  )
}

export async function linkOfferToAffiliateProduct(params: {
  userId: number
  productId: number
  offerId: number
}): Promise<{ product: AffiliateProduct; offerId: number; linked: boolean }> {
  const db = await getDatabase()

  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  const offer = await findOfferById(params.offerId, params.userId)
  if (!offer) {
    throw new Error('Offer不存在')
  }

  const existing = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM affiliate_product_offer_links
      WHERE user_id = ? AND product_id = ? AND offer_id = ?
      LIMIT 1
    `,
    [params.userId, params.productId, params.offerId]
  )

  if (existing) {
    return {
      product,
      offerId: offer.id,
      linked: false,
    }
  }

  await recordAffiliateProductOfferLink({
    userId: params.userId,
    productId: params.productId,
    offerId: params.offerId,
    createdVia: 'manual_link',
  })

  return {
    product,
    offerId: offer.id,
    linked: true,
  }
}

export async function backfillOfferProductLinkForPublishedCampaign(params: {
  userId: number
  offerId: number
}): Promise<OfferProductLinkBackfillResult> {
  const db = await getDatabase()

  const existing = await db.queryOne<{ product_id: number }>(
    `
      SELECT product_id
      FROM affiliate_product_offer_links
      WHERE user_id = ? AND offer_id = ?
      LIMIT 1
    `,
    [params.userId, params.offerId]
  )

  if (existing && Number.isFinite(Number(existing.product_id)) && Number(existing.product_id) > 0) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: Number(existing.product_id),
      reason: 'already_linked',
      signals: {
        urlTokenCount: 0,
        linkIdCount: 0,
        asinCount: 0,
        brandCount: 0,
      },
      candidates: {
        exactUrlProductIds: [],
        linkIdProductIds: [],
        asinProductIds: [],
        brandProductIds: [],
      },
    }
  }

  const offerNotDeletedCondition = '(is_deleted = false OR is_deleted IS NULL)'

  const offer = await db.queryOne<{
    id: number
    url: string | null
    final_url: string | null
    affiliate_link: string | null
  }>(
    `
      SELECT id, url, final_url, affiliate_link
      FROM offers
      WHERE id = ? AND user_id = ? AND ${offerNotDeletedCondition}
      LIMIT 1
    `,
    [params.offerId, params.userId]
  )

  if (!offer) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: null,
      reason: 'offer_not_found',
      signals: {
        urlTokenCount: 0,
        linkIdCount: 0,
        asinCount: 0,
        brandCount: 0,
      },
      candidates: {
        exactUrlProductIds: [],
        linkIdProductIds: [],
        asinProductIds: [],
        brandProductIds: [],
      },
    }
  }

  const offerUrlTokens = new Set<string>()
  const offerLinkIds = new Set<string>()
  const offerAsins = new Set<string>()
  const offerUrlCandidates = [offer.url, offer.final_url, offer.affiliate_link]

  for (const candidate of offerUrlCandidates) {
    for (const token of buildComparableUrlTokens(candidate)) {
      offerUrlTokens.add(token)
    }

    const linkId = extractPartnerboostLinkId(candidate)
    if (linkId) {
      offerLinkIds.add(linkId.toLowerCase())
    }

    const asin = extractAsinFromUrlLike(candidate)
    if (asin) {
      offerAsins.add(asin)
    }
  }

  // Query brand information from affiliate_products for ASINs found in offer URLs
  const offerBrands = new Set<string>()
  if (offerAsins.size > 0) {
    const asinArray = Array.from(offerAsins)
    const asinPlaceholders = asinArray.map(() => '?').join(', ')
    const brandRows = await db.query<{ brand: string }>(
      `
        SELECT DISTINCT brand
        FROM affiliate_products
        WHERE user_id = ? AND asin IN (${asinPlaceholders}) AND brand IS NOT NULL
      `,
      [params.userId, ...asinArray]
    )
    for (const row of brandRows) {
      const brand = normalizeBrand(row.brand)
      if (brand) {
        offerBrands.add(brand)
      }
    }
  }

  if (
    offerUrlTokens.size === 0 &&
    offerLinkIds.size === 0 &&
    offerAsins.size === 0 &&
    offerBrands.size === 0
  ) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: null,
      reason: 'no_offer_signal',
      signals: {
        urlTokenCount: 0,
        linkIdCount: 0,
        asinCount: 0,
        brandCount: 0,
      },
      candidates: {
        exactUrlProductIds: [],
        linkIdProductIds: [],
        asinProductIds: [],
        brandProductIds: [],
      },
    }
  }

  const notBlacklistedCondition = '(is_blacklisted = false OR is_blacklisted IS NULL)'

  const productRows = await db.query<{
    id: number
    asin: string | null
    brand: string | null
    promo_link: string | null
    short_promo_link: string | null
    product_url: string | null
  }>(
    `
      SELECT id, asin, brand, promo_link, short_promo_link, product_url
      FROM affiliate_products
      WHERE user_id = ? AND ${notBlacklistedCondition}
    `,
    [params.userId]
  )

  const exactUrlProductIds: number[] = []
  const linkIdProductIds: number[] = []
  const asinProductIds: number[] = []
  const brandProductIds: number[] = []

  for (const row of productRows) {
    const productId = Number(row.id)
    if (!Number.isFinite(productId) || productId <= 0) continue

    if (offerUrlTokens.size > 0) {
      const productUrlTokens = new Set<string>()
      for (const token of buildComparableUrlTokens(row.promo_link)) {
        productUrlTokens.add(token)
      }
      for (const token of buildComparableUrlTokens(row.short_promo_link)) {
        productUrlTokens.add(token)
      }
      for (const token of buildComparableUrlTokens(row.product_url)) {
        productUrlTokens.add(token)
      }
      for (const token of productUrlTokens) {
        if (!offerUrlTokens.has(token)) continue
        exactUrlProductIds.push(productId)
        break
      }
    }

    if (offerLinkIds.size > 0) {
      const productLinkIdCandidates = [
        extractPartnerboostLinkId(row.promo_link),
        extractPartnerboostLinkId(row.short_promo_link),
      ]
      for (const linkId of productLinkIdCandidates) {
        if (!linkId) continue
        if (offerLinkIds.has(linkId.toLowerCase())) {
          linkIdProductIds.push(productId)
          break
        }
      }
    }

    if (offerAsins.size > 0) {
      const productAsin = normalizeAsin(row.asin)
      if (productAsin && offerAsins.has(productAsin)) {
        asinProductIds.push(productId)
      }
    }

    if (offerBrands.size > 0) {
      const productBrand = normalizeBrand(row.brand)
      if (productBrand && offerBrands.has(productBrand)) {
        brandProductIds.push(productId)
      }
    }
  }

  const decision = resolveOfferProductBackfillDecision({
    exactUrlProductIds,
    linkIdProductIds,
    asinProductIds,
    brandProductIds,
  })

  const reasonMap: Record<OfferProductBackfillDecisionReason, OfferProductLinkBackfillReason> = {
    exact_url: 'linked_by_exact_url',
    link_id: 'linked_by_link_id',
    asin: 'linked_by_asin',
    brand: 'linked_by_brand',
    link_id_asin_intersection: 'linked_by_link_id_asin_intersection',
    ambiguous_exact_url: 'ambiguous_exact_url',
    ambiguous_link_id: 'ambiguous_link_id',
    ambiguous_asin: 'ambiguous_asin',
    ambiguous_brand: 'ambiguous_brand',
    ambiguous_link_id_asin_intersection: 'ambiguous_link_id_asin_intersection',
    conflicting_link_id_asin: 'conflicting_link_id_asin',
    no_match: 'no_match',
  }

  if (!decision.productId) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: null,
      reason: reasonMap[decision.reason],
      signals: {
        urlTokenCount: offerUrlTokens.size,
        linkIdCount: offerLinkIds.size,
        asinCount: offerAsins.size,
        brandCount: offerBrands.size,
      },
      candidates: {
        exactUrlProductIds: decision.exactUrlProductIds,
        linkIdProductIds: decision.linkIdProductIds,
        asinProductIds: decision.asinProductIds,
        brandProductIds: decision.brandProductIds,
      },
    }
  }

  await recordAffiliateProductOfferLink({
    userId: params.userId,
    productId: decision.productId,
    offerId: params.offerId,
    createdVia: 'publish_backfill',
  })

  return {
    linked: true,
    offerId: params.offerId,
    productId: decision.productId,
    reason: reasonMap[decision.reason],
    signals: {
      urlTokenCount: offerUrlTokens.size,
      linkIdCount: offerLinkIds.size,
      asinCount: offerAsins.size,
      brandCount: offerBrands.size,
    },
    candidates: {
      exactUrlProductIds: decision.exactUrlProductIds,
      linkIdProductIds: decision.linkIdProductIds,
      asinProductIds: decision.asinProductIds,
      brandProductIds: decision.brandProductIds,
    },
  }
}

export async function createOfferFromAffiliateProduct(params: {
  userId: number
  productId: number
  targetCountry?: string
  createdVia?: 'single' | 'batch'
}): Promise<{ product: AffiliateProduct; offerId: number; taskId: string }> {
  const db = await getDatabase()
  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  if (toBool(product.is_blacklisted)) {
    throw new Error('商品已下线，无法创建Offer')
  }

  const offerUrl = chooseOfferUrl(product)
  if (!offerUrl) {
    throw new Error('该商品缺少可用落地页链接，无法创建Offer')
  }

  const allowedCountries = parseAllowedCountries(product.allowed_countries_json)
  const targetCountry = (params.targetCountry || allowedCountries[0] || 'US').toUpperCase()
  const brand = (product.brand || product.product_name || product.mid || 'Unknown').trim()
  const affiliateLink = await resolveOfferAffiliateLinkForProduct({
    db,
    userId: params.userId,
    product,
    targetCountry,
  })

  const offer = await createOffer(params.userId, {
    url: offerUrl,
    brand,
    target_country: targetCountry,
    affiliate_link: affiliateLink || undefined,
    product_price: formatPriceForOffer(product),
    commission_payout: formatCommissionForOffer(product),
    page_type: 'product',
  })

  try {
    await recordAffiliateProductOfferLink({
      userId: params.userId,
      productId: product.id,
      offerId: offer.id,
      createdVia: params.createdVia || 'single',
    })

    const { taskId: extractionTaskId } = await enqueueExistingOfferExtractionAndMarkQueued({
      offer,
      userId: params.userId,
      offerId: offer.id,
      priority: params.createdVia === 'single' ? 'high' : 'normal',
      skipCache: false,
      skipWarmup: false,
    })

    return {
      product,
      offerId: offer.id,
      taskId: extractionTaskId,
    }
  } catch (error) {
    await db.exec(
      `DELETE FROM affiliate_product_offer_links WHERE user_id = ? AND product_id = ? AND offer_id = ?`,
      [params.userId, product.id, offer.id]
    )
    await db.exec(`DELETE FROM offers WHERE id = ? AND user_id = ?`, [offer.id, params.userId])

    throw error
  }
}

export async function batchCreateOffersFromAffiliateProducts(params: {
  userId: number
  items: Array<{ productId: number; targetCountry?: string }>
}): Promise<{
  total: number
  successCount: number
  failureCount: number
  results: Array<{
    productId: number
    success: boolean
    offerId?: number
    taskId?: string
    error?: string
  }>
}> {
  const results: Array<{
    productId: number
    success: boolean
    offerId?: number
    taskId?: string
    error?: string
  }> = []
  let successCount = 0
  let failureCount = 0

  for (const item of params.items) {
    try {
      const result = await createOfferFromAffiliateProduct({
        userId: params.userId,
        productId: item.productId,
        targetCountry: item.targetCountry,
        createdVia: 'batch',
      })
      successCount += 1
      results.push({
        productId: item.productId,
        success: true,
        offerId: result.offerId,
        taskId: result.taskId,
      })
    } catch (error: any) {
      failureCount += 1
      results.push({
        productId: item.productId,
        success: false,
        error: error?.message || '创建Offer失败',
      })
    }
  }

  return {
    total: params.items.length,
    successCount,
    failureCount,
    results,
  }
}
