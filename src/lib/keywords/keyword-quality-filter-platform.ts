/**
 * Platform detection for keyword quality filtering.
 */

// 平台检测

/**
 * 电商平台域名映射
 */
const PLATFORM_DOMAINS: Record<string, string[]> = {
  amazon: [
    'amazon.com',
    'amazon.co.uk',
    'amazon.de',
    'amazon.fr',
    'amazon.ca',
    'amazon.jp',
    'amzn.to',
  ],
  walmart: ['walmart.com', 'walmart.ca'],
  ebay: ['ebay.com', 'ebay.co.uk', 'ebay.de'],
  target: ['target.com'],
  bestbuy: ['bestbuy.com'],
  costco: ['costco.com'],
  aliexpress: ['aliexpress.com'],
  alibaba: ['alibaba.com'],
  etsy: ['etsy.com'],
  wish: ['wish.com'],
  temu: ['temu.com'],
  shein: ['shein.com'],
}

/**
 * 平台关键词模式（包含常见拼写错误）
 */
const PLATFORM_KEYWORDS: Record<string, string[]> = {
  amazon: ['amazon', 'amazone', 'amzn', 'amazn'], // amazone是常见拼写错误
  walmart: ['walmart', 'wal mart', 'wal-mart', 'walmat'],
  ebay: ['ebay', 'e bay', 'e-bay'],
  target: ['target'],
  bestbuy: ['best buy', 'bestbuy', 'bestbuy'],
  costco: ['costco'],
  sams: ['sams club', 'sams', "sam's club"],
  aliexpress: ['aliexpress', 'ali express'],
  alibaba: ['alibaba'],
  etsy: ['etsy'],
  wish: ['wish'],
  temu: ['temu'],
  shein: ['shein'],
}

/**
 * 从URL提取平台名称
 *
 * @param url - 产品URL
 * @returns 平台名称（小写）或null
 *
 * @example
 * extractPlatformFromUrl('https://www.amazon.com/dp/B123') → 'amazon'
 * extractPlatformFromUrl('https://www.walmart.com/ip/456') → 'walmart'
 */
export function extractPlatformFromUrl(url: string): string | null {
  if (!url) return null

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // 检查每个平台的域名列表
    for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
      if (domains.some((domain) => hostname.includes(domain))) {
        return platform
      }
    }
  } catch {
    // URL解析失败
  }

  return null
}

/**
 * 检测关键词中包含的平台名称
 *
 * @param keyword - 关键词
 * @returns 检测到的平台名称数组
 *
 * @example
 * detectPlatformsInKeyword('anker power bank walmart') → ['walmart']
 * detectPlatformsInKeyword('amazon best buy comparison') → ['amazon', 'bestbuy']
 */
export function detectPlatformsInKeyword(keyword: string): string[] {
  if (!keyword) return []

  const kwLower = keyword.toLowerCase()
  const detectedPlatforms: string[] = []

  for (const [platform, patterns] of Object.entries(PLATFORM_KEYWORDS)) {
    for (const pattern of patterns) {
      // 使用单词边界匹配，避免误匹配
      const regex = new RegExp(`\\b${pattern}\\b`, 'i')
      if (regex.test(kwLower)) {
        detectedPlatforms.push(platform)
        break // 找到一个匹配即可，跳出当前平台的模式循环
      }
    }
  }

  return [...new Set(detectedPlatforms)]
}

/**
 * 检测关键词平台是否与URL平台冲突
 *
 * @param keyword - 关键词
 * @param productUrl - 产品URL
 * @returns 是否冲突
 *
 * @example
 * isPlatformMismatch('anker walmart', 'https://amazon.com/...') → true
 * isPlatformMismatch('anker charger', 'https://amazon.com/...') → false
 * isPlatformMismatch('anker amazon', 'https://amazon.com/...') → false
 */
export function isPlatformMismatch(keyword: string, productUrl: string): boolean {
  const urlPlatform = extractPlatformFromUrl(productUrl)
  if (!urlPlatform) {
    // 无法识别URL平台，不过滤
    return false
  }

  const keywordPlatforms = detectPlatformsInKeyword(keyword)
  if (keywordPlatforms.length === 0) {
    // 关键词不包含平台名，不过滤
    return false
  }

  // 如果关键词包含平台名，但与URL平台不匹配，则视为冲突
  return !keywordPlatforms.includes(urlPlatform)
}
