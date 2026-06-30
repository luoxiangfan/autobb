/**
 * Manual Sitelink target sync for a url-swap task (Google Ads backfill + affiliate reconcile).
 */
import {
  getUrlSwapSitelinkTargets,
  reconcileUrlSwapSitelinkAffiliateLinks,
  syncStoreSitelinkTargetsForOffer,
} from '@/lib/url-swap'
import type { UrlSwapSitelinkTarget } from './url-swap-types'
import type { SyncStoreSitelinkTargetsForOfferResult } from './sync-store-sitelink-targets'

export interface RunUrlSwapSitelinkTargetsSyncParams {
  taskId: string
  offerId: number
  userId: number
}

export interface RunUrlSwapSitelinkTargetsSyncResult {
  success: boolean
  sitelink_targets: UrlSwapSitelinkTarget[]
  sitelink_sync: SyncStoreSitelinkTargetsForOfferResult
  message: string
}

export async function runUrlSwapSitelinkTargetsSync(
  params: RunUrlSwapSitelinkTargetsSyncParams
): Promise<RunUrlSwapSitelinkTargetsSyncResult> {
  const syncResult = await syncStoreSitelinkTargetsForOffer(params.offerId, params.userId, {
    force: true,
  })
  let sitelink_targets = await getUrlSwapSitelinkTargets(params.taskId, params.userId)

  if (sitelink_targets.length > 0) {
    const reconciled = await reconcileUrlSwapSitelinkAffiliateLinks({
      taskId: params.taskId,
      offerId: params.offerId,
      userId: params.userId,
      // backfill 已从 Google Ads 拉取最新 URL，避免重复远端查询拖长请求
      refreshFromGoogleAds: false,
    })
    sitelink_targets = reconciled.targets
  }

  const success = sitelink_targets.length > 0 || syncResult.upserted > 0
  const message = success
    ? `已同步 ${sitelink_targets.length} 条 Sitelink 映射`
    : syncResult.errors[0] || '未能同步 Sitelink 映射，请确认远端 Campaign 已有 Sitelink'

  return {
    success,
    sitelink_targets,
    sitelink_sync: syncResult,
    message,
  }
}

export async function executeUrlSwapSitelinkTargetsSyncJob(
  params: RunUrlSwapSitelinkTargetsSyncParams
): Promise<void> {
  const { completeUrlSwapSitelinkSync, failUrlSwapSitelinkSync } =
    await import('./sitelink-sync-async-state')

  try {
    const result = await runUrlSwapSitelinkTargetsSync(params)
    await completeUrlSwapSitelinkSync(params.taskId, params.userId, result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[url-swap] Sitelink 同步后台任务失败: task=${params.taskId}, error=${message}`)
    await failUrlSwapSitelinkSync(params.taskId, params.userId, message)
  }
}
