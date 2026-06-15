import type { HeadlineAsset, DescriptionAsset } from '../..'
import { MULTILINGUAL_CTA_WORDS, MULTILINGUAL_URGENCY_WORDS } from '../lexicons'
import { resolveLanguageKey, containsLocalizedPhrase } from '../keyword-matching'
import { calculateDifferentiation } from './differentiation'

export function calculateQuality(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  brandName?: string,
  productData?: any, // 产品数据（用于USP分析）
  targetLanguage?: string
) {
  const languageKey = resolveLanguageKey(targetLanguage)

  // 4.1 数字使用 (0-4分) - 降低权重，从5分改为4分
  const headlinesWithNumbers = headlines.filter((h) => h.hasNumber || /\d/.test(h.text)).length
  const numberUsage = Math.min(4, (headlinesWithNumbers / 3) * 4) // 至少3个含数字得满分

  // 4.2 CTA存在 (0-4分) - 降低权重，从5分改为4分
  const descriptionsWithCTA = descriptions.filter(
    (d) => d.hasCTA || containsLocalizedPhrase(d.text, MULTILINGUAL_CTA_WORDS, languageKey)
  ).length
  const ctaPresence = Math.min(4, (descriptionsWithCTA / 2) * 4) // 至少2个含CTA得满分

  // 4.3 紧迫感表达 (0-3分) - 降低权重，从5分改为3分
  const headlinesWithUrgency = headlines.filter(
    (h) => h.hasUrgency || containsLocalizedPhrase(h.text, MULTILINGUAL_URGENCY_WORDS, languageKey)
  ).length
  const urgencyExpression = Math.min(3, (headlinesWithUrgency / 2) * 3) // 至少2个含紧迫感得满分

  // 4.4 差异化表达 (0-4分) - 新增维度
  const differentiation = calculateDifferentiation(headlines, descriptions, brandName, productData)

  const totalScore = numberUsage + ctaPresence + urgencyExpression + differentiation

  console.log(`📊 Quality子维度:`)
  console.log(`   - 数字使用: ${numberUsage.toFixed(1)}/4 (${headlinesWithNumbers}个标题含数字)`)
  console.log(`   - CTA存在: ${ctaPresence.toFixed(1)}/4 (${descriptionsWithCTA}个描述含CTA)`)
  console.log(
    `   - 紧迫感: ${urgencyExpression.toFixed(1)}/3 (${headlinesWithUrgency}个标题含紧迫感)`
  )
  console.log(`   - 差异化: ${differentiation.toFixed(1)}/4`)

  return {
    score: Math.min(15, Math.round(totalScore)), // 确保不超过最大值15
    weight: 0.15 as const,
    details: {
      numberUsage: Math.round(numberUsage * 10) / 10,
      ctaPresence: Math.round(ctaPresence * 10) / 10,
      urgencyExpression: Math.round(urgencyExpression * 10) / 10,
      differentiation: Math.round(differentiation * 10) / 10,
    },
  }
}
