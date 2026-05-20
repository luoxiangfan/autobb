/**
 * @deprecated Scrape 任务执行器 — 已收敛至 offer-extraction。
 * 遗留 scrape 任务在当前 worker 内联执行提取，避免再入队第二条任务。
 */

import type { Task, TaskExecutor } from '../types'
import { analyzeProxyError } from './proxy-error-handler'

export interface ScrapeTaskData {
  offerId: number
  url: string
  brand?: string
  target_country: string
  priority?: number
}

export function createScrapeExecutor(): TaskExecutor<ScrapeTaskData> {
  return async (task: Task<ScrapeTaskData>) => {
    const { offerId, url, brand } = task.data
    const userId = task.userId

    console.warn(
      `⚠️ [DEPRECATED] scrape executor: Offer #${offerId} inline offer-extraction (task ${task.id})`
    )

    try {
      const { findOfferById, updateOfferScrapeStatus } = await import('@/lib/offers')
      const {
        buildExtractionTaskParamsFromOffer,
        createOfferExtractionTaskForExistingOffer,
      } = await import('@/lib/offer-extraction-task')

      const offer = await findOfferById(offerId, userId)
      if (!offer) {
        throw new Error('Offer不存在或无权访问')
      }

      const {
        validateExistingOfferForExtraction,
        resolveValidatedTargetCountry,
      } = await import('@/lib/offer-extract-request')
      const prerequisites = validateExistingOfferForExtraction(offer)
      const affiliateLink = prerequisites.affiliateLink
      const rawTaskCountry = (task.data.target_country || '').trim()
      const targetCountry = rawTaskCountry
        ? resolveValidatedTargetCountry(rawTaskCountry)
        : prerequisites.targetCountry

      // 遗留内联 scrape：校验通过后设 queued，再执行内联提取（executeOfferExtraction 会推进 in_progress）
      await updateOfferScrapeStatus(offerId, userId, 'queued')

      await createOfferExtractionTaskForExistingOffer({
        ...buildExtractionTaskParamsFromOffer(offer, {
          userId,
          offerId,
          affiliateLink,
          targetCountry,
          brandName: brand || offer.brand || undefined,
          skipCache: true,
          skipWarmup: false,
          taskId: task.id,
          runInline: true,
        }),
      })

      console.log(`✅ [ScrapeExecutor] 内联提取完成: Offer #${offerId}`)
    } catch (error: any) {
      const errorAnalysis = analyzeProxyError(error)
      const errorMessage = errorAnalysis.isProxyError
        ? errorAnalysis.enhancedMessage
        : error.message

      console.error(`❌ [ScrapeExecutor] 提取失败: Offer #${offerId}`, errorMessage)

      try {
        const { updateOfferScrapeStatus } = await import('@/lib/offers')
        await updateOfferScrapeStatus(offerId, userId, 'failed', errorMessage)
      } catch (updateError) {
        console.error('   更新状态失败:', updateError)
      }

      throw error
    }
  }
}

export function convertPriorityToEnum(priority?: number): 'high' | 'normal' | 'low' {
  if (!priority) return 'normal'
  if (priority >= 8) return 'high'
  if (priority >= 4) return 'normal'
  return 'low'
}
