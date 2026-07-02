import { normalizeLanguageCode } from '@/lib/common/server'
import type { Offer } from '@/lib/offers/server'

function getLanguageCode(language: string): string {
  return normalizeLanguageCode(language)
}

/**
 * 从Offer中提取特性列表
 */
function extractFeaturesFromOffer(offer: Offer): string[] {
  const features: string[] = []

  // 尝试从产品名称提取型号信息
  if (offer.product_name) {
    // 提取型号信息，如 "J15 Pro", "E20S" 等
    const modelMatch = offer.product_name.match(/([A-Z]\d{2}[A-Z]?)/)
    if (modelMatch) {
      features.push(modelMatch[1])
    }

    // 提取常见功能词
    const featureWords = ['wireless', 'smart', 'automatic', 'rechargeable', 'portable']
    for (const word of featureWords) {
      if (offer.product_name.toLowerCase().includes(word)) {
        features.push(word)
      }
    }
  }

  return [...new Set(features)].slice(0, 5)
}

/**
 * 从Offer中提取使用场景
 */
function extractUseCasesFromOffer(offer: Offer): string[] {
  const useCases: string[] = []

  if (offer.category) {
    useCases.push(offer.category)
  }

  // 尝试从产品名称或品牌描述中提取
  const textToSearch = `${offer.product_name || ''} ${offer.brand_description || ''}`

  if (textToSearch) {
    const useCasePatterns = [
      /home (security|monitoring|protection)/gi,
      /indoor (use|monitoring)/gi,
      /outdoor (use|security)/gi,
      /pet (monitoring|care)/gi,
      /baby (monitoring|care)/gi,
    ]

    for (const pattern of useCasePatterns) {
      const matches = textToSearch.match(pattern)
      if (matches) {
        useCases.push(...matches)
      }
    }
  }

  return [...new Set(useCases)].slice(0, 3)
}

/**
 * 从Offer中提取目标受众
 */
function extractAudienceFromOffer(offer: Offer): string[] {
  const audiences: string[] = []

  if (offer.target_audience) {
    // 从target_audience字段提取
    const parsed = JSON.parse(offer.target_audience)
    if (Array.isArray(parsed)) {
      audiences.push(...parsed)
    }
  }

  // 默认受众
  if (audiences.length === 0) {
    audiences.push('homeowners', 'tech-savvy users', 'security-conscious consumers')
  }

  return audiences.slice(0, 3)
}

/**
 * 从Offer中提取竞品（简单实现）
 */
function extractCompetitorsFromOffer(offer: Offer): string[] {
  // 尝试从竞品分析中提取
  if (offer.competitor_analysis) {
    try {
      const parsed = JSON.parse(offer.competitor_analysis)
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 5)
      }
    } catch {
      // 解析失败，返回空数组
    }
  }

  return []
}

export {
  getLanguageCode,
  extractFeaturesFromOffer,
  extractUseCasesFromOffer,
  extractAudienceFromOffer,
  extractCompetitorsFromOffer,
}
