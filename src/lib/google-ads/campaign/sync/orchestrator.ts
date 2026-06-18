import { getDatabase } from '../../../db'
import {
  autoBackupCampaign,
  findLatestGoogleAdsBackupForOffer,
  hasAutoadsLikeBackupForOffer,
  toDbCampaignBackupJsonField,
} from '../../../campaign/server'
import {
  createGoogleAdsLinkedAccountPrepareCache,
  clearGoogleAdsLinkedAccountPrepareCache,
  prepareGoogleAdsApiCallForLinkedAccountCached,
  resolveSyncAuthForAccount,
  type GoogleAdsLinkedAccountPrepareCache,
} from '@/lib/google-ads/accounts/auth/index'
import { createRiskAlert } from '../../../campaign/optimization'
import type { SyncResult } from './types'
import { fetchCampaignsFromGoogleAds } from './fetch'
import { createOfferFirst, saveCampaignToDatabase, updateCampaignConfig } from './persist'

import { googleAdsSyncLogger } from '../../common/logger'
export async function syncCampaignsFromGoogleAds(
  userId: number,
  options?: {
    customerId?: string // 指定同步特定账户
    dryRun?: boolean // 仅预览，不实际写入数据库
  }
): Promise<SyncResult> {
  const db = await getDatabase()
  const result: SyncResult = {
    syncedCount: 0,
    createdOffersCount: 0,
    updatedOffersCount: 0,
    skippedOffersCount: 0,
    errors: [],
    warnings: [],
  }
  let linkedAccountPrepareCache: GoogleAdsLinkedAccountPrepareCache | undefined

  try {
    googleAdsSyncLogger.info('sync_start', { userId })

    // 🔧 获取该用户的所有活跃 Google Ads 账户（支持 MCC 过滤）
    const isActiveCondition = 'is_active = TRUE'
    const isManagerCondition = 'is_manager_account = FALSE'
    const isDeletedCondition = 'is_deleted = FALSE'

    // 🔧 获取用户分配的 MCC 账号列表
    let mccCustomerIds: string[] = []
    const mccAssignments = (await db.query(
      `
      SELECT mcc_customer_id FROM user_mcc_assignments
      WHERE user_id = ?
    `,
      [userId]
    )) as Array<{ mcc_customer_id: string }>

    if (mccAssignments.length > 0) {
      mccCustomerIds = mccAssignments.map((a) => a.mcc_customer_id)
      googleAdsSyncLogger.info('sync_mcc_assignments', {
        userId,
        mccCount: mccCustomerIds.length,
        mccCustomerIds,
      })
    } else {
      googleAdsSyncLogger.info('sync_skip_no_mcc', { userId })
      result.warnings.push('未分配 MCC，无法同步 Google Ads 广告系列')
      return result
    }

    // 构建 customer_id 过滤条件（仅同步 parent_mcc_id 在用户 MCC 列表内的账户）
    const mccPlaceholders = mccCustomerIds.map(() => '?').join(',')
    const customerIdsFilter = `AND parent_mcc_id IN (${mccPlaceholders})`
    const accountQueryParams: unknown[] = [userId, ...mccCustomerIds]

    const accounts = (await db.query(
      `SELECT id, customer_id, account_name, parent_mcc_id, auth_type, service_account_id FROM google_ads_accounts
       WHERE user_id = ? AND ${isActiveCondition} AND ${isManagerCondition} AND ${isDeletedCondition} AND status = 'ENABLED' AND customer_id IS NOT NULL AND customer_id != '' ${customerIdsFilter}
       ORDER BY id`,
      accountQueryParams
    )) as Array<{
      id: number
      customer_id: string
      account_name: string | null
      parent_mcc_id: string | null
      auth_type: string | null
      service_account_id: string | null
    }>

    if (accounts.length === 0) {
      result.warnings.push('没有活跃的 Google Ads 账户')
      return result
    }

    const linkedAccountPrepareCacheRef = createGoogleAdsLinkedAccountPrepareCache()
    linkedAccountPrepareCache = linkedAccountPrepareCacheRef

    // 3. 对每个账户执行同步
    for (const account of accounts) {
      // 如果指定了 customerId，只同步该账户
      if (options?.customerId && account.customer_id !== options.customerId) {
        continue
      }

      googleAdsSyncLogger.info('sync_account', {
        userId,
        customerId: account.customer_id,
        accountName: account.account_name,
      })

      try {
        const accountPrepared = await prepareGoogleAdsApiCallForLinkedAccountCached(
          userId,
          account.service_account_id,
          linkedAccountPrepareCacheRef
        )
        if (!accountPrepared.ok) {
          result.warnings.push(
            `账户 ${account.customer_id}: ${accountPrepared.message}，已跳过同步`
          )
          continue
        }

        const authContext = accountPrepared.authContext
        const accountApiAuth = accountPrepared.apiAuth
        const {
          syncAuthType,
          syncServiceAccountId,
          syncRefreshToken: resolvedRefreshToken,
        } = resolveSyncAuthForAccount(
          accountApiAuth,
          authContext.oauthCredentials,
          account,
          authContext
        )
        const syncRefreshToken =
          syncAuthType === 'oauth' ? accountPrepared.refreshToken : resolvedRefreshToken
        const oauthApiCredentials = accountPrepared.oauthCredentials
        const oauthLoginCustomerId =
          accountPrepared.oauthLoginCustomerId ?? accountApiAuth.oauthLoginCustomerId

        if (syncAuthType === 'service_account' && !syncServiceAccountId) {
          result.warnings.push(`账户 ${account.customer_id}: 缺少服务账号配置，已跳过同步`)
          continue
        }

        if (syncAuthType === 'oauth' && !syncRefreshToken) {
          result.warnings.push(`账户 ${account.customer_id}: OAuth 缺少 refresh_token，已跳过同步`)
          continue
        }

        // 4. 从 Google Ads API 获取广告系列列表（聚合后的完整数据）
        const campaigns = await fetchCampaignsFromGoogleAds({
          userId,
          customerId: account.customer_id,
          googleAdsAccountId: account.id,
          authType: syncAuthType,
          serviceAccountId: syncServiceAccountId,
          refreshToken: syncRefreshToken,
          parentMccId: account.parent_mcc_id,
          oauthCredentials: oauthApiCredentials,
          oauthLoginCustomerId,
          authContext,
          enableAudit: !options?.dryRun,
        })

        googleAdsSyncLogger.info('sync_campaigns_found', {
          userId,
          customerId: account.customer_id,
          count: campaigns.length,
        })

        // 5. 保存广告系列到数据库并创建关联 Offer
        for (const { campaign, campaign_config, adGroupId, adId } of campaigns) {
          if (options?.dryRun) {
            googleAdsSyncLogger.info('sync_dry_run', {
              campaignId: campaign.campaign_id,
              campaignName: campaign.campaign_name,
            })
            result.syncedCount++
            continue
          }

          try {
            // 🆕 修复：使用事务确保广告系列和 Offer 的原子性
            // 先创建 Offer，再保存广告系列并关联 offer_id
            const offerResult = await createOfferFirst({
              userId,
              campaign,
              campaignConfig: campaign_config,
            })

            // 保存广告系列并关联 offer_id
            const campaignId = await saveCampaignToDatabase({
              userId,
              googleAdsAccountId: account.id,
              campaign,
              offerId: offerResult.offerId,
              adGroupId,
              adId,
            })

            result.syncedCount++
            if (offerResult.created) {
              result.createdOffersCount++
            } else if (offerResult.offerFieldsUpdated) {
              result.updatedOffersCount++
            }

            const offerSyncLabel = offerResult.created
              ? 'created'
              : offerResult.offerFieldsUpdated
                ? 'linked (backfilled url / brand / page_type from Google Ads)'
                : 'linked'
            googleAdsSyncLogger.info('sync_campaign_saved', {
              campaignId: campaign.campaign_id,
              campaignName: campaign.campaign_name,
              offerId: offerResult.offerId,
              offerSyncLabel,
            })

            const hasAutoadsBackup = await hasAutoadsLikeBackupForOffer(offerResult.offerId, userId)

            // 已在 AutoAds 发布并生成备份时，不再创建/更新 Google Ads 备份
            if (!hasAutoadsBackup) {
              try {
                await autoBackupCampaign({
                  userId,
                  offerId: offerResult.offerId,
                  campaignId: campaignId,
                  backupSource: 'google_ads',
                })
                googleAdsSyncLogger.info('sync_auto_backup', { campaignId })
              } catch (error) {
                googleAdsSyncLogger.error('sync_auto_backup_failed', { campaignId }, error)
              }
            } else {
              googleAdsSyncLogger.info('sync_skip_backup', {
                campaignId,
                offerId: offerResult.offerId,
              })
            }

            let shouldSyncComponents = true

            if (hasAutoadsBackup) {
              shouldSyncComponents = false
              googleAdsSyncLogger.info('sync_skip_components', {
                campaignId,
                reason: 'autoads_backup',
              })
            } else {
              const googleBackup = await findLatestGoogleAdsBackupForOffer(
                offerResult.offerId,
                userId
              )
              if (googleBackup && googleBackup.backup_version >= 2) {
                shouldSyncComponents = false
                googleAdsSyncLogger.info('sync_skip_components', {
                  campaignId,
                  reason: 'google_ads_backup_final',
                  backupVersion: googleBackup.backup_version,
                })
              }
            }

            if (shouldSyncComponents) {
              // 🔧 通过 Google Ads API 同步广告组件并保存为 campaign_config
              try {
                if (campaign_config && Object.keys(campaign_config).length > 0) {
                  // 🔧 更新 campaign_config（只更新从 Google 同步的广告系列）
                  const configUpdate = await updateCampaignConfig(
                    campaignId,
                    campaign_config,
                    adGroupId || null,
                    adId || null
                  )

                  if (configUpdate.updated) {
                    const configForBackup = configUpdate.savedConfig ?? campaign_config
                    const googleBackup = await findLatestGoogleAdsBackupForOffer(
                      offerResult.offerId,
                      userId
                    )

                    if (googleBackup) {
                      const dbCheck = await getDatabase()
                      await dbCheck.exec(
                        `
                        UPDATE campaign_backups
                        SET campaign_config = ?, updated_at = ?
                        WHERE id = ? AND user_id = ?
                      `,
                        [
                          toDbCampaignBackupJsonField(configForBackup),
                          new Date(),
                          googleBackup.id,
                          userId,
                        ]
                      )

                      googleAdsSyncLogger.info('sync_backup_config_updated', {
                        backupId: googleBackup.id,
                      })
                    }
                  }
                }
              } catch (error) {
                googleAdsSyncLogger.error('sync_components_failed', { campaignId }, error)
                // API 同步失败不影响主流程，只记录日志
              }
            }
          } catch (error: any) {
            result.errors.push({
              campaignId: campaign.campaign_id,
              campaignName: campaign.campaign_name,
              error: error.message || 'Unknown error',
            })
            googleAdsSyncLogger.error(
              'sync_campaign_failed',
              { campaignId: campaign.campaign_id },
              error
            )
          }
        }
      } catch (error: any) {
        const errorMsg = `同步账户 ${account.customer_id} 失败：${error.message}`
        result.errors.push({
          campaignId: account.customer_id,
          campaignName: account.account_name || 'N/A',
          error: errorMsg,
        })
        googleAdsSyncLogger.error('sync_account_failed', { customerId: account.customer_id }, error)

        // 创建风险预警
        await createRiskAlert(
          userId,
          'google_ads_sync_failed',
          'warning',
          'Google Ads 广告系列同步失败',
          errorMsg,
          {
            resourceType: 'campaign',
            resourceId: account.id,
          }
        )
      }
    }

    googleAdsSyncLogger.info('sync_completed', {
      userId,
      synced: result.syncedCount,
      created: result.createdOffersCount,
      updated: result.updatedOffersCount,
      errors: result.errors.length,
    })
  } catch (error: any) {
    googleAdsSyncLogger.error('sync_fatal', { userId }, error)
    result.errors.push({
      campaignId: 'N/A',
      campaignName: 'N/A',
      error: `同步服务异常：${error.message}`,
    })
  } finally {
    if (linkedAccountPrepareCache) {
      clearGoogleAdsLinkedAccountPrepareCache(linkedAccountPrepareCache)
    }
  }

  return result
}
