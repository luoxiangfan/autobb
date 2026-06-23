/**
 * 关键词生成器 v2.0 (精简版)
 *
 * 正向关键词请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()
 */
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

  console.log(`📋 生成否定关键词（10类固定模板，覆盖全场景）`)
  console.log(`   品牌: ${offer.brand}`)
  console.log(`   类别: ${offer.category || '未分类'}`)
  console.log(`   语言: ${targetLanguage}`)

  const negatives = buildNegativeKeywordTemplateList(targetLanguage)
  const dedupedNegatives = dedupeNegativeKeywords(negatives)

  console.log(`✅ 生成 ${dedupedNegatives.length} 个否定关键词（10类全覆盖，零维护）`)
  console.log(`   - 1. 低价值搜索: 9个`)
  console.log(`   - 2. 信息查询: 10个`)
  console.log(`   - 3. 招聘/工作: 7个`)
  console.log(`   - 4. 二手/维修: 8个`)
  console.log(`   - 5. 竞品比较: 11个`)
  console.log(`   - 6. 不相关产品: 4个`)
  console.log(`   - 7. 低价搜索: 7个`)
  console.log(`   - 8. DIY/自制: 5个`)
  console.log(`   - 9. 下载/虚拟: 7个`)
  console.log(`   - 10. 地域/渠道: 6个`)
  console.log(`   - 多语言词: ${Math.max(dedupedNegatives.length - 74, 0)}个`)
  if (dedupedNegatives.length !== negatives.length) {
    console.log(`   - 去重移除: ${negatives.length - dedupedNegatives.length}个`)
  }

  return dedupedNegatives
}
