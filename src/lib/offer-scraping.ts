/**
 * Offer抓取触发器
 * 使用统一队列系统，支持 Redis优先+内存回退架构
 *
 * 🔥 重构优化：迁移到统一队列系统
 * 🚀 新特性：
 *  - Redis优先 + 内存回退
 *  - 代理IP池管理（按需加载用户配置）
 *  - 三层并发控制（全局/用户/类型）
 *  - 自动任务恢复
 */

import { updateOfferScrapeStatus } from './offers'
import { getQueueManager } from './queue/unified-queue-manager'
import type { TaskPriority } from './queue/types'

/**
 * 🎯 优先级转换: 10-scale → TaskPriority
 * 将旧的 1-10 优先级转换为新队列系统的高/中/低优先级
 */
function convertPriority(priority: number): TaskPriority {
  if (priority >= 8) return 'high'
  if (priority >= 4) return 'normal'
  return 'low'
}

/**
 * Offer抓取任务数据结构
 */
interface ScrapeTaskData {
  offerId: number
  userId: number
  url: string
  brand: string  // 品牌名称（字符串类型）
  target_country: string // 目标国家
}

/**
 * 🎯 Offer抓取优先级枚举（保持向后兼容）
 * 用于区分不同场景的重要性，优化用户体验
 */
export enum OfferScrapingPriority {
  URGENT = 10,        // 用户手动创建（立即需要，最高优先级）
  HIGH = 7,           // SSE流式创建（用户等待中）
  NORMAL = 5,         // 默认优先级
  LOW = 3,            // 批量导入（后台慢慢处理）
  BACKGROUND = 1      // 定期重新抓取或系统任务
}

/**
 * 触发Offer抓取（异步，不阻塞）
 *
 * 使用统一队列系统，会立即返回 taskId
 * 🚀 新队列系统特性：
 *  - Redis优先 + 内存回退
 *  - 按需加载用户代理配置
 *  - 三层并发控制
 *  - 自动任务恢复
 *
 * @param offerId Offer ID
 * @param userId User ID
 * @param url 要抓取的URL
 * @param brand 品牌名称
 * @param targetCountry 目标国家
 * @param priority 优先级（1-10，数字越大优先级越高，默认5）
 * @returns Promise<string> 任务ID，可用于查询队列状态
 */
export async function triggerOfferScraping(
  offerId: number,
  userId: number,
  url: string,
  brand: string,  // 字符串类型
  targetCountry: string,
  priority: number = OfferScrapingPriority.NORMAL
): Promise<string> {
  console.log(`[OfferScraping] 🚀 触发异步抓取 Offer #${offerId}`)
  console.log(`[OfferScraping] URL: ${url}, Brand: ${brand}, Country: ${targetCountry}, UserId: ${userId}, Priority: ${priority}`)

  // 立即更新状态为 queued（已入队）
  updateOfferScrapeStatus(offerId, userId, 'queued')
  console.log(`[OfferScraping] 状态已更新为 queued（已入队等待处理）`)

  try {
    // 🚀 获取统一队列管理器
    const queueManager = getQueueManager()

    // 转换优先级到新格式
    const taskPriority = convertPriority(priority)

    // 构建任务数据
    const taskData: ScrapeTaskData = {
      offerId,
      userId,
      url,
      brand,
      target_country: targetCountry
    }

    console.log(`[OfferScraping] 📥 添加到统一队列: Offer #${offerId}, Priority: ${taskPriority}`)

    // 添加到统一队列（scrape 任务需要代理）
    const taskId = await queueManager.enqueue<ScrapeTaskData>(
      'scrape',
      taskData,
      userId,
      {
        priority: taskPriority,
        requireProxy: true,  // 🔥 scrape 任务需要代理IP
        maxRetries: 3
      }
    )

    console.log(`[OfferScraping] ✅ 任务已入队: ${taskId} (Offer #${offerId})`)
    console.log(`[OfferScraping] 代理配置：按需从用户设置加载`)

    return taskId
  } catch (error: any) {
    console.error(`[OfferScraping] ❌ 入队失败 Offer #${offerId}:`, error.message)

    // 更新状态为失败
    try {
      updateOfferScrapeStatus(offerId, userId, 'failed', `队列失败: ${error.message}`)
      console.log(`[OfferScraping] 已更新Offer #${offerId}状态为failed`)
    } catch (updateError: any) {
      console.error(`[OfferScraping] ⚠️  更新失败状态时出错:`, updateError.message)
    }

    throw error
  }
}
