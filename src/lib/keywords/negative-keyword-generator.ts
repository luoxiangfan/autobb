/**
 * 否定关键词生成：固定模板 + 多语言扩展。
 * 正向关键词请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()。
 */
import { logger } from '@/lib/common/server'
import type { Offer } from '../offers/server'
import {
  buildNegativeKeywordTemplateList,
  dedupeNegativeKeywords,
} from './negative-keyword-templates'

/**
 * 生成否定关键词（10 类固定模板 + 多语言扩展）
 */
export async function generateNegativeKeywords(offer: Offer, _userId: number): Promise<string[]> {
  const targetLanguage = (offer.target_language || 'English').toLowerCase()

  logger.debug(`📋 生成否定关键词（10类固定模板，覆盖全场景）`)
  logger.debug(`   品牌: ${offer.brand}`)
  logger.debug(`   类别: ${offer.category || '未分类'}`)
  logger.debug(`   语言: ${targetLanguage}`)

  const negatives = buildNegativeKeywordTemplateList(targetLanguage)
  const dedupedNegatives = dedupeNegativeKeywords(negatives)

  logger.debug(`✅ 生成 ${dedupedNegatives.length} 个否定关键词（10类全覆盖，零维护）`)
  logger.debug(`   - 1. 低价值搜索: 9个`)
  logger.debug(`   - 2. 信息查询: 10个`)
  logger.debug(`   - 3. 招聘/工作: 7个`)
  logger.debug(`   - 4. 二手/维修: 8个`)
  logger.debug(`   - 5. 竞品比较: 11个`)
  logger.debug(`   - 6. 不相关产品: 4个`)
  logger.debug(`   - 7. 低价搜索: 7个`)
  logger.debug(`   - 8. DIY/自制: 5个`)
  logger.debug(`   - 9. 下载/虚拟: 7个`)
  logger.debug(`   - 10. 地域/渠道: 6个`)
  logger.debug(`   - 多语言词: ${Math.max(dedupedNegatives.length - 74, 0)}个`)
  if (dedupedNegatives.length !== negatives.length) {
    logger.debug(`   - 去重移除: ${negatives.length - dedupedNegatives.length}个`)
  }

  return dedupedNegatives
}
