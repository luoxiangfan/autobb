/**
 * Refresh url_swap_sitelink_targets.current_final_url from Google Ads Sitelink assets.
 */
import { logger } from '@/lib/common/server'
import { getDatabase } from '@/lib/db'
import { splitUrlBaseAndSuffix } from '@/lib/creatives/sitelink-utils'
import { fetchCampaignSitelinkAssetsForUrlSwap } from './backfill-sitelink-targets'
import { resolveCampaignTargetsForSitelinkBackfill } from './url-swap-targets'
import { getUrlSwapSitelinkTargets } from './url-swap-sitelink-targets'

export interface RefreshUrlSwapSitelinkTargetsFromGoogleAdsResult {
  refreshed: number
  errors: string[]
}

export async function refreshUrlSwapSitelinkTargetsFromGoogleAds(params: {
  taskId: string
  userId: number
}): Promise<RefreshUrlSwapSitelinkTargetsFromGoogleAdsResult> {
  const result: RefreshUrlSwapSitelinkTargetsFromGoogleAdsResult = {
    refreshed: 0,
    errors: [],
  }

  const targets = await getUrlSwapSitelinkTargets(params.taskId, params.userId)
  if (targets.length === 0) return result

  const targetsByAsset = new Map(
    targets.map((target) => [target.asset_resource_name, target] as const)
  )

  const campaignTargets = await resolveCampaignTargetsForSitelinkBackfill(
    params.taskId,
    params.userId
  )
  if (campaignTargets.length === 0) {
    result.errors.push('无法解析 Campaign 目标，跳过远端 Sitelink URL 刷新')
    return result
  }

  const db = await getDatabase()
  const now = new Date().toISOString()

  for (const campaignTarget of campaignTargets) {
    try {
      const remoteAssets = await fetchCampaignSitelinkAssetsForUrlSwap({
        userId: params.userId,
        googleAdsAccountId: campaignTarget.google_ads_account_id,
        googleCustomerId: campaignTarget.google_customer_id,
        googleCampaignId: campaignTarget.google_campaign_id,
      })

      for (const asset of remoteAssets) {
        const existing = targetsByAsset.get(asset.assetResourceName)
        if (!existing) continue

        const split = splitUrlBaseAndSuffix(asset.finalUrl)
        const explicitSuffix = asset.finalUrlSuffix?.trim()
        const nextFinalUrl = split.base
        const nextSuffix = explicitSuffix || split.suffix || null

        const finalUrlChanged = (existing.current_final_url ?? '') !== nextFinalUrl
        const suffixChanged = (existing.current_final_url_suffix ?? null) !== nextSuffix
        const textChanged = existing.link_text !== asset.linkText
        if (!finalUrlChanged && !suffixChanged && !textChanged) continue

        await db.exec(
          `
          UPDATE url_swap_sitelink_targets
          SET current_final_url = ?,
              current_final_url_suffix = ?,
              link_text = ?,
              updated_at = ?
          WHERE id = ?
        `,
          [nextFinalUrl, nextSuffix, asset.linkText, now, existing.id]
        )

        existing.current_final_url = nextFinalUrl
        existing.current_final_url_suffix = nextSuffix
        existing.link_text = asset.linkText
        existing.updated_at = now
        result.refreshed++
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(
        `campaign=${campaignTarget.google_campaign_id}: 刷新 Sitelink URL 失败: ${message}`
      )
    }
  }

  if (result.refreshed > 0) {
    logger.debug(
      `[url-swap] 已从 Google Ads 刷新 Sitelink URL: task=${params.taskId}, count=${result.refreshed}`
    )
  }

  return result
}
