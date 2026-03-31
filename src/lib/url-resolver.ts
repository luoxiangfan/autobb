import { createProxyAxiosClient } from './proxy-axios'

/**
 * 解析后的URL信息
 */
export interface ResolvedUrl {
  finalUrl: string            // 不含查询参数的URL
  finalUrlSuffix: string       // 查询参数部分（用于Google Ads）
  redirectChain: string[]      // 完整的重定向链
  redirectCount: number        // 重定向次数
}

/**
 * URL解析结果缓存
 * 避免重复解析相同的affiliate链接
 */
interface CachedResolvedUrl {
  result: ResolvedUrl
  resolvedAt: number
  expiresAt: number
}

const urlResolverCache = new Map<string, CachedResolvedUrl>()
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24小时

/**
 * 清除过期的缓存条目
 */
function cleanExpiredCache(): void {
  const now = Date.now()
  for (const [key, cached] of urlResolverCache.entries()) {
    if (now >= cached.expiresAt) {
      urlResolverCache.delete(key)
    }
  }
}

/**
 * 解析相对URL为绝对URL
 */
function resolveRedirectUrl(baseUrl: string, redirectLocation: string): string {
  // 如果是绝对URL，直接返回
  if (redirectLocation.startsWith('http://') || redirectLocation.startsWith('https://')) {
    return redirectLocation
  }

  try {
    const base = new URL(baseUrl)

    // 如果以/开头，是相对于域名的路径
    if (redirectLocation.startsWith('/')) {
      return `${base.origin}${redirectLocation}`
    }

    // 否则是相对于当前路径
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/'))
    return `${base.origin}${basePath}/${redirectLocation}`
  } catch (error) {
    console.error('URL解析失败:', error)
    return redirectLocation
  }
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function isSameDomain(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

const TRACKING_TARGET_PARAM_NAMES = ['url', 'redirect', 'target', 'destination', 'goto', 'link', 'new', 'r', 'u']

function extractTrackingWrapperSuffix(urlObj: URL, finalHost: string): string {
  if (!urlObj.search) return ''

  const params = new URLSearchParams(urlObj.search)
  let hasEmbeddedTargetToFinalHost = false

  for (const paramName of TRACKING_TARGET_PARAM_NAMES) {
    const paramValue = params.get(paramName)
    if (!paramValue) continue

    try {
      const targetHost = normalizeHost(new URL(paramValue).hostname)
      if (!isSameDomain(targetHost, finalHost)) continue

      hasEmbeddedTargetToFinalHost = true
      params.delete(paramName)
    } catch {
      // ignore non-URL parameter values
    }
  }

  if (!hasEmbeddedTargetToFinalHost) return ''

  return params.toString()
}

function extractSuffixFromRedirectChain(redirectChain: string[], finalUrl: string): string {
  let finalHost = ''
  try {
    finalHost = normalizeHost(new URL(finalUrl).hostname)
  } catch {
    return ''
  }

  for (let i = redirectChain.length - 1; i >= 0; i--) {
    try {
      const urlObj = new URL(redirectChain[i])
      const suffix = urlObj.search.substring(1)
      if (!suffix) continue
      const host = normalizeHost(urlObj.hostname)
      if (isSameDomain(host, finalHost)) {
        return suffix
      }
    } catch {
      // Ignore invalid URL in redirect chain.
    }
  }

  for (let i = redirectChain.length - 1; i >= 0; i--) {
    try {
      const urlObj = new URL(redirectChain[i])
      const wrapperSuffix = extractTrackingWrapperSuffix(urlObj, finalHost)
      if (wrapperSuffix) {
        return wrapperSuffix
      }
    } catch {
      // Ignore invalid URL in redirect chain.
    }
  }

  return ''
}

/**
 * 解析Affiliate链接，跟踪所有重定向，提取Final URL和Final URL suffix
 *
 * @param affiliateLink - Offer推广链接（例如：https://pboost.me/UKTs4I6）
 * @param proxyUrl - 可选的代理URL（用于真实地理位置访问）
 * @returns 解析后的URL信息
 *
 * @example
 * const resolved = await resolveAffiliateLink('https://pboost.me/UKTs4I6', proxyUrl)
 * // {
 * //   finalUrl: 'https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA',
 * //   finalUrlSuffix: 'maas=maas_adg_api_...&aa_campaignid=...',
 * //   redirectChain: ['https://pboost.me/UKTs4I6', 'https://amazon.com/...'],
 * //   redirectCount: 5
 * // }
 */
export async function resolveAffiliateLink(
  affiliateLink: string,
  proxyUrl?: string,
  useCache = true
): Promise<ResolvedUrl> {
  // 生成缓存key（包含代理URL以区分不同地理位置的结果）
  const cacheKey = `${affiliateLink}|${proxyUrl || 'no-proxy'}`

  // 检查缓存
  if (useCache) {
    const now = Date.now()
    const cached = urlResolverCache.get(cacheKey)

    if (cached && now < cached.expiresAt) {
      console.log(`使用缓存的URL解析结果: ${affiliateLink}`)
      return cached.result
    }

    // 定期清理过期缓存（每100次请求清理一次）
    if (Math.random() < 0.01) {
      cleanExpiredCache()
    }
  }

  const redirectChain: string[] = [affiliateLink]
  const maxRedirects = 15  // 最多跟踪15次重定向
  let currentUrl = affiliateLink
  let redirectCount = 0

  // 创建统一的代理axios客户端（如果提供了proxyUrl则使用代理）
  const axiosClient = await createProxyAxiosClient({
    customProxyUrl: proxyUrl,
    timeout: 15000,
    useCache: true,
  })

  try {
    // 手动跟踪重定向链
    while (redirectCount < maxRedirects) {
      console.log(`重定向 ${redirectCount + 1}: ${currentUrl}`)

      try {
        const response = await axiosClient.get(currentUrl, {
          maxRedirects: 0,  // 禁用自动重定向
          validateStatus: (status) => status >= 200 && status < 400, // 接受2xx和3xx
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
          // 跟随重定向但手动处理
          beforeRedirect: (options: any, responseDetails: any) => {
            // 这个不会被调用，因为maxRedirects=0
          },
        })

        // 检查是否有重定向
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location

          if (!location) {
            console.warn('重定向响应但没有Location头')
            break
          }

          // 解析为绝对URL
          const nextUrl = resolveRedirectUrl(currentUrl, location)
          redirectChain.push(nextUrl)
          currentUrl = nextUrl
          redirectCount++
        } else {
          // 2xx响应，重定向结束
          break
        }
      } catch (error: any) {
        // 处理axios重定向错误
        if (error.response?.status >= 300 && error.response?.status < 400) {
          const location = error.response.headers.location

          if (location) {
            const nextUrl = resolveRedirectUrl(currentUrl, location)
            redirectChain.push(nextUrl)
            currentUrl = nextUrl
            redirectCount++
            continue
          }
        }

        // 其他错误，停止重定向
        console.error(`重定向跟踪失败（第${redirectCount + 1}次）:`, error.message)
        break
      }
    }

    if (redirectCount >= maxRedirects) {
      console.warn(`达到最大重定向次数 (${maxRedirects})，可能存在重定向循环`)
    }

    // 解析最终URL
    const finalFullUrl = currentUrl
    const urlObj = new URL(finalFullUrl)

    // 分离Final URL（不含查询参数）和Final URL suffix（查询参数部分）
    const finalUrl = `${urlObj.origin}${urlObj.pathname}`
    const finalUrlSuffix = urlObj.search.substring(1) // 去掉开头的'?'
    const fallbackSuffix = finalUrlSuffix ? '' : extractSuffixFromRedirectChain(redirectChain, finalUrl)
    const resolvedSuffix = finalUrlSuffix || fallbackSuffix

    console.log(`重定向完成: ${redirectCount}次重定向`)
    console.log(`Final URL: ${finalUrl}`)
    console.log(`Final URL Suffix: ${resolvedSuffix.substring(0, 100)}...`)

    const result: ResolvedUrl = {
      finalUrl,
      finalUrlSuffix: resolvedSuffix,
      redirectChain,
      redirectCount,
    }

    // 存入缓存
    if (useCache) {
      const now = Date.now()
      urlResolverCache.set(cacheKey, {
        result,
        resolvedAt: now,
        expiresAt: now + CACHE_DURATION,
      })
      console.log(`URL解析结果已缓存（24小时）`)
    }

    return result
  } catch (error: any) {
    console.error('URL解析失败:', error)
    throw new Error(`URL解析失败: ${error.message}`)
  }
}

/**
 * 从Final URL提取品牌或产品标识符
 * 用于验证推广链接是否指向正确的品牌页面
 *
 * @param finalUrl - Final URL（不含查询参数）
 * @returns 提取的标识符或路径片段
 *
 * @example
 * extractUrlIdentifier('https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA')
 * // '201E3A4F-C63F-48A6-87B7-524F985330DA'
 *
 * extractUrlIdentifier('https://itehil.com/products/solar-generator')
 * // 'solar-generator'
 */
export function extractUrlIdentifier(finalUrl: string): string {
  try {
    const urlObj = new URL(finalUrl)
    const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0)

    // 返回最后一个有意义的路径段
    return pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : ''
  } catch (error) {
    console.error('提取URL标识符失败:', error)
    return ''
  }
}

/**
 * 批量解析多个Affiliate链接
 *
 * @param links - 链接数组
 * @param proxyUrl - 可选的代理URL
 * @param concurrency - 并发数（默认3）
 * @returns 解析结果数组
 */
export async function resolveAffiliateLinksBatch(
  links: string[],
  proxyUrl?: string,
  concurrency = 3
): Promise<Array<{ link: string; result?: ResolvedUrl; error?: string }>> {
  const results: Array<{ link: string; result?: ResolvedUrl; error?: string }> = []

  // 分批处理
  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency)

    const batchPromises = batch.map(async (link) => {
      try {
        const result = await resolveAffiliateLink(link, proxyUrl)
        return { link, result }
      } catch (error: any) {
        return { link, error: error.message }
      }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)

    // 批次间延迟，避免请求过快
    if (i + concurrency < links.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return results
}

/**
 * 清除URL解析缓存
 *
 * @param affiliateLink - 可选，指定要清除的链接，不指定则清除所有
 */
export function clearUrlResolverCache(affiliateLink?: string): void {
  if (affiliateLink) {
    // 清除特定链接的所有缓存（包括不同代理的结果）
    let cleared = 0
    for (const key of urlResolverCache.keys()) {
      if (key.startsWith(affiliateLink + '|')) {
        urlResolverCache.delete(key)
        cleared++
      }
    }
    console.log(`已清除 ${cleared} 个缓存条目: ${affiliateLink}`)
  } else {
    const size = urlResolverCache.size
    urlResolverCache.clear()
    console.log(`已清除所有URL解析缓存 (${size}个)`)
  }
}

/**
 * 获取URL解析缓存统计信息
 */
export function getUrlResolverCacheStats(): {
  totalCached: number
  validCached: number
  expiredCached: number
} {
  const now = Date.now()
  let validCount = 0
  let expiredCount = 0

  urlResolverCache.forEach((cached) => {
    if (now < cached.expiresAt) {
      validCount++
    } else {
      expiredCount++
    }
  })

  return {
    totalCached: urlResolverCache.size,
    validCached: validCount,
    expiredCached: expiredCount,
  }
}
