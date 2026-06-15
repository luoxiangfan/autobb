import { AD_STRENGTH_RATING_THRESHOLDS, AD_STRENGTH_SUGGESTION_THRESHOLDS } from '..'
import type { AdStrengthRating } from './types'
export function scoreToRating(score: number): AdStrengthRating {
  if (score >= AD_STRENGTH_RATING_THRESHOLDS.excellent) return 'EXCELLENT'
  if (score >= AD_STRENGTH_RATING_THRESHOLDS.good) return 'GOOD'
  if (score >= AD_STRENGTH_RATING_THRESHOLDS.average) return 'AVERAGE'
  if (score > 0) return 'POOR'
  return 'PENDING'
}

/**
 * 生成改进建议
 */
export function generateSuggestions(
  diversity: any,
  relevance: any,
  completeness: any,
  quality: any,
  compliance: any,
  brandSearchVolume: any,
  competitivePositioning: any,
  rating: AdStrengthRating,
  copyIntentMetrics?: {
    expectedBucket: 'A' | 'B' | 'D' | 'UNSPECIFIED'
    typeIntentAlignmentScore: number
    copyIntentCoverage: number
  }
): string[] {
  const suggestions: string[] = []
  const thresholds = AD_STRENGTH_SUGGESTION_THRESHOLDS

  // 如果已经是EXCELLENT，给予肯定
  if (rating === 'EXCELLENT') {
    suggestions.push('✅ 广告创意质量优秀，符合Google Ads最高标准')
    return suggestions
  }

  // Diversity建议
  if (diversity.details.typeDistribution < thresholds.diversity.typeDistribution) {
    suggestions.push('💡 增加资产类型多样性：确保包含品牌、产品、促销、CTA、紧迫感5种类型')
  }
  if (diversity.details.lengthDistribution < thresholds.diversity.lengthDistribution) {
    suggestions.push('💡 优化长度分布：建议短标题5个、中标题5个、长标题5个')
  }
  if (diversity.details.textUniqueness < thresholds.diversity.textUniqueness) {
    suggestions.push('💡 提高文本独特性：避免使用相似或重复的表述')
  }

  // Relevance建议
  if (relevance.details.keywordCoverage < thresholds.relevance.keywordCoverage) {
    suggestions.push('💡 提高关键词覆盖率：至少80%的关键词应出现在创意中')
  }
  // v3.3 CTR优化：关键词嵌入率建议
  if (relevance.details.keywordEmbeddingRate < thresholds.relevance.keywordEmbeddingRate) {
    suggestions.push(
      `🔑 提高关键词嵌入率：当前${relevance.details.keywordEmbeddingRate}%，目标${thresholds.relevance.keywordEmbeddingRate}%+ (8/15 headlines含关键词)`
    )
  }
  if (relevance.details.keywordNaturalness < thresholds.relevance.keywordNaturalness) {
    suggestions.push('💡 优化关键词自然度：避免关键词堆砌，自然融入文案')
  }

  // Completeness建议
  if (completeness.details.assetCount < thresholds.completeness.assetCount) {
    suggestions.push('💡 补充资产数量：建议15个Headlines + 4个Descriptions')
  }
  if (completeness.details.characterCompliance < thresholds.completeness.characterCompliance) {
    suggestions.push('💡 优化字符长度：Headlines 10-30字符，Descriptions 60-90字符')
  }

  // Quality建议
  if (quality.details.numberUsage < thresholds.quality.numberUsage) {
    suggestions.push('💡 增加数字使用：至少3个Headlines包含具体数字（折扣、价格、数量）')
  }
  if (quality.details.ctaPresence < thresholds.quality.ctaPresence) {
    suggestions.push('💡 强化行动号召：至少2个Descriptions包含明确CTA（Shop Now、Get、Buy）')
  }
  if (quality.details.urgencyExpression < thresholds.quality.urgencyExpression) {
    suggestions.push('💡 增加紧迫感：至少2个Headlines体现限时优惠或稀缺性')
  }

  // Compliance建议
  if (compliance.details.policyAdherence < thresholds.compliance.policyAdherence) {
    suggestions.push('⚠️ 减少内容重复：确保每个资产独特且差异化')
  }
  if (compliance.details.noSpamWords < thresholds.compliance.noSpamWords) {
    suggestions.push('⚠️ 移除违规词汇：避免使用绝对化、夸大或误导性表述')
  }

  // Brand Search Volume建议
  if (brandSearchVolume.details.volumeLevel === 'micro') {
    suggestions.push('📊 品牌知名度较低：建议加强品牌推广，提升市场认知度')
  } else if (brandSearchVolume.details.volumeLevel === 'small') {
    suggestions.push('📊 品牌处于成长期：建议结合品牌建设和效果营销策略')
  } else if (brandSearchVolume.details.volumeLevel === 'medium') {
    suggestions.push('📊 品牌具备一定影响力：可以适当增加品牌类创意资产比例')
  }
  // large和xlarge级别无需建议，已经有足够品牌影响力

  // Competitive Positioning建议 (新增)
  if (
    competitivePositioning.details.priceAdvantage < thresholds.competitivePositioning.priceAdvantage
  ) {
    suggestions.push('🎯 强化价格优势：量化节省金额（如"Save €170"）提升竞争力')
  }
  if (
    competitivePositioning.details.uniqueMarketPosition <
    thresholds.competitivePositioning.uniqueMarketPosition
  ) {
    suggestions.push('🎯 突出独特定位：使用"L\'unica"、"The Only"等表述建立市场差异化')
  }
  if (
    competitivePositioning.details.competitiveComparison <
    thresholds.competitivePositioning.competitiveComparison
  ) {
    suggestions.push('🎯 暗示竞品对比：通过"Sostituisci il vecchio"等表述引导替换竞品')
  }
  if (
    competitivePositioning.details.valueEmphasis < thresholds.competitivePositioning.valueEmphasis
  ) {
    suggestions.push('🎯 强调性价比：使用"Rapporto Qualità-Prezzo"等表述增强价值感知')
  }

  // 非阻断：类型化文案意图建议
  if (copyIntentMetrics) {
    if (copyIntentMetrics.copyIntentCoverage < thresholds.copyIntent.coverage) {
      suggestions.push(
        `🧭 提升文案意图覆盖：当前${copyIntentMetrics.copyIntentCoverage}%（建议覆盖场景/解法/转化等不同表达）`
      )
    }

    if (copyIntentMetrics.typeIntentAlignmentScore < thresholds.copyIntent.alignment) {
      if (copyIntentMetrics.expectedBucket === 'A') {
        suggestions.push('🧭 A类型对齐不足：增加官方/可信/保障表达，减少过强场景或促销导向')
      } else if (copyIntentMetrics.expectedBucket === 'B') {
        suggestions.push('🧭 B类型对齐不足：增加“痛点→解法”表达，避免文案过度促销化')
      } else if (copyIntentMetrics.expectedBucket === 'D') {
        suggestions.push('🧭 D类型对齐不足：增强价值与行动号召表达（在证据允许范围内）')
      } else {
        suggestions.push(
          '🧭 文案意图对齐偏弱：建议按创意类型强化主导表达（A信任/B场景解法/D转化价值）'
        )
      }
    }
  }

  return suggestions
}
