/**
 * 评论数据压缩器
 *
 * 核心目标：将评论数据压缩60-70%，同时保持洞察完整性≥90%
 *
 * 压缩策略：
 * 1. 移除HTML标签和多余空白
 * 2. 截断每条评论到200字符（保留核心信息）
 * 3. 移除重复和低价值评论
 * 4. 保留情感词、高频关键词、使用场景描述
 *
 * 质量标准：
 * - 压缩率：60-70%（15,000 tokens → 4,500-6,000 tokens）
 * - 洞察完整性：≥90%（高频关键词、情感分布、痛点识别）
 * - 不破坏业务功能：所有下游分析正常
 */

export interface RawReview {
  title?: string
  body?: string
  rating?: string
  verified?: boolean
  author?: string
  date?: string
}

export interface CompressedReviewsResult {
  compressed: string
  stats: CompressionStats
  metadata: CompressionMetadata
}

export interface CompressionStats {
  originalChars: number
  compressedChars: number
  compressionRatio: string // 百分比
  reviewsProcessed: number
  reviewsKept: number
  reviewsFiltered: number
}

export interface CompressionMetadata {
  hasPositive: boolean
  hasNegative: boolean
  hasNeutral: boolean
  avgRating: number
  verifiedCount: number
}

/**
 * 清理HTML标签和多余空白
 */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '') // 移除HTML标签
    .replace(/\s+/g, ' ') // 多个空白合并为一个
    .replace(/[\r\n]+/g, ' ') // 换行符转空格
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
 * 判断评论是否为低价值（应过滤）
 */
function isLowValueReview(review: RawReview): boolean {
  const title = review.title || ''
  const body = review.body || ''
  const text = (title + ' ' + body).toLowerCase()

  // 过滤条件
  const filters = [
    text.length < 10, // 太短
    /^(good|great|nice|ok|fine|thanks|thank you)$/i.test(text), // 单词评论
    /^[^a-z0-9]+$/i.test(text), // 纯符号
    /^(\.|!|\?|:)+$/.test(text), // 纯标点
  ]

  return filters.some((f) => f)
}

/**
 * 提取评论核心信息（200字符限制）
 */
function extractCore(review: RawReview): string {
  const title = review.title ? cleanText(review.title) : ''
  const body = review.body ? cleanText(review.body) : ''

  // 合并标题和正文
  let combined = title
  if (title && body) {
    combined += ': ' + body
  } else if (body) {
    combined = body
  }

  // 截断到200字符，优先保留前半部分（通常包含核心观点）
  if (combined.length > 200) {
    // 尝试在句号、问号、感叹号处截断
    const sentenceEnd = combined.substring(0, 200).lastIndexOf('.')
    if (sentenceEnd > 100) {
      combined = combined.substring(0, sentenceEnd + 1)
    } else {
      combined = combined.substring(0, 200).trim() + '...'
    }
  }

  return combined
}

/**
 * 压缩评论数据
 *
 * @param reviews - 原始评论数组
 * @param maxReviews - 保留的最大评论数（默认40）
 * @returns 压缩后的评论字符串和统计信息
 */
export function compressReviews(
  reviews: RawReview[],
  maxReviews: number = 40
): CompressedReviewsResult {
  const originalChars = JSON.stringify(reviews).length

  // 过滤低价值评论
  const validReviews = reviews.filter((r) => !isLowValueReview(r))

  // 按评分分组（确保各类评分都有代表性）
  const positiveReviews = validReviews.filter((r) => parseRating(r.rating) >= 4)
  const negativeReviews = validReviews.filter((r) => parseRating(r.rating) <= 2)
  const neutralReviews = validReviews.filter(
    (r) => parseRating(r.rating) > 2 && parseRating(r.rating) < 4
  )

  // 智能采样（保持情感分布）
  const maxPositive = Math.ceil(maxReviews * 0.5) // 50%正面
  const maxNegative = Math.ceil(maxReviews * 0.3) // 30%负面
  const maxNeutral = maxReviews - maxPositive - maxNegative // 20%中性

  const sampledReviews = [
    ...positiveReviews.slice(0, maxPositive),
    ...negativeReviews.slice(0, maxNegative),
    ...neutralReviews.slice(0, maxNeutral),
  ]

  // 生成压缩格式
  const compressedLines = sampledReviews.map((r, idx) => {
    const rating = parseRating(r.rating)
    const verified = r.verified ? '[VP]' : '' // VP = Verified Purchase
    const core = extractCore(r)
    return `[${idx + 1}] ${rating}★ ${verified} ${core}`
  })

  const compressed = compressedLines.join('\n')
  const compressedChars = compressed.length

  // 计算元数据
  const ratings = sampledReviews.map((r) => parseRating(r.rating)).filter((r) => r > 0)
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
  const verifiedCount = sampledReviews.filter((r) => r.verified).length

  return {
    compressed,
    stats: {
      originalChars,
      compressedChars,
      compressionRatio: ((1 - compressedChars / originalChars) * 100).toFixed(1) + '%',
      reviewsProcessed: reviews.length,
      reviewsKept: sampledReviews.length,
      reviewsFiltered: reviews.length - validReviews.length,
    },
    metadata: {
      hasPositive: positiveReviews.length > 0,
      hasNegative: negativeReviews.length > 0,
      hasNeutral: neutralReviews.length > 0,
      avgRating,
      verifiedCount,
    },
  }
}

/**
 * 验证压缩质量（用于A/B测试）
 *
 * @param original - 原始评论
 * @param compressed - 压缩后的字符串
 * @returns 质量指标
 */
export function validateCompressionQuality(
  original: RawReview[],
  compressed: string
): {
  keywordRetention: number // 关键词保留率
  sentimentPreservation: number // 情感分布保留率
  informationDensity: number // 信息密度（压缩后每字符信息量）
} {
  // 提取原始关键词（简化版，实际应使用NLP）
  const originalText = original
    .map((r) => `${r.title || ''} ${r.body || ''}`)
    .join(' ')
    .toLowerCase()

  const originalWords = new Set(
    originalText.match(/\b\w{4,}\b/g) || [] // 4字母以上的单词
  )

  const compressedWords = new Set(
    compressed.toLowerCase().match(/\b\w{4,}\b/g) || []
  )

  // 关键词保留率
  const retainedWords = Array.from(originalWords).filter((w) =>
    compressedWords.has(w)
  ).length
  const keywordRetention = retainedWords / originalWords.size

  // 情感分布保留率（简化：基于评分分布）
  const originalRatings = original
    .map((r) => parseRating(r.rating))
    .filter((r) => r > 0)
  const originalAvg =
    originalRatings.reduce((a, b) => a + b, 0) / originalRatings.length

  const compressedRatings = Array.from(compressed.matchAll(/([\d.]+)★/g))
    .map((m) => parseFloat(m[1]))
    .filter((r) => r > 0)
  const compressedAvg =
    compressedRatings.reduce((a, b) => a + b, 0) / compressedRatings.length

  const sentimentPreservation = 1 - Math.abs(originalAvg - compressedAvg) / 5 // 5星制

  // 信息密度（压缩比的倒数）
  const informationDensity = originalText.length / compressed.length

  return {
    keywordRetention,
    sentimentPreservation,
    informationDensity,
  }
}

/**
 * 示例：压缩测试
 */
export function testCompression() {
  const sampleReviews: RawReview[] = [
    {
      title: 'Great product!',
      body: 'I love this product. It works perfectly and the quality is amazing. Highly recommended!',
      rating: '5.0 out of 5 stars',
      verified: true,
    },
    {
      title: 'Not bad',
      body: 'It is okay for the price. Some features are missing but overall decent.',
      rating: '3.0 out of 5 stars',
      verified: false,
    },
    {
      title: 'Terrible',
      body: 'Broke after one week. Do not buy this. Waste of money.',
      rating: '1.0 out of 5 stars',
      verified: true,
    },
  ]

  const result = compressReviews(sampleReviews, 40)

  console.log('📊 压缩测试结果:')
  console.log(`原始长度: ${result.stats.originalChars} 字符`)
  console.log(`压缩长度: ${result.stats.compressedChars} 字符`)
  console.log(`压缩率: ${result.stats.compressionRatio}`)
  console.log(`保留评论: ${result.stats.reviewsKept}/${result.stats.reviewsProcessed}`)
  console.log(`\n压缩后内容:\n${result.compressed}`)

  const quality = validateCompressionQuality(sampleReviews, result.compressed)
  console.log(`\n质量指标:`)
  console.log(`关键词保留率: ${(quality.keywordRetention * 100).toFixed(1)}%`)
  console.log(
    `情感分布保留率: ${(quality.sentimentPreservation * 100).toFixed(1)}%`
  )
  console.log(`信息密度: ${quality.informationDensity.toFixed(2)}x`)
}
