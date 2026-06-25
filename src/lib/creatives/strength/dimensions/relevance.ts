import type { HeadlineAsset, DescriptionAsset } from '../../server'
import { AD_STRENGTH_RELEVANCE_THRESHOLDS } from '../../server'

import {
  calculateKeywordDensityByToken,
  keywordAppearsInText,
  normalizeForKeywordMatching,
  tokenizeForKeywordMatching,
} from '../keyword-matching'
import { calculateBrandContentConsistency } from './brand-consistency'
import { calculateProductFocus } from './product-focus'
export function calculateRelevance(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  sitelinks?: Array<{
    text: string
    url: string
    description1?: string
    description2?: string
    description?: string
  }>,
  callouts?: string[],
  brandName?: string,
  category?: string
) {
  const allTexts = [...headlines.map((h) => h.text), ...descriptions.map((d) => d.text)].join(' ')
  const normalizedAllTexts = normalizeForKeywordMatching(allTexts)
  const allTextTokenSet = new Set<string>(tokenizeForKeywordMatching(allTexts))

  // 2.1 关键词覆盖率 (0-10分) - KISS: 词边界/词元匹配，避免子串误命中
  const matchedKeywords = keywords.filter((kw) => {
    return keywordAppearsInText(kw, normalizedAllTexts, allTextTokenSet)
  })

  const coverageRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0
  const keywordCoverage = coverageRatio * 10 // 降低到10分，为嵌入率腾出空间

  // 调试输出
  if (coverageRatio < 0.8) {
    const unmatchedKeywords = keywords.filter((kw) => !matchedKeywords.includes(kw))
    console.log(`⚠️ 关键词覆盖率偏低: ${(coverageRatio * 100).toFixed(0)}%`)
    console.log(`   匹配成功: ${matchedKeywords.join(', ')}`)
    console.log(`   匹配失败: ${unmatchedKeywords.join(', ')}`)
  }

  // 2.2 关键词嵌入率 (0-4分) - v3.3 CTR优化新增
  // 目标：8/15 headlines (53%+) 包含关键词
  const headlinesWithKeyword = headlines.filter((h) => {
    const normalizedHeadline = normalizeForKeywordMatching(h.text)
    const headlineTokenSet = new Set<string>(tokenizeForKeywordMatching(h.text))
    return keywords.some((kw) => keywordAppearsInText(kw, normalizedHeadline, headlineTokenSet))
  })

  const embeddingRate = headlines.length > 0 ? headlinesWithKeyword.length / headlines.length : 0
  const targetEmbeddingRate = AD_STRENGTH_RELEVANCE_THRESHOLDS.targetEmbeddingRate

  // 评分：达到53%得满分4分，低于则按比例扣分
  let keywordEmbedding = 0
  if (embeddingRate >= targetEmbeddingRate) {
    keywordEmbedding = 4
  } else if (embeddingRate >= AD_STRENGTH_RELEVANCE_THRESHOLDS.embeddingRateTier2) {
    keywordEmbedding = 3
  } else if (embeddingRate >= AD_STRENGTH_RELEVANCE_THRESHOLDS.embeddingRateTier1) {
    keywordEmbedding = 2
  } else if (embeddingRate > 0) {
    keywordEmbedding = 1
  }

  console.log(
    `🔑 关键词嵌入率: ${headlinesWithKeyword.length}/${headlines.length} (${(embeddingRate * 100).toFixed(0)}%)`
  )
  if (embeddingRate < targetEmbeddingRate) {
    console.log(`   ⚠️ 低于目标 ${(targetEmbeddingRate * 100).toFixed(0)}%，建议增加关键词嵌入`)
  } else {
    console.log(`   ✅ 达到目标嵌入率`)
  }

  // 2.3 关键词自然度 (0-6分)
  // 检查关键词是否自然融入（非堆砌）
  const keywordDensity = calculateKeywordDensityByToken(allTexts, keywords)
  const naturalness =
    keywordDensity < AD_STRENGTH_RELEVANCE_THRESHOLDS.naturalnessDensityGood
      ? 6
      : keywordDensity < AD_STRENGTH_RELEVANCE_THRESHOLDS.naturalnessDensityOk
        ? 4
        : 2

  // 2.4 单品聚焦度 (0-4分) - v4.18新增
  // 检查创意是否100%聚焦单品，排除其他品类
  const productFocus = calculateProductFocus(headlines, descriptions, sitelinks, callouts)

  // 2.5 品牌-内容一致性检查 (0分或扣分) - v4.19新增
  // 检测创意内容是否与声明的品牌一致，防止因抓取错误导致的品牌错配
  const brandConsistencyPenalty = calculateBrandContentConsistency(
    headlines,
    descriptions,
    brandName,
    category
  )

  const totalScore =
    keywordCoverage +
    keywordEmbedding +
    naturalness +
    productFocus.score -
    brandConsistencyPenalty.penalty

  return {
    score: Math.min(20, Math.max(0, Math.round(totalScore))), // 确保在0-20范围内
    weight: 0.2 as const,
    details: {
      keywordCoverage: Math.round(keywordCoverage),
      keywordEmbedding: Math.round(keywordEmbedding), // v3.3新增
      keywordEmbeddingRate: Math.round(embeddingRate * 100), // v3.3百分比
      keywordNaturalness: Math.round(naturalness),
      productFocus: Math.round(productFocus.score), // v4.18新增
      brandConsistencyPenalty: brandConsistencyPenalty.penalty, // v4.19新增
      brandConsistencyIssues: brandConsistencyPenalty.issues, // v4.19新增
    },
  }
}
