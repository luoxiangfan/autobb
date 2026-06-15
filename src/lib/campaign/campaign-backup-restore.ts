/**
 * 从 campaign_backups 恢复并发布广告系列的共享逻辑
 */

import { getDatabase, type DatabaseAdapter } from '../db'
import { getInsertedId } from '../db'
import {
  backupHasCampaignConfig,
  toDbCampaignBackupJsonField,
  toDbCampaignConfigTextField,
  type CampaignBackup,
} from './campaign-backups'
import { generateNamingScheme } from './naming-convention'
import { buildEffectiveCreative } from './publish/effective-creative'
import { resolveTaskCampaignKeywords } from './publish/task-keyword-fallback'
import { regenerateAdCreative } from '../creatives'
import {
  abandonStalePendingCampaignsForOffers,
  CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE,
  getActiveCampaignConflictsForOffers,
  isCampaignOfferUniqueViolation,
  type ActiveCampaignConflict,
} from './campaign-offer-constraint'

export const BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE =
  '该备份对应的 Offer 已有广告系列，无法再从备份创建'

export type BatchDbCreateDetail = {
  backupId: number
  offerId: number
  campaignId?: number
  error?: string
}

export type BatchPublishDetail = {
  backupId: number
  offerId: number
  campaignId?: number
  error?: string
  warning?: string
  regeneratedCreative?: boolean
  newAdCreativeId?: number | null
}

function parseJsonField<T>(value: unknown): T | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

export type BatchCreateBackupValidationResult = { ok: true } | { ok: false; error: string }

/**
 * 批量从备份恢复前的服务端校验
 */
export async function validateCampaignBackupsForBatchCreate(
  backupIds: number[],
  userId: number,
  googleAdsAccountId: number
): Promise<BatchCreateBackupValidationResult> {
  const db = await getDatabase()

  const accountCheck = await validateGoogleAdsAccountForRestore(db, googleAdsAccountId, userId)
  if (!accountCheck.ok) {
    return { ok: false, error: accountCheck.message }
  }

  const placeholders = backupIds.map(() => '?').join(',')
  const rows = (await db.query(
    `
    SELECT id, offer_id, campaign_name, campaign_config
    FROM campaign_backups
    WHERE id IN (${placeholders}) AND user_id = ?
  `,
    [...backupIds, userId]
  )) as Array<{
    id: number
    offer_id: number
    campaign_name: string
    campaign_config: unknown
  }>

  if (rows.length !== backupIds.length) {
    const found = new Set(rows.map((r) => r.id))
    const missing = backupIds.filter((id) => !found.has(id))
    return {
      ok: false,
      error: `以下备份不存在或无权访问：${missing.join(', ')}`,
    }
  }

  const offerToBackupIds = new Map<number, number[]>()
  for (const row of rows) {
    const list = offerToBackupIds.get(row.offer_id) ?? []
    list.push(row.id)
    offerToBackupIds.set(row.offer_id, list)
  }

  const duplicateOffers = [...offerToBackupIds.entries()].filter(([, ids]) => ids.length > 1)
  if (duplicateOffers.length > 0) {
    const detail = duplicateOffers
      .map(([offerId, ids]) => `Offer ${offerId}（备份 ${ids.join(', ')}）`)
      .join('；')
    return {
      ok: false,
      error: `同一 Offer 不能选择多条备份：${detail}`,
    }
  }

  const missingConfig = rows.filter((row) => !backupHasCampaignConfig(row.campaign_config))
  if (missingConfig.length > 0) {
    const names = missingConfig
      .map((row) => `${row.campaign_name || '备份'} (#${row.id})`)
      .join('、')
    return {
      ok: false,
      error: `以下备份缺少可用的广告系列配置（campaign_config）：${names}`,
    }
  }

  const uniqueOfferIds = [...new Set(rows.map((row) => row.offer_id))]
  await abandonStalePendingCampaignsForOffers(uniqueOfferIds, userId)
  const conflictsByOffer = await getActiveCampaignConflictsForOffers(uniqueOfferIds, userId)

  const blockedByCampaign: Array<{
    offerId: number
    backupIds: number[]
    conflict: ActiveCampaignConflict
  }> = []
  for (const [offerId, conflict] of conflictsByOffer) {
    blockedByCampaign.push({
      offerId,
      backupIds: offerToBackupIds.get(offerId) ?? [],
      conflict,
    })
  }

  if (blockedByCampaign.length > 0) {
    const detail = blockedByCampaign
      .map(
        ({ offerId, backupIds, conflict }) =>
          `Offer ${offerId}（备份 ${backupIds.join(', ')}，已有广告系列 #${conflict.id}「${conflict.campaign_name}」）`
      )
      .join('；')
    return {
      ok: false,
      error: `${BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE}：${detail}`,
    }
  }

  return { ok: true }
}

export async function validateGoogleAdsAccountForRestore(
  db: DatabaseAdapter,
  googleAdsAccountId: number,
  userId: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const adsAccount = (await db.queryOne(
    `
    SELECT is_active, is_deleted
    FROM google_ads_accounts
    WHERE id = ? AND user_id = ?
  `,
    [googleAdsAccountId, userId]
  )) as { is_active: boolean | number; is_deleted: boolean | number } | undefined

  if (!adsAccount) {
    return { ok: false, message: 'Google Ads 账号不存在或无权访问' }
  }

  const isActive = adsAccount.is_active === true || adsAccount.is_active === 1
  const isDeleted = adsAccount.is_deleted === true || adsAccount.is_deleted === 1

  if (!isActive || isDeleted) {
    return { ok: false, message: 'Google Ads 账号已禁用或删除' }
  }

  return { ok: true }
}

/**
 * 在数据库中从单条备份创建 campaigns 行
 */
export async function createCampaignRowFromBackup(params: {
  backup: CampaignBackup
  userId: number
  googleAdsAccountId?: number | null
  db: DatabaseAdapter
  /** 调用方已批量做过 abandon + 占用检查时跳过（如 batch-create 执行器） */
  skipOccupancyPrecheck?: boolean
}): Promise<BatchDbCreateDetail> {
  const { backup, userId, googleAdsAccountId, db, skipOccupancyPrecheck = false } = params
  const backupId = backup.id
  const offerId = backup.offerId

  try {
    if (!skipOccupancyPrecheck) {
      await abandonStalePendingCampaignsForOffers([offerId], userId)
      const existingCampaign =
        (await getActiveCampaignConflictsForOffers([offerId], userId)).get(offerId) ?? null

      if (existingCampaign) {
        return {
          backupId,
          offerId,
          error: BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE,
        }
      }
    }

    const campaignData = backup.campaignData
    const campaignConfig = backup.campaignConfig
    const campaignName =
      campaignConfig?.campaignName ||
      campaignData?.campaign_name ||
      backup.campaignName ||
      'Campaign'
    const resolvedGoogleAdsAccountId =
      googleAdsAccountId ?? backup.googleAdsAccountId ?? campaignData?.google_ads_account_id ?? null
    const adCreativeId =
      backup.adCreativeId ?? campaignData?.ad_creative_id ?? campaignConfig?.adCreativeId ?? null

    const result = await db.exec(
      `
      INSERT INTO campaigns (
        user_id, offer_id, google_ads_account_id,
        campaign_id, campaign_name, custom_name,
        budget_amount, budget_type,
        target_cpa, max_cpc,
        ad_creative_id,
        campaign_config,
        status, creation_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        userId,
        offerId,
        resolvedGoogleAdsAccountId,
        null,
        campaignName,
        backup.customName,
        campaignData?.budget_amount ?? backup.budgetAmount,
        campaignData?.budget_type ?? backup.budgetType,
        campaignData?.target_cpa ?? backup.targetCpa,
        campaignData?.max_cpc ?? backup.maxCpc,
        adCreativeId,
        toDbCampaignConfigTextField(campaignConfig),
        'PAUSED',
        'pending',
        new Date(),
        new Date(),
      ]
    )

    const campaignId = getInsertedId(result)
    return { backupId, offerId, campaignId }
  } catch (error: any) {
    return {
      backupId,
      offerId,
      error: isCampaignOfferUniqueViolation(error)
        ? CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE
        : error.message,
    }
  }
}

/**
 * 将单条备份对应的 campaign 发布任务入队
 */
export async function enqueueCampaignPublishFromBackup(params: {
  backup: CampaignBackup
  campaignId: number
  userId: number
  googleAdsAccountId: number
  db: DatabaseAdapter
  regenerateCreative?: boolean
  parentRequestId?: string
}): Promise<BatchPublishDetail> {
  const {
    backup,
    campaignId,
    userId,
    googleAdsAccountId,
    db,
    regenerateCreative = false,
    parentRequestId,
  } = params
  const backupId = backup.id
  const offerId = backup.offerId

  try {
    let finalCampaignConfig = backup.campaignConfig
    if (!finalCampaignConfig) {
      return {
        backupId,
        offerId,
        campaignId,
        error: '备份中没有广告系列配置',
      }
    }

    let regeneratedCreative = false
    let newAdCreativeId: number | null = null
    let warning: string | undefined

    if (regenerateCreative) {
      const regenerateResult = await regenerateAdCreative({
        userId,
        offerId,
        previousAdCreativeId: finalCampaignConfig.adCreativeId || backup.adCreativeId || 0,
        campaignConfigForTask: finalCampaignConfig,
      })
      if (regenerateResult.success && regenerateResult.campaignConfig) {
        finalCampaignConfig = regenerateResult.campaignConfig
        regeneratedCreative = true
        newAdCreativeId = regenerateResult.adCreativeId || null
      } else {
        warning = `创意重新生成失败，已使用原备份配置${regenerateResult.error ? `：${regenerateResult.error}` : ''}`
        console.warn(`[Backup Restore] 备份 ${backupId} ${warning}`)
      }

      if (regeneratedCreative) {
        const configSerialized = toDbCampaignBackupJsonField(finalCampaignConfig)
        const configText = toDbCampaignConfigTextField(finalCampaignConfig)
        const nowIso = new Date().toISOString()

        if (newAdCreativeId) {
          await db.exec(
            `
            UPDATE campaign_backups
            SET ad_creative_id = ?,
                campaign_config = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?
          `,
            [newAdCreativeId, configSerialized, nowIso, backupId, userId]
          )
          await db.exec(
            `
            UPDATE campaigns
            SET ad_creative_id = ?,
                campaign_config = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?
          `,
            [newAdCreativeId, configText, new Date(), campaignId, userId]
          )
        } else {
          await db.exec(
            `
            UPDATE campaign_backups
            SET campaign_config = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `,
            [configSerialized, nowIso, backupId, userId]
          )
          await db.exec(
            `
            UPDATE campaigns
            SET campaign_config = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `,
            [configText, new Date(), campaignId, userId]
          )
        }
      }
    }

    const offer = (await db.queryOne(
      `
      SELECT id, url, brand, category, offer_name
      FROM offers
      WHERE id = ? AND user_id = ?
    `,
      [offerId, userId]
    )) as
      | {
          id: number
          url: string
          brand: string
          category: string | null
          offer_name: string | null
        }
      | undefined

    if (!offer) {
      return { backupId, offerId, campaignId, error: 'Offer 不存在或无权访问' }
    }

    const naming = generateNamingScheme({
      offer: {
        id: offerId,
        brand: offer.brand,
        offerName: offer.offer_name || undefined,
        category: offer.category || undefined,
      },
      config: {
        targetCountry: finalCampaignConfig.targetCountry,
        budgetAmount: finalCampaignConfig.budgetAmount,
        budgetType: finalCampaignConfig.budgetType || 'DAILY',
        biddingStrategy: finalCampaignConfig.biddingStrategy || 'MAXIMIZE_CLICKS',
        maxCpcBid: finalCampaignConfig.maxCpcBid,
      },
      creative: undefined,
      smartOptimization: undefined,
    })

    const effectiveCreativeForTask = buildEffectiveCreative({
      dbCreative: {
        headlines: finalCampaignConfig.headlines,
        descriptions: finalCampaignConfig.descriptions,
        keywords: finalCampaignConfig.keywords,
        negativeKeywords: finalCampaignConfig.negativeKeywords,
        callouts: finalCampaignConfig.callouts,
        sitelinks: finalCampaignConfig.sitelinks,
        finalUrl: finalCampaignConfig.finalUrl,
        finalUrlSuffix: finalCampaignConfig.finalUrlSuffix,
      },
      campaignConfig: finalCampaignConfig,
      offerUrlFallback: offer.url,
    })

    const taskKeywordConfig = resolveTaskCampaignKeywords({
      configuredKeywords: finalCampaignConfig.keywords,
      configuredNegativeKeywords: finalCampaignConfig.negativeKeywords,
      fallbackKeywords: effectiveCreativeForTask.keywords,
      fallbackNegativeKeywords: effectiveCreativeForTask.negativeKeywords,
    })

    const keywordsWithVolume = parseJsonField<unknown>(finalCampaignConfig.keywords_with_volume)

    const { getOrCreateQueueManager } = await import('@/lib/queue/init-queue')
    const queue = await getOrCreateQueueManager()

    await queue.enqueue(
      'campaign-publish',
      {
        campaignId,
        offerId,
        googleAdsAccountId,
        userId,
        sourceBackupId: backupId,
        naming,
        marketingObjective: finalCampaignConfig.marketingObjective || 'WEB_TRAFFIC',
        campaignConfig: {
          targetCountry: finalCampaignConfig.targetCountry,
          targetLanguage: finalCampaignConfig.targetLanguage,
          biddingStrategy: finalCampaignConfig.biddingStrategy,
          budgetAmount: finalCampaignConfig.budgetAmount,
          budgetType: finalCampaignConfig.budgetType,
          maxCpcBid: finalCampaignConfig.maxCpcBid,
          keywords: taskKeywordConfig.keywords,
          negativeKeywords: taskKeywordConfig.negativeKeywords,
          negativeKeywordMatchType:
            finalCampaignConfig.negativeKeywordMatchType ||
            finalCampaignConfig.negativeKeywordsMatchType ||
            undefined,
        },
        creative: {
          headlines: effectiveCreativeForTask.headlines,
          descriptions: effectiveCreativeForTask.descriptions,
          finalUrl: effectiveCreativeForTask.finalUrl,
          finalUrlSuffix: effectiveCreativeForTask.finalUrlSuffix,
          path1: finalCampaignConfig.path1,
          path2: finalCampaignConfig.path2,
          callouts: effectiveCreativeForTask.callouts,
          sitelinks: effectiveCreativeForTask.sitelinks,
          keywordsWithVolume: keywordsWithVolume ?? undefined,
        },
        brandName: offer.brand,
        forcePublish: true,
        enableCampaignImmediately: false,
        pauseOldCampaigns: false,
      },
      userId,
      {
        parentRequestId,
        priority: 'high',
      }
    )

    return {
      backupId,
      offerId,
      campaignId,
      regeneratedCreative,
      newAdCreativeId,
      warning,
    }
  } catch (error: any) {
    return {
      backupId,
      offerId,
      campaignId,
      error: error?.message || '发布任务入队失败',
    }
  }
}
