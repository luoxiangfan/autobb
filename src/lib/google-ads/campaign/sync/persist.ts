import { getDatabase, utcNowIso, parseJsonField } from '../../../db'
import { toDbCampaignConfigTextField } from '../../../campaign/server'
import { getInsertedId } from '../../../db'
import { extractAsinFromOfferUrls } from '@/lib/openclaw/offers/offer-asin'
import { firstNonEmptyFinalUrlFromCampaignConfig } from '@/lib/google-ads/campaign/final-url'
import { offerOccupyingCampaignWhereClause } from '../../../campaign/server'
import type { GoogleAdsCampaign } from './types'
import { extractBrandFromGoogleAdsCampaignName } from './types'
import { inferPageTypeFromUrls } from '@/lib/offers/offer-link-type'
import {
  extractStoreProductLinksFromCampaignConfig,
  parseOfferStoreProductLinksColumn,
  serializeStoreProductLinks,
  storeProductLinksEqual,
} from './store-product-links'

import { googleAdsSyncLogger } from '../../common/logger'

/** Array fields in campaign_config that Google Ads sync may backfill when empty. */
const SYNC_BACKFILL_ARRAY_FIELDS = [
  'callouts',
  'sitelinks',
  'keywords',
  'negativeKeywords',
  'headlines',
  'descriptions',
  'finalUrls',
] as const

function isEmptyArrayField(value: unknown): boolean {
  return value == null || (Array.isArray(value) && value.length === 0)
}

/** Backfill empty array fields in existing config from Google Ads sync payload. */
export function mergeEmptyCampaignConfigArraysFromSync(
  existing: Record<string, unknown>,
  synced: Record<string, unknown>
): { merged: Record<string, unknown>; changed: boolean; backfilledFields: string[] } {
  const merged = { ...existing }
  const backfilledFields: string[] = []

  for (const field of SYNC_BACKFILL_ARRAY_FIELDS) {
    if (!isEmptyArrayField(existing[field])) {
      continue
    }
    const syncedValue = synced[field]
    if (Array.isArray(syncedValue) && syncedValue.length > 0) {
      merged[field] = syncedValue
      backfilledFields.push(field)
    }
  }

  return { merged, changed: backfilledFields.length > 0, backfilledFields }
}

export async function saveCampaignToDatabase(params: {
  userId: number
  googleAdsAccountId: number
  campaign: GoogleAdsCampaign
  offerId?: number // 🆕 可选的 offer_id
  adGroupId?: number | null // 🆕 可选的 ad_group_id
  adId?: number | null // 🆕 可选的 ad_id
}): Promise<string> {
  const { userId, googleAdsAccountId, campaign, offerId, adGroupId, adId } = params
  const db = await getDatabase()

  // 检查是否已存在
  const existing = await db.queryOne(
    'SELECT campaign_id FROM campaigns WHERE campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )

  if (existing) {
    googleAdsSyncLogger.info('sync_log', {
      message: String(
        `[GoogleAds Sync] Updating Campaign ${campaign.campaign_id} for User ${userId}`
      ),
    })
    // 更新现有广告系列
    await db.exec(
      `UPDATE campaigns SET
        max_cpc = ?,
        campaign_name = ?,
        budget_amount = ?,
        budget_type = ?,
        status = ?,
        google_ads_account_id = ?,
        updated_at = ?,
        google_ad_group_id = ?,
        google_ad_id = ?
      WHERE campaign_id = ?`,
      [
        campaign.cpc_bid_ceiling_micros || null, // 🆕 可选的 max_cpc 字段
        campaign.campaign_name,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.status,
        googleAdsAccountId,
        new Date(),
        `${adGroupId}` || null, // 🆕 可选的 ad_group_id 字段
        `${adGroupId}~${adId}` || null, // 🆕 可选的 ad_id 字段
        existing.campaign_id,
      ]
    )
    googleAdsSyncLogger.info('sync_log', {
      message: String(
        `[GoogleAds Sync] Updated Campaign ${campaign.campaign_id} for User ${userId}`
      ),
    })
    return existing.campaign_id
  }

  if (offerId) {
    const occupyingWhere = offerOccupyingCampaignWhereClause()
    const existingForOffer = (await db.queryOne(
      `SELECT id, campaign_id FROM campaigns WHERE ${occupyingWhere} ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [offerId, userId]
    )) as { id: number; campaign_id: string | null } | undefined

    if (existingForOffer) {
      googleAdsSyncLogger.info('sync_log', {
        message: String(
          `[GoogleAds Sync] Offer ${offerId} 已有 Campaign ${existingForOffer.id}，更新 Google 关联而非新建`
        ),
      })
      await db.exec(
        `UPDATE campaigns SET
          campaign_id = ?,
          campaign_name = ?,
          budget_amount = ?,
          budget_type = ?,
          status = ?,
          google_ads_account_id = ?,
          max_cpc = ?,
          google_campaign_id = ?,
          google_ad_group_id = ?,
          google_ad_id = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ?`,
        [
          campaign.campaign_id,
          campaign.campaign_name,
          campaign.budget_amount,
          campaign.budget_type,
          campaign.status,
          googleAdsAccountId,
          campaign.cpc_bid_ceiling_micros || null,
          campaign.campaign_id,
          adGroupId != null ? String(adGroupId) : null,
          adGroupId != null && adId != null ? `${adGroupId}~${adId}` : null,
          new Date(),
          existingForOffer.id,
          userId,
        ]
      )
      return campaign.campaign_id
    }
  }

  googleAdsSyncLogger.info('sync_log', {
    message: String(
      `[GoogleAds Sync] Creating Campaign ${campaign.campaign_id} for User ${userId}`
    ),
  })
  const campaignName = campaign.campaign_name
  const googleAdGroupId = adGroupId != null ? String(adGroupId) : null
  const googleAdId = adGroupId != null && adId != null ? `${adGroupId}~${adId}` : null
  await db.exec(
    `INSERT INTO campaigns (
        user_id,
        google_ads_account_id,
        campaign_id,
        campaign_name,
        budget_amount,
        budget_type,
        status,
        creation_status,
        synced_from_google_ads,
        offer_id,
        needs_offer_completion,
        max_cpc,
        google_campaign_id,
        google_ad_group_id,
        google_ad_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ${'TRUE'}, ?, ${'TRUE'}, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      googleAdsAccountId,
      campaign.campaign_id,
      campaignName,
      campaign.budget_amount,
      campaign.budget_type,
      campaign.status,
      offerId || null, // 🆕 如果提供了 offerId，则关联
      campaign.cpc_bid_ceiling_micros || null, // 🆕 可选的 max_cpc 字段
      campaign.campaign_id, // google_campaign_id
      googleAdGroupId,
      googleAdId,
      new Date(),
      new Date(),
    ]
  )
  googleAdsSyncLogger.info('sync_log', {
    message: String(`[GoogleAds Sync] Created Campaign ${campaign.campaign_id} for User ${userId}`),
  })
  return campaign.campaign_id
}

export async function createOfferFirst(params: {
  userId: number
  campaign: GoogleAdsCampaign
  campaignConfig?: GoogleAdsCampaign['campaign_config']
}): Promise<{ offerId: number; created: boolean; offerFieldsUpdated: boolean }> {
  const { userId, campaign, campaignConfig } = params
  const db = await getDatabase()
  const finalUrl = firstNonEmptyFinalUrlFromCampaignConfig(campaignConfig)
  const finalUrlSuffix =
    typeof campaignConfig?.finalUrlSuffix === 'string' ? campaignConfig.finalUrlSuffix.trim() : ''
  const url = finalUrl
  const isNullOrEmpty = (value: unknown): boolean =>
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

  const campaignNameTrimmed = campaign.campaign_name.trim()
  const derivedBrand = extractBrandFromGoogleAdsCampaignName(campaign.campaign_name)
  /** 仅当解析结果与完整 campaign_name 不同，视为提取成功（否则不碰已有 offer 的 brand） */
  const brandExtractSucceeded = derivedBrand !== campaignNameTrimmed

  // 1. 检查是否已存在关联的 Offer（通过 google_ads_campaign_id）
  const pageType = inferPageTypeFromUrls({ url, finalUrl })
  const syncedStoreProductLinks = extractStoreProductLinksFromCampaignConfig(campaignConfig)

  const existingOffer = (await db.queryOne(
    'SELECT id, sync_source, url, final_url, final_url_suffix, brand, page_type, store_product_links FROM offers WHERE google_ads_campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )) as
    | {
        id: number
        sync_source?: string | null
        url?: string | null
        final_url?: string | null
        final_url_suffix?: string | null
        brand?: string | null
        page_type?: string | null
        store_product_links?: string | null
      }
    | undefined

  if (existingOffer) {
    let offerFieldsUpdated = false
    if (existingOffer.sync_source === 'google_ads_sync') {
      const updates: string[] = []
      const updateParams: unknown[] = []

      if (isNullOrEmpty(existingOffer.url) && url) {
        updates.push('url = ?')
        updateParams.push(url)
      }

      if (isNullOrEmpty(existingOffer.final_url) && finalUrl) {
        updates.push('final_url = ?')
        updateParams.push(finalUrl)
      }

      if (isNullOrEmpty(existingOffer.final_url_suffix) && finalUrlSuffix) {
        updates.push('final_url_suffix = ?')
        updateParams.push(finalUrlSuffix)
      }

      const nextUrl = updates.some((entry) => entry.startsWith('url ='))
        ? url
        : (existingOffer.url ?? null)
      const nextFinalUrl = updates.some((entry) => entry.startsWith('final_url ='))
        ? finalUrl
        : (existingOffer.final_url ?? null)
      if (updates.some((entry) => entry.startsWith('url =') || entry.startsWith('final_url ='))) {
        updates.push('asin = ?')
        updateParams.push(extractAsinFromOfferUrls(nextUrl, nextFinalUrl))
      }

      const existingBrand =
        typeof existingOffer.brand === 'string' ? existingOffer.brand.trim() : ''
      const brandStillRawCampaignStyle =
        existingBrand === campaignNameTrimmed ||
        (existingBrand !== '' &&
          extractBrandFromGoogleAdsCampaignName(existingBrand) !== existingBrand)

      if (
        brandExtractSucceeded &&
        derivedBrand !== existingBrand &&
        (brandStillRawCampaignStyle || !existingBrand)
      ) {
        updates.push('brand = ?')
        updateParams.push(derivedBrand)
      }

      const existingPageType =
        typeof existingOffer.page_type === 'string' ? existingOffer.page_type.trim() : ''
      const inferredPageType = inferPageTypeFromUrls({ url: nextUrl, finalUrl: nextFinalUrl })
      const shouldSetPageType =
        !existingPageType ||
        inferredPageType !== existingPageType ||
        updates.some((entry) => entry.startsWith('url =') || entry.startsWith('final_url ='))
      if (shouldSetPageType && inferredPageType !== existingPageType) {
        updates.push('page_type = ?')
        updateParams.push(inferredPageType)
      }

      const effectivePageType =
        shouldSetPageType && inferredPageType !== existingPageType
          ? inferredPageType
          : existingPageType || inferredPageType

      if (effectivePageType === 'store' && syncedStoreProductLinks.length > 0) {
        const existingLinks = parseOfferStoreProductLinksColumn(existingOffer.store_product_links)
        if (!storeProductLinksEqual(existingLinks, syncedStoreProductLinks)) {
          updates.push('store_product_links = ?')
          updateParams.push(serializeStoreProductLinks(syncedStoreProductLinks))
        }
      } else if (
        shouldSetPageType &&
        inferredPageType === 'product' &&
        existingPageType === 'store'
      ) {
        updates.push('store_product_links = ?')
        updateParams.push(null)
      }

      if (updates.length > 0) {
        const updatedAt = utcNowIso()
        await db.exec(
          `UPDATE offers SET ${updates.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`,
          [...updateParams, updatedAt, existingOffer.id, userId]
        )
        offerFieldsUpdated = true
        googleAdsSyncLogger.info('offer_updated', {
          offerId: existingOffer.id,
          fields: updates.join(', '),
          updatedAt,
        })
      }
    }

    googleAdsSyncLogger.info('sync_log', {
      message: String(
        `[GoogleAds Sync] Found existing offer ${existingOffer.id} for campaign ${campaign.campaign_id}`
      ),
    })
    return { offerId: existingOffer.id, created: false, offerFieldsUpdated }
  }

  // 2. 创建新 Offer
  googleAdsSyncLogger.info('sync_log', {
    message: String(`[GoogleAds Sync] Creating new offer for campaign ${campaign.campaign_id}`),
  })

  // 生成唯一的 offer_name
  const offerName = campaign.campaign_name
  const now = utcNowIso()

  const storeProductLinksForInsert =
    pageType === 'store' && syncedStoreProductLinks.length > 0
      ? serializeStoreProductLinks(syncedStoreProductLinks)
      : null

  const result = await db.exec(
    `INSERT INTO offers (
      user_id,
      url,
      final_url,
      final_url_suffix,
      asin,
      brand,
      target_country,
      target_language,
      offer_name,
      google_ads_campaign_id,
      sync_source,
      needs_completion,
      scrape_status,
      is_active,
      page_type,
      store_product_links,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      url,
      finalUrl,
      finalUrlSuffix,
      extractAsinFromOfferUrls(url, finalUrl),
      derivedBrand,
      'US', // 默认国家，需要用户完善
      'English', // 默认语言
      offerName,
      campaign.campaign_id,
      'google_ads_sync',
      'TRUE', // 新创建的 Offer 标记为需要完善
      'pending',
      'TRUE',
      pageType,
      storeProductLinksForInsert,
      now,
      now,
    ]
  )

  const offerId = getInsertedId(result)
  googleAdsSyncLogger.info('sync_log', {
    message: String(
      `[GoogleAds Sync] Created offer ${offerId} for campaign ${campaign.campaign_id}`
    ),
  })

  return { offerId, created: true, offerFieldsUpdated: false }
}

export async function updateCampaignConfig(
  campaignId: string,
  campaignConfig: any,
  adGroupId: number | null,
  adId: number | null
): Promise<{ updated: boolean; savedConfig?: Record<string, unknown> }> {
  const db = await getDatabase()

  const campaign = (await db.queryOne(
    `
    SELECT id, synced_from_google_ads, campaign_config, ad_creative_id
    FROM campaigns
    WHERE campaign_id = ?
  `,
    [campaignId]
  )) as
    | {
        id: number
        synced_from_google_ads: number | boolean
        campaign_config: string | null
        ad_creative_id: number | null
      }
    | undefined

  if (!campaign) {
    googleAdsSyncLogger.info('sync_log', {
      message: String(`[Campaign Config] Campaign ${campaignId} not found, skipping config update`),
    })
    return { updated: false }
  }

  const hasAdCreative = campaign.ad_creative_id != null
  let configToSave: Record<string, unknown> =
    campaignConfig && typeof campaignConfig === 'object'
      ? (campaignConfig as Record<string, unknown>)
      : {}

  if (hasAdCreative) {
    const existingConfig = parseJsonField<Record<string, unknown>>(campaign.campaign_config, {})
    const syncedConfig = configToSave
    const { merged, changed, backfilledFields } = mergeEmptyCampaignConfigArraysFromSync(
      existingConfig,
      syncedConfig
    )

    if (!changed) {
      googleAdsSyncLogger.info('sync_log', {
        message: String(
          `[Campaign Config] Campaign ${campaignId} has ad_creative_id and no empty array fields to backfill, skipping config update`
        ),
      })
      return { updated: false }
    }

    configToSave = merged
    googleAdsSyncLogger.info('sync_log', {
      message: String(
        `[Campaign Config] Campaign ${campaignId} has ad_creative_id; backfilling empty array fields: ${backfilledFields.join(', ')}`
      ),
      backfilledFields,
    })

    await db.exec(
      `
      UPDATE campaigns
      SET campaign_config = ?,
          updated_at = ?
      WHERE campaign_id = ?
    `,
      [toDbCampaignConfigTextField(configToSave), new Date(), campaignId]
    )

    googleAdsSyncLogger.info('sync_log', {
      message: String(`[Campaign Config] Partially updated for campaign ${campaignId}`),
    })
    return { updated: true, savedConfig: configToSave }
  }

  await db.exec(
    `
    UPDATE campaigns
    SET campaign_config = ?,
        updated_at = ?,
        google_ad_group_id = ?,
        google_ad_id = ?
    WHERE campaign_id = ?
  `,
    [
      toDbCampaignConfigTextField(configToSave),
      new Date(),
      `${adGroupId}` || null,
      `${adGroupId}~${adId}` || null,
      campaignId,
    ]
  )

  googleAdsSyncLogger.info('sync_log', {
    message: String(`[Campaign Config] Updated for campaign ${campaignId}`),
  })
  return { updated: true, savedConfig: configToSave }
}
