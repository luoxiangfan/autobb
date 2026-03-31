/**
 * Scrape 任务执行器
 *
 * 负责执行网页抓取任务，包括：
 * - 推广链接解析
 * - 网页抓取（Amazon Store/Product/独立站）
 * - AI分析
 * - 评论分析
 * - 竞品分析
 * - 广告元素提取
 *
 * 代理配置：
 * - 从用户设置中获取代理（基于 offer 的 target_country）
 * - 代理URL保存在 task.proxyConfig.originalUrl 中
 */

import type { Task, TaskExecutor } from '../types'
import { analyzeProxyError } from './proxy-error-handler'

/**
 * Scrape 任务数据接口
 */
export interface ScrapeTaskData {
  offerId: number
  url: string
  brand?: string
  target_country: string  // offer 的推广国家
  priority?: number       // 1-10，数字越大优先级越高（兼容旧系统）
}

/**
 * 创建 Scrape 任务执行器
 */
export function createScrapeExecutor(): TaskExecutor<ScrapeTaskData> {
  return async (task: Task<ScrapeTaskData>) => {
    const { offerId, url, brand } = task.data
    const userId = task.userId

    console.log(`🔍 [ScrapeExecutor] 开始抓取任务: Offer #${offerId}, URL: ${url}`)
    console.log(`   用户: ${userId}, 国家: ${task.data.target_country}`)

    // 获取代理URL（如果有配置）
    const proxyUrl = task.proxyConfig?.originalUrl
    if (proxyUrl) {
      console.log(`   代理: ${task.proxyConfig?.country || 'default'}`)
    } else {
      console.log(`   代理: 未配置`)
    }

    try {
      // 动态导入抓取核心模块（避免循环依赖）
      const { performScrapeAndAnalysis } = await import('@/lib/offer-scraping-core')

      // 执行抓取和分析
      // performScrapeAndAnalysis 内部会处理所有抓取逻辑
      // 包括：URL解析、网页抓取、AI分析、评论分析、竞品分析等
      await performScrapeAndAnalysis(offerId, userId, url, brand || '')

      console.log(`✅ [ScrapeExecutor] 抓取任务完成: Offer #${offerId}`)
    } catch (error: any) {
      const errorAnalysis = analyzeProxyError(error)
      const errorMessage = errorAnalysis.isProxyError
        ? errorAnalysis.enhancedMessage
        : error.message

      console.error(`❌ [ScrapeExecutor] 抓取任务失败: Offer #${offerId}`, errorMessage)

      // 更新 offer 状态为失败
      try {
        const { updateOfferScrapeStatus } = await import('@/lib/offers')
        await updateOfferScrapeStatus(offerId, userId, 'failed', errorMessage)
      } catch (updateError) {
        console.error(`   更新状态失败:`, updateError)
      }

      throw error
    }
  }
}

/**
 * 将旧的优先级数字（1-10）转换为新的优先级枚举
 *
 * 旧系统: 1-10，数字越大优先级越高
 * 新系统: 'high' | 'normal' | 'low'
 *
 * 转换规则:
 * - 8-10 → 'high'
 * - 4-7  → 'normal'
 * - 1-3  → 'low'
 */
export function convertPriorityToEnum(priority?: number): 'high' | 'normal' | 'low' {
  if (!priority) return 'normal'
  if (priority >= 8) return 'high'
  if (priority >= 4) return 'normal'
  return 'low'
}
