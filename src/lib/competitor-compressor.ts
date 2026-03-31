/**
 * 竞品数据压缩器
 *
 * 核心目标：将竞品数据压缩40-50%，同时保持分析完整性≥90%
 *
 * 压缩策略：
 * 1. 多行格式 → 单行紧凑格式
 * 2. 移除冗余信息和多余空白
 * 3. 保留核心竞争要素（价格、评分、USP、特性）
 * 4. 使用紧凑分隔符（| 而非换行）
 *
 * 质量标准：
 * - 压缩率：40-50%（8,000-12,000 tokens → 4,000-6,000 tokens）
 * - USP识别准确率：≥85%
 * - 竞争特性完整性：≥90%
 * - 不破坏业务功能：所有下游分析正常
 */

export interface CompetitorInfo {
  name?: string
  brand?: string
  price?: string
  rating?: string
  reviewCount?: number
  usp?: string // Unique Selling Proposition
  keyFeatures?: string[]
  url?: string
}

export interface CompressedCompetitorsResult {
  compressed: string
  stats: CompressionStats
  metadata: CompressionMetadata
}

export interface CompressionStats {
  originalChars: number
  compressedChars: number
  compressionRatio: string // 百分比
  competitorsProcessed: number
  competitorsKept: number
  competitorsFiltered: number
}

export interface CompressionMetadata {
  avgRating: number
  priceRange: { min: number; max: number; currency: string }
  totalReviews: number
  hasUSP: boolean
}

/**
 * 清理文本：移除多余空白和特殊字符
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ') // 多个空白合并为一个
    .replace(/[\r\n]+/g, ' ') // 换行符转空格
    .replace(/\|/g, '') // 移除分隔符冲突字符
    .trim()
}

/**
 * 提取评分数字
 */
function parseRating(rating?: string): number {
  if (!rating) return 0
  const match = rating.match(/[\d.]+/)
  return match ? parseFloat(match[0]) : 0
}

/**
 * 提取价格数字和货币
 */
function parsePrice(price?: string): { value: number; currency: string } {
  if (!price) return { value: 0, currency: 'USD' }

  // 移除逗号和空格
  const cleaned = price.replace(/[,\s]/g, '')

  // 提取货币符号
  let currency = 'USD'
  if (cleaned.includes('$')) currency = 'USD'
  else if (cleaned.includes('€')) currency = 'EUR'
  else if (cleaned.includes('£')) currency = 'GBP'
  else if (cleaned.includes('¥')) currency = 'JPY'

  // 提取数字
  const match = cleaned.match(/[\d.]+/)
  const value = match ? parseFloat(match[0]) : 0

  return { value, currency }
}

/**
 * 判断竞品是否为低价值（应过滤）
 */
function isLowValueCompetitor(competitor: CompetitorInfo): boolean {
  const filters = [
    !competitor.name, // 无产品名
    !competitor.price && !competitor.rating, // 无价格且无评分
    competitor.reviewCount === 0, // 无评论
  ]

  return filters.some((f) => f)
}

/**
 * 提取竞品核心信息（单行紧凑格式）
 * 格式：Name | Brand | Price | Rating★(Reviews) | USP: xxx | Features: a,b,c
 */
function extractCompetitorCore(competitor: CompetitorInfo): string {
  const parts: string[] = []

  // 产品名（必需）
  if (competitor.name) {
    parts.push(cleanText(competitor.name))
  }

  // 品牌（可选）
  if (competitor.brand && competitor.brand !== competitor.name) {
    parts.push(cleanText(competitor.brand))
  }

  // 价格（可选）
  if (competitor.price) {
    parts.push(cleanText(competitor.price))
  }

  // 评分和评论数（可选）
  if (competitor.rating) {
    const rating = parseRating(competitor.rating)
    const reviews = competitor.reviewCount || 0
    parts.push(`${rating.toFixed(1)}★(${reviews})`)
  }

  // USP（可选但重要）
  if (competitor.usp) {
    const usp = cleanText(competitor.usp)
    // 截断到100字符
    const truncatedUSP = usp.length > 100 ? usp.substring(0, 100) + '...' : usp
    parts.push(`USP: ${truncatedUSP}`)
  }

  // 关键特性（可选，最多3个）
  if (competitor.keyFeatures && competitor.keyFeatures.length > 0) {
    const features = competitor.keyFeatures
      .slice(0, 3)
      .map((f) => cleanText(f))
      .join(',')
    parts.push(`Features: ${features}`)
  }

  return parts.join(' | ')
}

/**
 * 压缩竞品数据
 *
 * @param competitors - 原始竞品数组
 * @param maxCompetitors - 保留的最大竞品数（默认20）
 * @returns 压缩后的竞品字符串和统计信息
 */
export function compressCompetitors(
  competitors: CompetitorInfo[],
  maxCompetitors: number = 20
): CompressedCompetitorsResult {
  const originalChars = JSON.stringify(competitors).length

  // 过滤低价值竞品
  const validCompetitors = competitors.filter((c) => !isLowValueCompetitor(c))

  // 按评分排序（高评分优先，因为更有竞争力）
  const sortedCompetitors = validCompetitors.sort((a, b) => {
    const ratingA = parseRating(a.rating)
    const ratingB = parseRating(b.rating)
    return ratingB - ratingA
  })

  // 取前N个竞品
  const topCompetitors = sortedCompetitors.slice(0, maxCompetitors)

  // 生成压缩格式（单行紧凑格式）
  const compressedLines = topCompetitors.map((c, idx) => {
    const core = extractCompetitorCore(c)
    return `[${idx + 1}] ${core}`
  })

  const compressed = compressedLines.join('\n')
  const compressedChars = compressed.length

  // 计算元数据
  const ratings = topCompetitors
    .map((c) => parseRating(c.rating))
    .filter((r) => r > 0)
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0

  const prices = topCompetitors
    .map((c) => parsePrice(c.price))
    .filter((p) => p.value > 0)
  const priceRange = {
    min: prices.length > 0 ? Math.min(...prices.map((p) => p.value)) : 0,
    max: prices.length > 0 ? Math.max(...prices.map((p) => p.value)) : 0,
    currency: prices.length > 0 ? prices[0].currency : 'USD',
  }

  const totalReviews = topCompetitors.reduce((sum, c) => sum + (c.reviewCount || 0), 0)
  const hasUSP = topCompetitors.some((c) => !!c.usp)

  return {
    compressed,
    stats: {
      originalChars,
      compressedChars,
      compressionRatio: ((1 - compressedChars / originalChars) * 100).toFixed(1) + '%',
      competitorsProcessed: competitors.length,
      competitorsKept: topCompetitors.length,
      competitorsFiltered: competitors.length - validCompetitors.length,
    },
    metadata: {
      avgRating,
      priceRange,
      totalReviews,
      hasUSP,
    },
  }
}

/**
 * 验证压缩质量（用于A/B测试）
 *
 * @param original - 原始竞品数据
 * @param compressed - 压缩后的字符串
 * @returns 质量指标
 */
export function validateCompressionQuality(
  original: CompetitorInfo[],
  compressed: string
): {
  uspRetention: number // USP保留率
  featureRetention: number // 特性保留率
  priceAccuracy: number // 价格准确率
  ratingAccuracy: number // 评分准确率
} {
  // 提取原始数据的关键信息
  const originalUSPs = original
    .filter((c) => c.usp)
    .map((c) => c.usp!.toLowerCase())
  const originalFeatures = original
    .flatMap((c) => c.keyFeatures || [])
    .map((f) => f.toLowerCase())
  const originalPrices = original
    .filter((c) => c.price)
    .map((c) => parsePrice(c.price).value)
  const originalRatings = original
    .filter((c) => c.rating)
    .map((c) => parseRating(c.rating))

  // 从压缩数据中提取信息
  const compressedText = compressed.toLowerCase()

  // USP保留率
  const retainedUSPs = originalUSPs.filter((usp) =>
    compressedText.includes(usp.toLowerCase())
  ).length
  const uspRetention = originalUSPs.length > 0 ? retainedUSPs / originalUSPs.length : 1

  // 特性保留率
  const retainedFeatures = originalFeatures.filter((feature) =>
    compressedText.includes(feature.toLowerCase())
  ).length
  const featureRetention =
    originalFeatures.length > 0 ? retainedFeatures / originalFeatures.length : 1

  // 价格准确率（检查所有价格数字是否都出现在压缩数据中）
  const retainedPrices = originalPrices.filter((price) =>
    compressedText.includes(price.toString())
  ).length
  const priceAccuracy = originalPrices.length > 0 ? retainedPrices / originalPrices.length : 1

  // 评分准确率（检查所有评分数字是否都出现在压缩数据中）
  const retainedRatings = originalRatings.filter((rating) =>
    compressedText.includes(rating.toFixed(1))
  ).length
  const ratingAccuracy =
    originalRatings.length > 0 ? retainedRatings / originalRatings.length : 1

  return {
    uspRetention,
    featureRetention,
    priceAccuracy,
    ratingAccuracy,
  }
}

/**
 * 示例：压缩测试
 */
export function testCompression() {
  const sampleCompetitors: CompetitorInfo[] = [
    {
      name: 'Sony Alpha 7 IV',
      brand: 'Sony',
      price: '$2,499.99',
      rating: '4.8 out of 5 stars',
      reviewCount: 1234,
      usp: 'Professional full-frame mirrorless with 33MP sensor and real-time tracking',
      keyFeatures: ['33MP sensor', '4K 60p video', 'Real-time Eye AF'],
      url: 'https://amazon.com/sony-alpha-7-iv',
    },
    {
      name: 'Canon EOS R6 Mark II',
      brand: 'Canon',
      price: '$2,399.00',
      rating: '4.7 out of 5 stars',
      reviewCount: 892,
      usp: 'High-speed continuous shooting with superior autofocus system',
      keyFeatures: ['24.2MP sensor', '40fps burst', 'Dual Pixel AF II'],
      url: 'https://amazon.com/canon-eos-r6-mark-ii',
    },
    {
      name: 'Nikon Z6 III',
      brand: 'Nikon',
      price: '$2,199.95',
      rating: '4.6 out of 5 stars',
      reviewCount: 567,
      usp: 'Excellent low-light performance with 5-axis image stabilization',
      keyFeatures: ['24.5MP sensor', 'ISO 100-51200', '5-axis VR'],
      url: 'https://amazon.com/nikon-z6-iii',
    },
  ]

  const result = compressCompetitors(sampleCompetitors, 20)

  console.log('📊 竞品压缩测试结果:')
  console.log(`原始长度: ${result.stats.originalChars} 字符`)
  console.log(`压缩长度: ${result.stats.compressedChars} 字符`)
  console.log(`压缩率: ${result.stats.compressionRatio}`)
  console.log(`保留竞品: ${result.stats.competitorsKept}/${result.stats.competitorsProcessed}`)
  console.log(`\n压缩后内容:\n${result.compressed}`)

  const quality = validateCompressionQuality(sampleCompetitors, result.compressed)
  console.log(`\n质量指标:`)
  console.log(`USP保留率: ${(quality.uspRetention * 100).toFixed(1)}%`)
  console.log(`特性保留率: ${(quality.featureRetention * 100).toFixed(1)}%`)
  console.log(`价格准确率: ${(quality.priceAccuracy * 100).toFixed(1)}%`)
  console.log(`评分准确率: ${(quality.ratingAccuracy * 100).toFixed(1)}%`)
}
