/**
 * 从 Google Ads 回填 url_swap_sitelink_targets（存量 Campaign）。
 */
import { logger } from '@/lib/common/server'
import { getDatabase } from '@/lib/db'
import {
  prepareGoogleAdsApiCallForLinkedAccount,
  preparedAuthContextField,
} from '@/lib/google-ads/accounts/auth/index'
import { executeGAQLQueryPython } from '@/lib/campaign/python-ads-client'
import { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'
import { getCustomerWithCredentials } from '@/lib/google-ads/api/customer'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { trackOAuthApiCall } from '@/lib/google-ads/api/shared'
import { splitUrlBaseAndSuffix } from '@/lib/creatives/sitelink-utils'
import {
  getActiveUrlSwapSitelinkTargets,
  loadOfferStoreProductLinksForUrlSwap,
  resolveUrlSwapSitelinkTargetStatusForTaskStatus,
  upsertUrlSwapSitelinkTarget,
} from './url-swap-sitelink-targets'
import { resolveCampaignTargetsForSitelinkBackfill } from './url-swap-targets'
import { getUrlSwapTaskByOfferId } from './url-swap-queries'
import { getOfferById } from './url-swap-offer-lookup'
import { resolveStoreProductLinkFinalUrls } from './resolve-store-product-link-finals'
import { findStoreProductLinkIndexForSitelinkFinalUrl } from './sitelink-affiliate-matching'

export interface BackfillUrlSwapSitelinkTargetsOptions {
  offerId?: number
  userId?: number
  dryRun?: boolean
}

export interface BackfillUrlSwapSitelinkTargetsResult {
  scannedTasks: number
  scannedCampaigns: number
  upsertedMappings: number
  skippedTasks: number
  errors: string[]
}

type RemoteSitelinkAsset = {
  assetResourceName: string
  assetId: string
  linkText: string
  finalUrl: string
  finalUrlSuffix: string | null
}

function parseGaqlRow(row: any): RemoteSitelinkAsset | null {
  const resourceName = row.asset?.resource_name || row.asset?.resourceName
  const assetId = row.asset?.id
  const linkText = row.asset?.sitelink_asset?.link_text || row.asset?.sitelinkAsset?.linkText
  const finalUrls = row.asset?.final_urls || row.asset?.finalUrls
  const finalUrl = Array.isArray(finalUrls) ? finalUrls[0] : null

  if (!resourceName || !assetId || !linkText || !finalUrl) return null

  return {
    assetResourceName: String(resourceName),
    assetId: String(assetId),
    linkText: String(linkText),
    finalUrl: String(finalUrl),
    finalUrlSuffix: row.asset?.final_url_suffix || row.asset?.finalUrlSuffix || null,
  }
}

async function fetchCampaignSitelinkAssets(params: {
  userId: number
  googleAdsAccountId: number
  googleCustomerId: string
  googleCampaignId: string
}): Promise<RemoteSitelinkAsset[]> {
  const db = await getDatabase()
  const account = await db.queryOne<{ service_account_id: string | null }>(
    'SELECT service_account_id FROM google_ads_accounts WHERE id = ? AND user_id = ?',
    [params.googleAdsAccountId, params.userId]
  )
  if (!account) {
    throw new Error(`Google Ads 账号不存在: ${params.googleAdsAccountId}`)
  }

  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
    params.userId,
    account.service_account_id
  )
  if (!prepared.ok) {
    throw new Error(prepared.message)
  }

  const query = `
    SELECT
      campaign.id,
      campaign_asset.field_type,
      campaign_asset.status,
      asset.resource_name,
      asset.id,
      asset.final_urls,
      asset.final_url_suffix,
      asset.sitelink_asset.link_text
    FROM campaign_asset
    WHERE campaign.id = ${params.googleCampaignId}
      AND campaign_asset.field_type = 'SITELINK'
      AND campaign_asset.status != 'REMOVED'
  `

  let rows: any[] = []
  if (prepared.apiAuth.authType === 'service_account') {
    const response = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: prepared.apiAuth.serviceAccountId,
      customerId: params.googleCustomerId,
      query,
    })
    rows = response.results || []
  } else {
    const authContext = preparedAuthContextField(prepared).authContext
    if (!authContext) {
      throw new Error('OAuth 认证上下文缺失，无法查询 Sitelink Asset')
    }
    const customer = await getCustomerWithCredentials(
      oauthGetCustomerParams(
        {
          customerId: params.googleCustomerId,
          refreshToken: prepared.refreshToken,
          userId: params.userId,
          loginCustomerId: prepared.oauthLoginCustomerId ?? prepared.apiAuth.oauthLoginCustomerId,
          credentials: prepared.oauthCredentials,
        },
        authContext
      )
    )
    rows = await trackOAuthApiCall(
      params.userId,
      params.googleCustomerId,
      ApiOperationType.REPORT,
      '/gaql/campaign-sitelink-assets',
      () => customer.query(query)
    )
  }

  return rows.map(parseGaqlRow).filter((row): row is RemoteSitelinkAsset => row !== null)
}

export const fetchCampaignSitelinkAssetsForUrlSwap = fetchCampaignSitelinkAssets

export async function backfillUrlSwapSitelinkTargets(
  options: BackfillUrlSwapSitelinkTargetsOptions = {}
): Promise<BackfillUrlSwapSitelinkTargetsResult> {
  const db = await getDatabase()
  const dryRun = options.dryRun !== false
  const result: BackfillUrlSwapSitelinkTargetsResult = {
    scannedTasks: 0,
    scannedCampaigns: 0,
    upsertedMappings: 0,
    skippedTasks: 0,
    errors: [],
  }

  const params: unknown[] = []
  let where = `
    ust.status != 'completed'
    AND (ust.is_deleted = false OR ust.is_deleted IS NULL)
    AND o.page_type = 'store'
    AND o.store_product_links IS NOT NULL
    AND TRIM(o.store_product_links) != ''
    AND TRIM(o.store_product_links) != '[]'
  `
  if (options.offerId) {
    where += ' AND ust.offer_id = ?'
    params.push(options.offerId)
  }
  if (options.userId) {
    where += ' AND ust.user_id = ?'
    params.push(options.userId)
  }

  const taskRows = await db.query<{
    task_id: string
    offer_id: number
    user_id: number
  }>(
    `
    SELECT ust.id AS task_id, ust.offer_id, ust.user_id
    FROM url_swap_tasks ust
    INNER JOIN offers o ON o.id = ust.offer_id
    WHERE ${where}
    ORDER BY ust.created_at DESC
  `,
    params
  )

  for (const row of taskRows) {
    result.scannedTasks++

    const existingTargets = await getActiveUrlSwapSitelinkTargets(row.task_id, row.user_id)
    if (existingTargets.length > 0 && !options.offerId) {
      result.skippedTasks++
      continue
    }

    const { storeProductLinks } = await loadOfferStoreProductLinksForUrlSwap(
      row.offer_id,
      row.user_id
    )
    if (storeProductLinks.length === 0) {
      result.skippedTasks++
      continue
    }

    const offer = await getOfferById(row.offer_id)
    if (!offer?.target_country) {
      result.errors.push(`task=${row.task_id}: Offer 缺少 target_country，无法解析单品链接`)
      continue
    }

    const resolvedStoreLinks = await resolveStoreProductLinkFinalUrls({
      storeProductLinks,
      targetCountry: offer.target_country,
      userId: row.user_id,
      offerId: row.offer_id,
    })

    const campaignTargets = await resolveCampaignTargetsForSitelinkBackfill(
      row.task_id,
      row.user_id
    )
    if (campaignTargets.length === 0) {
      result.errors.push(
        `task=${row.task_id}: 无法解析 Campaign 目标（请确认 Campaign 已发布并关联到 Offer）`
      )
      continue
    }

    for (const campaignTarget of campaignTargets) {
      result.scannedCampaigns++
      try {
        const remoteAssets = await fetchCampaignSitelinkAssets({
          userId: row.user_id,
          googleAdsAccountId: campaignTarget.google_ads_account_id,
          googleCustomerId: campaignTarget.google_customer_id,
          googleCampaignId: campaignTarget.google_campaign_id,
        })

        if (remoteAssets.length === 0) {
          result.errors.push(
            `task=${row.task_id}, campaign=${campaignTarget.google_campaign_id}: 远端无 Sitelink Asset`
          )
          continue
        }

        const task = await getUrlSwapTaskByOfferId(row.offer_id, row.user_id)
        if (!task) {
          result.errors.push(`task=${row.task_id}: 换链任务不存在`)
          continue
        }

        const targetStatus = resolveUrlSwapSitelinkTargetStatusForTaskStatus(task.status)
        const matchedSortIndexes = new Set<number>()

        if (dryRun) {
          for (const asset of remoteAssets) {
            const sortIndex = findStoreProductLinkIndexForSitelinkFinalUrl(
              asset.finalUrl,
              resolvedStoreLinks
            )
            if (sortIndex >= 0) {
              matchedSortIndexes.add(sortIndex)
            }
          }
          logger.debug(
            `[dry-run] task=${row.task_id} campaign=${campaignTarget.google_campaign_id} would upsert ${matchedSortIndexes.size} sitelink mapping(s)`
          )
          result.upsertedMappings += matchedSortIndexes.size
          continue
        }

        for (const asset of remoteAssets) {
          const split = splitUrlBaseAndSuffix(asset.finalUrl)
          const explicitSuffix = asset.finalUrlSuffix?.trim()
          const currentFinalUrl = split.base
          const currentFinalUrlSuffix = explicitSuffix || split.suffix || null

          const sortIndex = findStoreProductLinkIndexForSitelinkFinalUrl(
            asset.finalUrl,
            resolvedStoreLinks
          )

          if (sortIndex < 0) {
            const db = await getDatabase()
            const now = new Date().toISOString()
            const refreshed = await db.exec(
              `
              UPDATE url_swap_sitelink_targets
              SET current_final_url = ?,
                  current_final_url_suffix = ?,
                  link_text = ?,
                  updated_at = ?
              WHERE task_id = ?
                AND asset_resource_name = ?
                AND status IN ('active', 'paused', 'invalid')
            `,
              [
                currentFinalUrl,
                currentFinalUrlSuffix,
                asset.linkText,
                now,
                task.id,
                asset.assetResourceName,
              ]
            )
            if (Number((refreshed as { changes?: number })?.changes) > 0) {
              result.upsertedMappings++
            }
            continue
          }

          const affiliateLink = storeProductLinks[sortIndex]?.trim()
          if (!affiliateLink) continue

          await upsertUrlSwapSitelinkTarget({
            taskId: task.id,
            offerId: row.offer_id,
            userId: row.user_id,
            sortIndex,
            affiliateLink,
            googleAdsAccountId: campaignTarget.google_ads_account_id,
            googleCustomerId: campaignTarget.google_customer_id,
            googleCampaignId: campaignTarget.google_campaign_id,
            assetResourceName: asset.assetResourceName,
            assetId: asset.assetId,
            linkText: asset.linkText,
            currentFinalUrl,
            currentFinalUrlSuffix,
            status: targetStatus,
          })
          matchedSortIndexes.add(sortIndex)
          result.upsertedMappings++
        }

        if (matchedSortIndexes.size > 0) {
          const db = await getDatabase()
          const now = new Date().toISOString()
          const maxSortIndex = Math.max(...matchedSortIndexes)
          await db.exec(
            `
            UPDATE url_swap_sitelink_targets
            SET status = 'removed', updated_at = ?
            WHERE task_id = ?
              AND google_campaign_id = ?
              AND status IN ('active', 'paused')
              AND sort_index > ?
          `,
            [now, task.id, campaignTarget.google_campaign_id, maxSortIndex]
          )
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        result.errors.push(
          `task=${row.task_id}, campaign=${campaignTarget.google_campaign_id}: ${message}`
        )
      }
    }
  }

  return result
}
