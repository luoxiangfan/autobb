import Redis from 'ioredis'
import { REDIS_PREFIX_CONFIG } from './config'

// 7天缓存时间（秒）
const CACHE_TTL = 7 * 24 * 60 * 60

// 单例Redis连接
let redisClient: Redis | null = null

/**
 * 获取Redis客户端连接
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not set')
    }

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    })

    redisClient.on('error', (err) => {
      console.error('Redis连接错误:', err.message)
    })

    redisClient.on('connect', () => {
      console.log('Redis已连接')
    })
  }

  return redisClient
}

/**
 * 生成网页缓存的key
 * @param url - 网页URL
 * @param language - 目标语言
 * @param pageType - 页面类型（product或store）
 *
 * 格式：{cache_prefix}scrape:{typePrefix}{language}:{base64Url}
 * 例如：autoads:development:cache:scrape:product:en:aHR0cHM6Ly8uLi4=
 */
function generateCacheKey(url: string, language: string, pageType?: 'product' | 'store'): string {
  // 标准化URL（移除尾部斜杠和查询参数中的tracking）
  const normalizedUrl = url.replace(/\/$/, '').replace(/[?&](ref|tag|utm_[^&]+)=[^&]*/g, '')

  // 包含页面类型以避免类型不匹配
  const typePrefix = pageType ? `${pageType}:` : ''
  return `${REDIS_PREFIX_CONFIG.cache}scrape:${typePrefix}${language}:${Buffer.from(normalizedUrl).toString('base64')}`
}

/**
 * SEO数据结构
 */
export interface SeoData {
  metaTitle: string
  metaDescription: string
  metaKeywords: string
  ogTitle: string
  ogDescription: string
  ogImage: string
  canonicalUrl: string
  h1: string[]
  imageAlts: string[]
}

/**
 * 网页抓取数据的缓存结构
 * 注意：不存储完整HTML以节省存储空间，只保留AI生成创意所需的文本内容和SEO信息
 */
export interface CachedPageData {
  title: string
  description: string
  text: string
  seo: SeoData
  pageType?: 'product' | 'store' // 页面类型（可选，避免类型不匹配）
  cachedAt: string
  url: string
  language: string
}

/**
 * 从缓存获取网页数据
 * @param url - 网页URL
 * @param language - 目标语言
 * @param pageType - 页面类型（product或store，可选）
 * @returns 缓存的数据或null
 */
export async function getCachedPageData(
  url: string,
  language: string,
  pageType?: 'product' | 'store'
): Promise<CachedPageData | null> {
  try {
    const redis = getRedisClient()
    const key = generateCacheKey(url, language, pageType)

    const cached = await redis.get(key)
    if (cached) {
      console.log(`📦 缓存命中: ${url} (${pageType || '未指定类型'})`)
      return JSON.parse(cached)
    }

    console.log(`📭 缓存未命中: ${url} (${pageType || '未指定类型'})`)
    return null
  } catch (error: any) {
    console.error('Redis读取失败:', error.message)
    return null
  }
}

// ============================================
// Keyword Search Volume Caching
// ============================================

const PREFIX = process.env.REDIS_KEY_PREFIX || 'autoads:'

// Keyword volume cache key format: autoads:kw:US:en:keyword
function getKeywordCacheKey(keyword: string, country: string, language: string): string {
  return `${PREFIX}kw:${country}:${language}:${keyword.toLowerCase()}`
}

// Batch get cached volumes
export async function getBatchCachedVolumes(
  keywords: string[],
  country: string,
  language: string
): Promise<Map<string, { volume: number; competition?: string; competitionIndex?: number }>> {
  const result = new Map<
    string,
    { volume: number; competition?: string; competitionIndex?: number }
  >()
  try {
    const client = getRedisClient()
    const keys = keywords.map((kw) => getKeywordCacheKey(kw, country, language))
    if (keys.length === 0) return result

    const values = await client.mget(...keys)

    keywords.forEach((kw, idx) => {
      if (values[idx]) {
        const data = JSON.parse(values[idx] as string)
        result.set(kw.toLowerCase(), {
          volume: data.volume,
          competition: data.competition || 'UNKNOWN',
          competitionIndex: data.competitionIndex || 0,
        })
      }
    })
  } catch (error: any) {
    console.error('[Redis] Batch get error:', error.message)
  }
  return result
}

// Batch cache volumes
export async function batchCacheVolumes(
  data: Array<{ keyword: string; volume: number; competition?: string; competitionIndex?: number }>,
  country: string,
  language: string,
  ttlSeconds: number = CACHE_TTL
): Promise<void> {
  try {
    const client = getRedisClient()
    const pipeline = client.pipeline()

    for (const item of data) {
      const key = getKeywordCacheKey(item.keyword, country, language)
      // 修复(2025-12-19): 保存competition_level数据
      pipeline.setex(
        key,
        ttlSeconds,
        JSON.stringify({
          volume: item.volume,
          competition: item.competition || 'UNKNOWN',
          competitionIndex: item.competitionIndex || 0,
          cachedAt: Date.now(),
        })
      )
    }

    await pipeline.exec()
  } catch (error: any) {
    console.error('[Redis] Batch cache error:', error.message)
  }
}
