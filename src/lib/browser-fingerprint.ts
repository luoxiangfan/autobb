/**
 * 浏览器指纹池 - 用于反爬虫和反风控
 *
 * 包含真实的浏览器 User-Agent，定期更新以保持有效性
 * 参考 browser-stealth.ts 的实现，增强反爬虫能力
 */

export type BrowserFingerprint = {
  userAgent: string
  platform: string
  vendor: string
  language: string
  acceptLanguage: string
  accept: string
  // 🔥 新增：Chrome 特有的客户端提示头
  secChUa?: string
  secChUaMobile?: string
  secChUaPlatform?: string
  // 🔥 新增：安全相关头部
  secFetchDest?: string
  secFetchMode?: string
  secFetchSite?: string
  secFetchUser?: string
  // 🔥 新增：其他头部
  dnt?: string
  acceptEncoding?: string
  connection?: string
  upgradeInsecureRequests?: string
  cacheControl?: string
}

/**
 * 真实的浏览器 User-Agent 池
 * 来源：2024-2026 年主流浏览器的真实 UA
 */
const USER_AGENT_POOL = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',

  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',

  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',

  // Safari on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',

  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',

  // Firefox on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
]

/**
 * 平台映射
 */
const PLATFORM_MAP: Record<string, string> = {
  'Windows': 'Win32',
  'Macintosh': 'MacIntel',
}

/**
 * 浏览器厂商映射
 */
const VENDOR_MAP: Record<string, string> = {
  'Chrome': 'Google Inc.',
  'Safari': 'Apple Computer, Inc.',
  'Firefox': '',
  'Edge': 'Microsoft Corporation',
}

/**
 * 语言池
 */
const LANGUAGE_POOL = [
  'en-US',
  'en-GB',
  'en',
]

/**
 * Accept-Language 池
 */
const ACCEPT_LANGUAGE_POOL = [
  'en-US,en;q=0.9',
  'en-GB,en;q=0.9',
  'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
]

/**
 * Accept 头
 */
const ACCEPT_HEADER = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

/**
 * 从 User-Agent 中提取平台信息
 */
function extractPlatform(userAgent: string): string {
  if (userAgent.includes('Windows')) return 'Win32'
  if (userAgent.includes('Macintosh')) return 'MacIntel'
  if (userAgent.includes('Linux')) return 'Linux x86_64'
  return 'Win32'
}

/**
 * 从 User-Agent 中提取浏览器厂商
 */
function extractVendor(userAgent: string): string {
  if (userAgent.includes('Edg/')) return 'Microsoft Corporation'
  if (userAgent.includes('Chrome/')) return 'Google Inc.'
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return 'Apple Computer, Inc.'
  if (userAgent.includes('Firefox/')) return ''
  return 'Google Inc.'
}

/**
 * 随机选择数组中的一个元素
 */
function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

/**
 * 生成随机浏览器指纹
 *
 * @returns 随机的浏览器指纹对象
 */
export function generateRandomFingerprint(): BrowserFingerprint {
  const userAgent = randomChoice(USER_AGENT_POOL)
  const platform = extractPlatform(userAgent)
  const vendor = extractVendor(userAgent)
  const language = randomChoice(LANGUAGE_POOL)
  const acceptLanguage = randomChoice(ACCEPT_LANGUAGE_POOL)

  // 🔥 根据 User-Agent 生成匹配的 Sec-CH-UA 头部（参考 browser-stealth.ts）
  let secChUa: string | undefined
  let secChUaPlatform: string | undefined
  let secChUaMobile: string | undefined = '?0'

  if (userAgent.includes('Macintosh')) {
    secChUaPlatform = '"macOS"'
  } else if (userAgent.includes('Windows')) {
    secChUaPlatform = '"Windows"'
  } else if (userAgent.includes('Linux')) {
    secChUaPlatform = '"Linux"'
  }

  if (userAgent.includes('Chrome/131')) {
    secChUa = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
  } else if (userAgent.includes('Chrome/130')) {
    secChUa = '"Google Chrome";v="130", "Chromium";v="130", "Not_A Brand";v="24"'
  } else if (userAgent.includes('Chrome/129')) {
    secChUa = '"Google Chrome";v="129", "Chromium";v="129", "Not_A Brand";v="24"'
  } else if (userAgent.includes('Edg/131')) {
    secChUa = '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
  } else if (userAgent.includes('Edg/130')) {
    secChUa = '"Microsoft Edge";v="130", "Chromium";v="130", "Not_A Brand";v="24"'
  } else if (userAgent.includes('Firefox') || (userAgent.includes('Safari') && !userAgent.includes('Chrome'))) {
    // Firefox 和 Safari 不发送 Sec-CH-UA
    secChUa = undefined
    secChUaPlatform = undefined
    secChUaMobile = undefined
  }

  return {
    userAgent,
    platform,
    vendor,
    language,
    acceptLanguage,
    accept: ACCEPT_HEADER,
    // Chrome/Edge 特有的客户端提示头
    secChUa,
    secChUaMobile,
    secChUaPlatform,
    // 安全相关头部
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secFetchUser: '?1',
    // 其他头部
    dnt: '1',
    acceptEncoding: 'gzip, deflate, br',
    connection: 'keep-alive',
    upgradeInsecureRequests: '1',
    cacheControl: 'max-age=0',
  }
}

/**
 * 获取指定索引的浏览器指纹（用于测试和调试）
 *
 * @param index - User-Agent 池中的索引
 * @returns 浏览器指纹对象
 */
export function getFingerprintByIndex(index: number): BrowserFingerprint {
  const normalizedIndex = index % USER_AGENT_POOL.length
  const userAgent = USER_AGENT_POOL[normalizedIndex]
  const platform = extractPlatform(userAgent)
  const vendor = extractVendor(userAgent)
  const language = LANGUAGE_POOL[0]
  const acceptLanguage = ACCEPT_LANGUAGE_POOL[0]

  return {
    userAgent,
    platform,
    vendor,
    language,
    acceptLanguage,
    accept: ACCEPT_HEADER,
  }
}

/**
 * 获取 User-Agent 池的大小
 */
export function getUserAgentPoolSize(): number {
  return USER_AGENT_POOL.length
}

/**
 * 获取所有 User-Agent（用于调试）
 */
export function getAllUserAgents(): string[] {
  return [...USER_AGENT_POOL]
}
