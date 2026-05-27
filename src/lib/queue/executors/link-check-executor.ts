/**
 * Link Check 任务执行器
 *
 * 负责执行链接可用性检查任务，包括：
 * - 检查Offer的推广链接是否可访问
 * - 复用offer创建时的"推广链接解析"功能（resolveAffiliateLink）
 * - 如果能提取出final url和final url suffix，说明链接有效
 * - 生成风险提示（含代理/网络类检查失败与环境类告警去重）
 * - Google Ads 账号状态：仅在不使用解析器而走 dailyLinkCheck 降级路径时在结果中体现
 *
 * 🔄 迁移自 scheduler.ts 中的 linkAndAccountCheckTask()
 * 优势：支持并发控制、失败重试、按用户隔离执行、复用URL解析逻辑
 */

import type { Task, TaskExecutor } from '../types'
import {
  createRiskAlertWithDedupMeta,
  dailyLinkCheck,
  refreshActiveRiskAlertContent,
} from '@/lib/risk-alerts'
import type { DatabaseAdapter } from '@/lib/db'
import { getDatabase } from '@/lib/db'
import { resolveAffiliateLink } from '@/lib/url-resolver'
import { getProxyForCountry } from '../user-proxy-loader'
import { analyzeProxyError } from './proxy-error-handler'
import { pauseClickFarmTasksByOfferId } from '../../click-farm'
import {
  prepareGoogleAdsAccountApiCall,
  type OAuthApiCredentialsFields,
} from '@/lib/google-ads-accounts-auth'
import { resolveGoogleAdsApiAuthForAccount } from '@/lib/google-ads-auth-context'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads-login-customer'
import { updateGoogleAdsCampaignStatus } from '../../google-ads-api'

/**
 * Link Check 任务数据接口
 */
export interface LinkCheckTaskData {
  checkType: 'daily' | 'manual' | 'single-offer'
  userId?: number  // 可选，指定用户ID时只检查该用户
  offerId?: number // 可选，指定Offer ID时只检查该Offer
  useUrlResolver?: boolean  // 是否使用URL解析器验证（默认true）
}

/**
 * Link Check 任务结果接口
 */
export interface LinkCheckTaskResult {
  success: boolean
  totalUsers: number
  totalLinks: number
  totalAlerts: number
  brokenLinks: number
  validLinks: number
  pausedCampaigns: number  // 🔧 暂停的数据库广告系列数
  pausedGoogleAdsCampaigns: number  // 🔧 暂停成功的 Google Ads 广告系列数（仅当 DB 有新暂停行时）
  pausedClickFarmTasks: number  // 🔧 新增：暂停的补点击任务数
  /** 对应 url-swap 自动暂停启用前恒为 0 */
  pausedUrlSwapTasks: number
  /** 仅在流程中真正把 offer 设为不活跃时才递增（当前 resolver 分支恒为 0） */
  deactivatedOffers: number
  /** 因代理/网络等基础设施问题未完成链接判定（未触发自动暂停） */
  checksUnresolvedInfrastructure: number
  /** 仅在 useUrlResolver=false 使用 dailyLinkCheck 时有值；resolver 主路径为占位 0 */
  accountChecks: {
    totalAccounts: number
    problemAccounts: number
  }
  errorMessage?: string
  duration: number  // 检查耗时（毫秒）
}

/** 非代理关键词但明显为网络/超时类失败，不应触发「链接失效」自动暂停 */
function isLikelyNetworkOrTimeoutFailure(error: unknown): boolean {
  const err = error as {
    code?: string
    message?: string
    name?: string
    response?: { status?: number }
  }
  const code = err?.code
  if (
    code &&
    new Set([
      'ECONNABORTED',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'EPIPE',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
    ]).has(code)
  ) {
    return true
  }
  if (err?.name === 'AbortError') return true
  const msg = String(err?.message ?? error ?? '')
  if (
    /timeout|ETIMEDOUT|socket hang up|ECONNRESET|network|DNS|连接超时|网络错误|fetch failed|aborted|ENOTFOUND|ECONNREFUSED/i.test(
      msg
    )
  ) {
    return true
  }
  const status = err?.response?.status
  if (status === 502 || status === 503 || status === 504) return true
  return false
}

/**
 * 使用URL解析器验证单个链接
 * 复用offer创建时的推广链接解析功能
 */
async function validateLinkWithResolver(
  affiliateLink: string,
  targetCountry: string,
  userId: number
): Promise<{
  isValid: boolean
  finalUrl?: string
  finalUrlSuffix?: string
  error?: string
  /** 代理/配额/网络等与链接本身无关，不应触发自动暂停 */
  unresolvedDueToInfrastructure?: boolean
}> {
  try {
    // 获取用户配置的代理
    const proxyConfig = await getProxyForCountry(targetCountry, userId)
    const proxyUrl = proxyConfig?.originalUrl

    // 使用URL解析器解析链接（不使用缓存，确保实时检查）
    const resolved = await resolveAffiliateLink(affiliateLink, proxyUrl, false)

    // 如果能提取出final url和final url suffix，说明链接有效
    if (resolved.finalUrl && resolved.finalUrl.length > 0) {
      return {
        isValid: true,
        finalUrl: resolved.finalUrl,
        finalUrlSuffix: resolved.finalUrlSuffix
      }
    } else {
      return {
        isValid: false,
        error: '无法解析到最终URL'
      }
    }
  } catch (error: any) {
    const errorAnalysis = analyzeProxyError(error)
    const infra =
      errorAnalysis.isProxyError || isLikelyNetworkOrTimeoutFailure(error)
    return {
      isValid: false,
      unresolvedDueToInfrastructure: infra,
      error: errorAnalysis.isProxyError
        ? errorAnalysis.enhancedMessage
        : (errorAnalysis.enhancedMessage || error.message || '链接解析失败')
    }
  }
}

/**
 * 创建 Link Check 任务执行器
 */
export function createLinkCheckExecutor(): TaskExecutor<LinkCheckTaskData, LinkCheckTaskResult> {
  return async (task: Task<LinkCheckTaskData>) => {
    const { checkType, userId, offerId, useUrlResolver = true } = task.data

    console.log(`🔍 [LinkCheckExecutor] 开始链接检查任务: 类型=${checkType}, 用户=${userId || 'all'}, Offer=${offerId || 'all'}, 使用URL解析器=${useUrlResolver}`)

    const startTime = Date.now()

    try {
      // 如果使用URL解析器验证（推荐方式）
      if (useUrlResolver) {
        const db = await getDatabase()

        // 🔧 修复: PostgreSQL BOOLEAN 兼容性
        const isActiveCondition = db.type === 'postgres' ? 'o.is_active = true' : 'o.is_active = 1'

        // 构建查询条件
        let query = `
          SELECT o.id, o.affiliate_link, o.target_country, o.user_id, o.brand, o.offer_name
          FROM offers o
          WHERE ${isActiveCondition} AND o.affiliate_link IS NOT NULL
        `
        const params: any[] = []

        if (userId) {
          query += ' AND o.user_id = ?'
          params.push(userId)
        }
        if (offerId) {
          query += ' AND o.id = ?'
          params.push(offerId)
        }

        const offers = await db.query<{
          id: number
          affiliate_link: string
          target_country: string
          user_id: number
          brand: string
          offer_name: string | null
        }>(query, params)

        console.log(`   找到 ${offers.length} 个需要检查的Offer`)

        let validLinks = 0
        let brokenLinks = 0
        let totalAlerts = 0
        let pausedCampaigns = 0
        let pausedGoogleAdsCampaigns = 0
        let pausedClickFarmTasks = 0
        let pausedUrlSwapTasks = 0
        let deactivatedOffers = 0
        let checksUnresolvedInfrastructure = 0

        const linkCheckConcurrency = Math.max(
          1,
          Math.min(20, parseInt(process.env.LINK_CHECK_CONCURRENCY || '5', 10) || 5)
        )
        console.log(`   并发检查数=${linkCheckConcurrency}`)

        type OfferRow = (typeof offers)[number]
        type LinkCheckOfferDelta = {
          validInc: number
          brokenInc: number
          infraInc: number
          totalAlertsInc: number
          pausedCampaigns: number
          pausedGoogleAdsCampaigns: number
          pausedClickFarmTasks: number
          pausedUrlSwapTasks: number
        }

        async function runOffer(dbConn: DatabaseAdapter, offer: OfferRow): Promise<LinkCheckOfferDelta> {
          const zero = (): LinkCheckOfferDelta => ({
            validInc: 0,
            brokenInc: 0,
            infraInc: 0,
            totalAlertsInc: 0,
            pausedCampaigns: 0,
            pausedGoogleAdsCampaigns: 0,
            pausedClickFarmTasks: 0,
            pausedUrlSwapTasks: 0,
          })

          const displayName = offer.offer_name || offer.brand || `Offer #${offer.id}`
          const result = await validateLinkWithResolver(
            offer.affiliate_link,
            offer.target_country || 'US',
            offer.user_id
          )

          if (result.isValid) {
            console.log(`   ✅ ${displayName}: 链接有效`)
            return { ...zero(), validInc: 1 }
          }

          if (result.unresolvedDueToInfrastructure) {
            console.log(
              `   ⚠️ ${displayName}: 链接检查未完成（代理/网络环境）-${result.error?.slice(0, 160)}`
            )

            const proxyTitle = `链接检查未完成（代理/网络）: ${displayName}`
            const proxyMessage = `无法在可靠环境下验证 Offer "${displayName}" 的推广链接，已跳过自动暂停。环境说明：${result.error}`
            const proxyDetails = {
              kind: 'link_check_infrastructure',
              offerId: offer.id,
            }

            try {
              const meta = await createRiskAlertWithDedupMeta(
                offer.user_id,
                'link_check_proxy',
                'info',
                proxyTitle,
                proxyMessage,
                {
                  resourceType: 'offer',
                  resourceId: offer.id,
                  details: proxyDetails,
                }
              )
              if (meta.created) {
                return { ...zero(), infraInc: 1, totalAlertsInc: 1 }
              }
              if (meta.id) {
                await refreshActiveRiskAlertContent(
                  offer.user_id,
                  meta.id,
                  'link_check_proxy',
                  proxyTitle,
                  proxyMessage,
                  proxyDetails
                )
              }
              return { ...zero(), infraInc: 1 }
            } catch (error: any) {
              console.error(`   ⚠️ 创建链接检查环境类风险提示失败:`, error.message)
              return { ...zero(), infraInc: 1 }
            }
          }

          console.log(`   ❌ ${displayName}: 链接失效 - ${result.error}`)

          const isDeletedFalse = dbConn.type === 'postgres' ? 'FALSE' : '0'
          let campaignsToSyncGoogle: Array<{
            campaign_id: string
            google_ads_account_id: number
          }> = []

          try {
            campaignsToSyncGoogle = (await dbConn.query(
              `
              SELECT campaign_id, google_ads_account_id
              FROM campaigns
              WHERE offer_id = ?
                AND status != 'PAUSED'
                AND is_deleted = ${isDeletedFalse}
                AND campaign_id IS NOT NULL
                AND campaign_id != ''
            `,
              [offer.id]
            )) as Array<{ campaign_id: string; google_ads_account_id: number }>
          } catch (error: any) {
            console.error(`   ⚠️  预取待同步 Google 的广告系列失败:`, error.message)
            campaignsToSyncGoogle = []
          }

          let pausedCampaignsForOffer = 0
          let pausedGoogleAdsCampaignsForOffer = 0
          let pausedClickFarmForOffer = 0
          let pausedUrlSwapForOffer = 0

          const campaignPauseResult = await (async () => {
            try {
              const upd = await dbConn.exec(
                `
                  UPDATE campaigns
                  SET status = 'PAUSED',
                      updated_at = ?
                  WHERE offer_id = ?
                    AND status != 'PAUSED'
                    AND is_deleted = ${isDeletedFalse}
                `,
                [new Date(), offer.id]
              )
              console.log(`   ⏸️  已暂停 ${upd.changes || 0} 个广告系列（数据库）`)

              const pausedInDb = upd.changes || 0
              let pausedInGoogleAds = 0
              const preparedByAccountId = new Map<
                number,
                Awaited<ReturnType<typeof prepareGoogleAdsAccountApiCall>> & { ok: true }
              >()
              if (pausedInDb > 0 && campaignsToSyncGoogle.length > 0) {
                for (const campaign of campaignsToSyncGoogle) {
                  try {
                    const adsAccount = (await dbConn.queryOne(
                      `
                          SELECT id, customer_id, service_account_id, parent_mcc_id
                          FROM google_ads_accounts
                          WHERE id = ? AND user_id = ?
                        `,
                      [campaign.google_ads_account_id, offer.user_id]
                    )) as
                      | {
                          id: number
                          customer_id: string
                          service_account_id: string | null
                          parent_mcc_id: string | null
                        }
                      | undefined

                    if (adsAccount) {
                      const authResolved = await resolveGoogleAdsApiAuthForAccount(
                        offer.user_id,
                        adsAccount.service_account_id
                      )
                      if (!authResolved.ok) {
                        console.warn(
                          `   ⚠️  跳过暂停 Google Ads 广告系列 ${campaign.campaign_id}: 凭证无效 (${authResolved.reason})`
                        )
                        continue
                      }
                      const { apiAuth } = authResolved
                      if (apiAuth.authType === 'oauth' && !apiAuth.refreshToken) {
                        console.warn(
                          `   ⚠️  跳过暂停 Google Ads 广告系列 ${campaign.campaign_id}: OAuth 缺少 refresh_token`
                        )
                        continue
                      }
                      if (apiAuth.authType === 'service_account' && !apiAuth.serviceAccountId) {
                        console.warn(
                          `   ⚠️  跳过暂停 Google Ads 广告系列 ${campaign.campaign_id}: 缺少服务账号配置`
                        )
                        continue
                      }

                      let oauthCredentials: OAuthApiCredentialsFields | undefined
                      let oauthLoginCustomerId: string | undefined
                      let refreshToken = apiAuth.refreshToken
                      if (apiAuth.authType === 'oauth') {
                        let prepared = preparedByAccountId.get(campaign.google_ads_account_id)
                        if (!prepared) {
                          const result = await prepareGoogleAdsAccountApiCall({
                            authContext: authResolved.ctx,
                            linkedServiceAccountId: adsAccount.service_account_id,
                          })
                          if (!result.ok) {
                            console.warn(
                              `   ⚠️  跳过暂停 Google Ads 广告系列 ${campaign.campaign_id}: ${result.message}`
                            )
                            continue
                          }
                          prepared = result
                          preparedByAccountId.set(campaign.google_ads_account_id, result)
                        }
                        oauthCredentials = prepared.oauthCredentials
                        oauthLoginCustomerId =
                          prepared.oauthLoginCustomerId ?? apiAuth.oauthLoginCustomerId
                        refreshToken = prepared.refreshToken
                      }

                      await runWithLoginCustomerFallbackForAccount({
                        adsAccount: {
                          customer_id: adsAccount.customer_id,
                          parent_mcc_id: adsAccount.parent_mcc_id,
                          id: adsAccount.id,
                        },
                        refreshToken,
                        authType: apiAuth.authType,
                        serviceAccountId: apiAuth.serviceAccountId,
                        serviceAccountMccId: apiAuth.serviceAccountMccId,
                        oauthLoginCustomerId,
                        actionName: `链接检测暂停 Campaign ${campaign.campaign_id}`,
                        callback: (loginCustomerId) =>
                          updateGoogleAdsCampaignStatus({
                            customerId: adsAccount.customer_id,
                            refreshToken,
                            campaignId: campaign.campaign_id,
                            status: 'PAUSED',
                            accountId: campaign.google_ads_account_id,
                            userId: offer.user_id,
                            loginCustomerId,
                            authType: apiAuth.authType,
                            serviceAccountId: apiAuth.serviceAccountId,
                            credentials: oauthCredentials,
                          }),
                      })
                      pausedInGoogleAds++
                      console.log(`   ⏸️  已暂停 Google Ads 广告系列 ${campaign.campaign_id}`)
                    }
                  } catch (error: any) {
                    console.error(
                      `   ⚠️  暂停 Google Ads 广告系列 ${campaign.campaign_id} 失败:`,
                      error.message
                    )
                  }
                }
              }

              return {
                pausedInDb,
                pausedInGoogleAds,
              }
            } catch (error: any) {
              console.error(`   ⚠️  暂停广告系列失败:`, error.message)
              return {
                pausedInDb: 0,
                pausedInGoogleAds: 0,
              }
            }
          })()

          pausedCampaignsForOffer = campaignPauseResult.pausedInDb
          pausedGoogleAdsCampaignsForOffer = campaignPauseResult.pausedInGoogleAds

          try {
            pausedClickFarmForOffer = await pauseClickFarmTasksByOfferId(offer.id, {
              reason: 'broken_link',
              message: 'Offer 推广链接失效，任务已自动暂停',
            })
            console.log(`   ⏸️  已暂停 ${pausedClickFarmForOffer} 个补点击任务`)
          } catch (error: any) {
            console.error(`   ⚠️  暂停补点击任务失败:`, error.message)
          }

          let totalAlertsInc = 0
          try {
            const meta = await createRiskAlertWithDedupMeta(
              offer.user_id,
              'broken_link',
              'warning',
              `推广链接失效: ${displayName}`,
              `Offer "${displayName}" 的推广链接无法正常解析。错误：${result.error}. 已自动暂停 ${pausedCampaignsForOffer} 个数据库广告系列、${pausedGoogleAdsCampaignsForOffer} 个 Google Ads 广告系列、${pausedClickFarmForOffer} 个补点击任务`,
              {
                resourceType: 'offer',
                resourceId: offer.id,
                details: {
                  dbCampaignsPaused: pausedCampaignsForOffer,
                  googleAdsCampaignsPaused: pausedGoogleAdsCampaignsForOffer,
                  clickFarmTasksPaused: pausedClickFarmForOffer,
                },
              }
            )
            if (meta.created) totalAlertsInc = 1
          } catch (error: any) {
            console.error(`   ⚠️  创建风险提示失败:`, error.message)
          }

          return {
            validInc: 0,
            brokenInc: 1,
            infraInc: 0,
            totalAlertsInc,
            pausedCampaigns: pausedCampaignsForOffer,
            pausedGoogleAdsCampaigns: pausedGoogleAdsCampaignsForOffer,
            pausedClickFarmTasks: pausedClickFarmForOffer,
            pausedUrlSwapTasks: pausedUrlSwapForOffer,
          }
        }

        for (let i = 0; i < offers.length; i += linkCheckConcurrency) {
          const chunk = offers.slice(i, i + linkCheckConcurrency)
          const deltas = await Promise.all(chunk.map((o) => runOffer(db, o)))
          for (const d of deltas) {
            validLinks += d.validInc
            brokenLinks += d.brokenInc
            checksUnresolvedInfrastructure += d.infraInc
            totalAlerts += d.totalAlertsInc
            pausedCampaigns += d.pausedCampaigns
            pausedGoogleAdsCampaigns += d.pausedGoogleAdsCampaigns
            pausedClickFarmTasks += d.pausedClickFarmTasks
            pausedUrlSwapTasks += d.pausedUrlSwapTasks
          }
        }

        const duration = Date.now() - startTime

        console.log(`✅ [LinkCheckExecutor] 链接检查完成: 有效=${validLinks}, 失效=${brokenLinks}, 未完成(基础设施)=${checksUnresolvedInfrastructure}, 新风险提示=${totalAlerts}, 耗时=${duration}ms`)
        console.log(`📊 [LinkCheckExecutor] 自动暂停统计: DB广告系列=${pausedCampaigns}, GoogleAds广告系列=${pausedGoogleAdsCampaigns}, 补点击任务=${pausedClickFarmTasks}`)

        return {
          success: true,
          totalUsers: new Set(offers.map(o => o.user_id)).size,
          totalLinks: offers.length,
          totalAlerts,
          brokenLinks,
          validLinks,
          pausedCampaigns,
          pausedGoogleAdsCampaigns,
          pausedClickFarmTasks,
          pausedUrlSwapTasks,
          deactivatedOffers,
          checksUnresolvedInfrastructure,
          accountChecks: { totalAccounts: 0, problemAccounts: 0 },
          duration
        }
      }

      // 使用原有的dailyLinkCheck方法（兼容旧逻辑）
      const result = await dailyLinkCheck()

      let brokenLinks = 0
      Object.values(result.results).forEach((r: any) => {
        brokenLinks += r.broken || 0
      })

      const duration = Date.now() - startTime

      console.log(`✅ [LinkCheckExecutor] 链接检查完成: 用户数=${result.totalUsers}, 链接数=${result.totalLinks}, 新风险提示=${result.totalAlerts}, 耗时=${duration}ms`)

      return {
        success: true,
        totalUsers: result.totalUsers,
        totalLinks: result.totalLinks,
        totalAlerts: result.totalAlerts,
        brokenLinks,
        validLinks: result.totalLinks - brokenLinks,
        pausedCampaigns: 0,  // 原有逻辑不包含暂停功能
        pausedGoogleAdsCampaigns: 0,
        pausedClickFarmTasks: 0,
        pausedUrlSwapTasks: 0,
        deactivatedOffers: 0,
        checksUnresolvedInfrastructure: 0,
        accountChecks: result.accountChecks,
        duration
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`❌ [LinkCheckExecutor] 链接检查失败: ${error.message}, 耗时=${duration}ms`)

      return {
        success: false,
        totalUsers: 0,
        totalLinks: 0,
        totalAlerts: 0,
        brokenLinks: 0,
        validLinks: 0,
        pausedCampaigns: 0,
        pausedGoogleAdsCampaigns: 0,
        pausedClickFarmTasks: 0,
        pausedUrlSwapTasks: 0,
        deactivatedOffers: 0,
        checksUnresolvedInfrastructure: 0,
        accountChecks: { totalAccounts: 0, problemAccounts: 0 },
        errorMessage: error.message,
        duration
      }
    }
  }
}
