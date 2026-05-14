/**
 * 暂停广告系列关联 Offer 的补点击和换链接任务
 *
 * 用于：
 * 1. 广告系列状态修改为暂停时即时触发
 * 2. 定时任务批量检测暂停的广告系列
 */

import { getDatabase } from './db'
import { removePendingClickFarmQueueTasksByTaskIds } from './click-farm/queue-cleanup'
import { removePendingUrlSwapQueueTasksByTaskIds } from './url-swap/queue-cleanup'

const MAX_IDS_PER_UPDATE_BATCH = 200

function chunkIds(ids: string[], size: number): string[][] {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size))
  }
  return chunks
}

export interface PauseOfferTasksResult {
  clickFarmTaskPaused: boolean
  clickFarmTaskId?: string
  clickFarmTaskCount: number
  urlSwapTaskDisabled: boolean
  urlSwapTaskId?: string
  urlSwapTaskCount: number
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
    clickFarmTaskCount: 0,
    urlSwapTaskDisabled: false,
    urlSwapTaskCount: 0,
  }

  const pausedCondition = db.type === 'postgres' ? 'NOW()' : 'datetime("now")'
  const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'
  let clickFarmTaskIds: string[] = []
  let urlSwapTaskIds: string[] = []

  // 统一事务内完成查询与状态更新，避免并发下读写窗口不一致
  await db.transaction(async () => {
    // 1) 批量暂停补点击任务（避免只暂停最新一条造成遗漏）
    const clickFarmTasks = await db.query<{ id: string }>(`
      SELECT id FROM click_farm_tasks
      WHERE offer_id = ? AND user_id = ? AND is_deleted = ${isDeletedFalse}
        AND status IN ('pending', 'running', 'paused')
    `, [offerId, userId])
    clickFarmTaskIds = clickFarmTasks.map((task) => String(task.id))

    if (clickFarmTaskIds.length > 0) {
      for (const batchIds of chunkIds(clickFarmTaskIds, MAX_IDS_PER_UPDATE_BATCH)) {
        const clickFarmIdPlaceholders = batchIds.map(() => '?').join(', ')
        await db.exec(`
          UPDATE click_farm_tasks
          SET status = 'stopped',
              pause_reason = ?,
              pause_message = ?,
              paused_at = ${pausedCondition},
              updated_at = ${pausedCondition}
          WHERE user_id = ? AND offer_id = ? AND is_deleted = ${isDeletedFalse}
            AND status IN ('pending', 'running', 'paused')
            AND id IN (${clickFarmIdPlaceholders})
        `, [pauseReason, pauseMessage, userId, offerId, ...batchIds])
      }

      result.clickFarmTaskPaused = true
      result.clickFarmTaskId = clickFarmTaskIds[0]
      result.clickFarmTaskCount = clickFarmTaskIds.length
    }

    // 2) 批量禁用换链接任务（仅处理可暂停态，避免触碰 completed 历史任务）
    const urlSwapTasks = await db.query<{ id: string }>(`
      SELECT id FROM url_swap_tasks
      WHERE offer_id = ? AND user_id = ? AND is_deleted = ${isDeletedFalse}
        AND status IN ('enabled', 'error')
    `, [offerId, userId])
    urlSwapTaskIds = urlSwapTasks.map((task) => String(task.id))

    if (urlSwapTaskIds.length > 0) {
      for (const batchIds of chunkIds(urlSwapTaskIds, MAX_IDS_PER_UPDATE_BATCH)) {
        const urlSwapIdPlaceholders = batchIds.map(() => '?').join(', ')
        await db.exec(`
          UPDATE url_swap_tasks
          SET status = 'disabled',
              updated_at = ${pausedCondition}
          WHERE user_id = ? AND offer_id = ? AND is_deleted = ${isDeletedFalse}
            AND status IN ('enabled', 'error')
            AND id IN (${urlSwapIdPlaceholders})
        `, [userId, offerId, ...batchIds])
      }

      result.urlSwapTaskDisabled = true
      result.urlSwapTaskId = urlSwapTaskIds[0]
      result.urlSwapTaskCount = urlSwapTaskIds.length
    }
  })

  // 提交后清理队列，避免事务内执行外部副作用导致锁占用过长
  if (clickFarmTaskIds.length > 0) {
    try {
      await removePendingClickFarmQueueTasksByTaskIds(clickFarmTaskIds, userId)
    } catch (error: any) {
      console.warn(`[pauseOfferTasks] 清理补点击队列失败 (offerId=${offerId}):`, error?.message || error)
    }
    console.log(`[pauseOfferTasks] 已暂停补点击任务 (offerId=${offerId}, taskCount=${clickFarmTaskIds.length})`)
  }

  if (urlSwapTaskIds.length > 0) {
    try {
      await removePendingUrlSwapQueueTasksByTaskIds(urlSwapTaskIds, userId)
    } catch (error: any) {
      console.warn(`[pauseOfferTasks] 清理换链接队列失败 (offerId=${offerId}):`, error?.message || error)
    }
    console.log(`[pauseOfferTasks] 已禁用换链接任务 (offerId=${offerId}, taskCount=${urlSwapTaskIds.length})`)
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
): Promise<Array<{ offerId: number; result: PauseOfferTasksResult; error?: string }>> {
  const results: Array<{ offerId: number; result: PauseOfferTasksResult; error?: string }> = []

  for (const offerId of offerIds) {
    try {
      const result = await pauseOfferTasks(offerId, userId, pauseReason, pauseMessage)
      results.push({ offerId, result })
    } catch (error: any) {
      const message = error?.message || String(error)
      console.error(`[pauseOfferTasksBatch] 处理 offer ${offerId} 失败:`, message)
      results.push({
        offerId,
        result: {
          clickFarmTaskPaused: false,
          clickFarmTaskCount: 0,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        },
        error: message,
      })
    }
  }

  return results
}
