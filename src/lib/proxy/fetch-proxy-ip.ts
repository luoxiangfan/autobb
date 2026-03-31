import { validateProxyUrl, maskProxyUrl } from './validate-url'
import { ProxyProviderRegistry } from './providers/provider-registry'
import type { ProxyCredentials } from './types'
import axios from 'axios'
import { shouldRetry, getRetryDelay, ProxyError, ProxyHealthCheckError } from './proxy-errors'

/**
 * 🔥 全局 IPRocket API 调用频率限制
 *
 * 问题：IPRocket API 有频率限制，50ms 间隔会在第 6 次调用后触发"业务异常"错误
 * 解决：添加全局调用队列，确保调用间隔 >= 100ms
 */
interface ThrottleQueueItem {
  execute: () => Promise<void>
  resolve: (value: any) => void
  reject: (error: any) => void
}

const iprocketCallQueue: ThrottleQueueItem[] = []
let lastIprocketCallTime = 0
let isProcessingQueue = false
const MIN_IPROCKET_CALL_INTERVAL = 100 // 最小调用间隔 100ms

/**
 * IPRocket API 调用频率限制包装器
 */
async function throttleIprocketCall<T>(providerName: string, fn: () => Promise<T>): Promise<T> {
  // 只对 IPRocket 进行频率限制
  if (providerName !== 'IPRocket') {
    return fn()
  }

  return new Promise((resolve, reject) => {
    const execute = async () => {
      try {
        const now = Date.now()
        const timeSinceLastCall = now - lastIprocketCallTime

        if (timeSinceLastCall < MIN_IPROCKET_CALL_INTERVAL) {
          const waitTime = MIN_IPROCKET_CALL_INTERVAL - timeSinceLastCall
          console.log(`⏳ [IPRocket 频率限制] 等待 ${waitTime}ms...`)
          await new Promise(r => setTimeout(r, waitTime))
        }

        lastIprocketCallTime = Date.now()
        const result = await fn()
        resolve(result)
      } catch (error) {
        reject(error)
      }
    }

    // 加入队列
    iprocketCallQueue.push({ execute, resolve, reject })

    // 如果没有正在处理队列，开始处理
    if (!isProcessingQueue) {
      processIprocketQueue()
    }
  })
}

/**
 * 处理 IPRocket API 调用队列
 */
async function processIprocketQueue(): Promise<void> {
  if (isProcessingQueue) return

  isProcessingQueue = true

  while (iprocketCallQueue.length > 0) {
    const item = iprocketCallQueue.shift()
    if (item) {
      await item.execute()
    }
  }

  isProcessingQueue = false
}

/**
 * 代理凭证信息
 */
export interface HealthCheckResult {
  healthy: boolean
  responseTime?: number
  error?: string
}

/**
 * 🔥 P1优化：快速TCP连接测试
 * 使用纯TCP连接测试代理IP的连通性，比HTTP请求快5-10倍
 *
 * @param host - 代理服务器地址
 * @param port - 代理服务器端口
 * @param timeoutMs - 超时时间（默认2秒）
 * @returns 连接耗时（毫秒），失败返回-1
 */
export async function tcpPing(host: string, port: number, timeoutMs = 2000): Promise<number> {
  const net = await import('net')

  return new Promise((resolve) => {
    const startTime = Date.now()
    const socket = new net.Socket()

    socket.setTimeout(timeoutMs)

    socket.on('connect', () => {
      const elapsed = Date.now() - startTime
      socket.destroy()
      resolve(elapsed)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(-1)
    })

    socket.on('error', () => {
      socket.destroy()
      resolve(-1)
    })

    socket.connect(port, host)
  })
}

/**
 * 🔥 P0优化：测试代理IP健康状态
 * 支持两种模式：
 * - 快速模式（默认）：仅TCP连接测试，耗时1-2秒
 * - 完整模式：HTTP请求测试，耗时3-10秒
 *
 * @param credentials - 代理凭证
 * @param timeoutMs - 测试超时时间（默认3秒）
 * @param fullCheck - 是否进行完整HTTP检查（默认false，仅TCP测试）
 * @returns 健康状态对象
 */
export async function testProxyHealth(
  credentials: ProxyCredentials,
  timeoutMs = 3000,
  fullCheck = false
): Promise<HealthCheckResult> {
  const startTime = Date.now()

  // 🔥 快速模式：仅TCP连接测试
  if (!fullCheck) {
    const tcpTime = await tcpPing(credentials.host, credentials.port, timeoutMs)
    const responseTime = Date.now() - startTime

    if (tcpTime === -1) {
      console.warn(`❌ 代理TCP连接失败: ${credentials.fullAddress} (${responseTime}ms)`)
      return {
        healthy: false,
        responseTime,
        error: 'TCP connection failed',
      }
    }

    // TCP连接成功，响应时间小于阈值则认为健康
    const healthy = tcpTime < 3000 // TCP连接小于3秒认为健康

    if (healthy) {
      console.log(`✅ 代理TCP测试通过: ${credentials.fullAddress} (${tcpTime}ms)`)
    } else {
      console.warn(`⚠️ 代理TCP响应慢: ${credentials.fullAddress} (${tcpTime}ms)`)
    }

    return {
      healthy,
      responseTime: tcpTime,
    }
  }

  // 完整模式：HTTP请求测试
  try {
    // 🔥 使用Amazon本身测试，因为我们的目标就是访问Amazon
    // 使用robots.txt作为测试端点（轻量级，无反爬虫）
    const testUrl = 'https://www.amazon.com/robots.txt'
    const proxyUrl = `http://${credentials.username}:${credentials.password}@${credentials.host}:${credentials.port}`

    // 使用node-fetch + https-proxy-agent测试
    // @ts-ignore - node-fetch类型声明问题
    const { default: fetch } = await import('node-fetch')
    const { HttpsProxyAgent } = await import('https-proxy-agent')

    const agent = new HttpsProxyAgent(proxyUrl)

    // 🔥 修复：使用AbortController代替AbortSignal.timeout (更可靠的超时控制)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(testUrl, {
        method: 'GET', // 使用GET获取实际内容，确保代理真实可用
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/plain,*/*',
        },
        agent,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseTime = Date.now() - startTime

      // 健康标准：
      // 1. HTTP状态码正常 (200-399)
      // 2. 响应时间 < 8秒（放宽阈值，提高代理可用率）
      const healthy = response.ok && responseTime < 8000

      if (healthy) {
        console.log(`✅ 代理IP健康检查通过: ${credentials.fullAddress} (${responseTime}ms)`)
      } else {
        console.warn(`⚠️ 代理IP响应慢: ${credentials.fullAddress} (${responseTime}ms)`)
      }

      return {
        healthy,
        responseTime,
        error: !response.ok ? `HTTP ${response.status}` : undefined,
      }
    } catch (fetchError: any) {
      // 清理超时定时器
      clearTimeout(timeoutId)
      throw fetchError
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime
    console.warn(`❌ 代理IP健康检查失败: ${credentials.fullAddress} - ${error.message} (${responseTime}ms)`)

    return {
      healthy: false,
      responseTime,
      error: error.message || String(error),
    }
  }
}

/**
 * 🔥 P0优化：异步健康检查（不阻塞主流程）
 * 在后台执行健康检查，返回Promise供调用者选择是否等待
 */
export function testProxyHealthAsync(
  credentials: ProxyCredentials,
  timeoutMs = 3000
): Promise<HealthCheckResult> {
  // 直接返回Promise，调用者可以选择await或忽略
  return testProxyHealth(credentials, timeoutMs)
}

/**
 * 从代理服务商获取代理IP（支持多种代理格式）
 *
 * 🔥 P1优化：新增多Provider支持
 * - 自动检测URL格式并选择合适的Provider
 * - 支持IPRocket（API调用）和直连格式（如 Oxylabs / Kookeey / Cliproxy）
 * - 统一接口，外部调用无感知
 *
 * @param proxyUrl - 代理服务商URL
 * @param maxRetries - 最大重试次数，默认3次
 * @param skipHealthCheck - 跳过健康检查（默认false，启用质量过滤）
 * @returns 代理凭证信息
 * @throws 如果获取失败或格式错误
 *
 * @example
 * // IPRocket格式
 * const proxy1 = await fetchProxyIp('https://api.iprocket.io/api?username=user&password=pass&cc=ROW&ips=1&proxyType=http&responseType=txt')
 *
 * // Oxylabs / Kookeey 等直连格式
 * const proxy2 = await fetchProxyIp('https://username:password@pr.oxylabs.io:7777')
 */
export async function fetchProxyIp(
  proxyUrl: string,
  maxRetries = 3,
  skipHealthCheck = false
): Promise<ProxyCredentials> {
  // Step 1: 获取合适的Provider
  let provider
  try {
    provider = ProxyProviderRegistry.getProvider(proxyUrl)
  } catch (error) {
    throw new Error(`不支持的代理URL格式: ${error instanceof Error ? error.message : String(error)}`)
  }

  console.log(`✅ 使用${provider.name} Provider处理URL: ${maskProxyUrl(proxyUrl)}`)

  // Step 2: 带智能重试的获取代理凭证
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔍 [${provider.name} ${attempt}/${maxRetries}] 开始获取...`)

      // 🔥 使用频率限制包装器调用 Provider 提取凭证
      const credentials = await throttleIprocketCall(provider.name, () =>
        provider.extractCredentials(proxyUrl)
      )

      // 🔥 P0优化：阻塞式健康检查，失败时重试获取新代理
      if (!skipHealthCheck) {
        const healthCheck = await testProxyHealth(credentials, 10000)
        if (!healthCheck.healthy) {
          console.warn(`⚠️ 代理IP健康检查失败: ${credentials.fullAddress} (${healthCheck.error || '响应过慢'})`)
          throw new ProxyHealthCheckError(
            `代理IP健康检查失败: ${healthCheck.error || '响应过慢'}`,
            credentials.fullAddress
          )
        }
        console.log(`✅ [${provider.name}] ${credentials.fullAddress} 健康检查通过 (${healthCheck.responseTime}ms)`)
      } else {
        console.log(`✅ [${provider.name}] ${credentials.fullAddress} (跳过健康检查)`)
      }

      return credentials
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('未知错误')

      // 🎯 智能重试判断
      const canRetry = shouldRetry(error)
      const isLastAttempt = attempt >= maxRetries

      if (error instanceof ProxyError) {
        console.error(
          `❌ [${provider.name} ${attempt}/${maxRetries}] ${error.name}: ${error.message} (code: ${error.code}, retryable: ${error.retryable})`
        )
      } else {
        console.error(`❌ [${provider.name} ${attempt}/${maxRetries}] ${lastError.message}`)
      }

      // 如果不可重试，直接抛出错误
      if (!canRetry) {
        console.error(`🚫 错误不可重试，终止获取代理`)
        throw lastError
      }

      // 如果不是最后一次尝试，等待后重试
      if (!isLastAttempt) {
        const waitTime = error instanceof ProxyError
          ? getRetryDelay(attempt, error)
          : attempt * 1000

        console.log(`⏳ 等待 ${waitTime}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
    }
  }

  // 所有重试都失败
  throw new Error(`获取代理IP失败（已重试${maxRetries}次）: ${lastError?.message || '未知错误'}`)
}

/**
 * 代理IP缓存
 * 避免频繁请求代理服务商API
 *
 * 缓存策略：
 * - 默认缓存5分钟（CACHE_DURATION）
 * - 按用户隔离缓存（必须传入 userId）
 * - 支持按 cacheKey 进一步隔离（用于补点击任务按 taskId 隔离）
 */
interface CachedProxy {
  credentials: ProxyCredentials
  fetchedAt: number
  expiresAt: number
}

const proxyCache = new Map<string, CachedProxy>()
const proxyInFlight = new Map<string, Promise<ProxyCredentials>>()
const CACHE_DURATION = 5 * 60 * 1000 // 5分钟

/**
 * 生成缓存键（必须包含 userId 以隔离不同用户）
 * @param proxyUrl - 代理URL
 * @param userId - 用户ID（必须）
 * @param cacheKey - 可选的缓存键（用于进一步隔离不同场景的缓存）
 */
function getCacheKey(proxyUrl: string, userId: number, cacheKey?: string): string {
  const baseKey = `${userId}:${proxyUrl}`
  return cacheKey ? `${baseKey}:${cacheKey}` : baseKey
}

/**
 * 🔥 P1优化：并行获取多个代理IP并选择最快的
 * 同时获取N个代理IP，通过TCP ping测试选择响应最快的
 *
 * @param proxyUrl - 代理服务商API URL
 * @param concurrency - 并行获取数量（默认3）
 * @param timeoutMs - TCP ping超时（默认2000ms）
 * @returns 最快的代理凭证，如果全部失败则抛出错误
 */
export async function fetchFastestProxy(
  proxyUrl: string,
  concurrency = 3,
  timeoutMs = 2000
): Promise<ProxyCredentials> {
  console.log(`\n🚀 并行获取 ${concurrency} 个代理IP，选择最快的...`)
  const startTime = Date.now()

  // 并行获取多个代理IP（跳过健康检查，后面统一测试）
  const fetchPromises: Promise<ProxyCredentials | null>[] = []
  for (let i = 0; i < concurrency; i++) {
    fetchPromises.push(
      fetchProxyIp(proxyUrl, 1, true)  // 单次尝试，跳过健康检查
        .then((creds) => {
          console.log(`✅ [${i + 1}] 获取成功: ${creds.fullAddress}`)
          return creds
        })
        .catch((err) => {
          console.warn(`⚠️ [${i + 1}] 获取失败: ${err.message}`)
          return null
        })
    )
  }

  // 等待所有获取完成
  const results = await Promise.all(fetchPromises)
  const validCredentials = results.filter((c): c is ProxyCredentials => c !== null)

  if (validCredentials.length === 0) {
    throw new Error(`获取代理IP失败：${concurrency}个并行请求全部失败`)
  }

  console.log(`📊 成功获取 ${validCredentials.length}/${concurrency} 个代理IP`)

  // 如果只有1个，直接返回
  if (validCredentials.length === 1) {
    const creds = validCredentials[0]
    // 做一次快速健康检查
    const health = await testProxyHealth(creds, timeoutMs, false)
    if (!health.healthy) {
      throw new Error(`唯一的代理IP健康检查失败: ${health.error}`)
    }
    console.log(`✅ 代理IP选中: ${creds.fullAddress} (${health.responseTime}ms)`)
    return creds
  }

  // 并行TCP ping测试所有代理
  console.log(`🏃 并行测试 ${validCredentials.length} 个代理IP的响应速度...`)
  const pingPromises = validCredentials.map(async (creds) => {
    const pingTime = await tcpPing(creds.host, creds.port, timeoutMs)
    return { creds, pingTime }
  })

  const pingResults = await Promise.all(pingPromises)

  // 过滤健康的代理并按响应时间排序
  const healthyProxies = pingResults
    .filter((r) => r.pingTime > 0)
    .sort((a, b) => a.pingTime - b.pingTime)

  if (healthyProxies.length === 0) {
    throw new Error(`所有代理IP的TCP连接测试均失败`)
  }

  // 选择最快的
  const fastest = healthyProxies[0]
  const totalTime = Date.now() - startTime

  console.log(`\n🏆 最快代理IP: ${fastest.creds.fullAddress}`)
  console.log(`   - TCP响应: ${fastest.pingTime}ms`)
  console.log(`   - 总耗时: ${totalTime}ms`)
  console.log(`   - 淘汰: ${validCredentials.length - healthyProxies.length} 个慢速/失败`)

  // 输出所有测试结果
  pingResults.forEach((r, i) => {
    const status = r.pingTime > 0 ? `${r.pingTime}ms` : '❌失败'
    const selected = r === fastest ? ' 👈 选中' : ''
    console.log(`   [${i + 1}] ${r.creds.fullAddress}: ${status}${selected}`)
  })

  return fastest.creds
}

/**
 * 获取代理IP（默认不使用缓存）
 *
 * 默认每次都获取最新的代理IP，确保代理有效性
 * 如需使用缓存（5分钟），设置 forceRefresh = false
 *
 * @param proxyUrl - 代理服务商API URL
 * @param forceRefresh - 是否强制刷新（默认true，总是获取新IP）
 * @param userId - 用户ID（必须，用于隔离不同用户的缓存）
 * @param cacheKey - 可选的缓存键，用于进一步隔离不同场景的缓存（例如：补点击任务按taskId隔离）
 * @returns 代理凭证信息
 *
 * @example
 * // 换链接任务：启用缓存，同一用户的多个任务复用代理IP
 * const proxy1 = await getProxyIp(proxyUrl, false, userId)
 *
 * // 补点击任务：按taskId隔离缓存，同一任务的每次点击使用不同IP
 * const proxy2 = await getProxyIp(proxyUrl, true, userId, taskId)
 */
export async function getProxyIp(
  proxyUrl: string,
  forceRefresh = true,
  userId?: number,
  cacheKey?: string
): Promise<ProxyCredentials> {
  const now = Date.now()

  // 🔥 如果启用缓存但没有提供 userId，抛出错误（防止跨用户缓存泄露）
  if (!forceRefresh && !userId) {
    throw new Error('启用代理IP缓存时必须提供 userId 参数以隔离不同用户')
  }

  const fullCacheKey = userId ? getCacheKey(proxyUrl, userId, cacheKey) : proxyUrl

  // 检查缓存
  if (!forceRefresh && userId) {
    const cached = proxyCache.get(fullCacheKey)
    if (cached && now < cached.expiresAt) {
      console.log(`使用缓存的代理IP: ${cached.credentials.fullAddress} (user: ${userId}${cacheKey ? `, key: ${cacheKey}` : ''})`)
      return cached.credentials
    }

    // 🔥 防止并发”打爆”同一个provider：同一proxyUrl只允许一个在飞请求
    const inflight = proxyInFlight.get(fullCacheKey)
    if (inflight) {
      return await inflight
    }
  }

  const fetchPromise = (async () => {
    // 获取新IP
    const credentials = await fetchProxyIp(proxyUrl)

    // 更新缓存（只有提供了 userId 才缓存）
    if (userId) {
      proxyCache.set(fullCacheKey, {
        credentials,
        fetchedAt: now,
        expiresAt: now + CACHE_DURATION,
      })
    }

    return credentials
  })()

  if (!forceRefresh && userId) {
    proxyInFlight.set(fullCacheKey, fetchPromise)
    try {
      return await fetchPromise
    } finally {
      proxyInFlight.delete(fullCacheKey)
    }
  }

  return await fetchPromise
}

/**
 * 清除代理IP缓存
 *
 * @param proxyUrl - 可选，指定要清除的Proxy URL，不指定则清除所有
 */
export function clearProxyCache(proxyUrl?: string): void {
  if (proxyUrl) {
    proxyCache.delete(proxyUrl)
    proxyInFlight.delete(proxyUrl)
    console.log(`已清除代理缓存: ${maskProxyUrl(proxyUrl)}`)
  } else {
    const size = proxyCache.size
    proxyCache.clear()
    proxyInFlight.clear()
    console.log(`已清除所有代理缓存 (${size}个)`)
  }
}

/**
 * 获取代理缓存统计信息
 */
export function getProxyCacheStats(): {
  totalCached: number
  validCached: number
  expiredCached: number
} {
  const now = Date.now()
  let validCount = 0
  let expiredCount = 0

  proxyCache.forEach((cached) => {
    if (now < cached.expiresAt) {
      validCount++
    } else {
      expiredCount++
    }
  })

  return {
    totalCached: proxyCache.size,
    validCached: validCount,
    expiredCached: expiredCount,
  }
}
