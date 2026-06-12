import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { getUserOnlySetting } from '@/lib/settings'
import type { AffiliatePlatform, AffiliateProductSyncProgress } from './types'
import type { NormalizedAffiliateProduct } from './types'
import {
  DEFAULT_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS,
  DEFAULT_PB_ACTIVE_DAYS,
  DEFAULT_PB_DELTA_ASIN_BATCH_SIZE,
  DEFAULT_UPSERT_BATCH_SIZE_POSTGRES,
  DEFAULT_YP_ACTIVE_DAYS,
  DEFAULT_YP_DELTA_MAX_PAGES,
  MAX_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS,
  MAX_PB_ACTIVE_DAYS,
  MAX_PB_DELTA_ASIN_BATCH_SIZE,
  MAX_YP_ACTIVE_DAYS,
  MAX_YP_SYNC_MAX_PAGES,
  MIN_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS,
  type YeahPromosMarketplaceTemplate,
} from './constants'
import {
  buildYeahPromosDeltaScopePlan,
  normalizeAsin,
  normalizeCountries,
  parseAllowedCountries,
  parseIntegerInRange,
} from './parsing'
import {
  fetchPartnerboostPromotableProducts,
  fetchYeahPromosPromotableProducts,
  loadYeahPromosMarketplaceTemplates,
} from './platform-fetch'

export function dedupeNormalizedProducts(
  items: NormalizedAffiliateProduct[]
): NormalizedAffiliateProduct[] {
  const deduped = new Map<string, NormalizedAffiliateProduct>()
  for (const item of items) {
    if (!item.mid) continue
    const key = `${item.platform}:${item.mid}`
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, {
        ...item,
        allowedCountries: normalizeCountries(item.allowedCountries),
      })
      continue
    }

    const mergedAllowedCountries = normalizeCountries([
      ...existing.allowedCountries,
      ...item.allowedCountries,
    ])

    const merged: NormalizedAffiliateProduct = {
      ...existing,
      merchantId: existing.merchantId || item.merchantId || null,
      asin: existing.asin || item.asin,
      brand: existing.brand || item.brand,
      productName: existing.productName || item.productName,
      productUrl: existing.productUrl || item.productUrl,
      promoLink: existing.promoLink || item.promoLink,
      shortPromoLink: existing.shortPromoLink || item.shortPromoLink,
      allowedCountries: mergedAllowedCountries,
      priceAmount: existing.priceAmount ?? item.priceAmount,
      priceCurrency: existing.priceCurrency || item.priceCurrency,
      commissionRate: existing.commissionRate ?? item.commissionRate,
      commissionAmount: existing.commissionAmount ?? item.commissionAmount,
      commissionRateMode: existing.commissionRateMode || item.commissionRateMode,
      reviewCount: existing.reviewCount ?? item.reviewCount,
      isDeepLink: existing.isDeepLink ?? item.isDeepLink,
      isConfirmedInvalid: existing.isConfirmedInvalid || item.isConfirmedInvalid,
    }

    deduped.set(key, merged)
  }
  return Array.from(deduped.values())
}

export async function loadExistingMidSet(
  userId: number,
  platform: AffiliatePlatform,
  mids: string[]
): Promise<Set<string>> {
  if (mids.length === 0) return new Set<string>()
  const db = await getDatabase()
  const existing = new Set<string>()
  const dedupedMids = Array.from(
    new Set(mids.map((mid) => String(mid || '').trim()).filter(Boolean))
  )
  if (dedupedMids.length === 0) return existing

  // 避免 PostgreSQL 参数上限（65534）导致大批量同步失败。
  const batchSize = 10000
  for (let index = 0; index < dedupedMids.length; index += batchSize) {
    const batch = dedupedMids.slice(index, index + batchSize)
    if (batch.length === 0) continue

    const placeholders = batch.map(() => '?').join(', ')
    const rows = await db.query<{ mid: string }>(
      `
        SELECT mid
        FROM affiliate_products
        WHERE user_id = ?
          AND platform = ?
          AND mid IN (${placeholders})
      `,
      [userId, platform, ...batch]
    )

    for (const row of rows) {
      if (row?.mid) {
        existing.add(row.mid)
      }
    }
  }

  return existing
}

export async function getPartnerboostDeltaSyncSettings(userId: number): Promise<{
  asinBatchSize: number
  activeDays: number
}> {
  const [asinBatchSetting, activeDaysSetting] = await Promise.all([
    getUserOnlySetting('system', 'affiliate_pb_delta_asin_batch_size', userId),
    getUserOnlySetting('system', 'affiliate_pb_active_days', userId),
  ])

  const asinBatchSize = parseIntegerInRange(
    asinBatchSetting?.value || String(DEFAULT_PB_DELTA_ASIN_BATCH_SIZE),
    DEFAULT_PB_DELTA_ASIN_BATCH_SIZE,
    10,
    MAX_PB_DELTA_ASIN_BATCH_SIZE
  )
  const activeDays = parseIntegerInRange(
    activeDaysSetting?.value || String(DEFAULT_PB_ACTIVE_DAYS),
    DEFAULT_PB_ACTIVE_DAYS,
    1,
    MAX_PB_ACTIVE_DAYS
  )

  return {
    asinBatchSize,
    activeDays,
  }
}

export async function listActivePartnerboostAsins(
  userId: number,
  activeDays: number
): Promise<string[]> {
  const db = await getDatabase()
  const recentDays = Math.max(1, activeDays)
  const isBlacklistedCondition = 'p.is_blacklisted = FALSE'
  const recentUpdatedCondition = `p.updated_at >= CURRENT_TIMESTAMP - INTERVAL '${recentDays} days'`
  const recentReportDateCondition = `report_date >= CURRENT_DATE - INTERVAL '${Math.max(0, recentDays - 1)} days'`

  const rows = await db.query<{ asin: string | null }>(
    `
      SELECT DISTINCT p.asin
      FROM affiliate_products p
      WHERE p.user_id = ?
        AND p.platform = 'partnerboost'
        AND ${isBlacklistedCondition}
        AND p.asin IS NOT NULL
        AND TRIM(p.asin) <> ''
        AND (
          EXISTS (
            SELECT 1
            FROM affiliate_product_offer_links l
            WHERE l.user_id = p.user_id
              AND l.product_id = p.id
            LIMIT 1
          )
          OR ${recentUpdatedCondition}
        )
      ORDER BY p.asin
    `,
    [userId]
  )

  const recentOrderRows = await db.query<{ asin: string | null }>(
    `
      SELECT DISTINCT source_asin AS asin
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND platform = 'partnerboost'
        AND source_asin IS NOT NULL
        AND TRIM(source_asin) <> ''
        AND ${recentReportDateCondition}
      UNION
      SELECT DISTINCT source_asin AS asin
      FROM openclaw_affiliate_attribution_failures
      WHERE user_id = ?
        AND platform = 'partnerboost'
        AND source_asin IS NOT NULL
        AND TRIM(source_asin) <> ''
        AND ${recentReportDateCondition}
    `,
    [userId, userId]
  )

  const asins: string[] = []
  const seen = new Set<string>()
  for (const row of [...rows, ...recentOrderRows]) {
    const asin = normalizeAsin(row.asin)
    if (!asin || seen.has(asin)) continue
    seen.add(asin)
    asins.push(asin)
  }
  return asins
}

export async function fetchPartnerboostDeltaProducts(params: {
  userId: number
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const settings = await getPartnerboostDeltaSyncSettings(params.userId)
  const asins = await listActivePartnerboostAsins(params.userId, settings.activeDays)
  if (asins.length === 0) {
    if (params.onFetchProgress) {
      await params.onFetchProgress(0)
    }
    return []
  }

  const normalizedItems: NormalizedAffiliateProduct[] = []
  const batchSize = Math.max(10, settings.asinBatchSize)

  for (let index = 0; index < asins.length; index += batchSize) {
    const batch = asins.slice(index, index + batchSize)
    const batchItems = await fetchPartnerboostPromotableProducts({
      userId: params.userId,
      asins: batch,
      maxPages: 1,
      onFetchProgress: async (fetchedCount: number) => {
        if (!params.onFetchProgress) return
        await params.onFetchProgress(normalizedItems.length + fetchedCount)
      },
    })
    normalizedItems.push(...batchItems)

    if (params.onFetchProgress) {
      await params.onFetchProgress(normalizedItems.length)
    }
  }

  return normalizedItems
}

export async function getYeahPromosDeltaSyncSettings(userId: number): Promise<{
  activeDays: number
  maxPages: number
}> {
  const [activeDaysSetting, maxPagesSetting] = await Promise.all([
    getUserOnlySetting('system', 'affiliate_yp_active_days', userId),
    getUserOnlySetting('system', 'affiliate_yp_delta_max_pages', userId),
  ])
  const activeDays = parseIntegerInRange(
    activeDaysSetting?.value || String(DEFAULT_YP_ACTIVE_DAYS),
    DEFAULT_YP_ACTIVE_DAYS,
    1,
    MAX_YP_ACTIVE_DAYS
  )
  const maxPages = parseIntegerInRange(
    maxPagesSetting?.value || String(DEFAULT_YP_DELTA_MAX_PAGES),
    DEFAULT_YP_DELTA_MAX_PAGES,
    1,
    MAX_YP_SYNC_MAX_PAGES
  )

  return {
    activeDays,
    maxPages,
  }
}

export async function listActiveYeahPromosScopes(params: {
  userId: number
  activeDays: number
  templates: YeahPromosMarketplaceTemplate[]
}): Promise<string[]> {
  if (params.templates.length === 0) return []

  const db = await getDatabase()
  const recentDays = Math.max(1, params.activeDays)
  const isBlacklistedCondition = 'p.is_blacklisted = FALSE'
  const recentSeenCondition = `COALESCE(p.last_seen_at, p.last_synced_at, p.updated_at) >= CURRENT_TIMESTAMP - INTERVAL '${recentDays} days'`

  const rows = await db.query<{
    allowed_countries_json: string | null
    product_count: number | string | null
    latest_activity_at: string | null
  }>(
    `
      SELECT
        p.allowed_countries_json,
        COUNT(*) AS product_count,
        MAX(COALESCE(p.last_seen_at, p.last_synced_at, p.updated_at)) AS latest_activity_at
      FROM affiliate_products p
      WHERE p.user_id = ?
        AND p.platform = 'yeahpromos'
        AND ${isBlacklistedCondition}
        AND (
          EXISTS (
            SELECT 1
            FROM affiliate_product_offer_links l
            WHERE l.user_id = p.user_id
              AND l.product_id = p.id
            LIMIT 1
          )
          OR ${recentSeenCondition}
        )
      GROUP BY p.allowed_countries_json
    `,
    [params.userId]
  )

  const scopesByCountry = new Map<string, string[]>()
  const templateOrder = new Map<string, number>()
  for (const [index, template] of params.templates.entries()) {
    templateOrder.set(template.scope, index)
    const countryScopes = scopesByCountry.get(template.country) || []
    countryScopes.push(template.scope)
    scopesByCountry.set(template.country, countryScopes)
  }

  const scores = new Map<string, { score: number; latestActivityAtMs: number }>()
  for (const row of rows) {
    const countries = parseAllowedCountries(row.allowed_countries_json)
    const rowScore = Math.max(1, Number(row.product_count || 0))
    const latestActivityAtMs = Date.parse(String(row.latest_activity_at || '')) || 0

    for (const country of countries) {
      const matchedScopes = scopesByCountry.get(country)
      if (!matchedScopes?.length) continue
      for (const scope of matchedScopes) {
        const current = scores.get(scope) || { score: 0, latestActivityAtMs: 0 }
        current.score += rowScore
        current.latestActivityAtMs = Math.max(current.latestActivityAtMs, latestActivityAtMs)
        scores.set(scope, current)
      }
    }
  }

  return Array.from(scores.entries())
    .sort((left, right) => {
      if (right[1].score !== left[1].score) {
        return right[1].score - left[1].score
      }
      if (right[1].latestActivityAtMs !== left[1].latestActivityAtMs) {
        return right[1].latestActivityAtMs - left[1].latestActivityAtMs
      }
      return (templateOrder.get(left[0]) || 0) - (templateOrder.get(right[0]) || 0)
    })
    .map(([scope]) => scope)
}

export async function fetchYeahPromosDeltaProducts(params: {
  userId: number
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const settings = await getYeahPromosDeltaSyncSettings(params.userId)
  const templates = await loadYeahPromosMarketplaceTemplates({ userId: params.userId })
  const activeScopes = await listActiveYeahPromosScopes({
    userId: params.userId,
    activeDays: settings.activeDays,
    templates,
  })
  const deltaPlan = buildYeahPromosDeltaScopePlan({
    templates,
    activeScopes,
    maxPages: settings.maxPages,
  })

  if (deltaPlan.templates.length === 0) {
    if (params.onFetchProgress) {
      await params.onFetchProgress(0)
    }
    return []
  }

  return await fetchYeahPromosPromotableProducts({
    userId: params.userId,
    maxPages: settings.maxPages,
    templatesOverride: deltaPlan.templates,
    scopePageBudgets: deltaPlan.scopePageBudgets,
    fetchStores: false,
    refreshAccessProductsBaseline: false,
    onFetchProgress: params.onFetchProgress,
  })
}

export function getAffiliateProductsUpsertBatchSize(): number {
  return DEFAULT_UPSERT_BATCH_SIZE_POSTGRES
}

export function resolveAffiliateProductsUpsertStatementTimeoutMs(): number {
  return parseIntegerInRange(
    process.env.AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS ||
      String(DEFAULT_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS),
    DEFAULT_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS,
    MIN_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS,
    MAX_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS
  )
}

export function isPostgresStatementTimeoutError(error: unknown): boolean {
  const code = String((error as any)?.code || '')
    .trim()
    .toUpperCase()
  if (code === '57014') return true
  const message = String((error as any)?.message || '').toLowerCase()
  return message.includes('statement timeout')
}

export async function runAffiliateProductsPostgresUpsertWithTimeout(params: {
  db: DatabaseAdapter
  operation: () => Promise<void>
}): Promise<void> {
  const statementTimeoutMs = resolveAffiliateProductsUpsertStatementTimeoutMs()
  await params.db.transaction(async () => {
    await params.db.exec(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`)
    await params.operation()
  })
}

export function buildAffiliateProductsUpsertValues(params: {
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): any[] {
  const values: any[] = []
  for (const item of params.items) {
    values.push(
      params.userId,
      params.platform,
      item.mid,
      item.merchantId || null,
      item.asin,
      item.brand,
      item.productName,
      item.productUrl,
      item.promoLink,
      item.shortPromoLink,
      JSON.stringify(item.allowedCountries || []),
      item.priceAmount,
      item.priceCurrency,
      item.commissionRate,
      item.commissionAmount,
      item.commissionRateMode,
      item.reviewCount,
      item.isDeepLink,
      item.isConfirmedInvalid,
      params.nowIso,
      params.nowIso,
      params.nowIso
    )
  }
  return values
}

export function buildAffiliateProductsBusinessChangedSql(params: {
  existingAlias: string
  incomingAlias: string
}): string {
  const comparator = 'IS DISTINCT FROM'

  const fields: Array<[string, string]> = [
    ['merchant_id', 'merchant_id'],
    ['asin', 'asin'],
    ['brand', 'brand'],
    ['product_name', 'product_name'],
    ['product_url', 'product_url'],
    ['promo_link', 'promo_link'],
    ['short_promo_link', 'short_promo_link'],
    ['allowed_countries_json', 'allowed_countries_json'],
    ['price_amount', 'price_amount'],
    ['price_currency', 'price_currency'],
    ['commission_rate', 'commission_rate'],
    ['commission_amount', 'commission_amount'],
    ['commission_rate_mode', 'commission_rate_mode'],
    ['review_count', 'review_count'],
    ['is_deeplink', 'is_deeplink'],
    ['is_confirmed_invalid', 'is_confirmed_invalid'],
  ]

  return fields
    .map(
      ([existingColumn, incomingColumn]) =>
        `${params.existingAlias}.${existingColumn} ${comparator} ${params.incomingAlias}.${incomingColumn}`
    )
    .join('\n          OR ')
}

export async function upsertAffiliateProductsChunkPostgresTwoPhase(params: {
  db: DatabaseAdapter
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): Promise<void> {
  if (params.items.length === 0) return

  const perRowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  const placeholders = new Array(params.items.length).fill(perRowPlaceholder).join(', ')
  const incomingColumns = `
    user_id,
    platform,
    mid,
    merchant_id,
    asin,
    brand,
    product_name,
    product_url,
    promo_link,
    short_promo_link,
    allowed_countries_json,
    price_amount,
    price_currency,
    commission_rate,
    commission_amount,
    commission_rate_mode,
    review_count,
    is_deeplink,
    is_confirmed_invalid,
    last_synced_at,
    last_seen_at,
    updated_at
  `
  const typedIncomingProjection = `
    v.user_id::integer AS user_id,
    v.platform::text AS platform,
    v.mid::text AS mid,
    v.merchant_id::text AS merchant_id,
    v.asin::text AS asin,
    v.brand::text AS brand,
    v.product_name::text AS product_name,
    v.product_url::text AS product_url,
    v.promo_link::text AS promo_link,
    v.short_promo_link::text AS short_promo_link,
    v.allowed_countries_json::text AS allowed_countries_json,
    v.price_amount::double precision AS price_amount,
    v.price_currency::text AS price_currency,
    v.commission_rate::double precision AS commission_rate,
    v.commission_amount::double precision AS commission_amount,
    v.commission_rate_mode::text AS commission_rate_mode,
    v.review_count::integer AS review_count,
    v.is_deeplink::boolean AS is_deeplink,
    v.is_confirmed_invalid::boolean AS is_confirmed_invalid,
    v.last_synced_at::timestamp AS last_synced_at,
    v.last_seen_at::timestamp AS last_seen_at,
    v.updated_at::timestamp AS updated_at
  `
  const incomingCte = `
    WITH incoming AS (
      SELECT
        ${typedIncomingProjection}
      FROM (VALUES ${placeholders}) AS v (${incomingColumns})
    )
  `
  const values = buildAffiliateProductsUpsertValues(params)
  const businessChangedSql = buildAffiliateProductsBusinessChangedSql({
    existingAlias: 'p',
    incomingAlias: 'incoming',
  })
  const conflictBusinessChangedSql = buildAffiliateProductsBusinessChangedSql({
    existingAlias: 'affiliate_products',
    incomingAlias: 'EXCLUDED',
  })

  await runAffiliateProductsPostgresUpsertWithTimeout({
    db: params.db,
    operation: async () => {
      await params.db.exec(
        `
        ${incomingCte}
        UPDATE affiliate_products p
        SET
          merchant_id = incoming.merchant_id,
          asin = incoming.asin,
          brand = incoming.brand,
          product_name = incoming.product_name,
          product_url = incoming.product_url,
          promo_link = incoming.promo_link,
          short_promo_link = incoming.short_promo_link,
          allowed_countries_json = incoming.allowed_countries_json,
          price_amount = COALESCE(incoming.price_amount, p.price_amount),
          price_currency = COALESCE(incoming.price_currency, p.price_currency),
          commission_rate = incoming.commission_rate,
          commission_amount = incoming.commission_amount,
          commission_rate_mode = incoming.commission_rate_mode,
          review_count = incoming.review_count,
          is_deeplink = incoming.is_deeplink,
          is_confirmed_invalid = incoming.is_confirmed_invalid,
          last_synced_at = incoming.last_synced_at,
          last_seen_at = incoming.last_seen_at,
          updated_at = incoming.updated_at
        FROM incoming
        WHERE p.user_id = incoming.user_id
          AND p.platform = incoming.platform
          AND p.mid = incoming.mid
          AND (
            ${businessChangedSql}
          )
      `,
        values
      )

      await params.db.exec(
        `
        ${incomingCte}
        UPDATE affiliate_products p
        SET
          last_synced_at = incoming.last_synced_at,
          last_seen_at = incoming.last_seen_at
        FROM incoming
        WHERE p.user_id = incoming.user_id
          AND p.platform = incoming.platform
          AND p.mid = incoming.mid
          AND NOT (
            ${businessChangedSql}
          )
          AND (
            p.last_synced_at IS DISTINCT FROM incoming.last_synced_at
            OR p.last_seen_at IS DISTINCT FROM incoming.last_seen_at
          )
      `,
        values
      )

      await params.db.exec(
        `
        ${incomingCte}
        INSERT INTO affiliate_products (
          user_id,
          platform,
          mid,
          merchant_id,
          asin,
          brand,
          product_name,
          product_url,
          promo_link,
          short_promo_link,
          allowed_countries_json,
          price_amount,
          price_currency,
          commission_rate,
          commission_amount,
          commission_rate_mode,
          review_count,
          is_deeplink,
          is_confirmed_invalid,
          last_synced_at,
          last_seen_at,
          updated_at
        )
        SELECT
          incoming.user_id,
          incoming.platform,
          incoming.mid,
          incoming.merchant_id,
          incoming.asin,
          incoming.brand,
          incoming.product_name,
          incoming.product_url,
          incoming.promo_link,
          incoming.short_promo_link,
          incoming.allowed_countries_json,
          incoming.price_amount,
          incoming.price_currency,
          incoming.commission_rate,
          incoming.commission_amount,
          incoming.commission_rate_mode,
          incoming.review_count,
          incoming.is_deeplink,
          incoming.is_confirmed_invalid,
          incoming.last_synced_at,
          incoming.last_seen_at,
          incoming.updated_at
        FROM incoming
        LEFT JOIN affiliate_products p
          ON p.user_id = incoming.user_id
          AND p.platform = incoming.platform
          AND p.mid = incoming.mid
        WHERE p.id IS NULL
        ON CONFLICT (user_id, platform, mid) DO UPDATE SET
          merchant_id = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.merchant_id
            ELSE affiliate_products.merchant_id
          END,
          asin = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.asin
            ELSE affiliate_products.asin
          END,
          brand = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.brand
            ELSE affiliate_products.brand
          END,
          product_name = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.product_name
            ELSE affiliate_products.product_name
          END,
          product_url = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.product_url
            ELSE affiliate_products.product_url
          END,
          promo_link = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.promo_link
            ELSE affiliate_products.promo_link
          END,
          short_promo_link = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.short_promo_link
            ELSE affiliate_products.short_promo_link
          END,
          allowed_countries_json = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.allowed_countries_json
            ELSE affiliate_products.allowed_countries_json
          END,
          price_amount = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN COALESCE(EXCLUDED.price_amount, affiliate_products.price_amount)
            ELSE affiliate_products.price_amount
          END,
          price_currency = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN COALESCE(EXCLUDED.price_currency, affiliate_products.price_currency)
            ELSE affiliate_products.price_currency
          END,
          commission_rate = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.commission_rate
            ELSE affiliate_products.commission_rate
          END,
          commission_amount = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.commission_amount
            ELSE affiliate_products.commission_amount
          END,
          commission_rate_mode = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.commission_rate_mode
            ELSE affiliate_products.commission_rate_mode
          END,
          review_count = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.review_count
            ELSE affiliate_products.review_count
          END,
          is_deeplink = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.is_deeplink
            ELSE affiliate_products.is_deeplink
          END,
          is_confirmed_invalid = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.is_confirmed_invalid
            ELSE affiliate_products.is_confirmed_invalid
          END,
          last_synced_at = EXCLUDED.last_synced_at,
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = CASE
            WHEN (
              ${conflictBusinessChangedSql}
            ) THEN EXCLUDED.updated_at
            ELSE affiliate_products.updated_at
          END
        WHERE (
          ${conflictBusinessChangedSql}
        )
          OR affiliate_products.last_synced_at IS DISTINCT FROM EXCLUDED.last_synced_at
          OR affiliate_products.last_seen_at IS DISTINCT FROM EXCLUDED.last_seen_at
      `,
        values
      )
    },
  })
}

export async function upsertAffiliateProductsChunk(params: {
  db: DatabaseAdapter
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): Promise<void> {
  await upsertAffiliateProductsChunkPostgresTwoPhase(params)
}

type UpsertAffiliateProductsBatchStats = {
  createdCount: number
  updatedCount: number
  processedCount: number
}

export async function upsertAffiliateProductsBatchWithAdaptiveRetry(params: {
  db: DatabaseAdapter
  userId: number
  platform: AffiliatePlatform
  batch: NormalizedAffiliateProduct[]
  nowIso: string
  recursionDepth?: number
}): Promise<UpsertAffiliateProductsBatchStats> {
  const recursionDepth = Number(params.recursionDepth || 0)
  const batch = params.batch
  if (batch.length === 0) {
    return {
      createdCount: 0,
      updatedCount: 0,
      processedCount: 0,
    }
  }

  try {
    const existingMidSet = await loadExistingMidSet(
      params.userId,
      params.platform,
      batch.map((item) => item.mid)
    )

    let createdCount = 0
    let updatedCount = 0
    for (const item of batch) {
      if (existingMidSet.has(item.mid)) {
        updatedCount += 1
      } else {
        createdCount += 1
      }
    }

    await upsertAffiliateProductsChunk({
      db: params.db,
      userId: params.userId,
      platform: params.platform,
      items: batch,
      nowIso: params.nowIso,
    })

    return {
      createdCount,
      updatedCount,
      processedCount: batch.length,
    }
  } catch (error: any) {
    const canSplitAndRetry = isPostgresStatementTimeoutError(error) && batch.length > 1
    if (!canSplitAndRetry) {
      throw error
    }

    const leftSize = Math.max(1, Math.floor(batch.length / 2))
    const rightSize = batch.length - leftSize
    console.warn(
      `[affiliate-products] PostgreSQL upsert timed out for user=${params.userId}, platform=${params.platform}, batch=${batch.length}; split retry ${leftSize}+${rightSize} (depth=${recursionDepth})`
    )

    const leftBatch = batch.slice(0, leftSize)
    const rightBatch = batch.slice(leftSize)
    const leftResult = await upsertAffiliateProductsBatchWithAdaptiveRetry({
      ...params,
      batch: leftBatch,
      recursionDepth: recursionDepth + 1,
    })
    const rightResult = await upsertAffiliateProductsBatchWithAdaptiveRetry({
      ...params,
      batch: rightBatch,
      recursionDepth: recursionDepth + 1,
    })

    return {
      createdCount: leftResult.createdCount + rightResult.createdCount,
      updatedCount: leftResult.updatedCount + rightResult.updatedCount,
      processedCount: leftResult.processedCount + rightResult.processedCount,
    }
  }
}

export async function upsertAffiliateProducts(
  userId: number,
  platform: AffiliatePlatform,
  items: NormalizedAffiliateProduct[],
  options?: {
    progressEvery?: number
    onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  }
): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
}> {
  const db = await getDatabase()
  const deduped = dedupeNormalizedProducts(items)
  const totalFetched = deduped.length

  const emitProgress = async (progress: AffiliateProductSyncProgress): Promise<void> => {
    if (!options?.onProgress) return
    try {
      await options.onProgress(progress)
    } catch (error: any) {
      console.warn('[affiliate-products] onProgress callback failed:', error?.message || error)
    }
  }

  if (deduped.length === 0) {
    await emitProgress({
      totalFetched: 0,
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      failedCount: 0,
    })
    return {
      totalFetched: 0,
      createdCount: 0,
      updatedCount: 0,
    }
  }

  let createdCount = 0
  let updatedCount = 0
  let processedCount = 0
  let lastEmittedProcessed = 0
  const nowIso = new Date().toISOString()
  const progressEvery = Math.max(1, Math.floor(Number(options?.progressEvery || 20)))
  const upsertBatchSize = Math.max(1, getAffiliateProductsUpsertBatchSize())

  await emitProgress({
    totalFetched,
    processedCount,
    createdCount,
    updatedCount,
    failedCount: 0,
  })

  for (let index = 0; index < deduped.length; index += upsertBatchSize) {
    const batch = deduped.slice(index, index + upsertBatchSize)
    const batchStats = await upsertAffiliateProductsBatchWithAdaptiveRetry({
      db,
      userId,
      platform,
      nowIso,
      batch,
    })

    createdCount += batchStats.createdCount
    updatedCount += batchStats.updatedCount
    processedCount += batchStats.processedCount
    if (processedCount - lastEmittedProcessed >= progressEvery || processedCount === totalFetched) {
      lastEmittedProcessed = processedCount
      await emitProgress({
        totalFetched,
        processedCount,
        createdCount,
        updatedCount,
        failedCount: 0,
      })
    }
  }

  return {
    totalFetched,
    createdCount,
    updatedCount,
  }
}
