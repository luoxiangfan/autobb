/**
 * 清理关键词，移除Google Ads不支持的特殊字符
 * 允许多语言字符：字母/数字(Unicode)、空格、下划线(_)、连字符(-)及少量常见标点
 */
export function sanitizeKeyword(keyword: string): string {
  const input = String(keyword ?? '')
  const cleaned = input.replace(/[\p{C}]/gu, ' ').replace(/[^\p{L}\p{M}\p{N}\s_.&'+-]/gu, '')

  const normalized = cleaned.replace(/\s+/g, ' ').trim()
  return normalized.replace(/^[-_]+|[-_]+$/g, '').trim()
}

export const GOOGLE_ADS_KEYWORD_MAX_WORDS = 10
export const GOOGLE_ADS_KEYWORD_MAX_LENGTH = 80

/**
 * 标准化关键词并应用Google Ads关键词限制
 * 最多10个单词
 * 最多80个字符
 */
export function sanitizeKeywordForGoogleAds(keyword: string): {
  text: string
  wasSanitized: boolean
  truncatedByWordLimit: boolean
  truncatedByCharLimit: boolean
  originalWordCount: number
} {
  const originalInput = String(keyword ?? '')
  const sanitized = sanitizeKeyword(originalInput)

  if (!sanitized) {
    return {
      text: '',
      wasSanitized: originalInput.trim().length > 0,
      truncatedByWordLimit: false,
      truncatedByCharLimit: false,
      originalWordCount: 0,
    }
  }

  const words = sanitized.split(/\s+/).filter(Boolean)
  const originalWordCount = words.length
  let limitedText = sanitized
  let truncatedByWordLimit = false
  let truncatedByCharLimit = false

  if (words.length > GOOGLE_ADS_KEYWORD_MAX_WORDS) {
    limitedText = words.slice(0, GOOGLE_ADS_KEYWORD_MAX_WORDS).join(' ')
    truncatedByWordLimit = true
  }

  if (limitedText.length > GOOGLE_ADS_KEYWORD_MAX_LENGTH) {
    const sliced = limitedText.slice(0, GOOGLE_ADS_KEYWORD_MAX_LENGTH)
    const truncatedAtWordBoundary = sliced.replace(/\s+\S*$/, '').trim()
    limitedText = (truncatedAtWordBoundary || sliced).trim()
    truncatedByCharLimit = true
  }

  limitedText = limitedText.replace(/\s+/g, ' ').trim()

  return {
    text: limitedText,
    wasSanitized: limitedText !== originalInput.trim(),
    truncatedByWordLimit,
    truncatedByCharLimit,
    originalWordCount,
  }
}
