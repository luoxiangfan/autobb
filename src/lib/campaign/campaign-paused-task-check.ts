import { getDatabase } from '@/lib/db'
import { pauseOfferTasksBatch } from '@/lib/campaign/server'

interface PausedCampaignOfferPair {
  user_id: number
  offer_id: number
  total_paused_campaigns: number | string
}

export interface CampaignPausedTaskCheckUserResult {
  userId: number
  offerIds: number[]
  offersAttempted: number
  offersSucceeded: number
  offersFailed: number
  offersChanged: number
  offersNoop: number
  clickFarmTasksPaused: number
  urlSwapTasksDisabled: number
}

export interface CampaignPausedTaskCheckSummary {
  totalPausedCampaigns: number
  totalPausedOfferPairs: number
  totalOffersProcessed: number
  totalOffersAttempted: number
  totalOffersSucceeded: number
  totalOffersFailed: number
  totalOffersChanged: number
  totalOffersNoop: number
  clickFarmTasksPaused: number
  urlSwapTasksDisabled: number
  errors: number
}

export interface CampaignPausedTaskCheckResult {
  summary: CampaignPausedTaskCheckSummary
  details: CampaignPausedTaskCheckUserResult[]
}

interface UserOfferBatch {
  userId: number
  offerIds: number[]
}

/** 用户级并发默认硬上限（可用 QUEUE_CAMPAIGN_PAUSED_USER_CONCURRENCY_MAX 覆盖） */
const DEFAULT_USER_CONCURRENCY_CAP = 16

function parsePositiveIntEnv(rawValue: string | undefined, defaultValue: number): number {
  if (!rawValue) return defaultValue
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
  return parsed
}

function getUserConcurrencySettings(): {
  requested: number
  cap: number
  effective: number
} {
  const cap = Math.max(
    1,
    parsePositiveIntEnv(
      process.env.QUEUE_CAMPAIGN_PAUSED_USER_CONCURRENCY_MAX,
      DEFAULT_USER_CONCURRENCY_CAP
    )
  )
  const requested = parsePositiveIntEnv(process.env.QUEUE_CAMPAIGN_PAUSED_USER_CONCURRENCY, 3)
  return { requested, cap, effective: Math.min(requested, cap) }
}

function logCampaignPausedTaskCheckComplete(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: 'campaign_paused_task_check_complete', ...payload }))
}

async function processUserOfferBatch(
  batch: UserOfferBatch,
  pauseReason: string,
  pauseMessage: string
): Promise<CampaignPausedTaskCheckUserResult> {
  const { userId, offerIds } = batch
  let userOffersAttempted = 0
  let userOffersSucceeded = 0
  let userOffersFailed = 0
  let userOffersChanged = 0
  let userOffersNoop = 0
  let userClickFarmPaused = 0
  let userUrlSwapDisabled = 0

  try {
    const batchResults = await pauseOfferTasksBatch(offerIds, userId, pauseReason, pauseMessage)

    for (const { result, error } of batchResults) {
      userOffersAttempted++
      if (error) {
        userOffersFailed++
      } else {
        userOffersSucceeded++
        if (result.clickFarmTaskPaused || result.urlSwapTaskDisabled) {
          userOffersChanged++
        } else {
          userOffersNoop++
        }
      }

      if (result.clickFarmTaskPaused) userClickFarmPaused++
      if (result.urlSwapTaskDisabled) userUrlSwapDisabled++
    }
  } catch (error: any) {
    const message = error?.message || String(error)
    console.error(`[runCampaignPausedTaskCheck] 用户 ${userId} 批处理失败:`, message)
    userOffersAttempted += offerIds.length
    userOffersFailed += offerIds.length
  }

  return {
    userId,
    offerIds,
    offersAttempted: userOffersAttempted,
    offersSucceeded: userOffersSucceeded,
    offersFailed: userOffersFailed,
    offersChanged: userOffersChanged,
    offersNoop: userOffersNoop,
    clickFarmTasksPaused: userClickFarmPaused,
    urlSwapTasksDisabled: userUrlSwapDisabled,
  }
}

export async function runCampaignPausedTaskCheck(
  pauseReason: string,
  pauseMessage: string
): Promise<CampaignPausedTaskCheckResult> {
  const checkStartedAt = Date.now()
  const db = await getDatabase()
  const isDeletedFalse = 'FALSE'

  const pausedOfferPairs = await db.query<PausedCampaignOfferPair>(`
    WITH paused_campaigns AS (
      SELECT c.user_id, c.offer_id
      FROM campaigns c
      WHERE c.status = 'PAUSED'
        AND c.is_deleted = ${isDeletedFalse}
        AND c.offer_id IS NOT NULL
    ),
    paused_campaign_totals AS (
      SELECT COUNT(*) AS total_paused_campaigns
      FROM paused_campaigns
    )
    SELECT DISTINCT
      p.user_id,
      p.offer_id,
      t.total_paused_campaigns
    FROM paused_campaigns p
    CROSS JOIN paused_campaign_totals t
    ORDER BY p.user_id, p.offer_id
  `)
  const totalPausedCampaigns = Number(pausedOfferPairs[0]?.total_paused_campaigns ?? 0)

  if (pausedOfferPairs.length === 0) {
    const summary: CampaignPausedTaskCheckSummary = {
      totalPausedCampaigns,
      totalPausedOfferPairs: 0,
      totalOffersProcessed: 0,
      totalOffersAttempted: 0,
      totalOffersSucceeded: 0,
      totalOffersFailed: 0,
      totalOffersChanged: 0,
      totalOffersNoop: 0,
      clickFarmTasksPaused: 0,
      urlSwapTasksDisabled: 0,
      errors: 0,
    }
    const concurrency = getUserConcurrencySettings()
    logCampaignPausedTaskCheckComplete({
      durationMs: Date.now() - checkStartedAt,
      userBatchCount: 0,
      activeUserConcurrency: 0,
      requestedUserConcurrency: concurrency.requested,
      userConcurrencyCap: concurrency.cap,
      effectiveUserConcurrency: concurrency.effective,
      summary,
    })
    return {
      summary,
      details: [],
    }
  }

  const userBatches: UserOfferBatch[] = []
  for (const pair of pausedOfferPairs) {
    const lastBatch = userBatches[userBatches.length - 1]
    if (!lastBatch || lastBatch.userId !== pair.user_id) {
      userBatches.push({
        userId: pair.user_id,
        offerIds: [pair.offer_id],
      })
    } else {
      lastBatch.offerIds.push(pair.offer_id)
    }
  }

  const details = new Array<CampaignPausedTaskCheckUserResult>(userBatches.length)
  const concurrency = getUserConcurrencySettings()
  const maxUserConcurrency = concurrency.effective

  let nextBatchIndex = 0
  const workers = Array.from(
    { length: Math.min(maxUserConcurrency, userBatches.length) },
    async () => {
      while (true) {
        const index = nextBatchIndex
        nextBatchIndex += 1
        if (index >= userBatches.length) return

        const userResult = await processUserOfferBatch(
          userBatches[index],
          pauseReason,
          pauseMessage
        )
        details[index] = userResult
      }
    }
  )
  await Promise.all(workers)

  let totalOffersAttempted = 0
  let totalOffersSucceeded = 0
  let totalOffersFailed = 0
  let totalOffersChanged = 0
  let totalOffersNoop = 0
  let totalClickFarmTasksPaused = 0
  let totalUrlSwapTasksDisabled = 0
  let totalErrors = 0

  for (const userResult of details) {
    totalOffersAttempted += userResult.offersAttempted
    totalOffersSucceeded += userResult.offersSucceeded
    totalOffersFailed += userResult.offersFailed
    totalOffersChanged += userResult.offersChanged
    totalOffersNoop += userResult.offersNoop
    totalClickFarmTasksPaused += userResult.clickFarmTasksPaused
    totalUrlSwapTasksDisabled += userResult.urlSwapTasksDisabled
    totalErrors += userResult.offersFailed
  }

  const summary: CampaignPausedTaskCheckSummary = {
    totalPausedCampaigns,
    totalPausedOfferPairs: pausedOfferPairs.length,
    // 兼容历史字段语义：processed = attempted
    totalOffersProcessed: totalOffersAttempted,
    totalOffersAttempted,
    totalOffersSucceeded,
    totalOffersFailed,
    totalOffersChanged,
    totalOffersNoop,
    clickFarmTasksPaused: totalClickFarmTasksPaused,
    urlSwapTasksDisabled: totalUrlSwapTasksDisabled,
    errors: totalErrors,
  }

  logCampaignPausedTaskCheckComplete({
    durationMs: Date.now() - checkStartedAt,
    userBatchCount: userBatches.length,
    activeUserConcurrency: Math.min(maxUserConcurrency, userBatches.length),
    requestedUserConcurrency: concurrency.requested,
    userConcurrencyCap: concurrency.cap,
    effectiveUserConcurrency: concurrency.effective,
    summary,
  })

  return {
    summary,
    details,
  }
}
