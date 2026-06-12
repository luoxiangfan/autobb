import { enums } from 'google-ads-api'
import {
  getGoogleAdsTextEffectiveLength,
  sanitizeGoogleAdsAdText,
  sanitizeGoogleAdsFinalUrlSuffix,
  sanitizeGoogleAdsPath,
} from '@/lib/google-ads/common/ad-text'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { trackOAuthApiCall } from './shared'
import { getCustomerWithCredentials, resolveGoogleAdsApiCallAuth } from './customer'
import { sanitizeKeyword } from './keywords-sanitize'
import { googleAdsApiLogger } from '@/lib/google-ads/common/logger'

const RESPONSIVE_AD_VARIANT_HINTS = ['Now', 'Today', 'Deals', 'Official', 'Shop'] as const

function normalizeResponsiveAssetKey(text: string, maxLength: number): string {
  return sanitizeGoogleAdsAdText(String(text ?? ''), maxLength)
    .trim()
    .toLowerCase()
}

function buildUniqueResponsiveAssetVariant(params: {
  baseText: string
  maxLength: number
  usedKeys: Set<string>
  index: number
}): string | null {
  const { baseText, maxLength, usedKeys, index } = params
  const normalizedBase = sanitizeGoogleAdsAdText(baseText, maxLength).trim()
  if (!normalizedBase) return null

  const candidateSuffixes = [
    ...RESPONSIVE_AD_VARIANT_HINTS.map((hint) => ` ${hint}`),
    ` ${index + 1}`,
  ]

  for (let i = 2; i <= 30; i++) {
    candidateSuffixes.push(` ${i}`)
  }

  for (const suffix of candidateSuffixes) {
    const maxBaseLength = Math.max(1, maxLength - suffix.length)
    const trimmedBase =
      normalizedBase.length > maxBaseLength
        ? normalizedBase.slice(0, maxBaseLength).trim()
        : normalizedBase

    if (!trimmedBase) continue

    const candidate = sanitizeGoogleAdsAdText(`${trimmedBase}${suffix}`, maxLength).trim()
    const candidateKey = normalizeResponsiveAssetKey(candidate, maxLength)
    if (!candidateKey || usedKeys.has(candidateKey)) continue

    usedKeys.add(candidateKey)
    return candidate
  }

  return null
}

export function ensureUniqueResponsiveSearchAdAssets(
  texts: string[],
  maxLength: number,
  assetLabel: string
): string[] {
  const usedKeys = new Set<string>()

  return texts.map((text, index) => {
    const cleaned = sanitizeGoogleAdsAdText(String(text ?? ''), maxLength).trim()
    const key = normalizeResponsiveAssetKey(cleaned, maxLength)
    if (!key) return cleaned

    if (!usedKeys.has(key)) {
      usedKeys.add(key)
      return cleaned
    }

    const replacement = buildUniqueResponsiveAssetVariant({
      baseText: cleaned,
      maxLength,
      usedKeys,
      index,
    })

    if (!replacement) {
      throw new Error(
        `${assetLabel}${index + 1}与已有资产重复，且无法自动生成唯一变体，请调整创意后重试`
      )
    }

    googleAdsApiLogger.warn('rsa_duplicate_asset_rewritten', {
      assetLabel,
      index: index + 1,
      replacement,
    })
    return replacement
  })
}

/**
 * 创建Google Ads Responsive Search Ad
 */
export async function createGoogleAdsResponsiveSearchAd(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  headlines: string[] // Max 15 headlines
  descriptions: string[] // Max 4 descriptions
  finalUrls: string[]
  finalUrlSuffix?: string // 查询参数后缀（用于tracking）
  path1?: string
  path2?: string
  accountId?: number
  userId: number
  loginCustomerId?: string // 🔥 经理账号ID
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<{ adId: string; resourceName: string }> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)

  const sanitizedHeadlines = params.headlines.map((h) => sanitizeGoogleAdsAdText(h, 30))
  const sanitizedDescriptions = params.descriptions.map((d) => sanitizeGoogleAdsAdText(d, 90))
  const uniqueHeadlines = ensureUniqueResponsiveSearchAdAssets(sanitizedHeadlines, 30, '标题')
  const uniqueDescriptions = ensureUniqueResponsiveSearchAdAssets(sanitizedDescriptions, 90, '描述')
  const sanitizedPath1 = params.path1 ? sanitizeGoogleAdsPath(params.path1, 15) : undefined
  const sanitizedPath2 = params.path2 ? sanitizeGoogleAdsPath(params.path2, 15) : undefined
  const sanitizedFinalUrlSuffix = params.finalUrlSuffix
    ? sanitizeGoogleAdsFinalUrlSuffix(params.finalUrlSuffix)
    : undefined

  const emptyHeadlineIndex = uniqueHeadlines.findIndex((h) => !h.trim())
  if (emptyHeadlineIndex >= 0) {
    throw new Error(
      `标题${emptyHeadlineIndex + 1}清洗后为空（可能仅包含不允许的符号），请修改后重试`
    )
  }
  const emptyDescriptionIndex = uniqueDescriptions.findIndex((d) => !d.trim())
  if (emptyDescriptionIndex >= 0) {
    throw new Error(
      `描述${emptyDescriptionIndex + 1}清洗后为空（可能仅包含不允许的符号），请修改后重试`
    )
  }

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createResponsiveSearchAdPython } = await import('../../python-ads-client')

    const adGroupResourceName = `customers/${params.customerId}/adGroups/${params.adGroupId}`
    const adResourceName = await createResponsiveSearchAdPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      adGroupResourceName,
      headlines: uniqueHeadlines,
      descriptions: uniqueDescriptions,
      finalUrls: params.finalUrls,
      finalUrlSuffix: sanitizedFinalUrlSuffix,
      path1: sanitizedPath1,
      path2: sanitizedPath2,
    })

    const adId = adResourceName.split('/').pop() || ''
    return { adId, resourceName: adResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  // Validate headlines (必须正好15个)
  // 根据业务规范：Headlines必须配置15个，如果从广告创意中获得的标题数量不足，则报错
  if (params.headlines.length !== 15) {
    throw new Error(
      `Headlines必须正好15个，当前提供了${params.headlines.length}个。如果从广告创意中获得的标题数量不足，请报错。`
    )
  }

  // Validate descriptions (必须正好4个)
  // 根据业务规范：Descriptions必须配置4个，如果从广告创意中获得的描述数量不足，则报错
  if (params.descriptions.length !== 4) {
    throw new Error(
      `Descriptions必须正好4个，当前提供了${params.descriptions.length}个。如果从广告创意中获得的描述数量不足，请报错。`
    )
  }

  // Validate headline length (max 30 characters each)
  uniqueHeadlines.forEach((headline, index) => {
    const effectiveLength = getGoogleAdsTextEffectiveLength(headline)
    if (effectiveLength > 30) {
      throw new Error(
        `标题${index + 1}超过30字符限制: "${headline}" (effective=${effectiveLength}, raw=${headline.length})`
      )
    }
  })

  // Validate description length (max 90 characters each)
  uniqueDescriptions.forEach((desc, index) => {
    const effectiveLength = getGoogleAdsTextEffectiveLength(desc)
    if (effectiveLength > 90) {
      throw new Error(
        `描述${index + 1}超过90字符限制: "${desc}" (effective=${effectiveLength}, raw=${desc.length})`
      )
    }
  })

  // Create ad structure
  const ad: any = {
    ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
    status: enums.AdGroupAdStatus.ENABLED,
    ad: {
      final_urls: params.finalUrls,
      responsive_search_ad: {
        headlines: uniqueHeadlines.map((text) => ({ text })),
        descriptions: uniqueDescriptions.map((text) => ({ text })),
      },
    },
  }

  // Add Final URL Suffix if provided (for tracking parameters)
  if (sanitizedFinalUrlSuffix) {
    ad.ad.final_url_suffix = sanitizedFinalUrlSuffix
  }

  // Add display path fields if provided
  if (sanitizedPath1) {
    ad.ad.responsive_search_ad.path1 = sanitizedPath1
  }
  if (sanitizedPath2) {
    ad.ad.responsive_search_ad.path2 = sanitizedPath2
  }

  const response = await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/responsive-search-ad/create',
    () => customer.adGroupAds.create([ad])
  )

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建Responsive Search Ad失败：无响应')
  }

  const result = response.results[0]
  const adId = result.resource_name?.split('/').pop() || ''

  return {
    adId,
    resourceName: result.resource_name || '',
  }
}

export function ensureKeywordsInHeadlines(
  headlines: string[],
  keywords: string[],
  brandName: string,
  maxKeywordsToEnsure: number = 3
): string[] {
  if (!headlines || headlines.length === 0) {
    googleAdsApiLogger.debug('headline_optimizer_no_headlines')
    return headlines
  }

  if (!keywords || keywords.length === 0) {
    googleAdsApiLogger.debug('headline_optimizer_no_keywords')
    return headlines
  }

  const result = [...headlines]
  const normalizeCoverageKey = (value: string): string =>
    normalizeGoogleAdsKeyword(value).replace(/\s+/g, '')
  const normalizeHeadlineAssetKey = (value: string): string =>
    sanitizeGoogleAdsAdText(String(value ?? ''), 30)
      .trim()
      .toLowerCase()

  const headlineCoverage = result.map((headline) => {
    const normalized = normalizeGoogleAdsKeyword(headline)
    const compact = normalized.replace(/\s+/g, '')
    const tokenSet = new Set(normalized.split(/\s+/).filter(Boolean))
    return { compact, tokenSet }
  })

  // 获取需要确保覆盖的 Top N 关键词
  const topKeywordsRaw = keywords
    .slice(0, maxKeywordsToEnsure)
    .map((k) => (typeof k === 'string' ? k : (k as any).text || (k as any).keyword || ''))
    .map((k) =>
      sanitizeKeyword(String(k ?? ''))
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((k) => k.length > 0)

  // 去重（规范化后去掉分隔符），避免把 "soundcore" 和 "sound core" 当成两个关键词
  const topKeywords: string[] = []
  const seenTopKeywords = new Set<string>()
  for (const keyword of topKeywordsRaw) {
    const key = normalizeCoverageKey(keyword)
    if (!key || seenTopKeywords.has(key)) continue
    seenTopKeywords.add(key)
    topKeywords.push(keyword)
  }

  googleAdsApiLogger.debug('headline_optimizer_coverage_check', {
    keywordCount: topKeywords.length,
    keywords: topKeywords.join(', '),
  })

  // 找出未被标题覆盖的关键词
  const uncoveredKeywords: string[] = []
  topKeywords.forEach((kw) => {
    const normalizedKeyword = normalizeGoogleAdsKeyword(kw)
    const keywordCompact = normalizeCoverageKey(kw)
    const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
    const isCovered = headlineCoverage.some((headline) => {
      if (keywordCompact && headline.compact.includes(keywordCompact)) return true
      if (keywordTokens.length === 0) return false
      return keywordTokens.every((token) => headline.tokenSet.has(token))
    })
    if (!isCovered) {
      uncoveredKeywords.push(kw)
      googleAdsApiLogger.debug('headline_optimizer_keyword_uncovered', { keyword: kw })
    } else {
      googleAdsApiLogger.debug('headline_optimizer_keyword_covered', { keyword: kw })
    }
  })

  if (uncoveredKeywords.length === 0) {
    googleAdsApiLogger.debug('headline_optimizer_all_covered')
    return result
  }

  googleAdsApiLogger.debug('headline_optimizer_uncovered_count', {
    count: uncoveredKeywords.length,
  })

  // 去重未覆盖关键词（按Google Ads规范化键），避免近似词重复替换
  const uniqueUncoveredKeywords = Array.from(
    uncoveredKeywords
      .reduce((map, keyword) => {
        const key = normalizeCoverageKey(keyword)
        if (!key || map.has(key)) return map
        map.set(key, keyword)
        return map
      }, new Map<string, string>())
      .values()
  )
  googleAdsApiLogger.debug('headline_optimizer_unique_uncovered', {
    count: uniqueUncoveredKeywords.length,
  })

  // 生成包含关键词的新标题模板
  const generateKeywordHeadline = (keyword: string, brand: string): string => {
    const brandText = sanitizeKeyword(String(brand ?? ''))
      .replace(/\s+/g, ' ')
      .trim()
    const brandKey = normalizeCoverageKey(brandText)
    const rawKeywordText = sanitizeKeyword(String(keyword ?? ''))
      .replace(/\s+/g, ' ')
      .trim()
    if (!rawKeywordText) {
      return brandText.length <= 30 ? brandText.trim() : brandText.substring(0, 30).trim()
    }

    const keywordKey = normalizeCoverageKey(rawKeywordText)
    const toHeadlineToken = (token: string): string => {
      if (!token) return token
      if (/^[A-Z0-9]{2,6}$/.test(token)) return token
      if (/^[a-z]+$/.test(token)) {
        return token.charAt(0).toUpperCase() + token.slice(1)
      }
      if (/^[A-Za-z][A-Za-z0-9-]*$/.test(token)) {
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
      }
      return token
    }

    const keywordForHeadline = (() => {
      // 空格/分隔符变体与品牌等价时，统一回品牌标准写法（如 sound core -> Soundcore）
      if (brandKey && keywordKey === brandKey) return brandText || rawKeywordText

      const tokens = rawKeywordText.split(/\s+/).filter(Boolean)
      const seenTokens = new Set<string>()
      const normalizedTokens: string[] = []
      for (const token of tokens) {
        const tokenKey = normalizeCoverageKey(token)
        if (!tokenKey || seenTokens.has(tokenKey)) continue
        seenTokens.add(tokenKey)
        if (brandKey && tokenKey === brandKey) {
          normalizedTokens.push(brandText || token)
        } else {
          normalizedTokens.push(toHeadlineToken(token))
        }
      }
      if (normalizedTokens.length === 0) return rawKeywordText
      return normalizedTokens.join(' ')
    })()

    const keywordContainsBrand = Boolean(
      brandKey && normalizeCoverageKey(keywordForHeadline).includes(brandKey)
    )

    // 多种模板，确保多样性
    // 注意：避免使用 "-" 和 "|" 等可能触发 Google Ads SYMBOLS 政策的符号
    const templates = keywordContainsBrand
      ? [
          `Shop ${keywordForHeadline} Now`,
          `Get ${keywordForHeadline} Today`,
          `${keywordForHeadline} Deals`,
          keywordForHeadline,
        ]
      : [
          `${brandText} ${keywordForHeadline}`,
          `Shop ${keywordForHeadline} Now`,
          `Best ${keywordForHeadline} Deals`,
          `${keywordForHeadline} by ${brandText}`,
          `Get ${keywordForHeadline} Today`,
        ]

    // 选择一个不超过30字符的模板
    for (const template of templates) {
      if (template.length <= 30) {
        return template
      }
    }

    // 如果所有模板都太长，直接使用关键词
    return keywordForHeadline.length <= 30
      ? keywordForHeadline
      : keywordForHeadline.substring(0, 30).trim()
  }

  // 替换最后几个标题为包含未覆盖关键词的版本
  uniqueUncoveredKeywords.forEach((kw, i) => {
    // 从倒数第二个开始替换（保留最后一个作为CTA）
    const replaceIndex = result.length - 2 - i
    if (replaceIndex >= 0 && replaceIndex < result.length) {
      const oldHeadline = result[replaceIndex]
      const newHeadline = generateKeywordHeadline(kw, brandName)
      const normalizedNewHeadlineKey = normalizeHeadlineAssetKey(newHeadline)

      // 检查生成的标题是否与已有标题重复
      const isDuplicate = result.some(
        (h, idx) =>
          idx !== replaceIndex && normalizeHeadlineAssetKey(h) === normalizedNewHeadlineKey
      )

      if (!isDuplicate) {
        result[replaceIndex] = newHeadline
        googleAdsApiLogger.debug('headline_optimizer_replaced', {
          replaceIndex,
          oldHeadline,
          newHeadline,
        })
      } else {
        googleAdsApiLogger.debug('headline_optimizer_skip_duplicate', {
          replaceIndex,
          newHeadline,
        })
      }
    }
  })

  googleAdsApiLogger.info('headline_optimizer_completed', {
    replacedCount: uniqueUncoveredKeywords.length,
  })

  return result
}
