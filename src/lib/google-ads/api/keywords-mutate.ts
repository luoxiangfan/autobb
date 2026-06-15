import { enums } from 'google-ads-api'
import { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { withRetry } from '../../common'
import { trackOAuthApiCall } from './shared'
import { getCustomerWithCredentials, resolveGoogleAdsApiCallAuth } from './customer'
import {
  GOOGLE_ADS_KEYWORD_MAX_LENGTH,
  GOOGLE_ADS_KEYWORD_MAX_WORDS,
  sanitizeKeywordForGoogleAds,
} from './keywords-sanitize'
import { googleAdsKeywordLogger } from '@/lib/google-ads/common/logger'

export async function updateGoogleAdsKeywordStatus(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywordId: string
  status: 'ENABLED' | 'PAUSED'
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  if (authType === 'service_account') {
    throw new Error('服务账号模式暂不支持关键词状态更新，请先使用OAuth账号执行')
  }

  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  const resourceName = `customers/${params.customerId}/adGroupCriteria/${params.adGroupId}~${params.keywordId}`

  await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/keyword/update-status',
    () =>
      withRetry(
        () =>
          customer.adGroupCriteria.update([
            {
              resource_name: resourceName,
              status: enums.AdGroupCriterionStatus[params.status],
            },
          ]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Update Keyword Status: ${params.keywordId} -> ${params.status}`,
        }
      )
  )
}

/**
 * 批量创建Google Ads Keywords
 */
export async function createGoogleAdsKeywordsBatch(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywords: Array<{
    keywordText: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    negativeKeywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT' // ← 新增：负向词的匹配类型
    status: 'ENABLED' | 'PAUSED'
    finalUrl?: string
    isNegative?: boolean
  }>
  accountId?: number
  userId: number
  loginCustomerId?: string // 🔧 添加MCC权限参数
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<Array<{ keywordId: string; resourceName: string; keywordText: string }>> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)

  const logKeywordNormalization = (
    originalText: string,
    normalized: ReturnType<typeof sanitizeKeywordForGoogleAds>
  ): void => {
    if (normalized.text === originalText) return
    const reasons: string[] = []
    if (normalized.truncatedByWordLimit) reasons.push(`words>${GOOGLE_ADS_KEYWORD_MAX_WORDS}`)
    if (normalized.truncatedByCharLimit) reasons.push(`chars>${GOOGLE_ADS_KEYWORD_MAX_LENGTH}`)

    googleAdsKeywordLogger.debug('keyword_normalized', {
      originalText,
      normalizedText: normalized.text,
      reasons: reasons.length > 0 ? reasons : undefined,
    })
  }

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createKeywordsPython } = await import('../../campaign')

    const adGroupResourceName = `customers/${params.customerId}/adGroups/${params.adGroupId}`
    const keywordInputs = params.keywords
      .map((kw, originalIndex) => {
        const normalized = sanitizeKeywordForGoogleAds(kw.keywordText)
        logKeywordNormalization(kw.keywordText, normalized)
        if (!normalized.text) {
          googleAdsKeywordLogger.warn('keyword_dropped_empty', { keywordText: kw.keywordText })
          return null
        }
        return { kw, originalIndex, normalizedText: normalized.text }
      })
      .filter(
        (
          x
        ): x is {
          kw: (typeof params.keywords)[number]
          originalIndex: number
          normalizedText: string
        } => Boolean(x)
      )

    if (keywordInputs.length === 0) {
      return []
    }

    const resourceNames = await createKeywordsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      adGroupResourceName,
      keywords: keywordInputs.map(({ kw, normalizedText }) => ({
        text: normalizedText,
        matchType: kw.matchType,
        status: kw.status,
        finalUrl: kw.finalUrl,
        isNegative: kw.isNegative,
        negativeKeywordMatchType: kw.negativeKeywordMatchType,
      })),
    })

    return resourceNames.map((resourceName, index) => ({
      keywordId: resourceName.split('/').pop() || '',
      resourceName,
      keywordText: params.keywords[keywordInputs[index].originalIndex].keywordText,
    }))
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  const results: Array<{ keywordId: string; resourceName: string; keywordText: string }> = []

  // 分批处理（每批最多100个）
  const batchSize = 100
  for (let i = 0; i < params.keywords.length; i += batchSize) {
    const batch = params.keywords.slice(i, i + batchSize)

    const keywordOperationsWithMeta = batch
      .map((kw) => {
        const effectiveMatchType = kw.isNegative
          ? kw.negativeKeywordMatchType || 'EXACT'
          : kw.matchType

        const normalized = sanitizeKeywordForGoogleAds(kw.keywordText)
        logKeywordNormalization(kw.keywordText, normalized)
        if (!normalized.text) {
          googleAdsKeywordLogger.warn('keyword_dropped_empty', { keywordText: kw.keywordText })
          return null
        }

        const operation: any = {
          ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
          keyword: {
            text: normalized.text,
            match_type: enums.KeywordMatchType[effectiveMatchType],
          },
        }

        if (kw.isNegative) {
          operation.negative = true
        } else {
          operation.status = enums.AdGroupCriterionStatus[kw.status]
          if (kw.finalUrl) {
            operation.final_urls = [kw.finalUrl]
          }
        }

        return { operation, keywordText: kw.keywordText }
      })
      .filter((x): x is { operation: any; keywordText: string } => Boolean(x))

    if (keywordOperationsWithMeta.length === 0) {
      continue
    }

    const response = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/keywords/create',
      () => customer.adGroupCriteria.create(keywordOperationsWithMeta.map((x) => x.operation))
    )

    if (response && response.results && response.results.length > 0) {
      response.results.forEach((result, index) => {
        const keywordId = result.resource_name?.split('/').pop() || ''
        results.push({
          keywordId,
          resourceName: result.resource_name || '',
          keywordText: keywordOperationsWithMeta[index]?.keywordText || '',
        })
      })
    }
  }

  return results
}

function isDuplicateKeywordCriterionError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase()
  if (
    message.includes('already exists') ||
    message.includes('resource_already_exists') ||
    message.includes('duplicate') ||
    message.includes('重复')
  ) {
    return true
  }

  const errors = (error as { errors?: Array<{ error_code?: Record<string, unknown> }> })?.errors
  if (!Array.isArray(errors)) return false

  return errors.some((entry) => {
    const codes = entry?.error_code || {}
    return Object.values(codes).some((code) => {
      const normalized = String(code || '').toUpperCase()
      return normalized.includes('DUPLICATE') || normalized.includes('ALREADY_EXISTS')
    })
  })
}

/**
 * 批量创建关键词；若整批因重复失败，则逐条重试并跳过已存在项（用于发布续发补全）。
 */
export async function createGoogleAdsKeywordsBatchAllowingDuplicates(
  params: Parameters<typeof createGoogleAdsKeywordsBatch>[0]
): Promise<Array<{ keywordId: string; resourceName: string; keywordText: string }>> {
  if (!params.keywords.length) return []

  try {
    return await createGoogleAdsKeywordsBatch(params)
  } catch (batchError) {
    if (!isDuplicateKeywordCriterionError(batchError)) {
      throw batchError
    }
    googleAdsKeywordLogger.warn('keyword_batch_duplicate_fallback')
  }

  const results: Array<{ keywordId: string; resourceName: string; keywordText: string }> = []
  for (const keyword of params.keywords) {
    try {
      const created = await createGoogleAdsKeywordsBatch({
        ...params,
        keywords: [keyword],
      })
      results.push(...created)
    } catch (singleError) {
      if (isDuplicateKeywordCriterionError(singleError)) {
        continue
      }
      throw singleError
    }
  }

  return results
}
