import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  getGoogleAdsAuthContext,
  GOOGLE_ADS_DUAL_STACK_WARNING,
  hasConfiguredGoogleAdsAuthFromContext,
  resolveConfiguredGoogleAdsAuthType,
  resolveEffectiveServiceAccountId,
} from '@/lib/google-ads-auth-context'
import { formatErrorMessage } from '@/lib/google-ads-credentials-errors'
import {
  healAccountsRouteDeveloperToken,
  resolveAccountsRouteAuthBundle,
} from '@/lib/google-ads-accounts-auth'
import {
  type CachedAccount,
  getCachedAccounts,
  GOOGLE_ADS_ACCOUNTS_CACHE_MAX_AGE_MS,
} from '@/lib/google-ads-accounts-cache'
import { syncAccountsFromAPI } from '@/lib/google-ads-accounts-sync'
import { getDatabase } from '@/lib/db'
import { toNumber } from '@/lib/utils'
import { withPerformanceMonitoring } from '@/lib/api-performance'
import {
  buildGoogleAdsAccountSyncKey,
  completeGoogleAdsAccountAsyncRefresh,
  getGoogleAdsAccountAsyncRefreshState,
  isGoogleAdsAccountRefreshInProgress,
  tryStartGoogleAdsAccountAsyncRefresh,
} from '@/lib/google-ads-accounts-async-refresh-state'
import { parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'

// 该接口返回用户私有数据（账号列表/关联Offer），必须禁用任何层面的静态缓存
export const dynamic = 'force-dynamic'

function jsonNoStore(body: any, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
    },
  })
}

const IS_DELETED_TRUE = 'IS_DELETED_TRUE'

function parseDbTimestampToMs(value: string | null | undefined) {
  if (!value) return NaN
  // SQLite datetime('now') 常见格式：'YYYY-MM-DD HH:mm:ss'（UTC，无时区标记）
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    return Date.parse(value.replace(' ', 'T') + 'Z')
  }
  return Date.parse(value)
}

function getLatestSyncAtMs(accounts: CachedAccount[]) {
  let latest = NaN
  for (const acc of accounts) {
    const ms = parseDbTimestampToMs(acc.last_sync_at)
    if (!Number.isNaN(ms) && (Number.isNaN(latest) || ms > latest)) latest = ms
  }
  return latest
}

function extractGoogleAdsFailureMessages(error: any): string[] {
  const messages: string[] = []

  if (!error) return messages

  if (typeof error?.details === 'string' && error.details.trim()) {
    messages.push(error.details.trim())
  }

  const errors = error?.errors
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (typeof item?.message === 'string' && item.message.trim()) {
        messages.push(item.message.trim())
      }
    }
  }

  const statusDetails = error?.statusDetails
  if (Array.isArray(statusDetails)) {
    for (const detail of statusDetails) {
      const nestedErrors = detail?.errors
      if (Array.isArray(nestedErrors)) {
        for (const item of nestedErrors) {
          if (typeof item?.message === 'string' && item.message.trim()) {
            messages.push(item.message.trim())
          }
        }
      }
    }
  }

  return messages
}

function extractGoogleAdsErrorMessage(error: any): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()

  const fromFailure = extractGoogleAdsFailureMessages(error)
  if (fromFailure.length > 0) return fromFailure[0]

  return formatErrorMessage(error)
}

function getErrorHttpStatus(error: any): number | null {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.response?.statusCode,
  ]
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function getOAuthErrorFromResponse(error: any): { error?: string; errorDescription?: string } {
  const data = error?.response?.data
  if (!data) return {}

  const oauthError = typeof data.error === 'string' ? data.error : undefined
  const oauthErrorDescription =
    typeof data.error_description === 'string'
      ? data.error_description
      : typeof data.errorDescription === 'string'
        ? data.errorDescription
        : undefined

  return { error: oauthError, errorDescription: oauthErrorDescription }
}

async function get(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return jsonNoStore({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const authContext = await getGoogleAdsAuthContext(userId)
    if (authContext.dualStack) {
      return jsonNoStore(
        {
          error: GOOGLE_ADS_DUAL_STACK_WARNING,
          code: 'DUAL_STACK_CONFLICT',
          message: GOOGLE_ADS_DUAL_STACK_WARNING,
          authConfigWarning: GOOGLE_ADS_DUAL_STACK_WARNING,
        },
        { status: 409 }
      )
    }
    if (!hasConfiguredGoogleAdsAuthFromContext(authContext)) {
      return jsonNoStore(
        {
          error: 'Google Ads 认证未配置或已失效',
          code: 'CREDENTIALS_NOT_CONFIGURED',
          message: '请先在设置中完成 OAuth 授权或配置服务账号',
        },
        { status: 404 }
      )
    }
    const ownerUserId = authContext.ownerUserId

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === 'true'
    const asyncRefresh = searchParams.get('async') === 'true'
    const offerIdParam = searchParams.get('offerId')
    const offerId = offerIdParam ? parsePositiveIntegerOfferId(offerIdParam) ?? null : null
    const authTypeParam = searchParams.get('auth_type') as 'oauth' | 'service_account' | null
    const configuredAuthType = resolveConfiguredGoogleAdsAuthType(authContext)
    const authType: 'oauth' | 'service_account' =
      authTypeParam === 'oauth' || authTypeParam === 'service_account'
        ? authTypeParam
        : configuredAuthType

    if (
      authTypeParam &&
      (authTypeParam === 'oauth' || authTypeParam === 'service_account') &&
      configuredAuthType &&
      authTypeParam !== configuredAuthType
    ) {
      return jsonNoStore(
        {
          error: '认证方式与当前配置不一致',
          code: 'AUTH_TYPE_MISMATCH',
          message:
            configuredAuthType === 'service_account'
              ? '当前已配置服务账号认证，请使用 auth_type=service_account，或在设置页删除服务账号后再使用 OAuth。'
              : '当前已配置 OAuth 认证，请使用 auth_type=oauth，或在设置页删除 OAuth 后再使用服务账号。',
          configuredAuthType,
          requestedAuthType: authTypeParam,
        },
        { status: 409 }
      )
    }

    const queryServiceAccountId = searchParams.get('service_account_id')?.trim() || null
    const scopedServiceAccountId: string | null =
      authType === 'service_account'
        ? queryServiceAccountId ||
          resolveEffectiveServiceAccountId(null, authContext) ||
          null
        : null

    console.log(`🔍 [GET /api/google-ads/credentials/accounts] forceRefresh=${forceRefresh}, asyncRefresh=${asyncRefresh}, offerId=${offerId}, authType=${authType}`)

    const authResolved = await resolveAccountsRouteAuthBundle({
      userId,
      authContext,
      authType,
      serviceAccountId: scopedServiceAccountId,
    })
    if (!authResolved.ok) {
      return jsonNoStore(authResolved.body, { status: authResolved.status })
    }

    let { credentials, serviceAccountConfig, loginCustomerId } = authResolved.bundle

    // 校验: login_customer_id 必须存在（MCC账户ID是调用Google Ads API的必填项）
    if (!loginCustomerId) {
      return jsonNoStore({
        error: '缺少 Login Customer ID (MCC账户ID)',
        message: '请先在设置页面配置 Login Customer ID，这是使用 Google Ads API 的必填项'
      }, { status: 400 })
    }

    const clientSecret = String(credentials?.client_secret || '')
    const healResult = await healAccountsRouteDeveloperToken({
      credentials,
      authType,
      ownerUserId,
      clientSecret,
      serviceAccountId: scopedServiceAccountId,
      serviceAccountConfig,
      authContext,
    })
    if (!healResult.ok) {
      const isDualStack = healResult.code === 'DUAL_STACK_CONFLICT'
      return jsonNoStore(
        {
          error: isDualStack
            ? GOOGLE_ADS_DUAL_STACK_WARNING
            : 'Google Ads Developer Token 配置无效',
          code: healResult.code,
          message: healResult.message,
          ...(isDualStack ? { authConfigWarning: healResult.message } : {}),
        },
        { status: isDualStack ? 409 : 400 }
      )
    }

    let allAccounts: any[]

    const syncKey = buildGoogleAdsAccountSyncKey({
      userId,
      authType,
      serviceAccountId: scopedServiceAccountId,
    })
    const syncState = await getGoogleAdsAccountAsyncRefreshState(syncKey)
    const refreshInProgress = isGoogleAdsAccountRefreshInProgress(syncState)

    const cachedAccounts = await getCachedAccounts({
      userId,
      authType,
      serviceAccountId: scopedServiceAccountId,
    })
    const authConfigWarning = null
    const latestSyncAtMs = getLatestSyncAtMs(cachedAccounts)
    const cacheAgeMs = Number.isNaN(latestSyncAtMs) ? Number.POSITIVE_INFINITY : Date.now() - latestSyncAtMs
    const cacheStaleBeforeRefresh = cacheAgeMs > GOOGLE_ADS_ACCOUNTS_CACHE_MAX_AGE_MS
    console.log(`📦 缓存中有 ${cachedAccounts.length} 个账号`)

	    const mapCachedAccounts = () => cachedAccounts.map(acc => {
	      const identityVerificationOverdue = toNumber(acc.identity_verification_overdue, 0) === 1
	      const status = acc.status || 'UNKNOWN'

	      return {
	        customer_id: acc.customer_id,
	        descriptive_name: acc.account_name || `客户 ${acc.customer_id}`,
	        currency_code: acc.currency,
	        time_zone: acc.timezone,
	        manager: toNumber(acc.is_manager_account, 0) === 1,
	        test_account: toNumber(acc.test_account, 0) === 1,
	        status,
	        account_balance: acc.account_balance,
	        parent_mcc: acc.parent_mcc_id,
	        identity_verification_program_status: acc.identity_verification_program_status,
	        identity_verification_start_deadline_time: acc.identity_verification_start_deadline_time,
	        identity_verification_completion_deadline_time: acc.identity_verification_completion_deadline_time,
	        identity_verification_overdue: identityVerificationOverdue,
	        identity_verification_checked_at: acc.identity_verification_checked_at,
	        db_account_id: acc.id,
	        last_sync_at: acc.last_sync_at,
	      }
	    })

    let usedCache = false
    let refreshFailed = false
    let effectiveLastSyncAtIso: string | null = Number.isNaN(latestSyncAtMs) ? null : new Date(latestSyncAtMs).toISOString()

    if (forceRefresh && asyncRefresh) {
      // 异步刷新：立即返回缓存（或空列表），后台继续同步，前端可通过轮询拿到逐步写入的账号数据
      usedCache = true
      allAccounts = cachedAccounts.length > 0 ? mapCachedAccounts() : []

      if (!refreshInProgress) {
        const syncKeyParams = {
          userId,
          authType,
          serviceAccountId: scopedServiceAccountId,
        }
        const shouldRunSync = await tryStartGoogleAdsAccountAsyncRefresh(syncKey, syncKeyParams)

        if (shouldRunSync) {
          void (async () => {
            try {
              await syncAccountsFromAPI(userId, credentials, authType, serviceAccountConfig)
              await completeGoogleAdsAccountAsyncRefresh(syncKey, syncKeyParams, {
                status: 'completed',
              })
            } catch (err: any) {
              await completeGoogleAdsAccountAsyncRefresh(syncKey, syncKeyParams, {
                status: 'failed',
                errorMessage: formatErrorMessage(err) || '同步失败',
              })
            }
          })()
        }
      }
    } else if (!forceRefresh && cachedAccounts.length > 0) {
      // 使用缓存数据（即使缓存已过期也先返回，避免请求阻塞/网关超时；由 refresh=true 显式触发同步）
      usedCache = true
      console.log(`✅ 使用缓存的 ${cachedAccounts.length} 个账号 (ageMs=${cacheAgeMs})`)
      allAccounts = mapCachedAccounts()
    } else {
      // 从 API 获取并同步（仅在 refresh=true 或无缓存时执行）
      console.log(`🔄 从 Google Ads API 同步账号... (forceRefresh=${forceRefresh}, cacheStale=${cacheStaleBeforeRefresh})`)
      try {
        allAccounts = await syncAccountsFromAPI(userId, credentials, authType, serviceAccountConfig)
        console.log(`✅ 同步完成，获取到 ${allAccounts.length} 个账号`)
        effectiveLastSyncAtIso = new Date().toISOString()
      } catch (err) {
        // 降级：如果刷新失败但有缓存，允许继续使用缓存（避免发布流程完全阻塞）
        if (cachedAccounts.length > 0) {
          refreshFailed = true
          usedCache = true
          console.warn(`⚠️ 同步账号失败，回退使用缓存账号列表:`, err)
          allAccounts = mapCachedAccounts()
        } else {
          throw err
        }
      }
    }

    // 查询关联的 Offer 信息
    const db = await getDatabase()

    // 🔓 KISS优化(2025-12-12): 获取当前Offer的品牌名（用于同品牌优先级计算）
    let currentOfferBrand: string | null = null
    if (offerId) {
      const currentOffer = await db.queryOne(`
        SELECT brand FROM offers WHERE id = ? AND user_id = ?
      `, [offerId, userId]) as { brand: string } | undefined
      currentOfferBrand = currentOffer?.brand || null
    }

    // 🔧 修复(2026-02-08): 关联Offer查询使用更稳健的“未删除”判定
    // 兼容历史数据（is_deleted 为空）并兜底 deleted_at 软删除标记，避免已删除Offer仍显示在关联列表中。
    const offerNotDeletedCondition = db.type === 'postgres'
      ? '(o.is_deleted = FALSE OR o.is_deleted IS NULL) AND o.deleted_at IS NULL'
      : '(o.is_deleted = 0 OR o.is_deleted IS NULL) AND o.deleted_at IS NULL'

    const campaignNotDeletedCondition = db.type === 'postgres'
      ? '(c.is_deleted = FALSE OR c.is_deleted IS NULL) AND c.deleted_at IS NULL'
      : '(c.is_deleted = 0 OR c.is_deleted IS NULL) AND c.deleted_at IS NULL'

    const accountsWithOffers = await Promise.all(allAccounts.map(async (account) => {
      const dbAccountId = account.db_account_id
      if (!dbAccountId) {
        // 🔧 修复(2025-12-11): 转换snake_case为camelCase，保持API响应一致性
        return {
          customerId: account.customer_id,
          descriptiveName: account.descriptive_name,
          currencyCode: account.currency_code,
          timeZone: account.time_zone,
          manager: account.manager,
          testAccount: account.test_account,
          status: account.status,
          accountBalance: account.account_balance,
          parentMcc: account.parent_mcc,
          identityVerification: {
            programStatus: account.identity_verification_program_status ?? null,
            startDeadlineTime: account.identity_verification_start_deadline_time ?? null,
            completionDeadlineTime: account.identity_verification_completion_deadline_time ?? null,
            overdue: Boolean(account.identity_verification_overdue),
            checkedAt: account.identity_verification_checked_at ?? null,
          },
          dbAccountId: account.db_account_id,
          lastSyncAt: account.last_sync_at,
          linkedOffers: [],
          // 🔓 KISS优化(2025-12-12): 优先级标识
          priority: 'none' as const,
          priorityScore: 0
        }
      }

      const linkedOffers = await db.query(`
        SELECT DISTINCT
          o.id,
          o.offer_name,
          o.brand,
          o.target_country,
          CASE
            WHEN o.is_deleted = IS_DELETED_TRUE OR o.deleted_at IS NOT NULL THEN 0
            ELSE 1
          END as is_active,
          COUNT(DISTINCT c.id) as campaign_count
        FROM offers o
        INNER JOIN campaigns c ON o.id = c.offer_id
        WHERE c.google_ads_account_id = ?
          AND c.user_id = ?
          AND o.user_id = ?
          AND ${offerNotDeletedCondition}
          AND ${campaignNotDeletedCondition}
          AND UPPER(TRIM(COALESCE(c.status, ''))) != 'REMOVED'
          -- 仅把“已成功发布到Google Ads”的campaign计为绑定，避免 failed/pending 造成误绑定展示
          AND c.google_campaign_id IS NOT NULL
          AND c.google_campaign_id != ''
        GROUP BY o.id, o.offer_name, o.brand, o.target_country, o.is_deleted, o.deleted_at
      `, [dbAccountId, userId, userId])

      // 🔧 修复(2025-12-11): 转换snake_case为camelCase，保持API响应一致性
      const linkedOffersMapped = linkedOffers.map((offer: any) => ({
        id: offer.id,
        offerName: offer.offer_name,
        brand: offer.brand,
        targetCountry: offer.target_country,
        isActive: offer.is_active === 1,
        campaignCount: offer.campaign_count
      }))

      // 🔓 KISS优化(2025-12-12): 计算账号优先级
      // priority: 'current' = 当前Offer已用过 | 'same-brand' = 同品牌Offer用过 | 'none' = 未使用
      // priorityScore: 用于排序 (2=current, 1=same-brand, 0=none)
      let priority: 'current' | 'same-brand' | 'none' = 'none'
      let priorityScore = 0

      if (offerId && linkedOffersMapped.length > 0) {
        // 检查是否被当前Offer使用过
        const usedByCurrentOffer = linkedOffersMapped.some((o: any) => o.id === offerId)
        if (usedByCurrentOffer) {
          priority = 'current'
          priorityScore = 2
        } else if (currentOfferBrand) {
          // 检查是否被同品牌Offer使用过
          const usedBySameBrand = linkedOffersMapped.some((o: any) => o.brand === currentOfferBrand)
          if (usedBySameBrand) {
            priority = 'same-brand'
            priorityScore = 1
          }
        }
      }

	      return {
	        customerId: account.customer_id,
	        descriptiveName: account.descriptive_name,
	        currencyCode: account.currency_code,
        timeZone: account.time_zone,
        manager: account.manager,
        testAccount: account.test_account,
        status: account.status,
        accountBalance: account.account_balance,
        parentMcc: account.parent_mcc,
	        identityVerification: {
	          programStatus: account.identity_verification_program_status ?? null,
	          startDeadlineTime: account.identity_verification_start_deadline_time ?? null,
	          completionDeadlineTime: account.identity_verification_completion_deadline_time ?? null,
	          overdue: Boolean(account.identity_verification_overdue),
	          checkedAt: account.identity_verification_checked_at ?? null,
	        },
	        dbAccountId: account.db_account_id,
	        lastSyncAt: account.last_sync_at,
	        linkedOffers: linkedOffersMapped,
	        // 🔓 KISS优化(2025-12-12): 优先级标识
	        priority,
	        priorityScore
	      }
	    }))

	    // 🔓 KISS优化(2025-12-12): 按优先级排序
	    // 排序规则: priorityScore DESC > is_manager_account DESC > account_name ASC
	    accountsWithOffers.sort((a, b) => {
	      // 1. 优先级分数高的在前
	      if (b.priorityScore !== a.priorityScore) {
	        return b.priorityScore - a.priorityScore
	      }
      // 2. MCC账号在前（用于展示层级结构）
      if (a.manager !== b.manager) {
        return a.manager ? -1 : 1
      }
      // 3. 按名称字母排序
      return (a.descriptiveName || '').localeCompare(b.descriptiveName || '')
    })

    // 🔧 过滤：只返回用户 MCC 下的账号（非 MCC 账号）
    // 当 filterByUserMcc=true 时：
    // - 普通用户：只返回 parentMcc 在用户分配的 MCC 列表中的非 MCC 账号
    // - 管理员：跳过过滤，显示所有非 MCC 账号
    const filterByUserMcc = searchParams.get('filterByUserMcc') === 'true'
    const isAdmin = authResult.user.role === 'admin'
    
    let finalAccounts = accountsWithOffers
    
    if (filterByUserMcc && !isAdmin) {
      // 获取用户分配的 MCC 列表
      const userMccAssignments = await db.query(`
        SELECT mcc_customer_id FROM user_mcc_assignments WHERE user_id = ?
      `, [userId]) as Array<{ mcc_customer_id: string }>
      
      const userMccIds = new Set(userMccAssignments.map(a => a.mcc_customer_id))
      
      // 过滤：只保留 parentMcc 在用户 MCC 列表中的非 MCC 账号
      finalAccounts = accountsWithOffers.filter(account => {
        // 排除 MCC 账号
        if (account.manager) return false
        // 只保留 parentMcc 在用户分配列表中的账号
        return account.parentMcc && userMccIds.has(account.parentMcc)
      })
      
      console.log(`🔧 filterByUserMcc=true (普通用户): 从 ${accountsWithOffers.length} 个账号过滤到 ${finalAccounts.length} 个账号`)
    } else if (filterByUserMcc && isAdmin) {
      // 管理员：只过滤掉 MCC 账号，显示所有非 MCC 账号
      finalAccounts = accountsWithOffers.filter(account => !account.manager)
      console.log(`🔧 filterByUserMcc=true (管理员): 过滤后剩余 ${finalAccounts.length} 个非 MCC 账号`)
    }

    const finalSyncState = await getGoogleAdsAccountAsyncRefreshState(syncKey)

    return jsonNoStore({
      success: true,
      data: {
        total: finalAccounts.length,
        accounts: finalAccounts,
        cached: usedCache,
        cacheStale: usedCache ? cacheStaleBeforeRefresh : false,
        refreshFailed,
        refreshInProgress: isGoogleAdsAccountRefreshInProgress(finalSyncState),
        refreshError: finalSyncState?.status === 'failed' ? (finalSyncState.errorMessage || null) : null,
        refreshStartedAt: finalSyncState?.startedAtMs ? new Date(finalSyncState.startedAtMs).toISOString() : null,
        lastSyncAt: effectiveLastSyncAtIso,
        loginCustomerId: loginCustomerId,
        authType: authType,
        authConfigWarning,
      },
    })

  } catch (error: any) {
    console.error('获取Google Ads账户失败:', error)

    // 🔧 修复(2025-12-24): 根据错误类型返回合适的 HTTP 状态码
    let statusCode = 500
    let errorCode = 'UNKNOWN_ERROR'
    const extractedMessage = extractGoogleAdsErrorMessage(error)
    const extractedMessageLower = extractedMessage.toLowerCase()

    // 🆕 检测权限错误并构建详细响应
    if (error.isPermissionError && error.serviceAccountEmail && error.mccCustomerId) {
      statusCode = 403
      errorCode = 'SERVICE_ACCOUNT_PERMISSION_DENIED'

      return jsonNoStore({
        error: '服务账号权限不足',
        code: errorCode,
        message: error.message,
        details: {
          serviceAccountEmail: error.serviceAccountEmail,
          mccCustomerId: error.mccCustomerId,
          loginAttempts: error.loginAttempts,
          solution: {
            title: '如何修复权限问题',
            steps: [
              '登录 Google Ads UI: https://ads.google.com',
              `切换到MCC账户: ${error.mccCustomerId}`,
              '进入"管理" → "访问权限和安全"',
              `添加服务账号: ${error.serviceAccountEmail}`,
              '选择权限级别: "标准访问"或"管理员"',
              '保存后等待几分钟，然后刷新此页面'
            ],
            docsUrl: '/docs/service-account-setup'
          }
        }
      }, { status: statusCode })
    }

    // 🔧 修复(2026-01-04): 检测 OAuth refresh token 过期错误
    const oauthError = getOAuthErrorFromResponse(error)
    const httpStatus = getErrorHttpStatus(error)

    if (oauthError.error === 'invalid_grant' || error.message?.includes('invalid_grant')) {
      statusCode = 401
      errorCode = 'OAUTH_TOKEN_EXPIRED'

      return jsonNoStore({
        error: 'OAuth 授权已过期',
        code: errorCode,
        message: 'Google OAuth refresh token 已过期或失效，请重新授权',
        needsReauth: true
      }, { status: statusCode })
    }

    // 🔧 更稳健：invalid_client 通常来自 client_id/client_secret 配置错误或已变更
    if (oauthError.error === 'invalid_client' || error.message?.includes('invalid_client') || (httpStatus === 401 && error.message === 'Request failed')) {
      statusCode = 401
      errorCode = 'INVALID_CLIENT'

      return jsonNoStore({
        error: 'Google OAuth 客户端配置无效',
        code: errorCode,
        message: oauthError.errorDescription || 'Google OAuth client_id/client_secret 配置错误或已失效，请在设置页面重新配置后再授权',
        needsReauth: false,
        solution: {
          title: '如何修复',
          steps: [
            '前往设置页面检查 Google Ads OAuth 凭证（Client ID / Client Secret / Developer Token / MCC账号）',
            '确认 Client ID 与 Client Secret 属于同一个 Google Cloud OAuth Client',
            '保存后重新进行 OAuth 授权（生成新的 refresh token）',
            '回到 Google Ads 页面点击“刷新账户列表”'
          ]
        }
      }, { status: statusCode })
    } else if (error.message?.includes('没有访问权限') || error.message?.includes('permission')) {
      statusCode = 403  // 禁止访问
      errorCode = 'PERMISSION_DENIED'
    } else if (error.message?.includes('找不到') || error.message?.includes('not found')) {
      statusCode = 404
      errorCode = 'NOT_FOUND'
    } else if (error.message?.includes('凭证') || error.message?.includes('credentials')) {
      statusCode = 400
      errorCode = 'CREDENTIALS_ERROR'
    }

    // 🔧 友好化：Developer Token 测试权限/未审批/无效
    // 常见报错：
    // - DEVELOPER_TOKEN_NOT_APPROVED: The developer token is only approved for use with test accounts
    // - The developer token is not approved.
    // - The developer token is not valid.
    if (
      extractedMessageLower.includes('developer_token_not_approved') ||
      extractedMessageLower.includes('only approved for use with test accounts') ||
      (extractedMessageLower.includes('developer token') && extractedMessageLower.includes('not approved'))
    ) {
      statusCode = 403
      errorCode = 'DEVELOPER_TOKEN_NOT_APPROVED'
      return jsonNoStore({
        error: 'Google Ads Developer Token 权限不足',
        code: errorCode,
        message:
          '当前 Google Ads Developer Token 仍为测试权限（Test access）或未通过生产权限审核，只能访问测试账号，无法读取此 MCC 下真实 Ads 账号列表。请在 Google Ads API Center 申请升级权限后再重试。',
        solution: {
          title: '下一步建议',
          steps: [
            '前往设置页面确认 Developer Token 填写正确',
            '到 Google Ads API Center 申请将 Developer Token 升级到 Basic/Standard access（生产权限）',
            '升级通过后，回到本页面点击“刷新账户列表”'
          ],
          docsUrl: '/help/google-ads-setup'
        }
      }, { status: statusCode })
    }

    if (
      (extractedMessageLower.includes('developer token') && extractedMessageLower.includes('not valid')) ||
      extractedMessageLower.includes('developer_token_invalid')
    ) {
      statusCode = 400
      errorCode = 'DEVELOPER_TOKEN_INVALID'
      return jsonNoStore({
        error: 'Google Ads Developer Token 无效',
        code: errorCode,
        message:
          '当前 Google Ads Developer Token 无效/已失效，或仍处于测试权限（Test access）未通过生产审核，导致无法拉取账号列表。请在设置页面检查 Developer Token 是否填写正确，并在 Google Ads API Center 申请升级权限后再重试。',
        solution: {
          title: '如何修复',
          steps: [
            '前往设置页面检查 Developer Token 是否填写正确（无多余空格/换行）',
            '确认该 Developer Token 属于当前配置的 Google Ads API 项目',
            '保存后回到本页面点击“刷新账户列表”'
          ],
          docsUrl: '/help/google-ads-setup'
        }
      }, { status: statusCode })
    }

    return jsonNoStore(
      {
        error: '获取Google Ads账户失败',
        message: oauthError.errorDescription || extractedMessage || '未知错误',
        code: errorCode
      },
      { status: statusCode }
    )
  }
}
export const GET = withPerformanceMonitoring<any>(get, { path: '/api/google-ads/credentials/accounts' })
