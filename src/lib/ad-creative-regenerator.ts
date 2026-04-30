/**
 * 广告创意重新生成器
 * 
 * 功能：
 * 1. 使用 AI 基于 Offer 重新生成广告创意
 * 2. 保存新生成的广告创意
 * 3. 返回新的广告创意 ID 和 campaign_config
 */

import { getDatabase } from './db'
import { createAdCreative } from './ad-creative'
import { generateAdCreative } from './ad-creative-generator'

/**
 * 重新生成广告创意结果
 */
export interface RegenerateAdCreativeResult {
  success: boolean
  adCreativeId?: number
  campaignConfig?: any
  error?: string
}

/**
 * 重新生成广告创意参数
 */
export interface RegenerateAdCreativeParams {
  userId: number
  offerId: number
  previousAdCreativeId: number
  campaignConfigForTask: Record<string, any>  // 来自任务的 campaignConfig，包含原始的创意元素等信息
}

/**
 * 重新生成广告创意
 * 
 * @param params 参数
 * @returns 重新生成结果
 */
export async function regenerateAdCreative(
  params: RegenerateAdCreativeParams
): Promise<RegenerateAdCreativeResult> {
  const { userId, offerId, previousAdCreativeId, campaignConfigForTask } = params
  const db = await getDatabase()

  try {
    // 1. 获取 Offer 信息
    const offer = await db.queryOne(`
      SELECT id, brand, offer_name, target_country, url, category, final_url_suffix
      FROM offers
      WHERE id = ? AND user_id = ?
    `, [offerId, userId]) as any

    if (!offer) {
      return {
        success: false,
        error: 'Offer 不存在或无权访问',
      }
    }

    // 2. 使用 AI 重新生成广告创意
    console.log(`[Ad Creative Regenerator] Generating new creative for offer ${offerId}`)
    
    const generatedCreative = await generateAdCreative(
      offerId,
      userId,
      {
        skipCache: true,  // 重新生成，不使用缓存
      }
    )

    if (!generatedCreative) {
      console.error(`[Ad Creative Regenerator] Generation failed`)
      return {
        success: false,
        error: '广告创意生成失败',
      }
    }

    // 3. 保存新生成的广告创意到数据库
    console.log(`[Ad Creative Regenerator] Saving new creative to database...`)
    
    const newCreative = await createAdCreative(
      userId,
      offerId,
      {
        ...generatedCreative,
        final_url: offer.url,
        final_url_suffix: offer.final_url_suffix || '',
      }
    )

    if (!newCreative || !newCreative.id) {
      console.error(`[Ad Creative Regenerator] Save failed`)
      return {
        success: false,
        error: '广告创意保存失败',
      }
    }

    console.log(`[Ad Creative Regenerator] New creative saved with ID: ${newCreative.id}`)

    // 4. 构建 campaign_config
    const campaignConfig = {
      ...campaignConfigForTask,  // 保留原有的 campaignConfig 配置
      headlines: generatedCreative.headlines || [],
      descriptions: generatedCreative.descriptions || [],
      keywords: generatedCreative.keywords || [],
      callouts: generatedCreative.callouts || [],
      sitelinks: generatedCreative.sitelinks || [],
    }

    return {
      success: true,
      adCreativeId: newCreative.id,
      campaignConfig,
    }
  } catch (error: any) {
    console.error('[Ad Creative Regenerator] Error:', error)
    return {
      success: false,
      error: error.message || '广告创意重新生成失败',
    }
  }
}
