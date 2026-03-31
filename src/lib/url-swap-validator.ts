/**
 * 换链接任务验证模块
 * src/lib/url-swap-validator.ts
 *
 * 功能：验证换链接任务是否可以执行
 * - 代理配置验证
 * - 域名类型检查
 */

import { getDatabase } from './db'
import { getProxyPool } from './url-resolver-enhanced'
import { initializeProxyPool } from './offer-utils'
import type { UrlSwapValidationResult } from './url-swap-types'
import { URL_SWAP_ALLOWED_INTERVALS_MINUTES } from './url-swap-intervals'

/**
 * 验证换链接任务是否可以执行
 * @param offerId - Offer ID
 * @returns 验证结果
 */
export async function validateUrlSwapTask(offerId: number): Promise<UrlSwapValidationResult> {
  const offer = await getOfferById(offerId)
  if (!offer) {
    return {
      valid: false,
      error: 'Offer不存在或已被删除'
    }
  }

  // 代理池按用户配置加载（避免全局proxyPool未初始化导致误报）
  // offer 表中包含 user_id，url-swap 任务属于该用户
  if (offer.user_id) {
    try {
      await initializeProxyPool(offer.user_id, offer.target_country)
    } catch (e: any) {
      return {
        valid: false,
        error: e?.message || '未找到代理配置，请在设置页面配置代理URL'
      }
    }
  }

  const proxyPool = getProxyPool(offer.user_id)

  // 1. 代理检查（必须）
  if (!proxyPool.hasProxyForCountry(offer.target_country)) {
    return {
      valid: false,
      error: `未配置 ${offer.target_country} 国家的代理。请前往设置页面配置代理后重试。`
    }
  }

  // 2. 域名类型检查（可选警告）
  const domainWarning = checkDomainType(offer.affiliate_link)
  if (domainWarning) {
    return {
      valid: true,
      warning: domainWarning
    }
  }

  return { valid: true }
}

/**
 * 验证任务配置
 * @param intervalMinutes - 换链间隔（分钟）
 * @param durationDays - 持续天数
 * @returns 验证结果
 */
export function validateTaskConfig(
  intervalMinutes: number,
  durationDays: number
): UrlSwapValidationResult {
  // 验证间隔
  const validIntervals = [...URL_SWAP_ALLOWED_INTERVALS_MINUTES]
  if (!validIntervals.includes(intervalMinutes)) {
    return {
      valid: false,
      error: `换链间隔必须是以下值之一：${validIntervals.join(', ')} 分钟`
    }
  }

  // 验证持续天数
  if (durationDays !== -1 && (durationDays < 1 || durationDays > 365)) {
    return {
      valid: false,
      error: '持续天数必须是 1-365 之间的整数，或 -1 表示无限期'
    }
  }

  return { valid: true }
}

/**
 * 检查推广链接域名类型
 * @param affiliateLink - 推广链接
 * @returns 警告信息（如果有）
 */
function checkDomainType(affiliateLink: string): string | null {
  const { getOptimalResolver } = require('./resolver-domains')

  const resolverMethod = getOptimalResolver(affiliateLink)

  if (resolverMethod === 'playwright') {
    return '检测到推广链接需要JavaScript渲染，解析可能较慢（3-5秒）。'
  }

  if (resolverMethod === 'http-with-fallback') {
    return '检测到未知重定向类型，可能需要更长的解析时间。'
  }

  return null
}

/**
 * 获取缺少代理的国家列表
 * @param offerIds - Offer ID列表
 * @returns 缺少代理的国家列表
 */
export async function getMissingProxyCountries(offerIds: number[]): Promise<string[]> {
  const proxyPool = getProxyPool()
  const missingCountries: string[] = []

  for (const offerId of offerIds) {
    const offer = await getOfferById(offerId)
    if (offer && !proxyPool.hasProxyForCountry(offer.target_country)) {
      if (!missingCountries.includes(offer.target_country)) {
        missingCountries.push(offer.target_country)
      }
    }
  }

  return missingCountries
}

async function getOfferById(offerId: number): Promise<any | null> {
  const db = await getDatabase()
  const isDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = FALSE OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  return db.queryOne(`
    SELECT id, user_id, target_country, affiliate_link
    FROM offers
    WHERE id = ? AND ${isDeletedCondition}
  `, [offerId])
}
