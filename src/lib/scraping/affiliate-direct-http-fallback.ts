/**
 * 联盟推广链接在代理 SSL/隧道异常时的直连 HTTP 兜底。
 * 解析 finalUrl / 追踪参数不依赖目标国 IP；浏览器可访问时直连通常更稳。
 */

import { logger } from '@/lib/common/server'
import { parseBooleanEnv } from '@/lib/common/parse-env'
import { runWithAffiliateDirectHttpConcurrency } from './affiliate-direct-http-concurrency'
import { resolveAffiliateLinkWithHttp, type HttpResolvedUrl } from './url-resolver-http'

const AFFILIATE_DIRECT_HTTP_HOST_KEYWORDS = [
  'yeahpromos.com',
  'yeahpromo.com',
  'pboost.me',
  'partnerboost.com',
  'partnermatic.com',
  'linkbux.com',
  'linkhaitao.com',
  'dailybacks.com',
  'earnlygo.com',
  'click.linksynergy.com',
  'aff.bstk.com',
  'go2cloud.org',
]

const PROXY_TRANSPORT_ERROR_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPROTO',
  'wrong version number',
  'ssl3_get_record',
  'ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_EMPTY_RESPONSE',
  'ERR_HTTP2_PROTOCOL_ERROR',
  'net::ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'socket hang up',
  'Proxy connection ended',
]

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

export function isAffiliatePlatformResolveLink(url: string): boolean {
  try {
    const host = normalizeHost(new URL(url).hostname)
    if (!host) return false
    return AFFILIATE_DIRECT_HTTP_HOST_KEYWORDS.some(
      (keyword) => host === keyword || host.endsWith(`.${keyword}`)
    )
  } catch {
    return false
  }
}

export function isProxyTransportError(error: unknown): boolean {
  const msg = (error as { message?: string })?.message
    ? String((error as { message?: string }).message)
    : String(error)
  return PROXY_TRANSPORT_ERROR_PATTERNS.some((pattern) => msg.includes(pattern))
}

/** 默认 true：联盟跟踪链接先直连 HTTP；false 时仅代理失败后再直连。 */
export function isAffiliateResolveDirectFirstEnabled(envValue: string | undefined): boolean {
  return parseBooleanEnv(envValue, true)
}

export function readAffiliateResolveDirectFirstEnabled(): boolean {
  return isAffiliateResolveDirectFirstEnabled(process.env.AFFILIATE_RESOLVE_DIRECT_FIRST)
}

function mapHttpResult(result: HttpResolvedUrl) {
  return {
    finalUrl: result.finalUrl,
    finalUrlSuffix: result.finalUrlSuffix,
    brand: null as string | null,
    redirectChain: result.redirectChain,
    redirectCount: result.redirectCount,
    pageTitle: null as string | null,
    statusCode: result.statusCode,
    resolveMethod: 'http' as const,
    proxyUsed: undefined as string | undefined,
  }
}

/**
 * 不经代理的 HTTP 解析；仅用于联盟跟踪域名的兜底。
 */
export async function resolveAffiliateLinkViaDirectHttp(affiliateLink: string) {
  if (!isAffiliatePlatformResolveLink(affiliateLink)) {
    return null
  }

  try {
    const result = await runWithAffiliateDirectHttpConcurrency(() =>
      resolveAffiliateLinkWithHttp(affiliateLink, undefined, 10)
    )
    return mapHttpResult(result)
  } catch (error) {
    logger.debug('[affiliate-direct-http] 直连解析失败', {
      host: (() => {
        try {
          return new URL(affiliateLink).hostname
        } catch {
          return affiliateLink
        }
      })(),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
