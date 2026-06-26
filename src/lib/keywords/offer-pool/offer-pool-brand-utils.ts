/**
 * 纯品牌词识别与分离
 */

import { logger } from '@/lib/common/server'
import { getPureBrandKeywords, isPureBrandKeyword } from '../server'
export function inferDefaultKeywordMatchType(
  keyword: string,
  pureBrandKeywords: string[]
): 'EXACT' | 'PHRASE' {
  return isPureBrandKeyword(keyword, pureBrandKeywords) ? 'EXACT' : 'PHRASE'
}

/**
 * 分离纯品牌词和非品牌词
 *
 * @param keywords - 所有关键词列表
 * @param brandName - 品牌名称
 * @returns 分离结果：纯品牌词 + 非品牌词
 */
export function separateBrandKeywords(
  keywords: string[],
  brandName: string
): { brandKeywords: string[]; nonBrandKeywords: string[] } {
  const brandKeywords: string[] = []
  const nonBrandKeywords: string[] = []
  const pureBrandKeywords = getPureBrandKeywords(brandName)

  for (const keyword of keywords) {
    if (isPureBrandKeyword(keyword, pureBrandKeywords)) {
      brandKeywords.push(keyword)
    } else {
      nonBrandKeywords.push(keyword)
    }
  }

  logger.debug(
    `🏷️ 纯品牌词分离: ${brandKeywords.length} 个纯品牌词, ${nonBrandKeywords.length} 个非品牌词`
  )
  logger.debug(`   纯品牌词: ${brandKeywords.join(', ') || '(无)'}`)

  return { brandKeywords, nonBrandKeywords }
}
