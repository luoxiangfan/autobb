/**
 * 通用代理 Axios 客户端
 *
 * 统一的 axios + HttpsProxyAgent 方案，用于所有需要代理的业务场景：
 * - 网页爬取 (scraper.ts)
 * - URL 解析 (url-resolver.ts)
 * - 链接检测 (risk-alerts.ts)
 * - Google 搜索建议 (google-suggestions.ts)
 * - 等其他需要真实地理位置访问的场景
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getProxyIp } from './proxy/fetch-proxy-ip'

/**
 * 代理 Axios 实例缓存
 * 避免频繁创建代理连接
 */
interface CachedProxyClient {
  client: AxiosInstance
  proxyAddress: string
  createdAt: number
  expiresAt: number
}

const proxyClientCache = new Map<string, CachedProxyClient>()
const CACHE_DURATION = 5 * 60 * 1000 // 5分钟缓存

/**
 * 清除过期的缓存客户端
 */
function cleanExpiredClients(): void {
  const now = Date.now()
  for (const [key, cached] of proxyClientCache.entries()) {
    if (now >= cached.expiresAt) {
      proxyClientCache.delete(key)
    }
  }
}

/**
 * 创建配置了代理的 axios 客户端
 *
 * @param options - 配置选项
 * @param options.forceProxy - 强制使用代理（默认根据 PROXY_ENABLED 环境变量）
 * @param options.customProxyUrl - 自定义代理 URL（覆盖环境变量）
 * @param options.baseURL - axios baseURL
 * @param options.timeout - 请求超时时间（默认 30 秒）
 * @param options.useCache - 是否使用缓存的代理客户端（默认 true）
 * @param options.userId - 用户ID（用于代理IP缓存隔离）
 * @returns axios 实例
 *
 * @example
 * // 使用默认配置（从环境变量读取）
 * const client = await createProxyAxiosClient()
 * const response = await client.get('https://example.com')
 *
 * @example
 * // 强制使用代理
 * const client = await createProxyAxiosClient({ forceProxy: true })
 *
 * @example
 * // 使用自定义代理 URL
 * const client = await createProxyAxiosClient({ customProxyUrl: 'https://...' })
 */
export async function createProxyAxiosClient(options?: {
  forceProxy?: boolean
  customProxyUrl?: string
  baseURL?: string
  timeout?: number
  useCache?: boolean
  userId?: number
}): Promise<AxiosInstance> {
  const {
    forceProxy = false,
    customProxyUrl,
    baseURL,
    timeout = 30000,
    useCache = true,
    userId,
  } = options || {}

  // 确定是否使用代理
  const proxyEnabled = forceProxy || process.env.PROXY_ENABLED === 'true'
  const proxyUrl = customProxyUrl || process.env.PROXY_URL

  // 如果不需要代理，返回普通 axios 实例
  if (!proxyEnabled && !customProxyUrl) {
    console.log('代理未启用，使用直连')
    return axios.create({
      baseURL,
      timeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    })
  }

  if (!proxyUrl) {
    throw new Error('代理已启用但未配置 PROXY_URL。请在 .env 中设置 PROXY_URL')
  }

  // 生成缓存 key
  const cacheKey = `${proxyUrl}|${baseURL || 'no-base'}`

  // 检查缓存
  if (useCache) {
    const now = Date.now()
    const cached = proxyClientCache.get(cacheKey)

    if (cached && now < cached.expiresAt) {
      console.log(`使用缓存的代理客户端: ${cached.proxyAddress}`)
      return cached.client
    }

    // 定期清理过期缓存（每100次请求清理一次）
    if (Math.random() < 0.01) {
      cleanExpiredClients()
    }
  }

  try {
    console.log('🔧 配置代理 axios 客户端...')

    // 获取代理凭证（启用5分钟缓存，避免频繁调用IPRocket API）
    const proxy = await getProxyIp(proxyUrl, false, userId)
    console.log(`✓ 代理IP: ${proxy.fullAddress}`)

    // 创建 HttpsProxyAgent
    const proxyAgent = new HttpsProxyAgent(
      `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
    )

    // 创建 axios 实例，配置代理 agent
    const client = axios.create({
      baseURL,
      timeout,
      httpsAgent: proxyAgent,
      httpAgent: proxyAgent as any,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    })

    console.log('✓ 代理 axios 客户端配置成功')

    // 存入缓存
    if (useCache) {
      const now = Date.now()
      proxyClientCache.set(cacheKey, {
        client,
        proxyAddress: proxy.fullAddress,
        createdAt: now,
        expiresAt: now + CACHE_DURATION,
      })
      console.log(`代理客户端已缓存（${CACHE_DURATION / 1000}秒）`)
    }

    return client
  } catch (error: any) {
    throw new Error(
      `代理 axios 客户端配置失败: ${error.message}。请检查代理配置。`
    )
  }
}

/**
 * 便捷函数：使用代理发送 GET 请求
 *
 * @param url - 目标 URL
 * @param config - axios 请求配置（可选）
 * @param proxyOptions - 代理配置（可选）
 * @returns axios 响应
 *
 * @example
 * const response = await proxyGet('https://example.com/page')
 * console.log(response.data)
 *
 * @example
 * // 使用自定义代理
 * const response = await proxyGet(
 *   'https://example.com',
 *   { headers: { 'Custom-Header': 'value' } },
 *   { customProxyUrl: 'https://...' }
 * )
 */
export async function proxyGet<T = any>(
  url: string,
  config?: AxiosRequestConfig,
  proxyOptions?: Parameters<typeof createProxyAxiosClient>[0]
): Promise<import('axios').AxiosResponse<T>> {
  const client = await createProxyAxiosClient(proxyOptions)
  return client.get<T>(url, config)
}

/**
 * 便捷函数：使用代理发送 POST 请求
 *
 * @param url - 目标 URL
 * @param data - POST 数据
 * @param config - axios 请求配置（可选）
 * @param proxyOptions - 代理配置（可选）
 * @returns axios 响应
 *
 * @example
 * const response = await proxyPost('https://api.example.com/submit', { key: 'value' })
 */
export async function proxyPost<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig,
  proxyOptions?: Parameters<typeof createProxyAxiosClient>[0]
): Promise<import('axios').AxiosResponse<T>> {
  const client = await createProxyAxiosClient(proxyOptions)
  return client.post<T>(url, data, config)
}

/**
 * 便捷函数：使用代理发送 HEAD 请求
 * 用于检查 URL 可用性而不下载完整内容
 *
 * @param url - 目标 URL
 * @param config - axios 请求配置（可选）
 * @param proxyOptions - 代理配置（可选）
 * @returns axios 响应
 *
 * @example
 * const response = await proxyHead('https://example.com')
 * console.log('Status:', response.status)
 * console.log('Redirected:', response.request.res.responseUrl !== url)
 */
export async function proxyHead<T = any>(
  url: string,
  config?: AxiosRequestConfig,
  proxyOptions?: Parameters<typeof createProxyAxiosClient>[0]
): Promise<import('axios').AxiosResponse<T>> {
  const client = await createProxyAxiosClient(proxyOptions)
  return client.head<T>(url, config)
}

/**
 * 清除代理客户端缓存
 *
 * @param proxyUrl - 可选，指定要清除的代理 URL，不指定则清除所有
 */
export function clearProxyClientCache(proxyUrl?: string): void {
  if (proxyUrl) {
    let cleared = 0
    for (const key of proxyClientCache.keys()) {
      if (key.startsWith(proxyUrl + '|')) {
        proxyClientCache.delete(key)
        cleared++
      }
    }
    console.log(`已清除 ${cleared} 个代理客户端缓存: ${proxyUrl}`)
  } else {
    const size = proxyClientCache.size
    proxyClientCache.clear()
    console.log(`已清除所有代理客户端缓存 (${size}个)`)
  }
}

/**
 * 获取代理客户端缓存统计信息
 */
export function getProxyClientCacheStats(): {
  totalCached: number
  validCached: number
  expiredCached: number
} {
  const now = Date.now()
  let validCount = 0
  let expiredCount = 0

  proxyClientCache.forEach((cached) => {
    if (now < cached.expiresAt) {
      validCount++
    } else {
      expiredCount++
    }
  })

  return {
    totalCached: proxyClientCache.size,
    validCached: validCount,
    expiredCached: expiredCount,
  }
}
