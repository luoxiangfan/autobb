/**
 * Whitelist and smart filters for unified keyword service.
 */
import { DEFAULTS, PLATFORMS, BRAND_PATTERNS } from '../keyword-constants'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import type { UnifiedKeywordData, WhitelistFilterResult } from './unified-keyword-types'

// 白名单过滤

/**
 * 检测关键词是否包含已知品牌名
 *
 * 返回: 品牌名 或 null
 *
 * 注意：销售平台关键词（如amazon）不会被识别为竞品品牌
 */
function detectBrandInKeyword(keyword: string): string | null {
  const keywordLower = keyword.toLowerCase()

  // 优先检查销售平台白名单
  // 如果关键词包含销售平台词（如 "argus 3 pro amazon"），不应视为竞品
  for (const platform of PLATFORMS) {
    const regex = new RegExp(`\\b${platform}\\b`, 'i')
    if (regex.test(keywordLower)) {
      // 包含销售平台词，不视为竞品，返回 null
      return null
    }
  }

  // 检查已知品牌列表
  for (const brand of BRAND_PATTERNS) {
    // 完整词匹配（避免 "spring" 匹配 "ring"）
    const regex = new RegExp(`\\b${brand}\\b`, 'i')
    if (regex.test(keywordLower)) {
      return brand
    }
  }

  return null
}

/**
 * 生成品牌名的常见拼写变体/错误
 *
 * 用于识别并排除 Google Keyword Planner 返回的拼写错误关键词
 * 例如: "Dreame" → ["dreamers", "dreamer", "dream "] (这些应该被排除)
 */
function generateBrandMisspellings(brandName: string): string[] {
  const brand = brandName.toLowerCase()
  const misspellings: string[] = []

  // 1. 添加 's' 后缀变体 (dreame → dreamers)
  misspellings.push(brand + 's')
  misspellings.push(brand + 'rs')
  misspellings.push(brand + 'er')
  misspellings.push(brand + 'ers')

  // 2. 去掉末尾字母变体 (dreame → dream)
  if (brand.length > 3) {
    misspellings.push(brand.slice(0, -1)) // dreame → dream
    misspellings.push(brand.slice(0, -1) + 'er') // dreame → dreamer
    misspellings.push(brand.slice(0, -1) + 'ers') // dreame → dreamers
  }

  // 3. 常见字母替换 (a↔e, i↔y)
  const variants = [
    brand.replace(/e/g, 'a'),
    brand.replace(/a/g, 'e'),
    brand.replace(/i/g, 'y'),
    brand.replace(/y/g, 'i'),
  ].filter((v) => v !== brand)
  misspellings.push(...variants)

  return [...new Set(misspellings)] // 去重
}

/**
 * 检查关键词是否包含品牌名作为完整单词
 *
 * 使用单词边界匹配，避免 "dreamers" 误匹配 "dreame"
 */
function containsBrandAsWord(keyword: string, brandName: string): boolean {
  const brandLower = brandName.toLowerCase()
  const keywordLower = keyword.toLowerCase()

  // 使用单词边界正则表达式
  const brandPattern = new RegExp(`\\b${escapeRegex(brandLower)}\\b`, 'i')
  return brandPattern.test(keywordLower)
}

/**
 * 检查关键词是否包含品牌拼写错误
 *
 * 用于排除 Google Keyword Planner 返回的拼写变体
 */
function containsBrandMisspelling(keyword: string, brandName: string): boolean {
  const keywordLower = keyword.toLowerCase()
  const misspellings = generateBrandMisspellings(brandName)

  for (const misspelling of misspellings) {
    // 使用单词边界匹配
    const pattern = new RegExp(`\\b${escapeRegex(misspelling)}\\b`, 'i')
    if (pattern.test(keywordLower)) {
      return true
    }
  }
  return false
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export { escapeRegex }

/**
 * 白名单过滤（提取竞品品牌用作否定关键词）
 *
 * 优化规则
 * 1. 保留: 包含自身品牌名的关键词（精确单词匹配）
 * 2. 排除: 包含品牌拼写错误的关键词（如 dreamers, dreamer）
 * 3. 保留: 不含任何品牌名的通用品类词
 * 4. 排除: 包含其他品牌名的关键词（竞品）
 * 5. 同时包含自身品牌+竞品的关键词保留（跨品牌比较搜索有价值）
 *
 * 使用单词边界匹配 + 拼写变体过滤
 * 返回识别到的竞品品牌列表，可用于创建否定关键词
 * 跨品牌比较搜索保留（如 "roborock xiaomi" 应该保留）
 */
export function filterByWhitelist<T extends { keyword: string }>(
  keywords: T[],
  brandName: string
): WhitelistFilterResult<T> {
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const shortBrand = pureBrandKeywords.find((kw) => kw.split(/\s+/).length === 1)
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName)
  const coreBrand = shortBrand || normalizedBrand || brandName.toLowerCase()
  const coreBrandLower = coreBrand.toLowerCase()

  let brandKept = 0
  let genericKept = 0
  let competitorFiltered = 0
  let crossBrandKept = 0 // 跨品牌比较搜索保留计数
  let misspellingFiltered = 0 // 拼写错误过滤计数

  // 收集识别到的竞品品牌
  const competitorBrandsSet = new Set<string>()

  const filtered = keywords.filter((kw) => {
    const keywordLower = kw.keyword.toLowerCase()

    // 先检查是否包含品牌拼写错误
    // 例如: "dreamers", "dreamer shop" 应该被过滤
    if (
      containsBrandMisspelling(kw.keyword, brandName) ||
      containsBrandMisspelling(kw.keyword, coreBrand)
    ) {
      misspellingFiltered++
      console.log(`   ❌ 过滤拼写错误: "${kw.keyword}" (品牌: ${brandName})`)
      return false
    }

    // 使用单词边界匹配品牌名
    // 1. 包含自身品牌名（完整单词匹配） → 保留
    if (containsBrandAsWord(kw.keyword, brandName) || containsBrandAsWord(kw.keyword, coreBrand)) {
      brandKept++
      return true
    }

    // 检查是否同时包含自身品牌和竞品
    // 如果同时包含自身品牌和竞品（如 "roborock xiaomi"），这是跨品牌比较搜索，应该保留
    const detectedBrand = detectBrandInKeyword(kw.keyword)
    if (detectedBrand) {
      // 先检查是否包含自身品牌（使用单词边界匹配）
      const hasSelfBrandWord =
        containsBrandAsWord(kw.keyword, brandName) || containsBrandAsWord(kw.keyword, coreBrand)

      // 辅助检查：部分匹配（处理品牌变体）
      const hasSelfBrandPartial =
        keywordLower.includes(coreBrandLower) ||
        brandName
          .toLowerCase()
          .split(' ')
          .some((part) => part.length >= 3 && keywordLower.includes(part.toLowerCase()))

      if (hasSelfBrandWord || hasSelfBrandPartial) {
        // 同时包含自身品牌和竞品，保留（跨品牌比较搜索有价值）
        crossBrandKept++
        console.log(
          `   ✅ 保留跨品牌比较词: "${kw.keyword}" (自身: ${brandName} + 竞品: ${detectedBrand})`
        )
        return true
      }

      // 纯竞品词（不含自身品牌） → 排除
      competitorFiltered++
      competitorBrandsSet.add(detectedBrand) // 收集竞品品牌
      console.log(`   ❌ 过滤竞品词: "${kw.keyword}" (检测到竞品: ${detectedBrand})`)
      return false
    }

    // 3. 不含任何品牌名 → 保留（通用品类词）
    genericKept++
    return true
  })

  const competitorBrands = Array.from(competitorBrandsSet)

  console.log(`\n📋 白名单过滤结果:`)
  console.log(`   ✅ 品牌词保留: ${brandKept}`)
  console.log(`   ✅ 通用词保留: ${genericKept}`)
  console.log(`   ✅ 跨品牌比较词保留: ${crossBrandKept}`) // 新增
  console.log(`   ❌ 竞品词过滤: ${competitorFiltered}`)
  console.log(`   ❌ 拼写错误过滤: ${misspellingFiltered}`) // 新增
  if (competitorBrands.length > 0) {
    console.log(`   🏷️ 识别竞品品牌: ${competitorBrands.join(', ')}`)
  }

  return {
    filtered,
    competitorBrands,
    stats: {
      brandKept,
      genericKept,
      competitorFiltered,
      misspellingFiltered, // 新增
    },
  }
}

// 智能过滤和排序

// 研究意图关键词标识（需要过滤）
const RESEARCH_INTENT_PATTERNS = [
  'review',
  'reviews',
  'vs',
  'versus',
  'comparison',
  'compare',
  'alternative',
  'alternatives',
  'how to',
  'what is',
  'guide',
  'tutorial',
  'reddit',
  'forum',
  'blog',
  'article',
]

/**
 * 智能过滤
 *
 * 搜索量过滤 (默认>500，可自适应降低)
 * 研究意图过滤 (排除 review, vs, tutorial)
 *
 * 优化3 : 搜索量阈值自适应
 * 如果过滤后关键词不足15个，自动降低阈值重试
 * 最低阈值为1（确保小众市场也能获得关键词）
 */
export function applySmartFilters(
  keywords: UnifiedKeywordData[],
  minSearchVolume: number = DEFAULTS.minSearchVolume,
  minKeywordsTarget: number = DEFAULTS.minKeywordsTarget,
  options?: { disableSearchVolumeFilter?: boolean; pureBrandKeywords?: string[] }
): UnifiedKeywordData[] {
  const hasAnyVolume = keywords.some((kw) => kw.searchVolume > 0)
  const disableSearchVolumeFilter = options?.disableSearchVolumeFilter ?? !hasAnyVolume
  const pureBrandKeywords = options?.pureBrandKeywords || []
  const isPureBrand = (keyword: string) => isPureBrandKeyword(keyword, pureBrandKeywords)

  if (disableSearchVolumeFilter) {
    console.log('\n⚠️ 搜索量数据不可用，跳过搜索量阈值过滤（仅过滤研究意图词）')
    return keywords.filter((kw) => {
      if (isPureBrand(kw.keyword)) return true
      const keywordLower = kw.keyword.toLowerCase()
      const hasResearchIntent = RESEARCH_INTENT_PATTERNS.some((pattern) =>
        keywordLower.includes(pattern)
      )
      return !hasResearchIntent
    })
  }

  let currentThreshold = minSearchVolume
  let filtered: UnifiedKeywordData[] = []
  let attempts = 0
  const maxAttempts = DEFAULTS.maxFilterAttempts

  // 动态阈值生成（基于初始关键词的搜索量分布）
  // 计算合理的自适应阈值序列
  const thresholdLevels = calculateAdaptiveThresholds(keywords, minSearchVolume)

  console.log(`\n📊 自适应阈值序列: ${thresholdLevels.join(' → ')}`)

  while (attempts < maxAttempts) {
    currentThreshold = thresholdLevels[Math.min(attempts, thresholdLevels.length - 1)]

    let volumeFiltered = 0
    let intentFiltered = 0

    filtered = keywords.filter((kw) => {
      if (isPureBrand(kw.keyword)) return true
      // 搜索量过滤
      if (kw.searchVolume < currentThreshold) {
        volumeFiltered++
        return false
      }

      // 研究意图过滤
      const keywordLower = kw.keyword.toLowerCase()
      const hasResearchIntent = RESEARCH_INTENT_PATTERNS.some((pattern) =>
        keywordLower.includes(pattern)
      )

      if (hasResearchIntent) {
        intentFiltered++
        return false
      }

      return true
    })

    // 如果结果足够或已达最低阈值，停止
    if (filtered.length >= minKeywordsTarget || currentThreshold <= 1) {
      console.log(`\n📊 智能过滤结果 (阈值=${currentThreshold}):`)
      console.log(`   过滤低搜索量(<${currentThreshold}): ${volumeFiltered}`)
      console.log(`   过滤研究意图词: ${intentFiltered}`)
      console.log(`   保留关键词: ${filtered.length}`)

      if (attempts > 0) {
        console.log(
          `   📉 阈值自适应: ${minSearchVolume} → ${currentThreshold} (第${attempts + 1}次尝试)`
        )
      }
      break
    }

    // 结果不足，降低阈值重试
    console.log(`   ⚠️ 关键词不足(${filtered.length}/${minKeywordsTarget})，降低阈值重试...`)
    attempts++
  }

  return filtered
}

/**
 * 计算动态自适应阈值
 * 简化设计：基于关键词的实际搜索量分布，只保留高中等价值的词
 * 低搜索量的词直接过滤掉，不需要逐步降低阈值
 */
function calculateAdaptiveThresholds(
  keywords: UnifiedKeywordData[],
  initialThreshold: number
): number[] {
  // 如果关键词为空，返回初始阈值
  if (keywords.length === 0) {
    return [initialThreshold, 1]
  }

  // 获取所有有效的搜索量数据
  const validVolumes = keywords
    .map((kw) => kw.searchVolume)
    .filter((vol) => vol > 0)
    .sort((a, b) => b - a)

  if (validVolumes.length === 0) {
    return [initialThreshold, 1]
  }

  // 计算中位数作为参考点
  const medianVolume = validVolumes[Math.floor(validVolumes.length / 2)]

  // 智能阈值：保留高中等价值的词（中位数的30%以上）
  const adaptiveThreshold = Math.max(
    Math.floor(medianVolume * 0.3), // 中位数的30%
    Math.floor(initialThreshold * 0.5) // 至少是初始阈值的50%
  )

  const thresholds: number[] = [initialThreshold]

  // 如果自适应阈值不同于初始阈值，添加到阈值序列
  if (adaptiveThreshold < initialThreshold && !thresholds.includes(adaptiveThreshold)) {
    thresholds.push(adaptiveThreshold)
  }

  // 最终兜底阈值
  thresholds.push(1)

  // 去重并按降序排列
  return Array.from(new Set(thresholds)).sort((a, b) => b - a)
}

/**
 * 智能匹配类型分配
 */
export function assignMatchTypes(
  keywords: UnifiedKeywordData[],
  brandName: string
): UnifiedKeywordData[] {
  const pureBrandKeywords = getPureBrandKeywords(brandName)

  return keywords.map((kw) => {
    // 纯品牌词 → EXACT
    if (isPureBrandKeyword(kw.keyword, pureBrandKeywords)) {
      return { ...kw, matchType: 'EXACT' as const }
    }

    // 品牌相关词 → PHRASE
    if (containsPureBrand(kw.keyword, pureBrandKeywords)) {
      return { ...kw, matchType: 'PHRASE' as const }
    }

    // 短关键词 (≤3 words) → PHRASE
    const wordCount = kw.keyword.split(/\s+/).length
    if (wordCount <= 3) {
      return { ...kw, matchType: 'PHRASE' as const }
    }

    // 长尾词 → PHRASE（默认收敛，避免意外放量）
    return { ...kw, matchType: 'PHRASE' as const }
  })
}
