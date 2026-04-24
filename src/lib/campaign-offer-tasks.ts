/**
 * 暂停广告系列关联 Offer 的补点击和换链接任务
 *
 * 用于：
 * 1. 广告系列状态修改为暂停时即时触发
 * 2. 定时任务批量检测暂停的广告系列
 */

import { getDatabase } from './db'

export interface PauseOfferTasksResult {
  clickFarmTaskPaused: boolean
  clickFarmTaskId?: number
  urlSwapTaskDisabled: boolean
  urlSwapTaskId?: number
}

/**
 * 暂停指定 offer 的补点击和换链接任务
 */
export async function pauseOfferTasks(
  offerId: number,
  userId: number,
  pauseReason: string = 'campaign_paused',
  pauseMessage: string = '关联广告系列已暂停，自动暂停任务'
): Promise<PauseOfferTasksResult> {
  const db = await getDatabase()
  const result: PauseOfferTasksResult = {
    clickFarmTaskPaused: false,
    urlSwapTaskDisabled: false,
  }

  const pausedCondition = db.type === 'postgres' ? 'NOW()' : 'datetime("now")'

  // 1. 暂停补点击任务
  const clickFarmTask = await db.queryOne<any>(`
    SELECT id, status FROM click_farm_tasks
    WHERE offer_id = ? AND user_id = ? AND is_deleted = 0
    ORDER BY created_at DESC
    LIMIT 1
  `, [offerId, userId])

  if (clickFarmTask && ['pending', 'running', 'paused'].includes(clickFarmTask.status)) {
    await db.exec(`
      UPDATE click_farm_tasks
      SET status = 'stopped', 
          pause_reason = ?, 
          pause_message = ?, 
          paused_at = ${pausedCondition}
      WHERE id = ? AND user_id = ?
    `, [pauseReason, pauseMessage, clickFarmTask.id, userId])
    
    result.clickFarmTaskPaused = true
    result.clickFarmTaskId = clickFarmTask.id
    console.log(`[pauseOfferTasks] 已暂停补点击任务 (offerId=${offerId}, taskId=${clickFarmTask.id})`)
  }

  // 2. 禁用换链接任务
  const urlSwapTask = await db.queryOne<any>(`
    SELECT id, status FROM url_swap_tasks
    WHERE offer_id = ? AND user_id = ? AND is_deleted = 0
    ORDER BY created_at DESC
    LIMIT 1
  `, [offerId, userId])

  if (urlSwapTask && urlSwapTask.status !== 'disabled') {
    await db.exec(`
      UPDATE url_swap_tasks
      SET status = 'disabled', 
          disabled_at = ${pausedCondition}
      WHERE id = ? AND user_id = ?
    `, [urlSwapTask.id, userId])
    
    result.urlSwapTaskDisabled = true
    result.urlSwapTaskId = urlSwapTask.id
    console.log(`[pauseOfferTasks] 已禁用换链接任务 (offerId=${offerId}, taskId=${urlSwapTask.id})`)
  }

  return result
}

/**
 * 批量暂停多个 offer 的任务
 * 用于定时任务批量处理
 */
export async function pauseOfferTasksBatch(
  offerIds: number[],
  userId: number,
  pauseReason: string = 'campaign_paused_batch',
  pauseMessage: string = '关联广告系列已暂停，自动暂停任务'
): Promise<Array<{ offerId: number; result: PauseOfferTasksResult }>> {
  const results: Array<{ offerId: number; result: PauseOfferTasksResult }> = []

  for (const offerId of offerIds) {
    try {
      const result = await pauseOfferTasks(offerId, userId, pauseReason, pauseMessage)
      results.push({ offerId, result })
    } catch (error: any) {
      console.error(`[pauseOfferTasksBatch] 处理 offer ${offerId} 失败:`, error)
      results.push({
        offerId,
        result: { clickFarmTaskPaused: false, urlSwapTaskDisabled: false },
      })
    }
  }

  return results
}
