/**
 * Detect affiliate link resolution failures (expired/invalid links, platform error pages).
 * Shared by URL resolver, url-swap executor, and link check flows.
 */

export type AffiliateLinkFailureKind =
  | 'partnerboost_invalid_link'
  | 'yeahpromos_link_blocked'
  | 'yeahpromos_link_suspended'
  | 'chrome_error'
  | 'affiliate_platform_landing'

export interface AffiliateLinkFailureInfo {
  kind: AffiliateLinkFailureKind
  message: string
}

const PARTNERBOOST_INVALID_LINK_PATH = '/partner/invalid-link'

/* * YeahPromos openurl 跟踪跳转常见中间域 / 错误页 */
const YEAHPROMOS_TRACKING_HOST_KEYWORDS = ['dailybacks.com', 'earnlygo.com']

const AFFILIATE_PLATFORM_HOST_KEYWORDS = [
  'partnerboost.com',
  'pboost.me',
  'yeahpromos.com',
  'yeahpromo.com',
]

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function tryParseUrl(value: string | null | undefined): URL | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed)
  } catch {
    return null
  }
}

export function isChromeErrorUrl(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase().startsWith('chrome-error://')
}

export function isAffiliatePlatformHost(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (!host) return false
  return AFFILIATE_PLATFORM_HOST_KEYWORDS.some(
    (keyword) => host === keyword || host.endsWith(`.${keyword}`)
  )
}

function isPartnerboostInvalidLinkUrl(urlObj: URL): boolean {
  const host = normalizeHost(urlObj.hostname)
  if (!host.endsWith('partnerboost.com')) return false
  const path = urlObj.pathname.toLowerCase()
  return (
    path === PARTNERBOOST_INVALID_LINK_PATH || path.startsWith(`${PARTNERBOOST_INVALID_LINK_PATH}/`)
  )
}

function isYeahpromosTrackingHost(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (!host) return false
  return YEAHPROMOS_TRACKING_HOST_KEYWORDS.some(
    (keyword) => host === keyword || host.endsWith(`.${keyword}`)
  )
}

function detectYeahpromosTrackingFailure(urlObj: URL): AffiliateLinkFailureInfo | null {
  if (!isYeahpromosTrackingHost(urlObj.hostname)) return null

  const path = urlObj.pathname.toLowerCase()
  const search = urlObj.search.toLowerCase()
  const haystack = `${path}${search}`

  if (haystack.includes('error_suspended')) {
    return {
      kind: 'yeahpromos_link_suspended',
      message:
        '推广链接已失效：YeahPromos 推广链接已被临时暂停（earnlygo 返回 "This link has been temporarily suspended!"）。' +
        '请在 YeahPromos 后台确认链接状态并重新生成推广链接，然后更新 Offer 中的联盟推广链接。',
    }
  }

  if (haystack.includes('error_blocked')) {
    return {
      kind: 'yeahpromos_link_blocked',
      message:
        '推广链接已失效：YeahPromos 推广链接已被屏蔽（dailybacks 返回 "This link has been blocked!"）。' +
        '请在 YeahPromos 后台重新生成推广链接，并更新 Offer 中的联盟推广链接。',
    }
  }

  return null
}

function detectYeahpromosOpenUrlFailure(urlObj: URL): AffiliateLinkFailureInfo | null {
  const host = normalizeHost(urlObj.hostname)
  if (!host.endsWith('yeahpromos.com')) return null

  const path = urlObj.pathname.toLowerCase()
  if (!path.includes('/index/index/openurl')) return null

  const haystack = `${path}${urlObj.search.toLowerCase()}`
  if (
    haystack.includes('error') ||
    haystack.includes('blocked') ||
    haystack.includes('suspended')
  ) {
    return {
      kind: 'yeahpromos_link_blocked',
      message:
        '推广链接已失效：YeahPromos openurl 返回错误页，链接无法正常跳转到商品页。' +
        '请在 YeahPromos 后台重新生成推广链接，并更新 Offer 中的联盟推广链接。',
    }
  }

  return null
}

function detectFromUrl(url: string | null | undefined): AffiliateLinkFailureInfo | null {
  if (isChromeErrorUrl(url)) {
    return {
      kind: 'chrome_error',
      message:
        '推广链接无法访问：浏览器未能加载页面。常见原因包括链接已失效、联盟平台撤销链接、或代理/网络阻断。请先在浏览器中直接访问推广链接确认。',
    }
  }

  const parsed = tryParseUrl(url)
  if (!parsed) return null

  if (isPartnerboostInvalidLinkUrl(parsed)) {
    return {
      kind: 'partnerboost_invalid_link',
      message:
        '推广链接已失效：PartnerBoost 返回 Invalid Link 页面（链接已过期或被撤销）。请在 PartnerBoost 后台重新生成推广链接，并更新 Offer 中的联盟推广链接。',
    }
  }

  const yeahpromosTrackingFailure = detectYeahpromosTrackingFailure(parsed)
  if (yeahpromosTrackingFailure) return yeahpromosTrackingFailure

  const yeahpromosOpenUrlFailure = detectYeahpromosOpenUrlFailure(parsed)
  if (yeahpromosOpenUrlFailure) return yeahpromosOpenUrlFailure

  return null
}

function detectFromPageTitle(
  pageTitle: string | null | undefined
): AffiliateLinkFailureInfo | null {
  const title = String(pageTitle || '')
    .trim()
    .toLowerCase()
  if (!title) return null
  if (title === 'invalid link' || title.includes('invalid link')) {
    return {
      kind: 'partnerboost_invalid_link',
      message:
        '推广链接已失效：联盟平台返回 Invalid Link 页面（链接已过期或被撤销）。请在联盟平台重新生成推广链接，并更新 Offer 中的联盟推广链接。',
    }
  }

  if (title.includes('blocked') || title.includes('has been blocked')) {
    return {
      kind: 'yeahpromos_link_blocked',
      message:
        '推广链接已失效：YeahPromos 推广链接已被屏蔽，无法正常跳转到商品页。' +
        '请在 YeahPromos 后台重新生成推广链接，并更新 Offer 中的联盟推广链接。',
    }
  }

  if (title.includes('suspended') || title.includes('temporarily suspended')) {
    return {
      kind: 'yeahpromos_link_suspended',
      message:
        '推广链接已失效：YeahPromos 推广链接已被临时暂停。' +
        '请在 YeahPromos 后台确认链接状态并重新生成推广链接，然后更新 Offer 中的联盟推广链接。',
    }
  }

  return null
}

export function detectAffiliateLinkFailure(params: {
  url?: string | null
  pageTitle?: string | null
  redirectChain?: string[]
}): AffiliateLinkFailureInfo | null {
  const direct = detectFromUrl(params.url)
  if (direct) return direct

  const titleFailure = detectFromPageTitle(params.pageTitle)
  if (titleFailure) return titleFailure

  for (const item of params.redirectChain || []) {
    const chainFailure = detectFromUrl(item)
    if (chainFailure) return chainFailure
  }

  return null
}

export function detectDomainChangeAffiliateFailure(
  oldUrl: string,
  newUrl: string
): AffiliateLinkFailureInfo | null {
  const resolvedFailure = detectAffiliateLinkFailure({ url: newUrl })
  if (resolvedFailure) return resolvedFailure

  const oldParsed = tryParseUrl(oldUrl)
  const newParsed = tryParseUrl(newUrl)
  if (!oldParsed || !newParsed) return null

  const oldHost = normalizeHost(oldParsed.hostname)
  const newHost = normalizeHost(newParsed.hostname)
  if (!oldHost || !newHost || oldHost === newHost) return null

  if (isAffiliatePlatformHost(newHost) && !isAffiliatePlatformHost(oldHost)) {
    return {
      kind: 'affiliate_platform_landing',
      message:
        `推广链接解析异常：落地页从 ${oldParsed.hostname} 变为 ${newParsed.hostname}，未能到达商品页。` +
        '可能是推广链接已失效，请在联盟平台检查并更新链接。',
    }
  }

  if (isYeahpromosTrackingHost(newHost) && !isYeahpromosTrackingHost(oldHost)) {
    return (
      detectYeahpromosTrackingFailure(newParsed) ?? {
        kind: 'yeahpromos_link_blocked',
        message:
          `推广链接解析异常：落地页从 ${oldParsed.hostname} 变为 ${newParsed.hostname}（YeahPromos 跟踪跳转页），未能到达商品页。` +
          '可能是推广链接已失效或被屏蔽，请在 YeahPromos 后台检查并更新链接。',
      }
    )
  }

  return null
}

export function isAffiliateLinkExpiredMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase()
  return (
    normalized.includes('推广链接已失效') ||
    normalized.includes('推广链接无法访问') ||
    normalized.includes('推广链接解析异常') ||
    normalized.includes('invalid link') ||
    normalized.includes('invalid-link') ||
    normalized.includes('error_blocked') ||
    normalized.includes('error_suspended') ||
    normalized.includes('yeahpromos') ||
    normalized.includes('dailybacks.com') ||
    normalized.includes('earnlygo.com') ||
    normalized.includes('chrome-error://')
  )
}

export function normalizeNestedResolveErrorMessage(message: string): string {
  let normalized = String(message || '').trim()
  if (!normalized) return '未知错误'

  while (normalized.includes('Playwright解析失败: Playwright解析失败')) {
    normalized = normalized.replace('Playwright解析失败: Playwright解析失败', 'Playwright解析失败')
  }

  return normalized
}
