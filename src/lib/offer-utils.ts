import { getDatabase } from '@/lib/db'
import { getAllProxyUrls } from '@/lib/settings'
import { getProxyPool, clearProxyPool } from '@/lib/url-resolver-enhanced'
import { getLanguageNameForCountry, getSupportedCountries, getCountryChineseName, normalizeCountryCode } from '@/lib/language-country-codes'
import { calculateMaxCPC } from '@/lib/currency'
import { maskProxyUrl } from '@/lib/proxy/validate-url'

/**
 * Offer相关的辅助函数库
 * 包括offer_name生成、语言映射、验证等
 */

/**
 * 页面类型检测结果
 */
export interface PageTypeResult {
  pageType: 'amazon_store' | 'amazon_product' | 'independent_store' | 'independent_product' | 'unknown'
  isAmazonStore: boolean
  isAmazonProductPage: boolean
  isIndependentStore: boolean
}

/**
 * 检测页面类型
 *
 * @param url - 目标URL
 * @returns 页面类型检测结果
 */
export function detectPageType(url: string): PageTypeResult {
  if (!url) {
    return {
      pageType: 'unknown',
      isAmazonStore: false,
      isAmazonProductPage: false,
      isIndependentStore: false,
    }
  }

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    const pathname = urlObj.pathname.toLowerCase()

    // Amazon域名检测
    const isAmazonDomain = hostname.includes('amazon.')

    if (isAmazonDomain) {
      // Amazon Store页面检测（stores路径）
      if (pathname.includes('/stores/') || pathname.includes('/storefront/')) {
        return {
          pageType: 'amazon_store',
          isAmazonStore: true,
          isAmazonProductPage: false,
          isIndependentStore: false,
        }
      }

      // Amazon单品页面检测（dp路径）
      if (pathname.includes('/dp/') || pathname.includes('/gp/product/')) {
        return {
          pageType: 'amazon_product',
          isAmazonStore: false,
          isAmazonProductPage: true,
          isIndependentStore: false,
        }
      }

      // 其他Amazon页面默认视为单品页面
      return {
        pageType: 'amazon_product',
        isAmazonStore: false,
        isAmazonProductPage: true,
        isIndependentStore: false,
      }
    }

    // 独立站检测
    const isSingleProductPage =
      pathname.includes('/products/') ||
      pathname.includes('/product/') ||
      pathname.includes('/p/') ||
      pathname.includes('/item/')

    if (isSingleProductPage) {
      return {
        pageType: 'independent_product',
        isAmazonStore: false,
        isAmazonProductPage: false,
        isIndependentStore: false,
      }
    }

    // 店铺首页特征
    const isStorePage =
      pathname === '/' ||
      pathname === '' ||
      pathname.includes('/collections') ||
      pathname.includes('/shop') ||
      pathname.includes('/store')

    if (isStorePage) {
      return {
        pageType: 'independent_store',
        isAmazonStore: false,
        isAmazonProductPage: false,
        isIndependentStore: true,
      }
    }

    return {
      pageType: 'unknown',
      isAmazonStore: false,
      isAmazonProductPage: false,
      isIndependentStore: false,
    }
  } catch {
    return {
      pageType: 'unknown',
      isAmazonStore: false,
      isAmazonProductPage: false,
      isIndependentStore: false,
    }
  }
}

/**
 * 缓存代理池初始化状态，避免重复加载
 */
let proxyPoolInitialized = false
let proxyPoolInitializedForUser: number | null = null
let proxyPoolInitializedConfigSignature: string | null = null

/**
 * 清除代理池缓存
 * 当用户更新代理配置时调用，强制下次使用时重新加载
 *
 * 🔥 修复（2025-12-11）：
 * 解决用户更新代理配置后，系统仍使用旧配置的问题
 *
 * 🔥 优化（2025-12-11）：用户隔离
 * - 只重置模块级缓存标记，不清除全局代理池实例
 * - 下次 initializeProxyPool 会根据 userId 判断是否需要重新加载
 * - initializeProxyPool 会调用 loadProxies() 覆盖旧配置
 * - 这样不会影响其他用户正在进行的操作
 */
export function invalidateProxyPoolCache(userId?: number): void {
  console.log(`🗑️ [invalidateProxyPoolCache] 清除代理池缓存 (userId: ${userId || 'all'})`)

  // 只清除指定用户的缓存
  if (!userId) {
    // 清除所有用户缓存
    proxyPoolInitialized = false
    proxyPoolInitializedForUser = null
    proxyPoolInitializedConfigSignature = null
    clearProxyPool() // 清除所有用户的代理池实例
    console.log(`   - 全局缓存已清除`)
  } else if (proxyPoolInitializedForUser === userId || proxyPoolInitializedForUser === null) {
    // 清除当前用户缓存（或缓存未初始化）
    proxyPoolInitialized = false
    proxyPoolInitializedForUser = null
    proxyPoolInitializedConfigSignature = null
    clearProxyPool(userId) // 清除该用户的代理池实例
    console.log(`   - 用户 ${userId} 的缓存已清除`)
  } else {
    // 缓存属于其他用户，不清除
    console.log(`   - 跳过清除：当前缓存属于用户 ${proxyPoolInitializedForUser}，请求清除用户 ${userId}`)
  }
}

/**
 * 初始化代理池
 *
 * 检查用户的代理配置并确保可用
 * 注意：只在第一次调用时初始化，后续调用会跳过（使用缓存）
 *
 * @param userId - 用户ID
 * @param targetCountry - 目标国家
 * @throws AppError 如果代理配置未设置
 */
export async function initializeProxyPool(userId: number, targetCountry: string): Promise<void> {
  // 获取用户配置的代理URL列表
  const proxyUrls = await getAllProxyUrls(userId)

  if (!proxyUrls || proxyUrls.length === 0) {
    console.error(`❌ [initializeProxyPool] 未找到代理配置`)
    const error = new Error(`未找到代理配置，请在设置页面配置代理URL`) as any
    error.code = 'PROXY_NOT_CONFIGURED'
    error.details = { targetCountry, userId }
    throw error
  }

  // 🔥 2026-01-06: 使用配置签名检测变更，避免“更新后仍使用旧配置”
  const configSignature = proxyUrls
    .map((p) => `${String(p.country).trim().toUpperCase()}:${String(p.url).trim()}`)
    .join('|')

  // 检查是否已经初始化过，且是同一个用户且配置未变更
  if (
    proxyPoolInitialized &&
    proxyPoolInitializedForUser === userId &&
    proxyPoolInitializedConfigSignature === configSignature
  ) {
    console.log(`✅ [initializeProxyPool] 代理池已初始化且配置未变更，跳过重复初始化`)
    return
  }

  const isSameUser = proxyPoolInitialized && proxyPoolInitializedForUser === userId
  if (isSameUser && proxyPoolInitializedConfigSignature !== null && proxyPoolInitializedConfigSignature !== configSignature) {
    console.log('🔄 [initializeProxyPool] 检测到代理配置变更，重新加载代理池')
  } else {
    console.log(`🔍 [initializeProxyPool] 开始初始化代理池 (userId=${userId}, country=${targetCountry})`)
  }

  // 🔥 修复:所有代理都不设置为 default（emergency）优先级
  // 代理池会自动将第一个代理作为兜底代理（如果需要）
  const proxiesWithDefault = proxyUrls.map((p: any) => ({
    url: p.url,
    country: String(p.country || '').trim().toUpperCase(),
    is_default: false, // 不自动设置兜底代理，让代理池自行管理
  }))

  console.log(`🔍 [initializeProxyPool] 准备加载${proxiesWithDefault.length}个代理到代理池`)

  // 加载代理到代理池（用户级别隔离）
  const proxyPool = getProxyPool(userId)
  await proxyPool.loadProxies(proxiesWithDefault)

  // 更新缓存状态
  proxyPoolInitialized = true
  proxyPoolInitializedForUser = userId
  proxyPoolInitializedConfigSignature = configSignature

  console.log(`✅ 代理池初始化成功: ${proxiesWithDefault.length}个代理 (用户ID: ${userId})`)
}

/**
 * 规范化品牌名称
 * - 首字母大写格式（Title Case）："apple" → "Apple", "APPLE" → "Apple"
 * - 多个单词："outdoor life" → "Outdoor Life"
 * - 保留常见全大写缩写：IBM, BMW, HP, LG, etc.
 *
 * @param brand - 原始品牌名称
 * @returns 规范化后的品牌名称
 */
export function normalizeBrandName(brand: string): string {
  if (!brand || typeof brand !== 'string') return brand

  const trimmed = brand.trim()
  if (!trimmed) return trimmed

  const normalizedApostrophe = trimmed.replace(/’/g, '\'')
  const normalizedKey = normalizedApostrophe.toLowerCase()
  const specialCases = new Map<string, string>([
    // BJ's Wholesale Club → prefer a stable, punctuation-free short brand token
    ['bjs', 'BJs'],
    [`bj's`, 'BJs'],
  ])

  const directSpecial = specialCases.get(normalizedKey)
  if (directSpecial) return directSpecial

  // 常见全大写缩写列表（保持大写）
  const ABBREVIATIONS = new Set([
    'IBM', 'HP', 'LG', 'BMW', 'ASUS', 'DELL', 'AMD', 'AT&T',
    'BBC', 'CNN', 'ESPN', 'HBO', 'MTV', 'NBA', 'NFL', 'NHL',
    'USA', 'UK', 'EU', 'NASA', 'FBI', 'CIA', 'DVD', 'LCD',
    'LED', 'USB', 'GPS', 'API', 'SEO', 'CEO', 'CTO', 'CFO'
  ])

  // 如果是常见缩写，保持大写
  if (ABBREVIATIONS.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase()
  }

  // 对每个单词进行首字母大写处理
  return trimmed
    .split(/\s+/)
    .map(word => {
      if (!word) return word

      const wordKey = word.replace(/’/g, '\'').toLowerCase()
      const specialWord = specialCases.get(wordKey)
      if (specialWord) return specialWord

      // 检查是否是缩写
      if (ABBREVIATIONS.has(word.toUpperCase())) {
        return word.toUpperCase()
      }

      // 首字母大写，其余小写
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * 生成Offer唯一标识
 * 格式：品牌名称_推广国家_序号
 * 示例：Reolink_US_01, Reolink_US_02, ITEHIL_DE_01
 *
 * 需求1: 自动生成的字段
 *
 * 🔥 修复（2025-12-09）：
 * 1. 排除软删除的记录（deleted_at IS NULL）
 * 2. 显式转换count为数字（PostgreSQL bigint可能返回字符串）
 * 3. 添加唯一性循环检查，避免重名
 */
export async function generateOfferName(
  brandName: string,
  countryCode: string,
  userId: number
): Promise<string> {
  const db = await getDatabase()
  const normalizedCountryCode = normalizeOfferTargetCountry(countryCode)

  // 🔥 修复：查询该用户下同品牌同国家的Offer数量（排除软删除）
  const result = await db.queryOne<{ count: number | string }>(
    `
    SELECT COUNT(*) as count
    FROM offers
    WHERE user_id = ?
      AND LOWER(TRIM(brand)) = LOWER(TRIM(?))
      AND UPPER(TRIM(target_country)) = UPPER(TRIM(?))
      AND deleted_at IS NULL
  `,
    [userId, brandName, normalizedCountryCode]
  )

  // 🔥 修复：显式转换为数字（PostgreSQL bigint可能返回字符串）
  const existingCount = Number(result?.count) || 0

  // 🔥 修复：循环检查确保生成的offer_name唯一
  let sequenceNum = existingCount + 1
  let maxAttempts = 100 // 防止无限循环

  while (maxAttempts > 0) {
    const sequence = String(sequenceNum).padStart(2, '0')
    const proposedName = `${brandName}_${normalizedCountryCode}_${sequence}`

    // 检查是否已存在（包括软删除的，避免历史冲突）
    const existing = await db.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND LOWER(offer_name) = LOWER(?)`,
      [userId, proposedName]
    )

    const existingNameCount = Number(existing?.count) || 0

    if (existingNameCount === 0) {
      // 找到唯一的名称
      return proposedName
    }

    // 已存在，尝试下一个序号
    sequenceNum++
    maxAttempts--
  }

  // 兜底：使用时间戳确保唯一
  const timestamp = Date.now().toString(36)
  console.warn(`⚠️ [generateOfferName] 无法找到唯一序号，使用时间戳: ${brandName}_${normalizedCountryCode}_${timestamp}`)
  return `${brandName}_${normalizedCountryCode}_${timestamp}`
}

/**
 * 规范化 Offer 国家代码（统一为 ISO alpha-2）
 * 示例：UK -> GB
 */
export function normalizeOfferTargetCountry(countryCode: string): string {
  const normalized = normalizeCountryCode(String(countryCode || '').trim())
  return normalized || 'US'
}

/**
 * 根据国家代码获取推广语言
 *
 * 需求5: 根据国家确定推广语言
 * 示例：
 * - 美国US → English
 * - 德国DE → German
 *
 * 使用全局统一映射，支持69+国家
 */
export function getTargetLanguage(countryCode: string): string {
  return getLanguageNameForCountry(normalizeOfferTargetCountry(countryCode))
}

/**
 * 验证品牌名称长度
 * 需求1要求品牌名称≤25字符
 */
export function validateBrandName(brandName: string): {
  valid: boolean
  error?: string
} {
  if (!brandName || brandName.trim().length === 0) {
    return { valid: false, error: '品牌名称不能为空' }
  }

  if (brandName.length > 25) {
    return { valid: false, error: '品牌名称最多25个字符' }
  }

  return { valid: true }
}

/**
 * 计算建议最大CPC（需求28）
 *
 * 公式：最大CPC = product_price * commission_payout / 50
 * （按照50个广告点击出一单来计算）
 *
 * @param productPrice - 产品价格字符串（如 "$699.00" 或 "¥699.00"）
 * @param commissionPayout - 佣金比例字符串（如 "6.75%"）
 * @param targetCurrency - 目标货币（USD, CNY等）
 * @returns 建议最大CPC信息，如果解析失败返回null
 *
 * 示例：
 * - 输入：$699.00, 6.75%, USD
 * - 计算：$699.00 * 6.75% / 50 = $0.94
 * - 输出：{ amount: 0.94, currency: 'USD', formatted: '$0.94' }
 */
export function calculateSuggestedMaxCPC(
  productPrice: string,
  commissionPayout: string,
  targetCurrency: string = 'USD'
): { amount: number; currency: string; formatted: string } | null {
  try {
    const result = calculateMaxCPC(productPrice, commissionPayout, 'USD', targetCurrency, 50)
    if (!result) return null

    return {
      amount: result.maxCPC,
      currency: targetCurrency,
      formatted: result.maxCPCFormatted,
    }
  } catch (error) {
    console.error('计算建议最大CPC失败:', error)
    return null
  }
}

/**
 * 获取国家列表（用于前端下拉选择）
 * 使用全局统一的国家映射，支持69个国家
 */
export function getCountryList(): Array<{ code: string; name: string; language: string }> {
  return getSupportedCountries()
    .map(country => ({
      code: country.code,
      name: getCountryChineseName(country.code),
      language: getLanguageNameForCountry(country.code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/**
 * 验证Offer名称是否唯一
 * 🔥 修复（2025-12-09）：显式转换count为数字（PostgreSQL bigint可能返回字符串）
 */
export async function isOfferNameUnique(offerName: string, userId: number, excludeOfferId?: number): Promise<boolean> {
  const db = await getDatabase()

  const query = excludeOfferId
    ? `SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND LOWER(offer_name) = LOWER(?) AND id != ?`
    : `SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND LOWER(offer_name) = LOWER(?)`

  const params = excludeOfferId ? [userId, offerName, excludeOfferId] : [userId, offerName]

  const result = await db.queryOne<{ count: number | string }>(query, params)

  // 🔥 修复：显式转换为数字
  return Number(result?.count || 0) === 0
}

/**
 * 格式化Offer显示名称
 * 用于UI显示，提供更友好的格式
 */
export function formatOfferDisplayName(offer: {
  brand: string
  target_country: string
  offer_name?: string
}): string {
  if (offer.offer_name) {
    return offer.offer_name
  }

  // 如果没有offer_name，临时生成一个显示名称
  return `${offer.brand} (${offer.target_country})`
}

/**
 * 从URL检测目标国家
 *
 * 支持的检测规则：
 * - Amazon域名: amazon.com(US), amazon.co.uk(GB), amazon.de(DE), amazon.ca(CA), amazon.co.jp(JP)等
 * - 其他域名: 使用顶级域名推断(.uk→GB, .de→DE等)
 *
 * @param url - 目标URL
 * @returns 检测到的国家代码，默认返回'US'
 */
export function detectCountryFromUrl(url: string): string {
  if (!url) return 'US';

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Amazon域名映射
    const amazonDomainMap: Record<string, string> = {
      'amazon.com': 'US',
      'amazon.co.uk': 'GB',
      'amazon.de': 'DE',
      'amazon.fr': 'FR',
      'amazon.it': 'IT',
      'amazon.es': 'ES',
      'amazon.ca': 'CA',
      'amazon.co.jp': 'JP',
      'amazon.com.au': 'AU',
      'amazon.in': 'IN',
      'amazon.com.br': 'BR',
      'amazon.com.mx': 'MX',
      'amazon.nl': 'NL',
      'amazon.se': 'SE',
      'amazon.pl': 'PL',
      'amazon.ae': 'AE',
      'amazon.sa': 'SA',
      'amazon.sg': 'SG',
    };

    // 检查Amazon域名
    for (const [domain, country] of Object.entries(amazonDomainMap)) {
      if (hostname === domain || hostname === `www.${domain}`) {
        return country;
      }
    }

    // 通用顶级域名映射
    const tldMap: Record<string, string> = {
      'uk': 'GB',
      'de': 'DE',
      'fr': 'FR',
      'it': 'IT',
      'es': 'ES',
      'ca': 'CA',
      'jp': 'JP',
      'au': 'AU',
      'in': 'IN',
      'br': 'BR',
      'mx': 'MX',
      'nl': 'NL',
      'se': 'SE',
      'pl': 'PL',
    };

    // 从顶级域名推断
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const tld = parts[parts.length - 1];
      // 处理 .co.uk 这类复合顶级域名
      if (parts.length >= 3 && parts[parts.length - 2] === 'co') {
        const countryTld = parts[parts.length - 1];
        if (tldMap[countryTld]) {
          return tldMap[countryTld];
        }
      }
      if (tldMap[tld]) {
        return tldMap[tld];
      }
    }

    // 默认返回US
    return 'US';
  } catch {
    return 'US';
  }
}
