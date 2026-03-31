import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { updateGoogleAdsCampaignStatus, getGoogleAdsCredentialsFromDB, getCustomerWithCredentials } from '@/lib/google-ads-api'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { invalidateOfferCache } from '@/lib/api-cache'
import { pauseUrlSwapTargetsByOfferId } from '@/lib/url-swap'
import { removePendingClickFarmQueueTasksByTaskIds } from '@/lib/click-farm/queue-cleanup'
import { removePendingUrlSwapQueueTasksByTaskIds } from '@/lib/url-swap/queue-cleanup'
import { applyCampaignTransition } from '@/lib/campaign-state-machine'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'

type OfflineBody = {
  blacklistOffer?: boolean
  forceLocalOffline?: boolean
  removeGoogleAdsCampaign?: boolean
  pauseClickFarmTasks?: boolean
  pauseUrlSwapTasks?: boolean
  waitRemote?: boolean
}

function normalizeGoogleCampaignId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return /^\d+$/.test(raw) ? raw : null
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const campaignId = Number(params.id)
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: '无效的campaignId' }, { status: 400 })
    }

    const body = (await request.json().catch(() => null)) as OfflineBody | null
    const blacklistOffer = Boolean(body?.blacklistOffer)
    const forceLocalOffline = Boolean(body?.forceLocalOffline)
    const removeGoogleAdsCampaign = Boolean(body?.removeGoogleAdsCampaign)
    const pauseClickFarmTasks = Boolean(body?.pauseClickFarmTasks)
    const pauseUrlSwapTasks = Boolean(body?.pauseUrlSwapTasks)
    const waitRemote = Boolean(body?.waitRemote)

    const db = await getDatabase()

    const campaignRow = await db.queryOne(
      `
        SELECT
          c.id,
          c.campaign_id,
          c.google_campaign_id,
          c.google_ads_account_id,
          c.status,
          c.creation_status,
          c.is_deleted,
          c.offer_id,
          o.brand as offer_brand,
          o.target_country as offer_target_country,
          o.is_deleted as offer_is_deleted,
          gaa.customer_id as customer_id,
          gaa.parent_mcc_id as parent_mcc_id,
          gaa.service_account_id as service_account_id,
          gaa.is_active as ads_account_active,
          gaa.is_deleted as ads_account_deleted,
          gaa.status as ads_account_status
        FROM campaigns c
        LEFT JOIN offers o ON c.offer_id = o.id
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        WHERE c.id = ? AND c.user_id = ?
        LIMIT 1
      `,
      [campaignId, userId]
    ) as
      | {
          id: number
          campaign_id: string | null
          google_campaign_id: string | null
          google_ads_account_id: number | null
          status: string | null
          creation_status: string | null
          is_deleted: any
          offer_id: number | null
          offer_brand: string | null
          offer_target_country: string | null
          offer_is_deleted: any
          customer_id: string | null
          parent_mcc_id: string | null
          service_account_id: string | null
          ads_account_active: any
          ads_account_deleted: any
          ads_account_status: string | null
        }
      | undefined

    if (!campaignRow) {
      return NextResponse.json({ error: '广告系列不存在或无权访问' }, { status: 404 })
    }

    const isDeleted = campaignRow.is_deleted === true || campaignRow.is_deleted === 1
    if (isDeleted || String(campaignRow.status || '').toUpperCase() === 'REMOVED') {
      return NextResponse.json({ error: '该广告系列已下线/删除' }, { status: 400 })
    }

    const offerDeleted = campaignRow.offer_is_deleted === true || campaignRow.offer_is_deleted === 1
    if (offerDeleted) {
      return NextResponse.json({ error: '关联Offer已删除，无法下线' }, { status: 400 })
    }

    const googleCampaignId =
      normalizeGoogleCampaignId(campaignRow.google_campaign_id) ||
      normalizeGoogleCampaignId(campaignRow.campaign_id)

    const creationStatus = String(campaignRow.creation_status || '').toLowerCase()
    const canLocalOfflineWithoutGoogleCampaign =
      creationStatus === 'pending' || creationStatus === 'failed'

    if (!googleCampaignId && !canLocalOfflineWithoutGoogleCampaign) {
      return NextResponse.json({ error: '该广告系列尚未发布到Google Ads，无法下线' }, { status: 400 })
    }

    let skipRemoteUpdates = false
    let skipRemoteReason: string | null = null
    if (!googleCampaignId && canLocalOfflineWithoutGoogleCampaign) {
      skipRemoteUpdates = true
      skipRemoteReason = `发布状态为${creationStatus}，且尚未同步到Google Ads，已执行本地下线`
    }

    if (forceLocalOffline && !skipRemoteUpdates) {
      skipRemoteUpdates = true
      skipRemoteReason = '已选择仅本地下线'
    }

    if (!skipRemoteUpdates) {
      if (!campaignRow.google_ads_account_id) {
        return NextResponse.json({ error: '未找到关联的Ads账号，无法下线' }, { status: 400 })
      }

      const accountIsActive = campaignRow.ads_account_active === true || campaignRow.ads_account_active === 1
      const accountIsDeleted = campaignRow.ads_account_deleted === true || campaignRow.ads_account_deleted === 1
      if (!accountIsActive || accountIsDeleted) {
        return NextResponse.json({ error: '关联的Ads账号不可用（可能已解除关联或停用）' }, { status: 400 })
      }

      const accountStatus = String(campaignRow.ads_account_status || 'UNKNOWN').toUpperCase()
      const isNotUsableStatus = [
        'CANCELED',
        'CANCELLED',
        'CLOSED',
        'SUSPENDED',
        'PAUSED',
        'DISABLED',
      ].includes(accountStatus)

      if (isNotUsableStatus) {
        if (!forceLocalOffline) {
          return NextResponse.json(
            {
              action: 'ACCOUNT_STATUS_NOT_USABLE',
              message: `该 Google Ads 账号状态为 ${accountStatus}，无法执行下线操作。是否仍然仅本地下线该广告系列（不影响同 Offer 下其他广告系列）？`,
              details: { accountStatus },
              canProceedLocal: true,
            },
            { status: 422 }
          )
        }
        skipRemoteUpdates = true
        skipRemoteReason = `账号状态异常（${accountStatus}），已执行本地下线`
      }
    }

    if (!campaignRow.offer_id) {
      return NextResponse.json({ error: '缺少关联Offer，无法下线' }, { status: 400 })
    }

    // 先执行本地标记下线，避免外部接口阻塞
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    await applyCampaignTransition({
      userId,
      campaignId: campaignRow.id,
      action: 'OFFLINE',
    })

    // 清理同一 campaign 的待执行发布任务，避免后续继续发布导致状态回弹
    let campaignPublishPendingRemoved = 0
    try {
      const { getOrCreateQueueManager } = await import('@/lib/queue/init-queue')
      const queueManager = await getOrCreateQueueManager()
      const pendingTasks = await queueManager.getPendingTasks()
      for (const task of pendingTasks) {
        if (!task || task.type !== 'campaign-publish') continue
        if (task.userId !== userId) continue
        if (Number(task.data?.campaignId) !== campaignRow.id) continue
        const removed = await queueManager.removeTask(task.id)
        if (removed) campaignPublishPendingRemoved += 1
      }
    } catch (err: any) {
      console.warn('[offline] campaign-publish queue cleanup skipped:', err?.message || err)
    }

    // 下线后刷新Offer缓存
    invalidateOfferCache(userId, campaignRow.offer_id)

    // 可选：暂停补点击任务
    let clickFarmPaused = 0
    if (pauseClickFarmTasks) {
      clickFarmPaused = (
        await db.exec(
          `
            UPDATE click_farm_tasks
            SET status = 'paused',
                pause_reason = 'offline',
                pause_message = '广告系列下线，任务已暂停',
                paused_at = ${nowFunc},
                updated_at = ${nowFunc}
            WHERE offer_id = ?
              AND user_id = ?
              AND status IN ('pending', 'running', 'paused')
              AND IS_DELETED_FALSE
          `,
          [campaignRow.offer_id, userId]
        )
      ).changes

      // 额外按 click_farm_tasks.id 清理 pending 队列，确保“暂停后立即止血”
      try {
        const pausedTaskRows = await db.query<{ id: string }>(
          `
            SELECT id
            FROM click_farm_tasks
            WHERE offer_id = ?
              AND user_id = ?
              AND status = 'paused'
              AND pause_reason = 'offline'
              AND IS_DELETED_FALSE
          `,
          [campaignRow.offer_id, userId]
        )

        if (pausedTaskRows.length > 0) {
          await removePendingClickFarmQueueTasksByTaskIds(
            pausedTaskRows.map((row) => row.id),
            userId
          )
        }
      } catch (err: any) {
        console.warn('[offline] click-farm queue cleanup by task ids skipped:', err?.message || err)
      }
    }

    // 可选：暂停换链接任务
    let urlSwapPaused = 0
    if (pauseUrlSwapTasks) {
      const urlSwapNotDeletedCondition =
        db.type === 'postgres'
          ? '(is_deleted = FALSE OR is_deleted IS NULL)'
          : '(is_deleted = 0 OR is_deleted IS NULL)'
      urlSwapPaused = (
        await db.exec(
          `
            UPDATE url_swap_tasks
            SET status = 'disabled',
                error_message = '广告系列下线，任务已暂停',
                updated_at = ${nowFunc}
            WHERE offer_id = ?
              AND user_id = ?
              AND status != 'disabled'
              AND ${urlSwapNotDeletedCondition}
          `,
          [campaignRow.offer_id, userId]
        )
      ).changes

      await pauseUrlSwapTargetsByOfferId(campaignRow.offer_id)

      // 额外按 url_swap_tasks.id 清理 pending 队列，确保“暂停后立即止血”
      try {
        const pausedUrlSwapRows = await db.query<{ id: string }>(
          `
            SELECT id
            FROM url_swap_tasks
            WHERE offer_id = ?
              AND user_id = ?
              AND status = 'disabled'
              AND ${urlSwapNotDeletedCondition}
          `,
          [campaignRow.offer_id, userId]
        )

        if (pausedUrlSwapRows.length > 0) {
          await removePendingUrlSwapQueueTasksByTaskIds(
            pausedUrlSwapRows.map((row) => row.id),
            userId
          )
        }
      } catch (err: any) {
        console.warn('[offline] url-swap queue cleanup by task ids skipped:', err?.message || err)
      }
    }

    // 🔥 可选：移除队列中的待处理任务（best-effort）
    if (pauseClickFarmTasks || pauseUrlSwapTasks) {
      try {
        const { getOrCreateQueueManager } = await import('@/lib/queue/init-queue')
        const queueManager = await getOrCreateQueueManager()
        const pendingTasks = await queueManager.getPendingTasks()
        for (const task of pendingTasks) {
          if (!task?.data) continue
          if (task.data.offerId !== campaignRow.offer_id) continue
          if (pauseClickFarmTasks && task.type === 'click-farm') {
            await queueManager.removeTask(task.id)
          }
          if (pauseUrlSwapTasks && task.type === 'url-swap') {
            await queueManager.removeTask(task.id)
          }
        }
      } catch (err: any) {
        console.warn('[offline] queue cleanup skipped:', err?.message || err)
      }
    }

    // 可选：Offer拉黑
    let blacklistResult: { applied: boolean; reason?: string } = { applied: false }
    if (blacklistOffer && campaignRow.offer_id && campaignRow.offer_brand && campaignRow.offer_target_country) {
      const existing = await db.queryOne(
        'SELECT id FROM offer_blacklist WHERE user_id = ? AND brand = ? AND target_country = ?',
        [userId, campaignRow.offer_brand, campaignRow.offer_target_country]
      )
      if (existing) {
        blacklistResult = { applied: false, reason: '该品牌+国家组合已在黑名单中' }
      } else {
        await db.exec(
          'INSERT INTO offer_blacklist (user_id, brand, target_country, offer_id) VALUES (?, ?, ?, ?)',
          [userId, campaignRow.offer_brand, campaignRow.offer_target_country, campaignRow.offer_id]
        )
        blacklistResult = { applied: true }
      }
    }

    // Google Ads 远端下线：默认暂停，可选删除
    const googleAdsSummary = {
      queued: false,
      planned: 0,
      paused: 0,
      removed: 0,
      pausedFallback: 0,
      failed: 0,
      errors: [] as string[],
      skippedReason: null as string | null,
      action: removeGoogleAdsCampaign ? 'REMOVE' : 'PAUSE',
    }

    if (skipRemoteUpdates) {
      googleAdsSummary.skippedReason = skipRemoteReason || '已选择仅本地下线'
    }

    const customerId = campaignRow.customer_id
    if (!googleAdsSummary.skippedReason) {
      if (!customerId) {
        googleAdsSummary.skippedReason = '缺少Google Ads customer_id'
      } else {
        const customerIdValue = customerId
        const googleCampaignIds = googleCampaignId ? [googleCampaignId] : []

        googleAdsSummary.planned = googleCampaignIds.length

        if (googleCampaignIds.length === 0) {
          googleAdsSummary.skippedReason = '未找到可同步的Google Ads广告系列ID'
        } else {
          const linkedServiceAccountId =
            typeof campaignRow.service_account_id === 'string'
              ? campaignRow.service_account_id.trim()
              : ''
          const useServiceAccount = linkedServiceAccountId.length > 0

          let credentials: Awaited<ReturnType<typeof getGoogleAdsCredentialsFromDB>> | null = null
          let authType: 'oauth' | 'service_account' = 'oauth'
          let refreshToken = ''
          let serviceAccountId: string | undefined
          let serviceAccountMccId: string | undefined

          if (useServiceAccount) {
            authType = 'service_account'
            const config = await getServiceAccountConfig(userId, linkedServiceAccountId)
            if (!config) {
              googleAdsSummary.skippedReason = '未找到服务账号配置'
            } else {
              serviceAccountId = config.id
              serviceAccountMccId = config.mccCustomerId ? String(config.mccCustomerId) : undefined
            }
          } else {
            try {
              credentials = await getGoogleAdsCredentialsFromDB(userId)
            } catch (err: any) {
              googleAdsSummary.skippedReason = err?.message || 'Google Ads 凭证未配置或不可用'
            }

            if (!googleAdsSummary.skippedReason) {
              authType = 'oauth'
              const oauthCredentials = await getGoogleAdsCredentials(userId)
              refreshToken = oauthCredentials?.refresh_token || ''
              if (!refreshToken) {
                googleAdsSummary.skippedReason = 'Google Ads OAuth未授权或已过期'
              }
            }
          }

          let loginCustomerId: string | undefined
          if (authType === 'service_account') {
            loginCustomerId = serviceAccountMccId
          } else {
            loginCustomerId = credentials?.login_customer_id
              ? String(credentials.login_customer_id)
              : undefined
          }
          if (!loginCustomerId && campaignRow.parent_mcc_id) {
            loginCustomerId = String(campaignRow.parent_mcc_id)
          }

          if (!googleAdsSummary.skippedReason) {
            const runRemoteUpdates = async () => {
                const toErrorMessage = (error: any): string =>
                  String(error?.message || error || 'Google Ads 更新失败')

                for (const id of googleCampaignIds) {
                  if (removeGoogleAdsCampaign) {
                    try {
                      if (authType === 'service_account') {
                        const { removeCampaignPython } = await import('@/lib/python-ads-client')
                        const resourceName = `customers/${customerIdValue}/campaigns/${id}`
                        await removeCampaignPython({
                          userId,
                          serviceAccountId,
                          customerId: customerIdValue,
                          campaignResourceName: resourceName,
                        })
                      } else {
                        const customer = await getCustomerWithCredentials({
                          customerId: customerIdValue,
                          refreshToken,
                          accountId: campaignRow.google_ads_account_id!,
                          userId,
                          loginCustomerId,
                          authType,
                        })
                        const resourceName = `customers/${customerIdValue}/campaigns/${id}`
                        const startTime = Date.now()
                        try {
                          await customer.campaigns.remove([resourceName])
                          await trackApiUsage({
                            userId,
                            operationType: ApiOperationType.MUTATE,
                            endpoint: '/api/google-ads/campaign/remove',
                            customerId: customerIdValue,
                            requestCount: 1,
                            responseTimeMs: Date.now() - startTime,
                            isSuccess: true,
                          })
                        } catch (error: any) {
                          await trackApiUsage({
                            userId,
                            operationType: ApiOperationType.MUTATE,
                            endpoint: '/api/google-ads/campaign/remove',
                            customerId: customerIdValue,
                            requestCount: 1,
                            responseTimeMs: Date.now() - startTime,
                            isSuccess: false,
                            errorMessage: toErrorMessage(error),
                          }).catch(() => {})
                          throw error
                        }
                      }
                      googleAdsSummary.removed += 1
                    } catch (removeError: any) {
                      const removeMessage = toErrorMessage(removeError)
                      try {
                        await updateGoogleAdsCampaignStatus({
                          customerId: customerIdValue,
                          refreshToken,
                          campaignId: id,
                          status: 'PAUSED',
                          accountId: campaignRow.google_ads_account_id!,
                          userId,
                          loginCustomerId,
                          authType,
                          serviceAccountId,
                        })
                        googleAdsSummary.pausedFallback += 1
                        console.warn(
                          `[offline] remove failed, paused as fallback: campaign=${id}, reason=${removeMessage}`
                        )
                      } catch (pauseError: any) {
                        const pauseMessage = toErrorMessage(pauseError)
                        googleAdsSummary.failed += 1
                        googleAdsSummary.errors.push(
                          `campaign ${id}: remove failed (${removeMessage}); pause fallback failed (${pauseMessage})`
                        )
                        console.error('[offline] Google Ads remove/pause fallback failed:', pauseMessage)
                      }
                    }
                    continue
                  }

                  try {
                    await updateGoogleAdsCampaignStatus({
                      customerId: customerIdValue,
                      refreshToken,
                      campaignId: id,
                      status: 'PAUSED',
                      accountId: campaignRow.google_ads_account_id!,
                      userId,
                      loginCustomerId,
                      authType,
                      serviceAccountId,
                    })
                    googleAdsSummary.paused += 1
                  } catch (err: any) {
                    googleAdsSummary.failed += 1
                    const message = toErrorMessage(err)
                    googleAdsSummary.errors.push(`campaign ${id}: ${message}`)
                    console.error('[offline] Google Ads update failed:', message)
                  }
                }
              }

            if (waitRemote) {
              await runRemoteUpdates()
            } else {
              googleAdsSummary.queued = true
              void runRemoteUpdates().catch((err: any) => {
                console.error('[offline] Google Ads update failed:', err?.message || err)
              })
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: '广告系列已下线',
      data: {
        campaignId,
        offerId: campaignRow.offer_id,
        offlineCount: googleCampaignId ? 1 : 0,
        campaignPublishPendingRemoved,
        blacklist: blacklistResult,
        clickFarmPaused,
        urlSwapPaused,
      },
      googleAds: googleAdsSummary,
    })
  } catch (error: any) {
    console.error('下线广告系列失败:', error)
    return NextResponse.json(
      { error: error?.message || '下线广告系列失败' },
      { status: 500 }
    )
  }
}
