/**
 * 换链接任务调度器
 * src/lib/url-swap-scheduler.ts
 *
 * 功能：触发和管理换链接任务的执行
 * - 事件驱动：任务创建后立即触发调度
 * - Cron备份：每5分钟检查待处理任务
 */

import { calculateNextSwapAt } from './url-swap-time'
import { getPendingTasks, updateTaskStatus, setTaskError, getOfferById, getUrlSwapTaskById } from './url-swap'
import { shouldCompleteTask } from './click-farm/scheduler'
import { getProxyPool } from './url-resolver-enhanced'
import { initializeProxyPool } from './offer-utils'
import { getQueueManagerForTaskType } from './queue'
import type { UrlSwapTaskData, TriggerResult } from './url-swap-types'

/**
 * 触发所有待处理的换链接任务
 * 由外部Cron每5分钟调用
 */
export async function triggerAllUrlSwapTasks(): Promise<{
  processed: number;
  executed: number;
  skipped: number;
  errors: number;
}> {
  console.log('[url-swap-scheduler] 开始触发换链接任务')

  const tasks = await getPendingTasks()
  const results = { processed: 0, executed: 0, skipped: 0, errors: 0 }
  const queueManager = getQueueManagerForTaskType('url-swap')

  for (const task of tasks) {
    try {
      // 1. 检查是否应该完成（duration_days）
      if (shouldCompleteTask(task as any)) {
        await updateTaskStatus(task.id, 'completed')
        console.log(`[url-swap-scheduler] 任务已完成: ${task.id}`)
        results.skipped++
        continue
      }

      // 2. 代理验证（必须）- 检查Offer目标国家是否有代理
      const offer = await getOfferById(task.offer_id)
      if (!offer) {
        await setTaskError(task.id, '关联的Offer已删除')
        results.skipped++
        continue
      }

      const swapMode = task.swap_mode === 'manual' ? 'manual' : 'auto'
      if (swapMode === 'auto' || swapMode === 'manual') {
        // 确保代理池已按该用户的设置加载（否则可能误报“缺少代理配置”）
        try {
          await initializeProxyPool(task.user_id, offer.target_country)
        } catch (e: any) {
          await setTaskError(task.id, e?.message || `缺少 ${offer.target_country} 国家的代理配置`)
          results.skipped++
          continue
        }

        const proxyPool = getProxyPool(task.user_id)
        if (!proxyPool.hasProxyForCountry(offer.target_country)) {
          await setTaskError(task.id, `缺少 ${offer.target_country} 国家的代理配置`)
          results.skipped++
          continue
        }
      }

      // 3. 构建任务数据并加入队列
      const taskData: UrlSwapTaskData = {
        taskId: task.id,
        offerId: task.offer_id,
        affiliateLink: offer.affiliate_link || '',
        targetCountry: offer.target_country,
        googleCustomerId: task.google_customer_id,
        googleCampaignId: task.google_campaign_id,
        currentFinalUrl: task.current_final_url,
        currentFinalUrlSuffix: task.current_final_url_suffix,
      }

      await queueManager.enqueue('url-swap', taskData, task.user_id, {
        priority: 'normal',
        maxRetries: 0 // 单次失败不立刻重试，等待下个时间点再执行
      })

      // 4. 更新下次执行时间
      const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)
      await updateTaskStatus(task.id, 'enabled', nextSwapAt.toISOString())

      results.executed++
      console.log(`[url-swap-scheduler] 任务已入队: ${task.id}`)

    } catch (error: any) {
      console.error(`[url-swap-scheduler] 任务处理失败: ${task.id}`, error)
      results.errors++
    }

    results.processed++
  }

  console.log(`[url-swap-scheduler] 完成: processed=${results.processed}, executed=${results.executed}, skipped=${results.skipped}, errors=${results.errors}`)

  return results
}

/**
 * 任务创建时触发调度（事件驱动）
 * 用户创建任务后立即触发调度，而不是等待Cron
 */
export async function triggerUrlSwapScheduling(taskId: string): Promise<TriggerResult> {
  const task = await getUrlSwapTaskById(taskId, 0)  // 使用0避免权限检查
  if (!task) {
    return { taskId, status: 'error', message: '任务不存在' }
  }

  if (task.status !== 'enabled') {
    return { taskId, status: 'skipped', message: `任务状态为 ${task.status}` }
  }

  // 检查是否应该完成
  if (shouldCompleteTask(task as any)) {
    await updateTaskStatus(task.id, 'completed')
    return { taskId, status: 'completed', message: '任务已完成' }
  }

  // 代理验证
  const offer = await getOfferById(task.offer_id)
  if (!offer) {
    await setTaskError(task.id, '关联的Offer已删除')
    return { taskId, status: 'error', message: 'Offer不存在' }
  }

  const swapMode = task.swap_mode === 'manual' ? 'manual' : 'auto'
  if (swapMode === 'auto' || swapMode === 'manual') {
    // 确保代理池已按该用户的设置加载（否则可能误报“缺少代理配置”）
    try {
      await initializeProxyPool(task.user_id, offer.target_country)
    } catch (e: any) {
      await setTaskError(task.id, e?.message || `缺少 ${offer.target_country} 国家的代理配置`)
      return { taskId, status: 'error', message: '代理配置缺失' }
    }

    const proxyPool = getProxyPool(task.user_id)
    if (!proxyPool.hasProxyForCountry(offer.target_country)) {
      await setTaskError(task.id, `缺少 ${offer.target_country} 国家的代理配置`)
      return { taskId, status: 'error', message: '代理配置缺失' }
    }
  }

  // 复用统一队列入队
  const queueManager = getQueueManagerForTaskType('url-swap')
  const taskData: UrlSwapTaskData = {
    taskId: task.id,
    offerId: task.offer_id,
    affiliateLink: offer.affiliate_link || '',
    targetCountry: offer.target_country,
    googleCustomerId: task.google_customer_id,
    googleCampaignId: task.google_campaign_id,
    currentFinalUrl: task.current_final_url,
    currentFinalUrlSuffix: task.current_final_url_suffix,
  }

  await queueManager.enqueue('url-swap', taskData, task.user_id, {
    priority: 'normal',
    maxRetries: 0 // 单次失败不立刻重试，等待下个时间点再执行
  })

  // 更新下次执行时间
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)
  await updateTaskStatus(task.id, 'enabled', nextSwapAt.toISOString())

  console.log(`[url-swap-scheduler] 事件驱动调度成功: ${taskId}`)

  return { taskId, status: 'queued', message: '任务已加入队列' }
}
