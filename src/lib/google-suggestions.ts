/**
 * Google搜索下拉词提取工具
 * 需求11：通过Google搜索获取品牌词的下拉建议
 */

import { getProxyConfig } from './proxy'

/**
 * 从产品名称中提取核心词（用于生成查询变体）
 * 🔧 优化(2025-12-12): 新增函数
 *
 * @example
 * extractCoreProductWords("Reolink Argus 4 Pro 4K Solar Security Camera", "Reolink")
 * // returns ["Argus", "Camera", "Security"]
 */
function extractCoreProductWords(productName: string, brandName: string): string[] {
  if (!productName || !brandName) return []

  // 移除品牌名
  const nameWithoutBrand = productName
    .replace(new RegExp(brandName, 'gi'), '')
    .trim()

  // 分词并过滤
  const words = nameWithoutBrand
    .split(/[\s\-–—]+/)
    .filter(w => {
      // 过滤条件：
      // 1. 太短（<3字符）
      if (w.length < 3) return false
      // 2. 纯数字或规格参数（如 4K, 1080P, 32GB, 2.4GHz）
      if (/^[\d.]+[pPkKgGmMtThHzZ"']*$/.test(w)) return false
      if (/^\d+x\d+$/i.test(w)) return false
      // 3. 常见无意义词
      if (/^(with|for|and|the|a|an|in|on|of|to|by|from|new|pro|plus|max|mini|lite|version|edition|series|gen|generation)$/i.test(w)) return false
      return true
    })

  // 返回前3个有意义的词
  return words.slice(0, 3)
}

/**
 * 购买意图弱的关键词模式 (需求11)
 * 过滤掉这些词，因为它们购买意图不强烈
 *
 * 分类：
 * 1. 安装配置类：setup, install, configure
 * 2. 教程指导类：how to, tutorial, guide
 * 3. 盗版免费类：free, cracked, pirate
 * 4. 评测对比类：review, vs, compare
 * 5. 替代品查询：alternative, replacement
 * 6. 问题故障类：problem, error, fix, broken
 * 7. 帮助支持类：manual, help, support
 * 8. 账号登录类：login, sign in, register, account
 * 9. 下载类：download, torrent, apk, app, application（用户问题2）
 * 10. 信息查询类：specs, wiki, what is
 * 11. 社区讨论类：reddit, forum, community
 * 12. 售后服务类：warranty, return, refund
 * 13. 驱动软件类：driver, firmware, software update
 * 14. 视频内容类：video, youtube（评测视频非购买）
 */
const LOW_INTENT_PATTERNS = [
  // 1. 安装配置类
  /\b(setup|set up|install|installation|configure|configuration)\b/i,

  // 2. 教程指导类
  /\b(how to|how do|tutorial|guide|tips|tricks)\b/i,

  // 3. 盗版免费类
  /\b(free|cracked|crack|pirate|nulled|torrent)\b/i,

  // 4. 评测对比类
  /\b(review|reviews|unboxing|vs\b|versus|compare|comparison)\b/i,

  // 5. 替代品查询
  /\b(alternative|alternatives|replacement|replace|substitute)\b/i,

  // 6. 问题故障类
  /\b(problem|issue|error|fix|broken|not working|troubleshoot|reset)\b/i,

  // 7. 帮助支持类
  /\b(manual|instruction|help|support|faq|contact)\b/i,

  // 8. 账号登录类（用户提到的重点）
  /\b(login|log in|sign in|signin|register|registration|account|password|forgot password)\b/i,

  // 9. 下载类（用户问题2：包含app/application）
  /\b(download|downloads|apk|torrent|iso|app\b|application|mobile app|android app|ios app)\b/i,

  // 10. 信息查询类
  /\b(specs|specifications|spec|what is|wiki|wikipedia|definition)\b/i,

  // 11. 社区讨论类
  /\b(reddit|forum|community|discussion|thread)\b/i,

  // 12. 售后服务类
  /\b(warranty|return policy|refund|exchange|rma)\b/i,

  // 13. 驱动软件类
  /\b(driver|drivers|firmware|software update|update|upgrade)\b/i,

  // 14. 视频内容类
  // 🔧 修复(2025-12-17): 排除 "video doorbell" 等合法产品类别
  // 使用负向前瞻排除 video + 产品词 的组合
  /\b(youtube|vlog|video\s+review|review\s+video)\b/i,
  /\bvideo\b(?!\s+(doorbell|camera|monitor|recorder|intercom|surveillance))/i,

  // 15. 素材/尺寸信息类（低购买意图，且容易污染关键词池）
  /\b(gif|meme|emoji|sticker|drawing|image|images|logo|png|jpg|jpeg|svg|icon|clipart|wallpaper)\b/i,
  /\b(size chart|size guide|sizing)\b/i,
]

/**
 * 国家/地区关键词映射 (用户问题1)
 * 关键词如 "reolink australia" 应该只在对应国家使用
 *
 * 格式：{ 国家代码: [关键词变体数组] }
 */
const COUNTRY_KEYWORDS: Record<string, string[]> = {
  // 北美
  US: ['usa', 'united states', 'america', 'american'],
  CA: ['canada', 'canadian'],
  MX: ['mexico', 'mexican'],

  // 欧洲（使用ISO 3166-1标准代码GB）
  GB: ['uk', 'united kingdom', 'britain', 'british', 'england', 'english'],
  DE: ['germany', 'german', 'deutschland', 'deutsche'],
  FR: ['france', 'french', 'français'],
  IT: ['italy', 'italian', 'italia', 'italiano'],
  ES: ['spain', 'spanish', 'españa', 'español'],
  NL: ['netherlands', 'dutch', 'holland'],
  BE: ['belgium', 'belgian'],
  AT: ['austria', 'austrian'],
  CH: ['switzerland', 'swiss'],
  SE: ['sweden', 'swedish'],
  NO: ['norway', 'norwegian'],
  DK: ['denmark', 'danish'],
  FI: ['finland', 'finnish'],
  PL: ['poland', 'polish'],

  // 亚太
  AU: ['australia', 'australian', 'aussie'],
  NZ: ['new zealand', 'nz', 'kiwi'],
  JP: ['japan', 'japanese', 'nihon'],
  KR: ['korea', 'korean', 'south korea'],
  CN: ['china', 'chinese'],
  SG: ['singapore', 'singaporean'],
  IN: ['india', 'indian'],
  TH: ['thailand', 'thai'],
  VN: ['vietnam', 'vietnamese'],
  MY: ['malaysia', 'malaysian'],
  PH: ['philippines', 'filipino', 'pilipinas'],

  // 中东
  AE: ['uae', 'dubai', 'emirates'],
  SA: ['saudi', 'saudi arabia'],

  // 其他
  BR: ['brazil', 'brazilian', 'brasil'],
  AR: ['argentina', 'argentinian'],
  ZA: ['south africa', 'south african'],
}

/**
 * Google搜索建议结果
 */
export interface GoogleSuggestion {
  keyword: string
  source: 'google_suggest'
}

/**
 * 从Google获取搜索建议（下拉词）
 * 使用Google的自动完成API (非官方，但广泛使用)
 */
export async function getGoogleSearchSuggestions(params: {
  query: string
  country: string // 如 'US', 'UK', 'DE'
  language: string // 如 'en', 'de'
  useProxy?: boolean
}): Promise<GoogleSuggestion[]> {
  try {
    const { query, country, language, useProxy = true } = params

    // Google建议API端点
    const apiUrl = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(
      query
    )}&gl=${country.toLowerCase()}&hl=${language.toLowerCase()}`

    console.log(`🔍 获取Google搜索建议: "${query}" (${country}, ${language})`)

    let fetchOptions: RequestInit = {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    }

    // 如果需要使用代理
    if (useProxy) {
      try {
        const proxyConfig = await getProxyConfig(country)
        if (proxyConfig && proxyConfig.auth) {
          // 使用代理配置
          const proxyAuth = Buffer.from(
            `${proxyConfig.auth.username}:${proxyConfig.auth.password}`
          ).toString('base64')

          fetchOptions = {
            ...fetchOptions,
            // @ts-ignore - proxy配置
            agent: {
              host: proxyConfig.host,
              port: proxyConfig.port,
              auth: `${proxyConfig.auth.username}:${proxyConfig.auth.password}`,
            },
            headers: {
              ...fetchOptions.headers,
              'Proxy-Authorization': `Basic ${proxyAuth}`,
            },
          }

          console.log(
            `  ✓ 使用代理: ${proxyConfig.host}:${proxyConfig.port} (${country})`
          )
        }
      } catch (proxyError) {
        console.warn('  ⚠️ 代理配置失败，使用直连:', proxyError)
      }
    }

    const response = await fetch(apiUrl, fetchOptions)

    if (!response.ok) {
      throw new Error(
        `Google Suggest API返回错误: ${response.status} ${response.statusText}`
      )
    }

    const data = await response.json()

    // Google Suggest API返回格式: [query, [suggestion1, suggestion2, ...]]
    if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) {
      console.warn('  ⚠️ Google Suggest API返回格式异常')
      return []
    }

    const suggestions: GoogleSuggestion[] = data[1].map((text: string) => ({
      keyword: text,
      source: 'google_suggest' as const,
    }))

    console.log(`  ✓ 获取到${suggestions.length}个下拉词建议`)

    return suggestions
  } catch (error: any) {
    console.error('获取Google搜索建议失败:', error)
    // 失败时返回空数组，不阻塞主流程
    return []
  }
}

/**
 * 批量获取Google搜索建议
 * 为品牌词生成多个查询变体
 *
 * 🔧 优化(2026-04-02): 证据驱动查询变体
 * - 移除固定交易词模板（official/store/buy/price/sale/discount/shop）
 * - 仅保留品牌、品牌+品类、品牌+产品核心词查询
 */
export async function getBrandSearchSuggestions(params: {
  brand: string
  country: string
  language: string
  useProxy?: boolean
  productName?: string  // 🔧 新增：产品名称
  category?: string     // 🔧 新增：产品品类
}): Promise<GoogleSuggestion[]> {
  const { brand, country, language, useProxy, productName, category } = params

  // 仅生成证据驱动查询，避免模板交易词污染
  const queries: string[] = [
    brand, // 品牌名
  ]

  // 品牌+品类组合（如 "Reolink camera"）
  if (category) {
    const categoryClean = category.replace(/[&,]/g, ' ').trim().split(' ')[0]
    if (categoryClean && categoryClean.length > 2) {
      queries.push(`${brand} ${categoryClean}`)
    }
  }

  // 从产品名提取核心词并组合
  if (productName) {
    const coreWords = extractCoreProductWords(productName, brand)
    for (const word of coreWords.slice(0, 2)) {
      queries.push(`${brand} ${word}`)
    }
    const phrase = coreWords.slice(0, 2).join(' ').trim()
    if (phrase) {
      queries.push(`${brand} ${phrase}`)
    }
  }

  // 去重
  const uniqueQueries = [...new Set(queries)]

  console.log(`🔍 批量获取品牌"${brand}"的搜索建议 (${uniqueQueries.length}个查询变体)...`)

  // 并行获取所有查询的建议
  const allSuggestions = await Promise.all(
    uniqueQueries.map((query) =>
      getGoogleSearchSuggestions({
        query,
        country,
        language,
        useProxy,
      })
    )
  )

  // 合并去重
  const uniqueSuggestions = new Map<string, GoogleSuggestion>()
  allSuggestions.flat().forEach((suggestion) => {
    const lowerKeyword = suggestion.keyword.toLowerCase()
    if (!uniqueSuggestions.has(lowerKeyword)) {
      uniqueSuggestions.set(lowerKeyword, suggestion)
    }
  })

  const results = Array.from(uniqueSuggestions.values())
  console.log(`  ✓ 合并去重后共${results.length}个建议`)

  return results
}

/**
 * 过滤购买意图不强烈的关键词 (需求11)
 */
export function filterLowIntentKeywords(keywords: string[]): string[] {
  return keywords.filter((keyword) => {
    const isLowIntent = LOW_INTENT_PATTERNS.some((pattern) =>
      pattern.test(keyword)
    )

    if (isLowIntent) {
      console.log(`  ⊗ 过滤低意图关键词: "${keyword}"`)
      return false
    }

    return true
  })
}

/**
 * 检测关键词中包含的国家/地区
 * 返回匹配的国家代码数组
 *
 * @example
 * detectCountryInKeyword("reolink australia") // returns ["AU"]
 * detectCountryInKeyword("security camera") // returns []
 */
export function detectCountryInKeyword(keyword: string): string[] {
  const lowerKeyword = keyword.toLowerCase()
  const detectedCountries: string[] = []

  for (const [countryCode, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
    for (const countryKeyword of keywords) {
      // 使用单词边界匹配，避免部分匹配（如"german"不应匹配"germany"的一部分）
      const regex = new RegExp(`\\b${countryKeyword}\\b`, 'i')
      if (regex.test(lowerKeyword)) {
        detectedCountries.push(countryCode)
        break // 找到该国家的一个关键词就够了
      }
    }
  }

  return detectedCountries
}

/**
 * 过滤与目标国家不匹配的地理关键词 (用户问题1)
 *
 * 规则：
 * - 如果关键词包含国家/地区信息，只保留与目标国家匹配的
 * - 如果关键词不包含国家信息，保留
 *
 * @example
 * filterMismatchedGeoKeywords(["reolink", "reolink australia", "reolink uk"], "AU")
 * // returns ["reolink", "reolink australia"] - 过滤掉 "reolink uk"
 */
export function filterMismatchedGeoKeywords(
  keywords: string[],
  targetCountry: string
): string[] {
  return keywords.filter((keyword) => {
    const detectedCountries = detectCountryInKeyword(keyword)

    // 如果没有检测到国家信息，保留
    if (detectedCountries.length === 0) {
      return true
    }

    // 如果检测到国家信息，检查是否匹配目标国家
    const isMatch = detectedCountries.includes(targetCountry.toUpperCase())

    if (!isMatch) {
      console.log(
        `  ⊗ 过滤地理不匹配关键词: "${keyword}" (包含${detectedCountries.join(',')}，目标${targetCountry})`
      )
      return false
    }

    return true
  })
}

/**
 * 过滤关键词建议对象数组
 */
export function filterLowIntentSuggestions(
  suggestions: GoogleSuggestion[]
): GoogleSuggestion[] {
  const filteredKeywords = filterLowIntentKeywords(
    suggestions.map((s) => s.keyword)
  )

  return suggestions.filter((s) =>
    filteredKeywords.includes(s.keyword)
  )
}

/**
 * 获取高质量的购买意图关键词
 * 结合Google建议、意图过滤和地理过滤
 */
export async function getHighIntentKeywords(params: {
  brand: string
  country: string
  language: string
  useProxy?: boolean
}): Promise<string[]> {
  const { country } = params

  // 1. 获取Google搜索建议
  const suggestions = await getBrandSearchSuggestions(params)

  // 2. 提取关键词
  const keywords = suggestions.map((s) => s.keyword)
  console.log(`  → 步骤1: 获取${keywords.length}个原始关键词`)

  // 3. 过滤低意图关键词
  const highIntentKeywords = filterLowIntentKeywords(keywords)
  console.log(
    `  → 步骤2: 过滤低意图后剩余${highIntentKeywords.length}个关键词`
  )

  // 4. 过滤地理不匹配的关键词 (用户问题1)
  const geoFilteredKeywords = filterMismatchedGeoKeywords(
    highIntentKeywords,
    country
  )
  console.log(
    `  → 步骤3: 过滤地理不匹配后剩余${geoFilteredKeywords.length}个关键词`
  )

  console.log(
    `  ✓ 最终剩余${geoFilteredKeywords.length}个高质量关键词 (原始${keywords.length}个)`
  )

  return geoFilteredKeywords
}
