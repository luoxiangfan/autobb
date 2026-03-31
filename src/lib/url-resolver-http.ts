/**
 * HTTP请求方式解析URL（Level 1降级）
 * 优点：快速、成本低
 * 缺点：不支持JavaScript重定向
 */

import axios, { AxiosInstance } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Readable } from 'stream'
import { getProxyIp } from './proxy/fetch-proxy-ip'

export interface HttpResolvedUrl {
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
  statusCode: number
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

function shouldAcceptServerErrorAsResolvedFinalUrl(url: string, statusCode: number): boolean {
  if (statusCode < 500) return false
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    // Amazon 常对爬虫/代理返回 5xx（尤其 503 bot challenge），但 URL 本身仍是有效落地页。
    // URL 解析阶段的目标是“拿到最终落地 URL”，因此允许在此处“带 5xx”返回，让后续抓取阶段用更强策略处理。
    return /(^|\.)amazon\./.test(hostname)
  } catch {
    return false
  }
}

function safeDestroyStream(stream: unknown): void {
  try {
    const s = stream as any
    if (s && typeof s.destroy === 'function') s.destroy()
  } catch {
    // ignore
  }
}

async function readStreamSnippet(stream: Readable, maxBytes: number, timeoutMs: number): Promise<string> {
  return await new Promise((resolve) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let done = false

    const cleanup = () => {
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onError)
    }

    const finish = (value: string) => {
      if (done) return
      done = true
      cleanup()
      safeDestroyStream(stream)
      resolve(value)
    }

    const timer = setTimeout(() => {
      finish(chunks.length ? Buffer.concat(chunks).toString('utf8') : '')
    }, timeoutMs)
    timer.unref?.()

    const onData = (chunk: Buffer) => {
      if (done) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any)
      const remaining = maxBytes - totalBytes
      if (remaining <= 0) {
        clearTimeout(timer)
        finish(Buffer.concat(chunks).toString('utf8'))
        return
      }

      if (buf.length > remaining) {
        chunks.push(buf.subarray(0, remaining))
        totalBytes += remaining
        clearTimeout(timer)
        finish(Buffer.concat(chunks).toString('utf8'))
        return
      }

      chunks.push(buf)
      totalBytes += buf.length
      if (totalBytes >= maxBytes) {
        clearTimeout(timer)
        finish(Buffer.concat(chunks).toString('utf8'))
      }
    }

    const onEnd = () => {
      clearTimeout(timer)
      finish(Buffer.concat(chunks).toString('utf8'))
    }

    const onError = () => {
      clearTimeout(timer)
      finish(Buffer.concat(chunks).toString('utf8'))
    }

    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
    try {
      stream.resume()
    } catch {
      // ignore
    }
  })
}


/**
 * 使用HTTP请求解析Affiliate链接
 *
 * @param affiliateLink - Offer推广链接
 * @param proxyUrl - 可选的代理URL
 * @param maxRedirects - 最大重定向次数（默认10）
 * @param userId - 用户ID（用于代理IP缓存隔离）
 * @param forceRefreshProxy - 是否强制刷新代理IP（默认false使用缓存，重试时应设为true）
 * @returns 解析后的URL信息
 */
export async function resolveAffiliateLinkWithHttp(
  affiliateLink: string,
  proxyUrl?: string,
  maxRedirects = 10,
  userId?: number,
  forceRefreshProxy = false
): Promise<HttpResolvedUrl> {
  const redirectChain: string[] = [affiliateLink]
  let currentUrl = affiliateLink
  let redirectCount = 0
  let finalStatusCode = 200

  try {
    // 配置axios实例
    const axiosConfig: any = {
      maxRedirects: 0, // 手动处理重定向
      validateStatus: (status: number) => status >= 200 && status < 400, // 接受2xx和3xx
      timeout: 15000, // 15秒超时
      headers: {
        // URL解析阶段主要依赖 Location / 最终URL，使用“低摩擦”UA更稳定（部分站点对浏览器UA会卡死/触发挑战）
        'User-Agent': 'curl/8.5.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }

    // 如果有代理URL,先获取真实代理IP
    if (proxyUrl) {
      try {
        console.log('🔄 获取代理IP...')
        // 🔥 代理IP缓存策略：
        // - 正常请求：启用缓存（5分钟），避免频繁调用IPRocket API触发频率限制
        // - 重试请求：强制刷新，获取新的代理IP以绕过可能被封禁的IP
        const proxyCredentials = await getProxyIp(proxyUrl, forceRefreshProxy, userId)

        // 配置代理
        const proxyAgent = new HttpsProxyAgent(
          `http://${proxyCredentials.username}:${proxyCredentials.password}@${proxyCredentials.host}:${proxyCredentials.port}`
        )
        axiosConfig.httpsAgent = proxyAgent
        axiosConfig.httpAgent = proxyAgent

        console.log(`✅ 使用代理: ${proxyCredentials.fullAddress}`)
      } catch (proxyError: any) {
        // 代理获取失败 → 抛出错误，触发降级到Playwright
        console.error('❌ 获取代理IP失败:', proxyError.message)
        throw new Error(`无法获取代理IP（将降级到Playwright）: ${proxyError.message}`)
      }
    }

    const client: AxiosInstance = axios.create(axiosConfig)

    const extractRedirectFromHtml = (html: unknown, baseUrl: string): string | null => {
      if (typeof html !== 'string') return null
      const content = html.slice(0, 200_000) // 防御：避免超大HTML导致正则过慢

      // meta refresh: <meta http-equiv="refresh" content="0;url=https://...">
      const metaRefresh = content.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>\s]+)[^"']*["'][^>]*>/i)
        || content.match(/<meta[^>]+content=["'][^"']*url=([^"'>\s]+)[^"']*["'][^>]+http-equiv=["']?refresh["']?[^>]*>/i)
      const metaUrl = metaRefresh?.[1] ? metaRefresh[1].replace(/^['"]|['"]$/g, '') : null
      if (metaUrl) {
        try {
          return new URL(metaUrl, baseUrl).toString()
        } catch {
          // ignore
        }
      }

      // JS redirect patterns
      const jsCandidates = [
        /(?:window\.)?location\.replace\(\s*["']([^"']+)["']\s*\)/i,
        /(?:window\.)?location\.assign\(\s*["']([^"']+)["']\s*\)/i,
        /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
        /document\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
      ]
      for (const re of jsCandidates) {
        const m = content.match(re)
        const u = m?.[1]?.trim()
        if (!u) continue
        if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) continue
        try {
          return new URL(u, baseUrl).toString()
        } catch {
          // ignore
        }
      }

      // JS redirect via变量: var u = "https://..."; location.replace(u)
      const varMap = new Map<string, string>()
      const varRegex = /(?:var|let|const)\s+([a-zA-Z_$][\w$]*)\s*=\s*["']([^"']+)["']/gi
      let varMatch: RegExpExecArray | null
      while ((varMatch = varRegex.exec(content)) !== null) {
        const varName = varMatch[1]
        const varValue = varMatch[2]?.trim()
        if (!varName || !varValue) continue
        if (!/^https?:\/\//i.test(varValue) && !varValue.startsWith('/')) continue
        varMap.set(varName, varValue)
      }

      if (varMap.size > 0) {
        const varRedirects = [
          /(?:window\.)?location\.replace\(\s*([a-zA-Z_$][\w$]*)\s*\)/i,
          /(?:window\.)?location\.assign\(\s*([a-zA-Z_$][\w$]*)\s*\)/i,
          /(?:window\.)?location(?:\.href)?\s*=\s*([a-zA-Z_$][\w$]*)/i,
          /document\.location(?:\.href)?\s*=\s*([a-zA-Z_$][\w$]*)/i,
        ]
        for (const re of varRedirects) {
          const m = content.match(re)
          const varName = m?.[1]
          if (!varName) continue
          const value = varMap.get(varName)
          if (!value) continue
          try {
            return new URL(value, baseUrl).toString()
          } catch {
            // ignore
          }
        }
      }

      return null
    }

    const shouldProbeHtmlRedirect = (url: string): boolean => {
      // 仅对tracking特征明显的URL做GET探测（读取少量HTML），避免慢/大落地页导致整体超时
      return /\/track|\/click|\/redirect|\/go|\/out|\/visit|\/link|[?&](?:url|redirect|target|destination|goto|link|new)=/i.test(url)
    }

    // 手动跟踪重定向
    while (redirectCount < maxRedirects) {
      console.log(`HTTP请求: ${currentUrl} (重定向 ${redirectCount}/${maxRedirects})`)

      const response = await client.request({
        method: 'HEAD',
        url: currentUrl,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 600, // 接受所有状态码
      })

      finalStatusCode = response.status

      // HEAD被禁止时降级到GET（但只读取少量HTML，避免超时）
      if (response.status === 405 || response.status === 501) {
        const getResponse = await client.get(currentUrl, {
          timeout: 8000,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 600,
          responseType: 'stream',
        })
        finalStatusCode = getResponse.status

        if (getResponse.status >= 300 && getResponse.status < 400) {
          const location = getResponse.headers.location || getResponse.headers.Location
          if (!location) {
            console.warn('重定向响应缺少Location头')
            safeDestroyStream(getResponse.data)
            break
          }

          // 解析重定向URL（可能是相对路径）
          let nextUrl: string
          if (location.startsWith('http')) {
            nextUrl = location
          } else if (location.startsWith('/')) {
            const urlObj = new URL(currentUrl)
            nextUrl = `${urlObj.origin}${location}`
          } else {
            const urlObj = new URL(currentUrl)
            const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
            nextUrl = `${urlObj.origin}${basePath}${location}`
          }

          redirectChain.push(nextUrl)
          currentUrl = nextUrl
          redirectCount++
          safeDestroyStream(getResponse.data)
          await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
          continue
        }

        if (getResponse.status >= 400 && getResponse.status < 500) {
          console.warn(`⚠️ HTTP到达最终URL但返回状态码 ${getResponse.status}，停止继续重定向追踪`)
          safeDestroyStream(getResponse.data)
          break
        }

        if (getResponse.status >= 500) {
          safeDestroyStream(getResponse.data)
          if (shouldAcceptServerErrorAsResolvedFinalUrl(currentUrl, getResponse.status)) {
            console.warn(`⚠️ HTTP到达最终URL但返回状态码 ${getResponse.status}，停止继续重定向追踪`)
            break
          }
          throw new Error(`HTTP请求失败: 状态码 ${getResponse.status}`)
        }

        const snippet = await readStreamSnippet(getResponse.data as Readable, 64 * 1024, 3000)
        const htmlRedirect = extractRedirectFromHtml(snippet, currentUrl)
        if (htmlRedirect && htmlRedirect !== currentUrl) {
          redirectChain.push(htmlRedirect)
          currentUrl = htmlRedirect
          redirectCount++
          await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
          continue
        }

        break
      }

      // 检查是否是重定向状态码
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location || response.headers.Location

        if (!location) {
          console.warn('重定向响应缺少Location头')
          break
        }

        // 解析重定向URL（可能是相对路径）
        let nextUrl: string
        if (location.startsWith('http')) {
          nextUrl = location
        } else if (location.startsWith('/')) {
          const urlObj = new URL(currentUrl)
          nextUrl = `${urlObj.origin}${location}`
        } else {
          const urlObj = new URL(currentUrl)
          const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
          nextUrl = `${urlObj.origin}${basePath}${location}`
        }

        redirectChain.push(nextUrl)
        currentUrl = nextUrl
        redirectCount++

        // 添加随机延迟模拟人类行为
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
      } else if (response.status === 200) {
        // 检查是否有meta refresh头（如yeahpromos.com）
        const refreshHeader = response.headers.refresh || response.headers.Refresh

        if (refreshHeader) {
          console.log(`🔄 检测到Meta Refresh: ${refreshHeader}`)

          // 解析 refresh 头: "0;url=https://example.com"
          const urlMatch = refreshHeader.match(/url=(.+)$/i)
          if (urlMatch && urlMatch[1]) {
            const nextUrl = urlMatch[1].trim()

            // 验证URL格式
            if (nextUrl.startsWith('http')) {
              redirectChain.push(nextUrl)
              currentUrl = nextUrl
              redirectCount++

              console.log(`   → Meta Refresh重定向到: ${nextUrl}`)

              // 添加随机延迟
              await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
              continue
            }
          }
        }

        // tracking中间页可能在HTML中通过meta refresh / JS跳转到真实落地页（仅对tracking特征明显的URL探测）
        if (shouldProbeHtmlRedirect(currentUrl)) {
          try {
            const getResponse = await client.get(currentUrl, {
              timeout: 8000,
              maxRedirects: 0,
              validateStatus: (status) => status >= 200 && status < 600,
              responseType: 'stream',
            })

            finalStatusCode = getResponse.status

            if (getResponse.status >= 300 && getResponse.status < 400) {
              const location = getResponse.headers.location || getResponse.headers.Location
              if (location) {
                let nextUrl: string
                if (location.startsWith('http')) {
                  nextUrl = location
                } else if (location.startsWith('/')) {
                  const urlObj = new URL(currentUrl)
                  nextUrl = `${urlObj.origin}${location}`
                } else {
                  const urlObj = new URL(currentUrl)
                  const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)
                  nextUrl = `${urlObj.origin}${basePath}${location}`
                }
                redirectChain.push(nextUrl)
                currentUrl = nextUrl
                redirectCount++
                safeDestroyStream(getResponse.data)
                await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
                continue
              }
            }

            const snippet = await readStreamSnippet(getResponse.data as Readable, 64 * 1024, 3000)
            const htmlRedirect = extractRedirectFromHtml(snippet, currentUrl)
            if (htmlRedirect && htmlRedirect !== currentUrl) {
              redirectChain.push(htmlRedirect)
              currentUrl = htmlRedirect
              redirectCount++
              await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
              continue
            }
          } catch {
            // ignore probe failure
          }
        }

        // 没有meta refresh，成功到达最终页面
        break
      } else if (response.status >= 400 && response.status < 500) {
        // 🔥 关键：URL解析阶段不应把4xx当作“无法解析”
        // 例如最终站点对代理/爬虫返回403，但finalUrl仍然是有效落地页URL，后续抓取阶段可用更强手段处理
        console.warn(`⚠️ HTTP到达最终URL但返回状态码 ${response.status}，停止继续重定向追踪`)
        break
      } else if (response.status >= 500) {
        if (shouldAcceptServerErrorAsResolvedFinalUrl(currentUrl, response.status)) {
          console.warn(`⚠️ HTTP到达最终URL但返回状态码 ${response.status}，停止继续重定向追踪`)
          break
        }
        throw new Error(`HTTP请求失败: 状态码 ${response.status}`)
      } else {
        throw new Error(`HTTP请求失败: 状态码 ${response.status}`)
      }
    }

    if (redirectCount >= maxRedirects) {
      throw new Error(`超过最大重定向次数: ${maxRedirects}`)
    }

    // 分离Final URL和Final URL suffix
    // 注意：不要从tracking域名的URL参数中提取目标URL
    // 应该让HTTP重定向自然跟踪，tracking域名会302重定向到带追踪参数的最终URL
    // 例如：partnermatic.com/track/... → 302 → diamondsfactory.ca/?wgu=...&utm_source=...
    let finalFullUrl = currentUrl
    let urlObj = new URL(finalFullUrl)

    const finalUrl = `${urlObj.origin}${urlObj.pathname}`
    const finalUrlSuffix = urlObj.search.substring(1)
    const fallbackSuffix = finalUrlSuffix ? '' : extractSuffixFromRedirectChain(redirectChain, finalUrl)
    const resolvedSuffix = finalUrlSuffix || fallbackSuffix

    let resolvedFinalUrl = finalUrl
    let resolvedFinalUrlSuffix = resolvedSuffix
    let resolvedRedirectCount = redirectCount

    const fullResolvedUrl = resolvedFinalUrlSuffix
      ? `${resolvedFinalUrl}?${resolvedFinalUrlSuffix}`
      : resolvedFinalUrl
    const embeddedTarget = extractEmbeddedTargetUrl(fullResolvedUrl)
    if (embeddedTarget) {
      try {
        const embeddedUrlObj = new URL(embeddedTarget)
        const embeddedFinalUrl = `${embeddedUrlObj.origin}${embeddedUrlObj.pathname}`
        const embeddedFinalUrlSuffix = embeddedUrlObj.search.substring(1)

        if (embeddedFinalUrl !== resolvedFinalUrl || embeddedFinalUrlSuffix !== resolvedFinalUrlSuffix) {
          console.log(`   📎 HTTP解析识别到嵌入目标URL: ${embeddedFinalUrl}`)
          redirectChain.push(embeddedUrlObj.toString())
          resolvedFinalUrl = embeddedFinalUrl
          resolvedFinalUrlSuffix = embeddedFinalUrlSuffix
          resolvedRedirectCount += 1
        }
      } catch {
        // ignore invalid embedded URL
      }
    }

    console.log(`✅ HTTP解析完成: ${resolvedRedirectCount}次重定向`)
    console.log(`   Final URL: ${resolvedFinalUrl}`)
    if (!finalUrlSuffix && fallbackSuffix) {
      console.log(`   Final URL Suffix(redirect): ${fallbackSuffix.substring(0, 100)}${fallbackSuffix.length > 100 ? '...' : ''}`)
    }

    return {
      finalUrl: resolvedFinalUrl,
      finalUrlSuffix: resolvedFinalUrlSuffix,
      redirectChain,
      redirectCount: resolvedRedirectCount,
      statusCode: finalStatusCode,
    }
  } catch (error: any) {
    console.error('HTTP解析失败:', error.message)

    // 如果是超时或网络错误，抛出可重试的错误
    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ECONNREFUSED' ||
      error.message.includes('timeout') ||
      error.message.includes('EPROTO') ||
      error.message.includes('wrong version number') ||
      error.message.includes('ssl3_get_record')
    ) {
      throw new Error(`HTTP请求超时或网络错误: ${error.message}`)
    }

    // 其他错误（如SSL错误、JavaScript重定向等）抛出不可重试的错误
    // 这些错误应该降级到Playwright
    throw new Error(`HTTP请求失败（可能需要Playwright）: ${error.message}`)
  }
}

/**
 * 验证URL是否可以使用HTTP方式解析
 *
 * 某些网站可能使用JavaScript重定向，HTTP方式无法处理
 * 返回true表示可以尝试HTTP，false表示直接使用Playwright
 */
export function canUseHttpResolver(url: string): boolean {
  // 已知需要JavaScript的域名黑名单
  const jsRequiredDomains: string[] = [
    // 可以根据实际情况添加
  ]

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // 检查是否在黑名单中
    for (const domain of jsRequiredDomains) {
      if (hostname.includes(domain)) {
        console.log(`⚠️ ${hostname} 需要JavaScript，跳过HTTP解析`)
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

/**
 * 🔥 从tracking域名URL中提取嵌入的目标URL
 *
 * 某些tracking服务（如partnermatic.com）会将目标URL嵌入到查询参数中
 * 例如: https://app.partnermatic.com/track/xxx?url=https://byinsomnia.com/
 *
 * @param url - 可能包含嵌入URL的tracking链接
 * @returns 提取的目标URL，如果没有则返回null
 */
export function extractEmbeddedTargetUrl(url: string): string | null {
  // 已知的tracking域名列表
  const trackingDomains = [
    'partnermatic.com',
    'linkbux.com',
    'linkhaitao.com',
    'go2cloud.org',
    'tracking.com',
    'aff.bstk.com',
    'click.linksynergy.com',
  ]

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // 检查是否是tracking域名
    const isTrackingDomain = trackingDomains.some(domain => hostname.includes(domain))
    if (!isTrackingDomain) {
      return null
    }

    // 尝试从查询参数中提取目标URL
    // 常见参数名: url, redirect, target, destination, goto, link, new
    const targetParamNames = ['url', 'redirect', 'target', 'destination', 'goto', 'link', 'new', 'r', 'u']

    for (const paramName of targetParamNames) {
      const targetUrl = urlObj.searchParams.get(paramName)
      if (targetUrl && targetUrl.startsWith('http')) {
        console.log(`   📎 从参数 "${paramName}" 提取目标URL`)
        return targetUrl
      }
    }

    // 尝试从URL路径中提取（某些tracking服务将URL编码在路径中）
    // 例如: /track/base64encodedurl
    const pathParts = urlObj.pathname.split('/')
    for (const part of pathParts) {
      // 检查是否是URL编码的完整URL
      try {
        const decoded = decodeURIComponent(part)
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          console.log(`   📎 从路径中提取URL编码的目标URL`)
          return decoded
        }
      } catch {
        // 不是有效的URL编码，跳过
      }
    }

    return null
  } catch (error) {
    console.warn('提取嵌入URL失败:', error)
    return null
  }
}
