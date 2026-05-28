import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsResponsiveSearchAd,
  updateGoogleAdsCampaignStatus,
  createGoogleAdsCalloutExtensions,
  createGoogleAdsSitelinkExtensions
} from '@/lib/google-ads-api'
import {
  getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext,
} from '@/lib/google-ads-auth-context'
import { createError, ErrorCode, AppError } from '@/lib/errors'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { calculateLaunchScore } from '@/lib/scoring'
import type { AdCreative } from '@/lib/ad-creative'
import type { ScoreAnalysis } from '@/lib/launch-scores'
import { saveLaunchScoreWithContentCache } from '@/lib/launch-score-cache'
import {
  findCachedLaunchScore,
  computeContentHash,
  computeCampaignConfigHash,
  parseLaunchScoreAnalysis,
  type CreativeContentData,
  type CampaignConfigData
} from '@/lib/launch-scores'
import { generateNamingScheme, parseAdGroupName } from '@/lib/naming-convention'
import { buildEffectiveCreative } from '@/lib/campaign-publish/effective-creative'
import {
  buildAlignedPublishCampaignConfig,
  evaluatePublishCampaignConfigOwnership,
  hasPublishCampaignConfigOwnershipViolation,
} from '@/lib/campaign-publish/aligned-campaign-config'
import { resolveTaskCampaignKeywords } from '@/lib/campaign-publish/task-keyword-fallback'
import { isGoogleAdsAccountAccessError } from '@/lib/google-ads-login-customer'
import { applyCampaignTransitionByGoogleCampaignIds } from '@/lib/campaign-state-machine'
import { normalizeCampaignPublishRequestBody } from '@/lib/autoads-request-normalizers'
import { invalidateOfferCache } from '@/lib/api-cache'
import {
  CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE,
  abandonStalePendingCampaignsForOffer,
  getActiveCampaignConflictForOffer,
  isCampaignOfferUniqueViolation,
  rollbackPendingCampaignAfterEnqueueFailure,
} from '@/lib/campaign-offer-constraint'
import {
  findResumablePublishCampaignForOffer,
  reactivateCampaignForPublishResume,
} from '@/lib/campaign-publish-resume'

const SINGLE_BRAND_PER_ACCOUNT_ENFORCED = (
  process.env.CAMPAIGN_PUBLISH_ENFORCE_SINGLE_BRAND_PER_ACCOUNT
  || 'true'
).trim().toLowerCase() !== 'false'

function normalizeBrand(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

const MAX_INT32 = 2147483647

function normalizeAccountIdInput(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '')
}

function toSafePositiveInt32(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_INT32) {
    return null
  }
  return parsed
}

function normalizeCustomerId(value: string): string {
  return value.replace(/-/g, '')
}

function isOAuthTokenExpiredOrRevoked(err: any): boolean {
  const message = String(err?.message || '')
  const causeMessage = String(err?.cause?.message || '')
  const combined = `${message}\n${causeMessage}`
  return combined.includes('invalid_grant') || combined.includes('Token has been expired or revoked')
}

function extractGoogleAdsRequestId(error: any): string | undefined {
  const candidates = [
    error?.request_id,
    error?.requestId,
    error?.response?.request_id,
    error?.response?.requestId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return undefined
}

function isGoogleAdsAccountPermissionDenied(error: any): boolean {
  return isGoogleAdsAccountAccessError(error)
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') {
    return true
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true'
  }

  return false
}

/**
 * 从ScoreAnalysis中提取所有问题（v4.0 - 4维度）
 */
function extractAllIssues(analysis: ScoreAnalysis): string[] {
  return [
    ...(analysis.launchViability?.issues || []),
    ...(analysis.adQuality?.issues || []),
    ...(analysis.keywordStrategy?.issues || []),
    ...(analysis.basicConfig?.issues || []),
  ]
}

/**
 * 从ScoreAnalysis中提取所有建议（v4.0 - 4维度）
 */
function extractAllSuggestions(analysis: ScoreAnalysis): string[] {
  return [
    ...(analysis.launchViability?.suggestions || []),
    ...(analysis.adQuality?.suggestions || []),
    ...(analysis.keywordStrategy?.suggestions || []),
    ...(analysis.basicConfig?.suggestions || []),
  ]
}

/**
 * POST /api/campaigns/publish
 *
 * 发布广告系列到Google Ads
 *
 * Request Body (🔧 修复2025-12-11: 统一使用camelCase):
 * {
 *   offerId: number
 *   adCreativeId: number  // 单创意模式：指定创意ID；智能优化模式：忽略（自动选 launch_score 最高 1 条）
 *   googleAdsAccountId: number
 *   campaignConfig: {
 *     campaignName: string
 *     budgetAmount: number
 *     budgetType: 'DAILY' | 'TOTAL'
 *     targetCountry: string
 *     targetLanguage: string
 *     biddingStrategy: string
 *     finalUrlSuffix: string
 *     adGroupName: string
 *     maxCpcBid: number
 *     keywords: string[]
 *     negativeKeywords: string[]
 *     negativeKeywordMatchType?: Record<string, 'EXACT' | 'PHRASE' | 'BROAD'>
 *   }
 *   pauseOldCampaigns: boolean
 *   enableSmartOptimization?: boolean  // 启用智能优化：自动选用 launch_score 最高的 1 个创意（1 Campaign + 1 Ad Group）
 *   variantCount?: number              // 已废弃，保留字段兼容旧客户端
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const parentRequestId = request.headers.get('x-request-id') || undefined
    // 1. Verify authentication
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const userId = authResult.user.userId

    // 2. 解析请求体 - 🔧 修复(2025-12-11): 接受camelCase字段名
    const rawBody = await request.json()
    const body = normalizeCampaignPublishRequestBody(rawBody) || rawBody
    const {
      // 支持camelCase（推荐）
      offerId,
      adCreativeId,
      googleAdsAccountId,
      campaignConfig,
      pauseOldCampaigns,
      enableCampaignImmediately = false,  // 是否立即启用Campaign，默认false（PAUSED状态）
      enableSmartOptimization = false,
      forcePublish, // 强制发布标志（用于绕过40-80分警告）
      forceLaunch, // 兼容历史字段（等价于 forcePublish）
      skipLaunchScore, // 兼容历史字段（等价于 forcePublish）
      // 向后兼容snake_case
      offer_id,
      ad_creative_id,
      google_ads_account_id,
      campaign_config,
      pause_old_campaigns,
      enable_campaign_immediately,
      enable_smart_optimization,
      force_publish,
      force_launch,
      skip_launch_score
    } = body

    // 使用camelCase优先，兼容snake_case
    const _offerId = offerId ?? offer_id
    const _adCreativeId = adCreativeId ?? ad_creative_id
    const _googleAdsAccountId = googleAdsAccountId ?? google_ads_account_id
    const _campaignConfig = campaignConfig ?? campaign_config
    const _pauseOldCampaigns = pauseOldCampaigns ?? pause_old_campaigns
    const _enableCampaignImmediately = enableCampaignImmediately ?? enable_campaign_immediately ?? false
    const _enableSmartOptimization = enableSmartOptimization ?? enable_smart_optimization ?? false
    const _forcePublish = [
      forcePublish,
      force_publish,
      forceLaunch,
      force_launch,
      skipLaunchScore,
      skip_launch_score,
    ].some((value) => isTruthyFlag(value))

    // 3. 验证必填字段
    if (!_offerId || !_googleAdsAccountId || !_campaignConfig) {
      const missing = []
      if (!_offerId) missing.push('offerId')
      if (!_googleAdsAccountId) missing.push('googleAdsAccountId')
      if (!_campaignConfig) missing.push('campaignConfig')

      const error = createError.requiredField(missing.join(', '))
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 单创意模式需要指定adCreativeId
    if (!_enableSmartOptimization && !_adCreativeId) {
      const error = createError.requiredField('adCreativeId')
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const normalizeName = (value: unknown): string => (
      typeof value === 'string' ? value.trim() : ''
    )

    const baseCampaignName = normalizeName(_campaignConfig?.campaignName)
    const baseAdGroupName = normalizeName(_campaignConfig?.adGroupName)
    const baseAdName = normalizeName(_campaignConfig?.adName)
    const parsedAdGroupName = baseAdGroupName ? parseAdGroupName(baseAdGroupName) : null

    const db = await getDatabase()

    // 4. 验证Offer归属
    const offer = await db.queryOne(`
      SELECT id, url, final_url, final_url_suffix, brand, target_country, target_language, scrape_status, category, offer_name
      FROM offers
      WHERE id = ? AND user_id = ?
    `, [_offerId, userId]) as any

    if (!offer) {
      const error = createError.offerNotFound({ offerId: _offerId, userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    if (offer.scrape_status !== 'completed') {
      const error = createError.offerNotReady({
        offerId: _offerId,
        currentStatus: offer.scrape_status,
        requiredStatus: 'completed'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 4.5. 检查 Offer 是否已有广告系列（严格一对一约束）；发布失败/未完成时可续发复用
    await abandonStalePendingCampaignsForOffer(_offerId, userId)
    const resumableCampaign = await findResumablePublishCampaignForOffer(_offerId, userId)
    const existingCampaign = resumableCampaign
      ? null
      : await getActiveCampaignConflictForOffer(_offerId, userId)

    if (existingCampaign) {
      const error = createError.invalidParameter({
        field: 'offerId',
        value: _offerId,
        constraint: 'One Offer can only have one Campaign'
      })
      return NextResponse.json({
        ...error.toJSON(),
        message: CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE,
        existingCampaign: {
          id: existingCampaign.id,
          campaignName: existingCampaign.campaign_name,
          creationStatus: existingCampaign.creation_status,
          status: existingCampaign.status,
        },
      }, { status: 409 })
    }

    // 5. 选择广告创意（单创意模式 vs 智能优化模式）
    let creatives: any[] = []

    if (_enableSmartOptimization) {
      const bestCreative = await db.queryOne(`
        SELECT id, headlines, descriptions, keywords, negative_keywords, callouts, sitelinks, final_url, final_url_suffix, launch_score, keywords_with_volume, theme, path_1, path_2
        FROM ad_creatives
        WHERE offer_id = ? AND user_id = ?
        ORDER BY
          CASE WHEN launch_score IS NULL THEN 0 ELSE 1 END DESC,
          launch_score DESC,
          created_at DESC
        LIMIT 1
      `, [_offerId, userId]) as any

      if (!bestCreative) {
        const error = createError.invalidParameter({
          field: 'creatives',
          message: '智能优化模式需要至少 1 个广告创意',
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }

      creatives = [bestCreative]
    } else {
      // 单创意模式：验证指定的创意
      const creative = await db.queryOne(`
        SELECT id, headlines, descriptions, keywords, negative_keywords, callouts, sitelinks, final_url, final_url_suffix, is_selected, keywords_with_volume, theme, path_1, path_2
        FROM ad_creatives
        WHERE id = ? AND offer_id = ? AND user_id = ?
      `, [_adCreativeId, _offerId, userId]) as any

      if (!creative) {
        const error = createError.creativeNotFound({ creativeId: _adCreativeId })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }

      creatives = [creative]
    }

    // 验证Final URL必须存在（Final URL Suffix可以为空）
    for (const creative of creatives) {
      if (!creative.final_url) {
        const error = createError.invalidParameter({
          field: 'final_url',
          message: `广告创意 ${creative.id} 缺少Final URL，请重新抓取Offer数据`
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
    }

    // 6. 获取 Google Ads 账号信息（兼容内部ID与 customer_id 两种输入）
    const rawGoogleAdsAccountId = normalizeAccountIdInput(_googleAdsAccountId)
    const normalizedCustomerId = normalizeCustomerId(rawGoogleAdsAccountId)
    const accountIdAsInt32 = toSafePositiveInt32(rawGoogleAdsAccountId)
    let accountLookupBy: 'id' | 'customer_id' | null = null

    let adsAccount = null as any
    if (accountIdAsInt32 !== null) {
      adsAccount = await db.queryOne(`
        SELECT
          id,
          customer_id,
          parent_mcc_id,
          is_active,
          status
        FROM google_ads_accounts
        WHERE id = ? AND user_id = ? AND is_active = ?
      `, [accountIdAsInt32, Number(userId), 1]) as any
      if (adsAccount) {
        accountLookupBy = 'id'
      }
    }

    // 兜底：若传入的是 customer_id（如 3178223819），自动映射到内部 account.id
    if (!adsAccount && normalizedCustomerId) {
      adsAccount = await db.queryOne(`
        SELECT
          id,
          customer_id,
          parent_mcc_id,
          is_active,
          status
        FROM google_ads_accounts
        WHERE user_id = ?
          AND is_active = ?
          AND REPLACE(customer_id, '-', '') = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `, [Number(userId), 1, normalizedCustomerId]) as any
      if (adsAccount) {
        accountLookupBy = 'customer_id'
      }
    }

    if (!adsAccount) {
      const error = createError.gadsAccountNotActive({
        accountId: rawGoogleAdsAccountId || _googleAdsAccountId,
        userId
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const resolvedGoogleAdsAccountId = Number(adsAccount.id)
    if (!Number.isSafeInteger(resolvedGoogleAdsAccountId) || resolvedGoogleAdsAccountId <= 0) {
      throw new Error(`Invalid google_ads_accounts.id: ${adsAccount.id}`)
    }

    console.log(`✅ Ads账号 ${rawGoogleAdsAccountId} 可供Offer #${_offerId} 使用（内部ID: ${resolvedGoogleAdsAccountId}）`)
    if (accountLookupBy === 'customer_id') {
      console.log(`ℹ️ 发布账号自动映射: customer_id=${normalizedCustomerId} -> account.id=${resolvedGoogleAdsAccountId}`)
    }

	    const accountStatus = String(adsAccount.status || 'UNKNOWN').toUpperCase()

	    const isNotUsableStatus =
	      accountStatus === 'CANCELED' ||
	      accountStatus === 'CANCELLED' ||
	      accountStatus === 'CLOSED' ||
	      accountStatus === 'SUSPENDED' ||
	      accountStatus === 'PAUSED' ||
	      accountStatus === 'DISABLED'

	    if (isNotUsableStatus) {
	      return NextResponse.json({
	        action: 'ACCOUNT_STATUS_NOT_USABLE',
	        message: `该 Google Ads 账号状态为 ${accountStatus}，无法用于发布/投放。请更换其他账号或先在 Google Ads 后台恢复账号状态。`,
	        details: { accountStatus }
	      }, { status: 422 })
	    }

    const authContext = await getGoogleAdsAuthContext(userId)
    if (!hasConfiguredGoogleAdsAuthFromContext(authContext)) {
      const error = new AppError(ErrorCode.GADS_CREDENTIALS_INVALID, {
        userId,
        reason:
          'Google Ads 认证未配置或已失效，请先在设置中完成 OAuth 授权或配置服务账号',
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

	    // 🔍 验证2：查询Google Ads账号中真实激活的广告系列（使用命名规范关联）
    const { queryActiveCampaigns } = await import('@/lib/active-campaigns-query')
    let activeCampaignsResult
    try {
      activeCampaignsResult = await queryActiveCampaigns(
        _offerId,
        resolvedGoogleAdsAccountId,
        userId
      )
    } catch (error: any) {
      if (isGoogleAdsAccountPermissionDenied(error)) {
        const requestId = extractGoogleAdsRequestId(error)

        try {
          await db.exec(`
            UPDATE google_ads_accounts
            SET is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
          `, [0, resolvedGoogleAdsAccountId, Number(userId)])
        } catch (deactivateError: any) {
          console.warn('标记无权限Google Ads账号为inactive失败:', deactivateError?.message || deactivateError)
        }

        return NextResponse.json({
          action: 'ACCOUNT_ACCESS_DENIED',
          message: '当前Google Ads账号已无访问权限，系统已自动下线该账号。请刷新账号列表后选择可用账号重试。',
          details: {
            accountId: resolvedGoogleAdsAccountId,
            customerId: String(adsAccount.customer_id || ''),
            parentMccId: adsAccount.parent_mcc_id || null,
            requestId: requestId || null,
          },
        }, { status: 422 })
      }

      throw error
    }

    console.log(`📊 Google Ads账号中广告系列统计:`)
    console.log(`   - 属于当前Offer: ${activeCampaignsResult.ownCampaigns.length}`)
    console.log(`   - 用户手动创建: ${activeCampaignsResult.manualCampaigns.length}`)
    console.log(`   - 属于其他Offer: ${activeCampaignsResult.otherCampaigns.length}`)

    const currentBrandNormalized = normalizeBrand(offer.brand)
    const publishWarnings: string[] = []

    if (SINGLE_BRAND_PER_ACCOUNT_ENFORCED && currentBrandNormalized) {
      const enabledOtherBrandCampaigns = activeCampaignsResult.otherCampaigns.filter((campaign) => {
        const campaignBrand = normalizeBrand((campaign as any).parsedNaming?.brandName || (campaign as any).name)
        if (!campaignBrand) return true
        return campaignBrand !== currentBrandNormalized
      })

      if (enabledOtherBrandCampaigns.length > 0 && !_pauseOldCampaigns) {
        const warningMessage = '检测到Ads账号中存在其他品牌Campaign，当前发布将继续执行。建议尽快评估并暂停其他品牌Campaign，避免多品牌并行投放。'
        publishWarnings.push(warningMessage)
        console.warn('⚠️ 检测到品牌冲突（仅警告，不阻断发布）', {
          accountId: resolvedGoogleAdsAccountId,
          currentOfferId: _offerId,
          currentBrand: offer.brand || null,
          conflictCampaigns: enabledOtherBrandCampaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
          })),
        })
      }

    }

    // 计算需要暂停的广告系列总数（属于当前Offer + 用户手动创建 + 其他Offer/品牌）
    const campaignsToPause = [
      ...activeCampaignsResult.ownCampaigns,
      ...activeCampaignsResult.manualCampaigns,
      ...activeCampaignsResult.otherCampaigns
    ]

    // 仅对“当前Offer + 手工Campaign”弹确认；跨品牌Campaign仅警告不拦截
    const campaignsRequireConfirm = [
      ...activeCampaignsResult.ownCampaigns,
      ...activeCampaignsResult.manualCampaigns
    ]

    // 记录暂停结果（用于前端展示）
    let pausedOldCampaignsSummary: {
      attemptedCount: number
      pausedCount: number
      failedCount: number
      ownCount: number
      manualCount: number
      otherCount: number
    } | undefined

    // ⚠️ 验证3：如果有需要暂停的广告系列且用户未确认，返回确认提示
    if (campaignsRequireConfirm.length > 0 && !_pauseOldCampaigns && !_forcePublish) {
      console.log(`⚠️ 需要用户确认: 是否暂停${campaignsRequireConfirm.length}个已激活的Campaign`)

      // 构建确认信息
      const ownCampaignsInfo = activeCampaignsResult.ownCampaigns.map(c => ({
        id: c.id,
        name: c.name,
        budget: c.budget,
        type: '系统创建（属于当前Offer）'
      }))

      const manualCampaignsInfo = activeCampaignsResult.manualCampaigns.map(c => ({
        id: c.id,
        name: c.name,
        budget: c.budget,
        type: '用户手动创建'
      }))

      const otherCampaignsInfo = activeCampaignsResult.otherCampaigns.map(c => ({
        id: c.id,
        name: c.name,
        budget: c.budget,
        type: '属于其他Offer/品牌'
      }))

      return NextResponse.json({
        action: 'CONFIRM_PAUSE_OLD_CAMPAIGNS',
        warnings: publishWarnings.length > 0 ? publishWarnings : undefined,
        existingCampaigns: {
          own: ownCampaignsInfo,
          manual: manualCampaignsInfo,
          other: otherCampaignsInfo
        },
        total: {
          own: ownCampaignsInfo.length,
          manual: manualCampaignsInfo.length,
          other: otherCampaignsInfo.length,
          all: campaignsRequireConfirm.length
        },
        message: `在Google Ads账号中检测到${campaignsRequireConfirm.length}个已激活的广告系列需要处理`,
        details: {
          own: `属于当前Offer（通过命名规范匹配）: ${ownCampaignsInfo.length}个`,
          manual: `用户手动创建（无命名规范）: ${manualCampaignsInfo.length}个`,
          other: `属于其他Offer/品牌: ${otherCampaignsInfo.length}个`
        },
        question: '是否暂停这些广告系列后再发布新创意？',
        options: [
          { label: '暂停并发布', value: 'pause_and_publish', description: '推荐：先暂停所有旧广告，再发布新广告' },
          { label: '直接发布（A/B测试）', value: 'publish_together', description: '旧广告继续运行，新广告同时激活' },
          { label: '取消', value: 'cancel', description: '不发布新广告' }
        ]
      }, { status: 422 })
    }

    // 7. 暂停旧广告系列（如果请求）- 使用真实的Google Ads查询结果
    if (_pauseOldCampaigns) {
      console.log(`⏸️ 开始暂停旧广告系列...`)

      // 使用之前查询的真实广告系列数据
      const campaignsToPause = [
        ...activeCampaignsResult.ownCampaigns,
        ...activeCampaignsResult.manualCampaigns,
        ...activeCampaignsResult.otherCampaigns
      ]

      console.log(`   - 需要暂停的广告系列数量: ${campaignsToPause.length}`)
      console.log(`   - 属于当前Offer: ${activeCampaignsResult.ownCampaigns.length}`)
      console.log(`   - 用户手动创建: ${activeCampaignsResult.manualCampaigns.length}`)
      console.log(`   - 属于其他Offer/品牌: ${activeCampaignsResult.otherCampaigns.length}`)

      // 批量暂停（串行执行，避免并发冲突）
      const { pauseCampaigns } = await import('@/lib/active-campaigns-query')
      const pauseResult = await pauseCampaigns(campaignsToPause, resolvedGoogleAdsAccountId, userId)
      pausedOldCampaignsSummary = {
        attemptedCount: pauseResult.attemptedCount,
        pausedCount: pauseResult.pausedCount,
        failedCount: pauseResult.failedCount,
        ownCount: activeCampaignsResult.ownCampaigns.length,
        manualCount: activeCampaignsResult.manualCampaigns.length,
        otherCount: activeCampaignsResult.otherCampaigns.length
      }

      // 更新数据库中对应的campaign记录状态
      const pausedGoogleCampaignIds = campaignsToPause
        .map((campaign) => String(campaign.id || '').trim())
        .filter(Boolean)

      if (pausedGoogleCampaignIds.length > 0) {
        try {
          await applyCampaignTransitionByGoogleCampaignIds({
            userId,
            googleAdsAccountId: resolvedGoogleAdsAccountId,
            googleCampaignIds: pausedGoogleCampaignIds,
            action: 'PAUSE_OLD_CAMPAIGNS',
          })
        } catch (error: any) {
          console.warn('更新数据库状态失败:', error?.message || error)
        }
      }

      console.log(`✅ 旧广告系列暂停完成`)
    }

    const campaignConfigBaseObject = (
      typeof _campaignConfig === 'object' && _campaignConfig !== null
        ? _campaignConfig
        : {}
    ) as Record<string, any>

    for (const creative of creatives) {
      const ownershipCheck = evaluatePublishCampaignConfigOwnership({
        campaignConfig: campaignConfigBaseObject,
        creative: {
          finalUrl: creative?.final_url || null,
          finalUrlSuffix: creative?.final_url_suffix || null,
        },
        offer: {
          url: offer?.url || null,
          finalUrl: offer?.final_url || null,
          finalUrlSuffix: offer?.final_url_suffix || null,
        },
      })

      if (hasPublishCampaignConfigOwnershipViolation(ownershipCheck.violation)) {
        const violatedFields: string[] = []
        if (ownershipCheck.violation.finalUrls) violatedFields.push('finalUrls')
        if (ownershipCheck.violation.finalUrlSuffix) violatedFields.push('finalUrlSuffix')

        console.error(
          `[CampaignPublish] URL字段归属校验失败: creativeId=${creative?.id || '-'}, fields=${violatedFields.join(',')}, inputFinalUrl=${ownershipCheck.violation.inputFinalUrl || '-'}, expectedFinalUrl=${ownershipCheck.violation.expectedFinalUrl || '-'}`
        )

        return NextResponse.json(
          {
            action: 'CAMPAIGN_CONFIG_FIELD_OWNERSHIP_VIOLATION',
            message: 'campaignConfig URL字段与系统归属来源不一致，请移除这些字段或改为与创意/Offer一致',
            ownership: ownershipCheck.ownership,
            details: {
              creativeId: creative?.id || null,
              fields: violatedFields,
              finalUrls: ownershipCheck.violation.finalUrls
                ? {
                    input: ownershipCheck.violation.inputFinalUrl || null,
                    expected: ownershipCheck.violation.expectedFinalUrl || null,
                  }
                : undefined,
              finalUrlSuffix: ownershipCheck.violation.finalUrlSuffix
                ? {
                    input: ownershipCheck.violation.inputFinalUrlSuffix || null,
                    expected: ownershipCheck.violation.expectedFinalUrlSuffix || null,
                  }
                : undefined,
            },
          },
          { status: 422 }
        )
      }
    }

    const buildAlignedCampaignConfigForCreative = (creative: any, stage: string) => {
      const baseCampaignConfig = _enableSmartOptimization
        ? {
            ...campaignConfigBaseObject,
            headlines: undefined,
            descriptions: undefined,
            callouts: undefined,
            sitelinks: undefined,
            finalUrls: undefined,
          }
        : campaignConfigBaseObject

      const alignedCampaignConfig = buildAlignedPublishCampaignConfig({
        campaignConfig: baseCampaignConfig,
        creative: {
          finalUrl: creative?.final_url || null,
          finalUrlSuffix: creative?.final_url_suffix || null,
        },
        offer: {
          url: offer?.url || null,
          finalUrl: offer?.final_url || null,
          finalUrlSuffix: offer?.final_url_suffix || null,
        },
      })

      if (
        process.env.NODE_ENV !== 'test'
        && (alignedCampaignConfig.overridden.finalUrls || alignedCampaignConfig.overridden.finalUrlSuffix)
      ) {
        console.log(
          `[CampaignPublish] [${stage}] URL字段按字段归属对齐: inputFinalUrl=${alignedCampaignConfig.overridden.inputFinalUrl || '-'} -> appliedFinalUrl=${alignedCampaignConfig.overridden.appliedFinalUrl || '-'}`
        )
      }

      return alignedCampaignConfig.campaignConfig
    }

    // 7.5 Launch Score评估（投放风险评估）
    console.log(`\n🎯 开始Launch Score评估...`)
    const primaryCreative = creatives[0]

    const campaignConfigForCreativeContent = buildAlignedCampaignConfigForCreative(
      primaryCreative,
      'launch_score'
    )

    const creativeData = buildEffectiveCreative({
      dbCreative: {
        headlines: primaryCreative.headlines,
        descriptions: primaryCreative.descriptions,
        keywords: primaryCreative.keywords,
        negativeKeywords: primaryCreative.negative_keywords,
        callouts: primaryCreative.callouts,
        sitelinks: primaryCreative.sitelinks,
        finalUrl: primaryCreative.final_url,
        finalUrlSuffix: primaryCreative.final_url_suffix
      },
      campaignConfig: campaignConfigForCreativeContent,
      offerUrlFallback: offer.url
    })

    // 🔥 新增：调试日志 - 追踪creativeData中的否定关键词
    console.log(`[Publish] 创意ID: ${primaryCreative.id}`)
    console.log(`[Publish] creativeData.negativeKeywords长度: ${creativeData.negativeKeywords.length}`)
    console.log(`[Publish] creativeData.negativeKeywords示例: ${creativeData.negativeKeywords.slice(0, 5).join(', ')}`)

    // 🔥 新增(2025-12-17): 计算缓存哈希
    const contentHashData: CreativeContentData = {
      headlines: creativeData.headlines,
      descriptions: creativeData.descriptions,
      keywords: creativeData.keywords,
      negativeKeywords: creativeData.negativeKeywords,
      finalUrl: creativeData.finalUrl || ''
    }
    const campaignConfigHashData: CampaignConfigData = {
      targetCountry: _campaignConfig.targetCountry || '',
      targetLanguage: _campaignConfig.targetLanguage || '',
      dailyBudget: _campaignConfig.budgetAmount || 0,
      maxCpc: _campaignConfig.maxCpcBid || 0
    }
    const contentHash = computeContentHash(contentHashData)
    const campaignConfigHash = computeCampaignConfigHash(campaignConfigHashData)
    console.log(`📝 内容哈希: ${contentHash}, 配置哈希: ${campaignConfigHash}`)

    // 🔥 新增(2025-12-17): 检查缓存的Launch Score
    let cachedLaunchScore = null
    try {
      cachedLaunchScore = await findCachedLaunchScore(
        primaryCreative.id,
        contentHash,
        campaignConfigHash,
        userId
      )
      if (cachedLaunchScore) {
        console.log(`✅ 找到缓存的Launch Score (ID: ${cachedLaunchScore.id})，跳过重新计算`)
      }
    } catch (cacheError: any) {
      console.warn(`⚠️ 缓存查询失败: ${cacheError.message}，将重新计算`)
    }

    // 🔥 修复(2025-12-19): 在try块外声明变量，以便在返回响应时使用
    let launchScore: number = 0
    let scoreAnalysis: ScoreAnalysis | undefined
    let analysis: any
    let overallRecommendations: string[] = []

    try {
      if (cachedLaunchScore) {
        // 使用缓存的数据
        launchScore = cachedLaunchScore.totalScore
        scoreAnalysis = parseLaunchScoreAnalysis(cachedLaunchScore)
        console.log(`📦 使用缓存的Launch Score: ${launchScore}分`)
      } else {
        // 🔥 修复(2025-12-18)：使用用户在第2步配置的关键词，而非创意原始数据
        // 关键词及其matchType应该来自campaignConfig（用户配置），而不是创意数据库记录
        const keywordsWithVolumeFromConfig = (_campaignConfig.keywords || []).map((kw: any) => ({
          keyword: typeof kw === 'string' ? kw : kw.text,
          text: typeof kw === 'string' ? kw : kw.text,
          matchType: typeof kw === 'string' ? 'PHRASE' : (kw.matchType || 'PHRASE'),
          searchVolume: typeof kw === 'object' ? kw.searchVolume : undefined,
          competition: typeof kw === 'object' ? kw.competition : undefined,
          lowTopPageBid: typeof kw === 'object' ? kw.lowTopPageBid : undefined,
          highTopPageBid: typeof kw === 'object' ? kw.highTopPageBid : undefined
        }))

        // 🔥 修复：明确构建创意对象，避免字段冲突
        const creativeForLaunchScore = {
          id: primaryCreative.id,
          offer_id: primaryCreative.offer_id,
          user_id: primaryCreative.user_id,
          headlines: creativeData.headlines,
          descriptions: creativeData.descriptions,
          keywords: creativeData.keywords,
          negativeKeywords: creativeData.negativeKeywords,  // 使用解析后的数组
          keywordsWithVolume: keywordsWithVolumeFromConfig.length > 0 ?
            keywordsWithVolumeFromConfig :  // 🔥 修复：使用用户配置的关键词
            (primaryCreative.keywords_with_volume ?
              JSON.parse(primaryCreative.keywords_with_volume) :
              (Array.isArray(creativeData.keywords) ?
                creativeData.keywords.map((kw: any) => ({
                  keyword: typeof kw === 'string' ? kw : kw.keyword || kw.text || '',
                  matchType: 'PHRASE'
                })) :
                [])),
          callouts: creativeData.callouts,
          sitelinks: creativeData.sitelinks,
          final_url: creativeData.finalUrl,
          final_url_suffix: creativeData.finalUrlSuffix,
          path_1: primaryCreative.path_1,
          path_2: primaryCreative.path_2,
          score: primaryCreative.score || 0,
          score_breakdown: primaryCreative.score_breakdown || {
            relevance: 0,
            quality: 0,
            engagement: 0,
            diversity: 0,
            clarity: 0,
            brandSearchVolume: 0,
            competitivePositioning: 0
          },
          score_explanation: primaryCreative.score_explanation || '',
          version: primaryCreative.version || 1,
          generation_round: primaryCreative.generation_round || 1,
          generation_prompt: primaryCreative.generation_prompt,
          theme: primaryCreative.theme || '',
          ai_model: primaryCreative.ai_model || 'gemini-pro',
          ad_group_id: primaryCreative.ad_group_id,
          ad_id: primaryCreative.ad_id,
          creation_status: primaryCreative.creation_status || 'draft',
          creation_error: primaryCreative.creation_error,
          last_sync_at: primaryCreative.last_sync_at,
          is_selected: primaryCreative.is_selected || 0,
          created_at: primaryCreative.created_at,
          updated_at: primaryCreative.updated_at
        } as AdCreative

        // 🔥 新增(2025-12-18)：调试日志 - 追踪关键词matchType一致性
        console.log(`[Publish] 关键词matchType一致性检查:`)
        console.log(`   - 用户配置关键词数量: ${_campaignConfig.keywords?.length || 0}`)
        if (keywordsWithVolumeFromConfig.length > 0) {
          const matchTypeDist = keywordsWithVolumeFromConfig.reduce((acc: any, kw: any) => {
            const type = kw.matchType || 'UNKNOWN'
            acc[type] = (acc[type] || 0) + 1
            return acc
          }, {})
          console.log(`   - 用户配置的matchType分布:`, Object.entries(matchTypeDist).map(([type, count]) => `${type}: ${count}`).join(', '))
          if (keywordsWithVolumeFromConfig.length > 0) {
            console.log(`   - 示例关键词 #1: ${keywordsWithVolumeFromConfig[0].keyword} (${keywordsWithVolumeFromConfig[0].matchType})`)
          }
        }

        // 🔥 新增：调试日志 - 追踪构建的创意对象
        console.log(`[Publish] 构建的创意对象ID: ${creativeForLaunchScore.id}`)
        console.log(`[Publish] keywordsWithVolume长度: ${creativeForLaunchScore.keywordsWithVolume?.length || 0}`)
        if (creativeForLaunchScore.keywordsWithVolume && creativeForLaunchScore.keywordsWithVolume.length > 0) {
          const kwMatchTypeDist = creativeForLaunchScore.keywordsWithVolume.reduce((acc: any, kw: any) => {
            const type = kw.matchType || 'UNKNOWN'
            acc[type] = (acc[type] || 0) + 1
            return acc
          }, {})
          console.log(`   - keywordsWithVolume的matchType分布:`, Object.entries(kwMatchTypeDist).map(([type, count]) => `${type}: ${count}`).join(', '))
        }
        console.log(`[Publish] negativeKeywords字段存在: ${!!creativeForLaunchScore.negativeKeywords}`)
        console.log(`[Publish] negativeKeywords长度: ${creativeForLaunchScore.negativeKeywords?.length || 0}`)
        console.log(`[Publish] negativeKeywords示例: ${creativeForLaunchScore.negativeKeywords?.slice(0, 5).join(', ') || 'NONE'}`)

        // 重新计算Launch Score
        const launchScoreResult = await calculateLaunchScore(
          offer,
          creativeForLaunchScore,
          userId,
          {
            budgetAmount: _campaignConfig.budgetAmount,
            maxCpcBid: _campaignConfig.maxCpcBid,
            budgetType: _campaignConfig.budgetType,
            finalUrl: creativeForLaunchScore.final_url,  // 🔧 使用（可能被Step 3覆盖的）Final URL
            targetCountry: _campaignConfig.targetCountry,
            targetLanguage: _campaignConfig.targetLanguage
          }
        )

        // 🔥 新增：调试日志 - 追踪传递给Launch Score的campaignConfig参数
        console.log(`[Publish] 传递给Launch Score的campaignConfig:`)
        console.log(`   - budgetAmount: ${_campaignConfig.budgetAmount}/day`)
        console.log(`   - maxCpcBid: ${_campaignConfig.maxCpcBid}`)
        console.log(`   - finalUrl: ${creativeForLaunchScore.final_url}`)
        console.log(`   - targetCountry: ${_campaignConfig.targetCountry}`)
        console.log(`   - targetLanguage: ${_campaignConfig.targetLanguage}`)
        console.log(`[Publish] 传递给Launch Score的negativeKeywords长度: ${creativeData.negativeKeywords.length}`)
        console.log(`[Publish] 传递给Launch Score的negativeKeywords示例: ${creativeData.negativeKeywords.slice(0, 5).join(', ')}`)

        launchScore = launchScoreResult.totalScore
        scoreAnalysis = launchScoreResult.scoreAnalysis

        try {
          const { created } = await saveLaunchScoreWithContentCache(
            userId,
            _offerId,
            creativeForLaunchScore,
            offer,
            scoreAnalysis,
            {
              campaignConfig: {
                targetCountry: _campaignConfig.targetCountry || '',
                targetLanguage: _campaignConfig.targetLanguage || '',
                budgetAmount: _campaignConfig.budgetAmount || 0,
                maxCpcBid: _campaignConfig.maxCpcBid || 0,
              },
              contentHash,
              campaignConfigHash,
            }
          )
          console.log(
            created
              ? `✅ Launch Score已保存到launch_scores表（带缓存信息）`
              : `♻️ 复用已有 Launch Score 记录（相同内容哈希），跳过重复 INSERT`
          )

          // 2. 更新ad_creatives表的launch_score字段
          await db.exec(`
            UPDATE ad_creatives
            SET launch_score = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [launchScore, primaryCreative.id])
          console.log(`✅ ad_creatives.launch_score已更新为${launchScore}`)
        } catch (saveError: any) {
          // 保存失败不阻断流程，只记录警告
          console.warn(`⚠️ 保存Launch Score失败: ${saveError.message}`)
        }
      }

      // 🎯 从scoreAnalysis中提取各维度分数（v4.16 - 4维度智能matchType评分）
      analysis = scoreAnalysis

      // 🔧 修复：确保overallRecommendations在所有路径中可用
      overallRecommendations = scoreAnalysis?.overallRecommendations || extractAllSuggestions(scoreAnalysis)

      console.log(`📊 Launch Score评估结果 (v4.16): ${launchScore}分`)
      console.log(`   - 投放可行性: ${analysis.launchViability.score}/40`)
      console.log(`      • 品牌搜索量得分: ${analysis.launchViability.brandSearchScore}/15 (搜索量: ${analysis.launchViability.brandSearchVolume})`)
      console.log(`      • 竞争度得分: ${analysis.launchViability.competitionScore}/15 (${analysis.launchViability.competitionLevel})`)
      console.log(`      • 市场潜力得分: ${analysis.launchViability.marketPotentialScore || 0}/10`)
      console.log(`   - 广告质量: ${analysis.adQuality.score}/30`)
      console.log(`      • 广告强度: ${analysis.adQuality.adStrengthScore}/15 (${analysis.adQuality.adStrength})`)
      console.log(`      • 标题多样性得分: ${analysis.adQuality.headlineDiversityScore}/8 (${analysis.adQuality.headlineDiversity}%)`)
      console.log(`      • 描述质量得分: ${analysis.adQuality.descriptionQualityScore}/7`)
      console.log(`   - 关键词策略: ${analysis.keywordStrategy.score}/20`)
      console.log(`      • 相关性得分: ${analysis.keywordStrategy.relevanceScore}/8`)
      console.log(`      • 匹配类型策略: ${analysis.keywordStrategy.matchTypeScore}/6`)
      console.log(`      • 否定关键词得分: ${analysis.keywordStrategy.negativeKeywordsScore}/6`)
      console.log(`   - 基础配置: ${analysis.basicConfig.score}/10`)
      console.log(`      • 国家/语言得分: ${analysis.basicConfig.countryLanguageScore}/5`)
      console.log(`      • Final URL得分: ${analysis.basicConfig.finalUrlScore}/5`)

      // 阻断规则
      const CRITICAL_THRESHOLD = 40  // 严重问题阈值
      const WARNING_THRESHOLD = 80   // 警告阈值

      if (launchScore < CRITICAL_THRESHOLD) {
        // 强制阻断：<40分
        console.error(`❌ Launch Score过低: ${launchScore}分 < ${CRITICAL_THRESHOLD}分，强制阻断`)

        // 🎯 收集所有维度的问题和建议
        const allIssues = extractAllIssues(scoreAnalysis)
        const allSuggestions = extractAllSuggestions(scoreAnalysis)

        return NextResponse.json(
          {
            error: `投放风险过高（Launch Score: ${launchScore}分），无法发布`,
            details: {
              launchScore,
              threshold: CRITICAL_THRESHOLD,
              breakdown: {
                launchViability: { score: analysis.launchViability.score, max: 35 },
                adQuality: { score: analysis.adQuality.score, max: 30 },
                keywordStrategy: { score: analysis.keywordStrategy.score, max: 20 },
                basicConfig: { score: analysis.basicConfig.score, max: 15 }
              },
              issues: allIssues,
              suggestions: allSuggestions,
              overallRecommendations: overallRecommendations  // 🔧 修复：使用正确的变量
            },
            action: 'LAUNCH_SCORE_BLOCKED'
          },
          { status: 422 } // 422 Unprocessable Entity
        )
      } else if (launchScore < WARNING_THRESHOLD && !_forcePublish) {
        // 警告但可绕过：40-80分
        console.warn(`⚠️ Launch Score偏低: ${launchScore}分 < ${WARNING_THRESHOLD}分，建议优化后再发布`)

        // 🎯 收集所有维度的问题和建议
        const allIssues = extractAllIssues(scoreAnalysis)
        const allSuggestions = extractAllSuggestions(scoreAnalysis)

        return NextResponse.json(
          {
            error: `投放风险较高（Launch Score: ${launchScore}分），建议优化`,
            details: {
              launchScore,
              threshold: WARNING_THRESHOLD,
              breakdown: {
                launchViability: { score: analysis.launchViability.score, max: 35 },
                adQuality: { score: analysis.adQuality.score, max: 30 },
                keywordStrategy: { score: analysis.keywordStrategy.score, max: 20 },
                basicConfig: { score: analysis.basicConfig.score, max: 15 }
              },
              issues: allIssues,
              suggestions: allSuggestions,
              overallRecommendations: overallRecommendations,  // 🔧 修复：使用正确的变量
              canForcePublish: true // 允许强制发布
            },
            action: 'LAUNCH_SCORE_WARNING'
          },
          { status: 422 }
        )
      }

      console.log(`✅ Launch Score评估通过: ${launchScore}分 ${_forcePublish ? '(强制发布)' : ''}`)

    } catch (error: any) {
      console.error('Launch Score评估失败:', error.message)
      // Launch Score评估失败不阻断发布，只记录日志
      console.warn('⚠️ Launch Score评估失败，跳过风险评估')
    }

    // 8. A/B测试功能已下线 (KISS optimization 2025-12-08)
    // 保留ab_test_id变量以保持向后兼容性，但始终为null
    const abTestId: number | null = null
    // A/B测试记录创建已移除 - 原代码: INSERT INTO ab_tests ...

    // 9–10. 严格一对一：1 条本地 Campaign + 1 个 Ad Group（智能优化仅选最高分创意）
    const selectedCreative = creatives[0]
    const now = new Date().toISOString()

    const naming = generateNamingScheme({
      offer: {
        id: _offerId,
        brand: offer.brand,
        offerName: offer.offer_name || undefined,
        category: offer.category || undefined,
      },
      config: {
        targetCountry: _campaignConfig.targetCountry,
        budgetAmount: _campaignConfig.budgetAmount,
        budgetType: _campaignConfig.budgetType,
        biddingStrategy: _campaignConfig.biddingStrategy,
        maxCpcBid: _campaignConfig.maxCpcBid,
      },
      creative: {
        id: selectedCreative.id,
        theme: selectedCreative.theme || undefined,
      },
      smartOptimization: _enableSmartOptimization ? { enabled: true } : undefined,
    })

    const allowCustomAdGroupName = Boolean(baseAdGroupName && parsedAdGroupName)
    const resolvedCampaignName = baseCampaignName
      || naming.associativeCampaignName
      || naming.campaignName
    const resolvedAdGroupName = allowCustomAdGroupName ? baseAdGroupName : naming.adGroupName
    const resolvedAdName = baseAdName || naming.adName
    const campaignConfigForCreative = buildAlignedCampaignConfigForCreative(
      selectedCreative,
      'persist_single'
    )

    const effectiveCreativeForPersistence = buildEffectiveCreative({
      dbCreative: {
        headlines: selectedCreative.headlines,
        descriptions: selectedCreative.descriptions,
        keywords: selectedCreative.keywords,
        negativeKeywords: selectedCreative.negative_keywords,
        callouts: selectedCreative.callouts,
        sitelinks: selectedCreative.sitelinks,
        finalUrl: selectedCreative.final_url,
        finalUrlSuffix: selectedCreative.final_url_suffix,
      },
      campaignConfig: campaignConfigForCreative,
      offerUrlFallback: offer.url,
    })

    const persistedKeywordConfig = resolveTaskCampaignKeywords({
      configuredKeywords: campaignConfigForCreative.keywords,
      configuredNegativeKeywords: campaignConfigForCreative.negativeKeywords,
      fallbackKeywords: effectiveCreativeForPersistence.keywords,
      fallbackNegativeKeywords: effectiveCreativeForPersistence.negativeKeywords,
    })

    const publishNaming = {
      ...naming,
      campaignName: resolvedCampaignName,
      associativeCampaignName: resolvedCampaignName,
      adGroupName: resolvedAdGroupName,
      adName: resolvedAdName || naming.adName || '',
    }

    const primaryCampaignConfig: Record<string, any> = {
      ...campaignConfigForCreative,
      campaignName: resolvedCampaignName,
      adGroupName: resolvedAdGroupName,
      keywords: persistedKeywordConfig.keywords,
      negativeKeywords: persistedKeywordConfig.negativeKeywords,
      budgetAmount: _campaignConfig.budgetAmount,
      budgetType: _campaignConfig.budgetType,
      headlines: effectiveCreativeForPersistence.headlines,
      descriptions: effectiveCreativeForPersistence.descriptions,
      callouts: effectiveCreativeForPersistence.callouts,
      sitelinks: effectiveCreativeForPersistence.sitelinks,
      finalUrl: effectiveCreativeForPersistence.finalUrl,
      finalUrlSuffix: effectiveCreativeForPersistence.finalUrlSuffix,
      ...(resolvedAdName ? { adName: resolvedAdName } : {}),
      ...(_enableSmartOptimization
        ? { smartOptimization: { enabled: true, selectedCreativeId: selectedCreative.id } }
        : {}),
    }

    const normalizedBudgetType = primaryCampaignConfig.budgetType ?? _campaignConfig.budgetType
    const normalizedMaxCpc = Number(primaryCampaignConfig.maxCpcBid)
    const persistedMaxCpc = Number.isFinite(normalizedMaxCpc) && normalizedMaxCpc > 0
      ? normalizedMaxCpc
      : null

    console.log(
      `📝 生成命名: Campaign=${resolvedCampaignName}, AdGroup=${resolvedAdGroupName}, Ad=${resolvedAdName || naming.adName}`
    )

    let campaignId: number
    let resumedExistingCampaign = false
    try {
      if (resumableCampaign) {
        campaignId = resumableCampaign.id
        resumedExistingCampaign = true
        await reactivateCampaignForPublishResume({
          campaignId,
          offerId: Number(_offerId),
          userId,
          googleAdsAccountId: resolvedGoogleAdsAccountId,
          adCreativeId: Number(selectedCreative.id),
          campaignName: publishNaming.associativeCampaignName || publishNaming.campaignName,
          campaignConfig: primaryCampaignConfig,
          budgetAmount: _campaignConfig.budgetAmount,
          budgetType: String(normalizedBudgetType || _campaignConfig.budgetType || 'DAILY'),
          maxCpc: persistedMaxCpc,
        })
        console.log(
          `[CampaignPublish] 续发复用 Campaign ${campaignId}（offer=${_offerId}, status=${resumableCampaign.creation_status}）`
        )
      } else {
        const campaignInsert = await db.exec(`
          INSERT INTO campaigns (
            user_id,
            offer_id,
            google_ads_account_id,
            campaign_name,
            budget_amount,
            budget_type,
            max_cpc,
            status,
            creation_status,
            ad_creative_id,
            campaign_config,
            pause_old_campaigns,
            is_test_variant,
            ab_test_id,
            traffic_allocation,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAUSED', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId,
          _offerId,
          resolvedGoogleAdsAccountId,
          publishNaming.associativeCampaignName || publishNaming.campaignName,
          _campaignConfig.budgetAmount,
          normalizedBudgetType,
          persistedMaxCpc,
          selectedCreative.id,
          JSON.stringify(primaryCampaignConfig),
          _pauseOldCampaigns ? 1 : 0,
          0,
          abTestId,
          1,
          now,
          now,
        ])
        campaignId = getInsertedId(campaignInsert, db.type)
      }
    } catch (insertError) {
      if (isCampaignOfferUniqueViolation(insertError)) {
        const raceConflict = await getActiveCampaignConflictForOffer(_offerId, userId)
        const error = createError.invalidParameter({
          field: 'offerId',
          value: _offerId,
          constraint: 'One Offer can only have one Campaign',
        })
        return NextResponse.json({
          ...error.toJSON(),
          message: CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE,
          ...(raceConflict
            ? {
                existingCampaign: {
                  id: raceConflict.id,
                  campaignName: raceConflict.campaign_name,
                  creationStatus: raceConflict.creation_status,
                  status: raceConflict.status,
                },
              }
            : {}),
        }, { status: 409 })
      }
      throw insertError
    }

    const effectiveCreativeForTask = buildEffectiveCreative({
      dbCreative: {
        headlines: selectedCreative.headlines,
        descriptions: selectedCreative.descriptions,
        keywords: selectedCreative.keywords,
        negativeKeywords: selectedCreative.negative_keywords,
        callouts: selectedCreative.callouts,
        sitelinks: selectedCreative.sitelinks,
        finalUrl: selectedCreative.final_url,
        finalUrlSuffix: selectedCreative.final_url_suffix,
      },
      campaignConfig: primaryCampaignConfig,
      offerUrlFallback: offer.url,
    })
    // effectiveCreativeForPersistence 已在 primaryCampaignConfig 构建前计算

    const taskKeywordConfig = resolveTaskCampaignKeywords({
      configuredKeywords: primaryCampaignConfig.keywords,
      configuredNegativeKeywords: primaryCampaignConfig.negativeKeywords,
      fallbackKeywords: effectiveCreativeForTask.keywords,
      fallbackNegativeKeywords: effectiveCreativeForTask.negativeKeywords,
    })

    // 11. 发布到 Google Ads（1 Campaign + 1 Ad Group，异步队列）
    const publishResults: any[] = []
    const failedCampaigns: any[] = []

    try {
      const { getOrCreateQueueManager } = await import('@/lib/queue/init-queue')
      const queue = await getOrCreateQueueManager()

      try {
        const taskData: any = {
          campaignId,
          offerId: _offerId,
          googleAdsAccountId: resolvedGoogleAdsAccountId,
          userId,
          resumePublish: resumedExistingCampaign,
          naming: publishNaming,
          marketingObjective: _campaignConfig.marketingObjective || 'WEB_TRAFFIC',
          campaignConfig: {
            targetCountry: primaryCampaignConfig.targetCountry,
            targetLanguage: primaryCampaignConfig.targetLanguage,
            biddingStrategy: primaryCampaignConfig.biddingStrategy,
            budgetAmount: _campaignConfig.budgetAmount,
            budgetType: primaryCampaignConfig.budgetType ?? _campaignConfig.budgetType,
            maxCpcBid: primaryCampaignConfig.maxCpcBid,
            keywords: taskKeywordConfig.keywords,
            negativeKeywords: taskKeywordConfig.negativeKeywords,
            negativeKeywordMatchType:
              primaryCampaignConfig.negativeKeywordMatchType ||
              primaryCampaignConfig.negativeKeywordsMatchType ||
              undefined,
          },
          creative: {
            id: selectedCreative.id,
            headlines: effectiveCreativeForTask.headlines,
            descriptions: effectiveCreativeForTask.descriptions,
            finalUrl: effectiveCreativeForTask.finalUrl,
            finalUrlSuffix: effectiveCreativeForTask.finalUrlSuffix,
            path1: selectedCreative.path_1,
            path2: selectedCreative.path_2,
            callouts: effectiveCreativeForTask.callouts,
            sitelinks: effectiveCreativeForTask.sitelinks,
            keywordsWithVolume: selectedCreative.keywords_with_volume
              ? JSON.parse(selectedCreative.keywords_with_volume)
              : undefined,
          },
          brandName: offer.brand,
          forcePublish: _forcePublish,
          enableCampaignImmediately: _enableCampaignImmediately,
          pauseOldCampaigns: _pauseOldCampaigns,
        }

        await queue.enqueue('campaign-publish', taskData, userId, {
          parentRequestId,
          priority: 'high',
        })

        console.log(`✅ Campaign发布任务已入队 ID: ${campaignId}（1 Campaign + 1 Ad Group）`)

        publishResults.push({
          id: campaignId,
          status: 'queued',
          creationStatus: 'pending',
          resumed: resumedExistingCampaign,
          message: resumedExistingCampaign
            ? '已续发上次未完成的发布任务，将复用远端 Campaign 并补全缺失资源'
            : '广告系列发布任务已提交（1 个 Campaign + 1 个 Ad Group）',
        })
      } catch (enqueueError: any) {
        const errorMessage = enqueueError?.message || '队列任务创建失败'
        console.error(`❌ Campaign ${campaignId} 队列化失败:`, errorMessage)

        const rolledBack = await rollbackPendingCampaignAfterEnqueueFailure({
          campaignId,
          offerId: _offerId,
          userId,
          reason: `队列化失败: ${errorMessage}`,
        })
        if (rolledBack) {
          invalidateOfferCache(userId, Number(_offerId))
        }

        failedCampaigns.push({
          id: campaignId,
          error: errorMessage,
          rolledBack,
          canRetryPublish: rolledBack,
        })
      }

      // A/B测试功能已下线 (KISS optimization 2025-12-08)
      // ab_test_variants记录创建已移除 - abTestId始终为null

      const numericOfferId = Number(_offerId)
      if (Number.isFinite(numericOfferId) && numericOfferId > 0) {
        invalidateOfferCache(userId, numericOfferId)
      } else {
        invalidateOfferCache(userId)
      }

      return NextResponse.json({
        success: publishResults.length > 0,
        abTestId: abTestId,  // 🔧 修复(2025-12-11): ab_test_id → abTestId
        campaigns: publishResults,
        failed: failedCampaigns,
        pausedOldCampaigns: pausedOldCampaignsSummary,
        warnings: publishWarnings.length > 0 ? publishWarnings : undefined,
        summary: {
          total: 1,
          successful: publishResults.length,
          failed: failedCampaigns.length,
        },
        // 🔥 新增(2025-12-19): Launch Score评分结果
        launchScore: (launchScore > 0 && analysis) ? {
          totalScore: launchScore,
          breakdown: {
            launchViability: { score: analysis.launchViability.score, max: 40 },
            adQuality: { score: analysis.adQuality.score, max: 30 },
            keywordStrategy: { score: analysis.keywordStrategy.score, max: 20 },
            basicConfig: { score: analysis.basicConfig.score, max: 10 }
          },
          overallRecommendations: overallRecommendations || []
        } : undefined,
        // 🔧 修复(2025-12-19): 强调这是异步队列状态，不是最终结果
        // 前端应该轮询campaign.creation_status而不仅仅依赖HTTP响应码
        message: publishResults.length > 0
          ? '1 个广告系列（1 Campaign + 1 Ad Group）已提交到后台处理，请稍候...'
          : '广告系列队列化失败',
        note: '请通过轮询 campaign.creation_status 监听实际发布结果。可能值: pending(处理中) | synced(成功) | failed(失败)'
      }, { status: 202 })

    } catch (error: any) {
      // 批量队列化的系统级错误
      console.error('Batch publish queue error:', error)

      if (campaignId > 0) {
        const rolledBack = await rollbackPendingCampaignAfterEnqueueFailure({
          campaignId,
          offerId: _offerId,
          userId,
          reason: `队列系统错误: ${error?.message || 'unknown'}`,
        }).catch((rollbackError: any) => {
          console.error('[Publish] 入队失败后回滚 campaign 失败:', rollbackError?.message || rollbackError)
          return false
        })
        if (rolledBack) {
          invalidateOfferCache(userId, Number(_offerId))
        }
      }

      // OAuth refresh token 过期/被撤销：提示前端引导用户重新授权，避免用户反复重试
      if (isOAuthTokenExpiredOrRevoked(error)) {
        return NextResponse.json({
          error: 'OAuth 授权已过期',
          code: 'OAUTH_TOKEN_EXPIRED',
          message: 'Google OAuth refresh token 已过期或失效，请前往设置页面重新授权后再发布',
          needsReauth: true
        }, { status: 401 })
      }

      // 如果是AppError，直接返回
      if (error instanceof AppError) {
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }

      // 通用错误
      const appError = createError.campaignCreateFailed({
        originalError: error.message
      })
      return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
    }

  } catch (error: any) {
    console.error('Publish campaign error:', error)

    // OAuth refresh token 过期/被撤销：提示前端引导用户重新授权，避免用户反复重试
    if (isOAuthTokenExpiredOrRevoked(error)) {
      return NextResponse.json({
        error: 'OAuth 授权已过期',
        code: 'OAUTH_TOKEN_EXPIRED',
        message: 'Google OAuth refresh token 已过期或失效，请前往设置页面重新授权后再发布',
        needsReauth: true
      }, { status: 401 })
    }

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 通用系统错误
    const appError = createError.internalError({
      operation: 'publish_campaign',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}
