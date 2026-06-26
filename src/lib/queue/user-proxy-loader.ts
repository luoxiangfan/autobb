/**
 * 从用户设置中获取代理配置
 *
 * 复用/settings页面中用户配置的"代理设置"
 * 数据存储在 system_settings 表中，category='proxy', key='urls'
 *
 * 重要：代理配置只使用用户自己的配置，不使用全局配置
 */

import {
  expandProxyUrlCountries,
  proxyCountryCodesOverlap,
  type ProxyCountryUrlConfig,
} from '@/lib/common/proxy-country'

export type ProxyUrlConfig = ProxyCountryUrlConfig

/**
 * 队列系统使用的代理配置格式
 */
export interface QueueProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
  protocol: 'http' | 'https' | 'socks5'
  country?: string
  userId?: number
  // 保留原始URL，用于IPRocket等动态代理服务
  originalUrl?: string
}

type ParsedProxyEndpoint = {
  host: string
  port: number
  username?: string
  password?: string
  protocol: 'http' | 'https' | 'socks5'
}

/**
 * 需要代理的任务类型
 * offer-extraction: 网页抓取需要代理以避免 IP 封禁
 *
 * 不需要代理的任务类型
 * sync: Google Ads数据同步使用官方API，不需要代理
 * backup: 备份任务是内部操作
 */
const PROXY_REQUIRED_TASK_TYPES = ['offer-extraction'] as const

function parseProxyEndpoint(proxyUrl: string): ParsedProxyEndpoint | null {
  const trimmed = String(proxyUrl || '').trim()
  if (!trimmed) return null

  // 直连格式（可选带 http(s):// 前缀）: host:port:user:pass
  const direct = trimmed.replace(/^https?:\/\//, '')
  const directParts = direct.split(':')
  if (directParts.length >= 4) {
    const port = parseInt(directParts[1], 10)
    if (Number.isFinite(port)) {
      return {
        host: directParts[0],
        port,
        username: directParts[2] || undefined,
        password: directParts[3] || undefined,
        protocol: 'http',
      }
    }
  }

  // 标准 URL 格式
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('socks5://')
  ) {
    try {
      const url = new URL(trimmed)
      let protocol: 'http' | 'https' | 'socks5' = 'http'
      if (url.protocol === 'https:') protocol = 'https'
      if (url.protocol === 'socks5:') protocol = 'socks5'

      return {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
        username: url.username || undefined,
        password: url.password || undefined,
        protocol,
      }
    } catch {
      return null
    }
  }

  // 简单格式: host:port
  const parts = trimmed.split(':')
  if (parts.length === 2) {
    const port = parseInt(parts[1], 10)
    if (Number.isFinite(port)) {
      return {
        host: parts[0],
        port,
        protocol: 'http',
      }
    }
  }

  return null
}

/**
 * 检查任务类型是否需要代理
 */
export function isProxyRequiredForTaskType(taskType: string): boolean {
  return PROXY_REQUIRED_TASK_TYPES.includes(taskType as any)
}

/**
 * 将用户代理配置转换为统一队列系统使用的ProxyConfig格式
 *
 * 注意：IPRocket等动态代理服务的URL是API端点，不是传统的代理服务器地址
 * 需要保留原始URL以便在实际使用时调用API获取代理IP
 */
export function convertUserProxiesToQueueFormat(proxies: ProxyUrlConfig[]): QueueProxyConfig[] {
  return proxies
    .map((proxy) => {
      const parsed = parseProxyEndpoint(proxy.url)
      if (!parsed) {
        console.warn(`解析代理URL失败: ${proxy.url}`)
        return null
      }

      return {
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        protocol: parsed.protocol,
        country: proxy.country,
        // 保留原始URL，用于IPRocket等动态代理服务
        originalUrl: proxy.url,
      }
    })
    .filter((proxy): proxy is NonNullable<typeof proxy> => proxy !== null)
}

/**
 * 获取用户的代理配置（用于队列系统）
 *
 * 重要：只返回用户自己配置的代理，不使用全局配置
 *
 * @param userId - 用户ID
 * @returns 转换后的代理配置列表
 */
async function getUserProxiesForQueue(userId: number): Promise<QueueProxyConfig[]> {
  // 只读取用户级配置，不回退全局
  const userProxies = await getUserOnlyProxyUrls(userId)
  const queueProxies = convertUserProxiesToQueueFormat(userProxies)

  // 添加userId标识
  return queueProxies.map((proxy) => ({
    ...proxy,
    userId,
  }))
}

/**
 * 获取用户自己的代理配置（不包含全局配置）
 *
 * @param userId - 用户ID
 * @returns 用户自己配置的代理URL列表
 */
async function getUserOnlyProxyUrls(userId: number): Promise<ProxyUrlConfig[]> {
  try {
    // 动态导入数据库模块
    const { getDatabase } = await import('@/lib/db')
    const db = await getDatabase()

    // 只查询用户级配置（user_id = userId），不包含全局配置（user_id IS NULL）
    const query = `
      SELECT value, encrypted_value, is_sensitive
      FROM system_settings
      WHERE category = 'proxy' AND key = 'urls' AND user_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `
    const row = (await db.queryOne(query, [userId])) as
      | {
          value: string | null
          encrypted_value: string | null
          is_sensitive: number | boolean
        }
      | undefined

    if (!row) {
      return []
    }

    // 获取配置值（处理加密情况）
    const isSensitive = row.is_sensitive === true
    let value = row.value

    if (isSensitive && row.encrypted_value) {
      const { decrypt } = await import('@/lib/auth')
      value = decrypt(row.encrypted_value)
    }

    if (!value) {
      return []
    }

    const proxies = JSON.parse(value)
    if (Array.isArray(proxies)) {
      const normalized = proxies
        .filter((p: any) => p && typeof p.country === 'string' && typeof p.url === 'string')
        .map((p: any) => ({
          country: String(p.country || '').trim(),
          url: String(p.url || '').trim(),
        }))
      return expandProxyUrlCountries(normalized)
    }

    return []
  } catch (error: any) {
    console.error(`获取用户 ${userId} 代理配置失败:`, error.message)
    return []
  }
}

/**
 * 获取指定国家的代理配置
 *
 * @param targetCountry - 目标国家代码
 * @param userId - 用户ID
 * @returns 匹配的代理配置，如果没有匹配则返回第一个作为兜底
 */
export async function getProxyForCountry(
  targetCountry: string,
  userId: number
): Promise<QueueProxyConfig | undefined> {
  const proxies = await getUserProxiesForQueue(userId)

  if (proxies.length === 0) {
    return undefined
  }

  // 查找匹配的国家
  const matched = proxies.find((proxy) =>
    proxyCountryCodesOverlap(targetCountry, String(proxy.country || ''))
  )

  if (matched) {
    return matched
  }

  // 没有找到匹配的国家，返回第一个作为兜底
  return proxies[0]
}
