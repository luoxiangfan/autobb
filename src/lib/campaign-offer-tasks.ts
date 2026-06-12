/**
 * 广告系列启停时同步处理关联 Offer 的补点击和换链接任务
 *
 * 用于：
 * 1. 暂停：广告系列状态修改为暂停时即时触发
 * 2. 启用：广告系列恢复投放时，按默认参数恢复/创建任务（复用 batch-start-tasks）
 * 3. 定时任务批量检测暂停的广告系列
 */

import { batchStartTasksForOffers, type BatchStartTasksResult } from './batch-start-tasks'
import { getDatabase } from './db'
import { removePendingClickFarmQueueTasksByTaskIds } from './click-farm/queue-cleanup'
import { removePendingUrlSwapQueueTasksByTaskIds } from './url-swap/queue-cleanup'

const DEFAULT_PAUSE_BATCH_CONCURRENCY = 3
const DEV_DEFAULT_PAUSE_BATCH_CONCURRENCY = 2
const MIN_PAUSE_BATCH_CONCURRENCY = 1
const MAX_PAUSE_BATCH_CONCURRENCY = 10

function resolvePauseBatchConcurrency(): number {
  const envDefault =
    process.env.NODE_ENV === 'development'
      ? DEV_DEFAULT_PAUSE_BATCH_CONCURRENCY
      : DEFAULT_PAUSE_BATCH_CONCURRENCY
  const rawValue = process.env.PAUSE_OFFER_TASKS_BATCH_CONCURRENCY
  if (rawValue === undefined || rawValue.trim() === '') {
    return envDefault
  }
  const raw = Number(rawValue)
  if (!Number.isFinite(raw)) return envDefault
  const normalized = Math.floor(raw)
  return Math.min(MAX_PAUSE_BATCH_CONCURRENCY, Math.max(MIN_PAUSE_BATCH_CONCURRENCY, normalized))
}

function normalizeUpdatedTaskIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((left, right) => left.localeCompare(right))
}

export interface PauseOfferTasksResult {
  clickFarmTaskPaused: boolean
  clickFarmTaskId?: string
  clickFarmTaskCount: number
  urlSwapTaskDisabled: boolean
  urlSwapTaskId?: string
  urlSwapTaskCount: number
}

export type ResumeOfferTasksResult = Pick<
  BatchStartTasksResult,
  | 'clickFarmTasksCreated'
  | 'clickFarmTasksUpdated'
  | 'urlSwapTasksCreated'
  | 'urlSwapTasksUpdated'
  | 'errors'
  | 'success'
  | 'partialSuccess'
>

/** 供批处理与测试替换实现的入口（避免 ESM 内部直接绑定导致 spy 无效） */
export const campaignOfferTaskActions: {
  pauseOfferTasks: (
    offerId: number,
    userId: number,
    pauseReason?: string,
    pauseMessage?: string
  ) => Promise<PauseOfferTasksResult>
  resumeOfferTasksOnCampaignEnable: (
    offerId: number,
    userId: number
  ) => Promise<ResumeOfferTasksResult>
} = {
  pauseOfferTasks: async () => {
    throw new Error('campaignOfferTaskActions.pauseOfferTasks is not initialized')
  },
  resumeOfferTasksOnCampaignEnable: async () => {
    throw new Error('campaignOfferTaskActions.resumeOfferTasksOnCampaignEnable is not initialized')
  },
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

  const pausedCondition = 'NOW()'
  const isDeletedFalse = 'FALSE'
  let updatedClickFarmTaskIds: string[] = []
  let updatedUrlSwapTaskIds: string[] = []
  let clickFarmUpdatedCount = 0
  let urlSwapUpdatedCount = 0

  // 统一事务内完成查询与状态更新，避免并发下读写窗口不一致
  await db.transaction(async () => {
    // 1) 暂停补点击任务
    const updatedClickFarmRows = await db.query<{ id: string }>(
      `
        UPDATE click_farm_tasks
        SET status = 'stopped',
            pause_reason = ?,
            pause_message = ?,
            paused_at = ${pausedCondition},
            updated_at = ${pausedCondition}
        WHERE user_id = ? AND offer_id = ? AND is_deleted = ${isDeletedFalse}
          AND status IN ('pending', 'running', 'paused')
        RETURNING id
      `,
      [pauseReason, pauseMessage, userId, offerId]
    )
    updatedClickFarmTaskIds.push(...updatedClickFarmRows.map((row) => String(row.id)))
    clickFarmUpdatedCount = updatedClickFarmRows.length
    result.clickFarmTaskPaused = clickFarmUpdatedCount > 0
    updatedClickFarmTaskIds = normalizeUpdatedTaskIds(updatedClickFarmTaskIds)
    if (updatedClickFarmTaskIds.length > 0) {
      result.clickFarmTaskId = updatedClickFarmTaskIds[0]
    }
    result.clickFarmTaskCount = clickFarmUpdatedCount

    // 2) 禁用换链接任务（仅处理可暂停态，避免触碰 completed 历史任务）
    const updatedUrlSwapRows = await db.query<{ id: string }>(
      `
        UPDATE url_swap_tasks
        SET status = 'disabled',
            updated_at = ${pausedCondition}
        WHERE user_id = ? AND offer_id = ? AND is_deleted = ${isDeletedFalse}
          AND status IN ('enabled', 'error')
        RETURNING id
      `,
      [userId, offerId]
    )
    updatedUrlSwapTaskIds.push(...updatedUrlSwapRows.map((row) => String(row.id)))
    urlSwapUpdatedCount = updatedUrlSwapRows.length
    result.urlSwapTaskDisabled = urlSwapUpdatedCount > 0
    updatedUrlSwapTaskIds = normalizeUpdatedTaskIds(updatedUrlSwapTaskIds)
    if (updatedUrlSwapTaskIds.length > 0) {
      result.urlSwapTaskId = updatedUrlSwapTaskIds[0]
    }
    result.urlSwapTaskCount = urlSwapUpdatedCount
  })

  // 提交后清理队列，避免事务内执行外部副作用导致锁占用过长
  if (updatedClickFarmTaskIds.length > 0) {
    try {
      await removePendingClickFarmQueueTasksByTaskIds(updatedClickFarmTaskIds, userId)
    } catch (error: any) {
      console.warn(
        `[pauseOfferTasks] 清理补点击队列失败 (offerId=${offerId}):`,
        error?.message || error
      )
    }
    console.log(
      `[pauseOfferTasks] 已暂停补点击任务 (offerId=${offerId}, taskCount=${result.clickFarmTaskCount})`
    )
  }

  if (updatedUrlSwapTaskIds.length > 0) {
    try {
      await removePendingUrlSwapQueueTasksByTaskIds(updatedUrlSwapTaskIds, userId)
    } catch (error: any) {
      console.warn(
        `[pauseOfferTasks] 清理换链接队列失败 (offerId=${offerId}):`,
        error?.message || error
      )
    }
    console.log(
      `[pauseOfferTasks] 已禁用换链接任务 (offerId=${offerId}, taskCount=${result.urlSwapTaskCount})`
    )
  }

  return result
}

campaignOfferTaskActions.pauseOfferTasks = pauseOfferTasks

/**
 * 启用广告系列时，按批量开启任务的默认参数恢复或创建关联 Offer 任务。
 * - 任务仍存在：更新为默认参数并 restart/enable（调度器会重新入队）
 * - 任务不存在或已完成：使用默认参数新建
 */
export async function resumeOfferTasksOnCampaignEnable(
  offerId: number,
  userId: number
): Promise<ResumeOfferTasksResult> {
  const db = await getDatabase()
  const isDeletedFalse = 'FALSE'
  const offerRow = await db.queryOne<{ target_country: string | null }>(
    `
    SELECT target_country
    FROM offers
    WHERE id = ? AND user_id = ? AND is_deleted = ${isDeletedFalse}
    LIMIT 1
  `,
    [offerId, userId]
  )

  const batchResult = await batchStartTasksForOffers({
    userId,
    offers: [{ offerId, targetCountry: offerRow?.target_country ?? null }],
    enableClickFarm: true,
    enableUrlSwap: true,
  })

  return {
    success: batchResult.success,
    partialSuccess: batchResult.partialSuccess,
    clickFarmTasksCreated: batchResult.clickFarmTasksCreated,
    clickFarmTasksUpdated: batchResult.clickFarmTasksUpdated,
    urlSwapTasksCreated: batchResult.urlSwapTasksCreated,
    urlSwapTasksUpdated: batchResult.urlSwapTasksUpdated,
    errors: batchResult.errors,
  }
}

campaignOfferTaskActions.resumeOfferTasksOnCampaignEnable = resumeOfferTasksOnCampaignEnable

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
  const results: Array<{ offerId: number; result: PauseOfferTasksResult; error?: string }> =
    new Array(offerIds.length)
  let nextIndex = 0
  const configuredConcurrency = resolvePauseBatchConcurrency()
  const workerCount = Math.max(1, Math.min(configuredConcurrency, offerIds.length))

  const worker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= offerIds.length) break

      const offerId = offerIds[index]
      try {
        const result = await campaignOfferTaskActions.pauseOfferTasks(
          offerId,
          userId,
          pauseReason,
          pauseMessage
        )
        results[index] = { offerId, result }
      } catch (error: any) {
        const message = error?.message || String(error)
        console.error(`[pauseOfferTasksBatch] 处理 offer ${offerId} 失败:`, message)
        results[index] = {
          offerId,
          result: {
            clickFarmTaskPaused: false,
            clickFarmTaskCount: 0,
            urlSwapTaskDisabled: false,
            urlSwapTaskCount: 0,
          },
          error: message,
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results
}
