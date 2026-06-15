import {
  BATCH_URL_SWAP_TASK_DEFAULTS,
  getBatchClickFarmRuntimeConfig,
  isClickFarmTaskUsingBatchDefaults,
  isUrlSwapTaskUsingBatchDefaults,
} from '@/lib/campaign'
import {
  createClickFarmTask,
  getClickFarmTaskByOfferId,
  restartClickFarmTask,
  updateClickFarmTask,
} from '@/lib/click-farm'
import {
  createUrlSwapTask,
  enableUrlSwapTask,
  getUrlSwapTaskByOfferId,
  updateUrlSwapTask,
} from '@/lib/url-swap'

export interface BatchStartOfferTarget {
  offerId: number
  targetCountry?: string | null
}

export interface BatchStartTasksInput {
  userId: number
  offers: BatchStartOfferTarget[]
  enableClickFarm: boolean
  enableUrlSwap: boolean
  now?: Date
  concurrency?: number
}

export interface BatchStartTasksErrorItem {
  offerId: number
  type: 'clickFarm' | 'urlSwap' | 'general'
  error: string
}

export interface BatchStartTasksResult {
  success: boolean
  partialSuccess: boolean
  /** 本批传入 `batchStartTasksForOffers` 的 Offer 数量（通常等于路由层的 matchedOfferCount） */
  requestedCount: number
  processedOfferCount: number
  failedOfferCount: number
  failedItemsByType: {
    clickFarm: number
    urlSwap: number
    general: number
  }
  clickFarmTasksCreated: number
  clickFarmTasksUpdated: number
  urlSwapTasksCreated: number
  urlSwapTasksUpdated: number
  errors: BatchStartTasksErrorItem[]
}

const DEFAULT_CONCURRENCY = 8
const MIN_CONCURRENCY = 1
const MAX_CONCURRENCY = 32

type MutableResult = Omit<BatchStartTasksResult, 'success' | 'partialSuccess'> & {
  _failedOfferIds: Set<number>
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '未知错误'
}

export function resolveBatchStartTasksConcurrency(rawValue?: string): number {
  const value = Number(rawValue)
  if (!Number.isFinite(value) || value < MIN_CONCURRENCY) {
    return DEFAULT_CONCURRENCY
  }
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.floor(value)))
}

async function processOffer(
  input: BatchStartTasksInput,
  offer: BatchStartOfferTarget,
  result: MutableResult
): Promise<void> {
  const now = input.now || new Date()
  const clickFarmConfig = getBatchClickFarmRuntimeConfig(offer, now)

  const urlSwapConfig = {
    swapMode: BATCH_URL_SWAP_TASK_DEFAULTS.swapMode,
    swapIntervalMinutes: BATCH_URL_SWAP_TASK_DEFAULTS.swapIntervalMinutes,
    durationDays: BATCH_URL_SWAP_TASK_DEFAULTS.durationDays,
  }

  let hasError = false

  if (input.enableClickFarm) {
    try {
      const existingTask = await getClickFarmTaskByOfferId(offer.offerId, input.userId)

      if (existingTask) {
        if (existingTask.status === 'running' && isClickFarmTaskUsingBatchDefaults(existingTask)) {
          // 已在运行且配置为批量默认参数，无需重复写入
        } else if (existingTask.status === 'completed') {
          await createClickFarmTask(input.userId, {
            offer_id: offer.offerId,
            daily_click_count: clickFarmConfig.dailyClickCount,
            start_time: clickFarmConfig.startTime,
            end_time: clickFarmConfig.endTime,
            duration_days: clickFarmConfig.durationDays,
            scheduled_start_date: clickFarmConfig.scheduledStartDate,
            hourly_distribution: clickFarmConfig.hourlyDistribution,
            timezone: clickFarmConfig.timezone,
            referer_config: clickFarmConfig.refererConfig,
          })
          result.clickFarmTasksCreated++
        } else {
          await updateClickFarmTask(existingTask.id, input.userId, {
            daily_click_count: clickFarmConfig.dailyClickCount,
            start_time: clickFarmConfig.startTime,
            end_time: clickFarmConfig.endTime,
            duration_days: clickFarmConfig.durationDays,
            scheduled_start_date: clickFarmConfig.scheduledStartDate,
            hourly_distribution: clickFarmConfig.hourlyDistribution,
            timezone: clickFarmConfig.timezone,
            referer_config: clickFarmConfig.refererConfig,
          })
          if (
            existingTask.status === 'paused' ||
            existingTask.status === 'stopped' ||
            existingTask.status === 'pending'
          ) {
            await restartClickFarmTask(existingTask.id, input.userId)
          }
          result.clickFarmTasksUpdated++
        }
      } else {
        await createClickFarmTask(input.userId, {
          offer_id: offer.offerId,
          daily_click_count: clickFarmConfig.dailyClickCount,
          start_time: clickFarmConfig.startTime,
          end_time: clickFarmConfig.endTime,
          duration_days: clickFarmConfig.durationDays,
          scheduled_start_date: clickFarmConfig.scheduledStartDate,
          hourly_distribution: clickFarmConfig.hourlyDistribution,
          timezone: clickFarmConfig.timezone,
          referer_config: clickFarmConfig.refererConfig,
        })
        result.clickFarmTasksCreated++
      }
    } catch (error: unknown) {
      hasError = true
      result.errors.push({
        offerId: offer.offerId,
        type: 'clickFarm',
        error: resolveErrorMessage(error),
      })
    }
  }

  if (input.enableUrlSwap) {
    try {
      const existingTask = await getUrlSwapTaskByOfferId(offer.offerId, input.userId)

      if (existingTask) {
        if (existingTask.status === 'enabled' && isUrlSwapTaskUsingBatchDefaults(existingTask)) {
          // 已启用且配置为批量默认参数，无需重复写入
        } else if (existingTask.status === 'completed') {
          await createUrlSwapTask(input.userId, {
            offer_id: offer.offerId,
            swap_mode: urlSwapConfig.swapMode,
            swap_interval_minutes: urlSwapConfig.swapIntervalMinutes,
            duration_days: urlSwapConfig.durationDays,
          })
          result.urlSwapTasksCreated++
        } else {
          await updateUrlSwapTask(existingTask.id, input.userId, {
            swap_interval_minutes: urlSwapConfig.swapIntervalMinutes,
            duration_days: urlSwapConfig.durationDays,
          })
          if (existingTask.status !== 'enabled') {
            await enableUrlSwapTask(existingTask.id, input.userId)
          }
          result.urlSwapTasksUpdated++
        }
      } else {
        await createUrlSwapTask(input.userId, {
          offer_id: offer.offerId,
          swap_mode: urlSwapConfig.swapMode,
          swap_interval_minutes: urlSwapConfig.swapIntervalMinutes,
          duration_days: urlSwapConfig.durationDays,
        })
        result.urlSwapTasksCreated++
      }
    } catch (error: unknown) {
      hasError = true
      result.errors.push({
        offerId: offer.offerId,
        type: 'urlSwap',
        error: resolveErrorMessage(error),
      })
    }
  }

  if (hasError) {
    result._failedOfferIds.add(offer.offerId)
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  let nextIndex = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return
        await worker(items[index])
      }
    }
  )

  await Promise.all(workers)
}

export async function batchStartTasksForOffers(
  input: BatchStartTasksInput
): Promise<BatchStartTasksResult> {
  const result: MutableResult = {
    requestedCount: input.offers.length,
    processedOfferCount: 0,
    failedOfferCount: 0,
    failedItemsByType: {
      clickFarm: 0,
      urlSwap: 0,
      general: 0,
    },
    clickFarmTasksCreated: 0,
    clickFarmTasksUpdated: 0,
    urlSwapTasksCreated: 0,
    urlSwapTasksUpdated: 0,
    errors: [],
    _failedOfferIds: new Set<number>(),
  }

  await runWithConcurrency(
    input.offers,
    input.concurrency ??
      resolveBatchStartTasksConcurrency(process.env.BATCH_START_TASKS_CONCURRENCY),
    async (offer) => {
      try {
        await processOffer(input, offer, result)
      } catch (error: unknown) {
        result.errors.push({
          offerId: offer.offerId,
          type: 'general',
          error: resolveErrorMessage(error),
        })
        result._failedOfferIds.add(offer.offerId)
      } finally {
        result.processedOfferCount++
      }
    }
  )

  result.failedOfferCount = result._failedOfferIds.size
  const hasAnySuccess =
    result.clickFarmTasksCreated +
      result.clickFarmTasksUpdated +
      result.urlSwapTasksCreated +
      result.urlSwapTasksUpdated >
    0
  const hasAnyFailure = result.errors.length > 0
  const partialSuccess = hasAnySuccess && hasAnyFailure
  const success = hasAnySuccess && !hasAnyFailure
  const failedItemsByType = { clickFarm: 0, urlSwap: 0, general: 0 }
  for (const item of result.errors) {
    if (item.type === 'clickFarm') failedItemsByType.clickFarm += 1
    else if (item.type === 'urlSwap') failedItemsByType.urlSwap += 1
    else failedItemsByType.general += 1
  }

  return {
    success,
    partialSuccess,
    requestedCount: result.requestedCount,
    processedOfferCount: result.processedOfferCount,
    failedOfferCount: result.failedOfferCount,
    failedItemsByType,
    clickFarmTasksCreated: result.clickFarmTasksCreated,
    clickFarmTasksUpdated: result.clickFarmTasksUpdated,
    urlSwapTasksCreated: result.urlSwapTasksCreated,
    urlSwapTasksUpdated: result.urlSwapTasksUpdated,
    errors: result.errors,
  }
}
