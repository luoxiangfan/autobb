/**
 * 查询Google Ads账号中的已激活广告系列
 *
 * 使用真实的Google Ads API查询，结合命名规范建立关联关系
 */

import { logger } from '@/lib/common/server'
import { enums } from '@/lib/google-ads/api/api'
import { getDatabase } from '../db'
import { listGoogleAdsCampaigns } from '@/lib/google-ads/api/api'
import {
  googleAdsAuthContextParam,
  prepareGoogleAdsApiCallForLinkedAccount,
} from '@/lib/google-ads/accounts/auth/index'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads/oauth/login-customer'
import { categorizeCampaigns, type GoogleAdsCampaignInfo } from './campaign-association'

/**
 * 查询结果
 */
export interface ActiveCampaignsQueryResult {
  // 属于当前Offer的广告系列
  ownCampaigns: GoogleAdsCampaignInfo[]
  // 用户手动创建的广告系列
  manualCampaigns: GoogleAdsCampaignInfo[]
  // 属于其他Offer的广告系列
  otherCampaigns: GoogleAdsCampaignInfo[]
  // 总计
  total: {
    enabled: number
    own: number
    manual: number
    other: number
  }
}

function normalizeCampaignStatus(status: unknown): 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' {
  if (typeof status === 'number') {
    const mapped = (enums.CampaignStatus as Record<number, string>)[status]
    return (mapped || 'UNKNOWN') as 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  }

  if (typeof status === 'string') {
    const trimmed = status.trim()
    if (!trimmed) return 'UNKNOWN'
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      const mapped = (enums.CampaignStatus as Record<number, string>)[numeric]
      return (mapped || 'UNKNOWN') as 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
    }
    return trimmed.toUpperCase() as 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  }

  if (status && typeof status === 'object') {
    const maybeValue = status as { value?: unknown; name?: unknown; status?: unknown }
    const nested = maybeValue.value ?? maybeValue.name ?? maybeValue.status
    if (typeof nested === 'string' || typeof nested === 'number') {
      return normalizeCampaignStatus(nested)
    }
  }

  return 'UNKNOWN'
}

async function loadGoogleAdsQueryAuth(
  userId: number,
  linkedAccountServiceAccountId?: string | null
) {
  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
    userId,
    linkedAccountServiceAccountId ?? null
  )
  if (!prepared.ok) {
    throw new Error(prepared.message)
  }

  return {
    ctx: prepared.authContext,
    apiAuth: prepared.apiAuth,
    refreshToken: prepared.refreshToken,
    serviceAccountId: prepared.apiAuth.serviceAccountId,
    serviceAccountMccId: prepared.apiAuth.serviceAccountMccId,
    oauthCredentials: prepared.oauthCredentials,
    oauthLoginCustomerId: prepared.oauthLoginCustomerId ?? prepared.apiAuth.oauthLoginCustomerId,
  }
}

/**
 * 查询已激活的广告系列
 *
 * @param offerId Offer ID
 * @param googleAdsAccountId Google Ads账号ID
 * @param userId 用户ID
 * @returns 查询结果
 */
export async function queryActiveCampaigns(
  offerId: number,
  googleAdsAccountId: number,
  userId: number
): Promise<ActiveCampaignsQueryResult> {
  const db = await getDatabase()

  // 1. 获取Google Ads账号信息（包含parent_mcc_id用于MCC子账号权限）
  const adsAccount = (await db.queryOne(
    `SELECT id, customer_id, parent_mcc_id, service_account_id FROM google_ads_accounts
     WHERE id = ? AND user_id = ? AND is_active = true`,
    [Number(googleAdsAccountId), Number(userId)]
  )) as any

  if (!adsAccount) {
    throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
  }

  const {
    ctx,
    apiAuth,
    refreshToken,
    serviceAccountId,
    serviceAccountMccId,
    oauthCredentials,
    oauthLoginCustomerId,
  } = await loadGoogleAdsQueryAuth(userId, adsAccount.service_account_id)

  logger.debug(`🔍 查询Google Ads账号 ${adsAccount.customer_id} 中的广告系列...`)
  const allCampaigns = await runWithLoginCustomerFallbackForAccount({
    adsAccount: {
      customer_id: adsAccount.customer_id,
      parent_mcc_id: adsAccount.parent_mcc_id,
      id: googleAdsAccountId,
    },
    refreshToken,
    authType: apiAuth.authType,
    serviceAccountId,
    serviceAccountMccId,
    oauthLoginCustomerId,
    actionName: `queryActiveCampaigns(${adsAccount.customer_id})`,
    callback: (loginCustomerId) =>
      listGoogleAdsCampaigns({
        customerId: adsAccount.customer_id,
        refreshToken,
        accountId: googleAdsAccountId,
        userId,
        loginCustomerId,
        authType: ctx.auth.authType,
        serviceAccountId,
        credentials: oauthCredentials,
        ...googleAdsAuthContextParam(ctx),
        skipCache: true,
      }),
  })

  // 4. 转换为简化格式
  const campaigns: GoogleAdsCampaignInfo[] = allCampaigns.map((c: any) => ({
    id: c.campaign.id,
    name: c.campaign.name,
    status: normalizeCampaignStatus(c.campaign.status),
    budget: c.campaign_budget?.amount_micros
      ? Math.round(Number(c.campaign_budget.amount_micros) / 1000000)
      : undefined,
  }))

  // 5. 分类广告系列
  const categorized = categorizeCampaigns(campaigns, offerId)

  logger.debug(`📊 广告系列分类结果:`)
  logger.debug(`   - 总启用广告系列: ${campaigns.filter((c) => c.status === 'ENABLED').length}`)
  logger.debug(`   - 属于当前Offer: ${categorized.ownCampaigns.length}`)
  logger.debug(`   - 用户手动创建: ${categorized.manualCampaigns.length}`)
  logger.debug(`   - 属于其他Offer: ${categorized.otherCampaigns.length}`)

  return {
    ownCampaigns: categorized.ownCampaigns,
    manualCampaigns: categorized.manualCampaigns,
    otherCampaigns: categorized.otherCampaigns,
    total: {
      enabled: campaigns.filter((c) => c.status === 'ENABLED').length,
      own: categorized.ownCampaigns.length,
      manual: categorized.manualCampaigns.length,
      other: categorized.otherCampaigns.length,
    },
  }
}

export interface PauseCampaignsResult {
  attemptedCount: number
  pausedCount: number
  failedCount: number
  failures: Array<{
    id: string
    name: string
    error: string
  }>
}

/**
 * 批量暂停广告系列
 *
 * @param campaigns 要暂停的广告系列列表
 * @param googleAdsAccountId Google Ads账号ID
 * @param userId 用户ID
 */
export async function pauseCampaigns(
  campaigns: GoogleAdsCampaignInfo[],
  googleAdsAccountId: number,
  userId: number
): Promise<PauseCampaignsResult> {
  const db = await getDatabase()

  // 获取账号信息（包含parent_mcc_id用于MCC子账号权限）
  const adsAccount = (await db.queryOne(
    `SELECT customer_id, parent_mcc_id, service_account_id FROM google_ads_accounts
     WHERE id = ? AND user_id = ? AND is_active = true`,
    [Number(googleAdsAccountId), Number(userId)]
  )) as any

  if (!adsAccount) {
    throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
  }

  const {
    ctx,
    apiAuth,
    refreshToken,
    serviceAccountId,
    serviceAccountMccId,
    oauthCredentials,
    oauthLoginCustomerId,
  } = await loadGoogleAdsQueryAuth(userId, adsAccount.service_account_id)

  const { updateGoogleAdsCampaignStatus } = await import('@/lib/google-ads/api/api')

  const failures: PauseCampaignsResult['failures'] = []
  let pausedCount = 0
  let preferredLoginCustomerId: string | undefined

  for (const campaign of campaigns) {
    try {
      logger.debug(`⏸️ 暂停广告系列: ${campaign.name} (${campaign.id})`)

      await runWithLoginCustomerFallbackForAccount({
        adsAccount: {
          customer_id: adsAccount.customer_id,
          parent_mcc_id: adsAccount.parent_mcc_id,
          id: googleAdsAccountId,
        },
        refreshToken,
        authType: apiAuth.authType,
        serviceAccountId,
        serviceAccountMccId,
        oauthLoginCustomerId,
        preferredLoginCustomerId,
        onLoginCustomerIdResolved: (loginCustomerId) => {
          preferredLoginCustomerId = loginCustomerId
        },
        actionName: `pauseCampaigns(${campaign.id})`,
        callback: (loginCustomerId) =>
          updateGoogleAdsCampaignStatus({
            customerId: adsAccount.customer_id,
            refreshToken,
            campaignId: campaign.id,
            status: 'PAUSED',
            accountId: googleAdsAccountId,
            userId,
            loginCustomerId,
            authType: ctx.auth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...googleAdsAuthContextParam(ctx),
          }),
      })

      pausedCount++
    } catch (error: any) {
      console.error(`❌ 暂停失败: ${campaign.name}`, error)
      failures.push({
        id: campaign.id,
        name: campaign.name,
        error: error?.message || String(error),
      })
    }
  }

  return {
    attemptedCount: campaigns.length,
    pausedCount,
    failedCount: failures.length,
    failures,
  }
}
