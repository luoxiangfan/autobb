import { getDatabase } from '@/lib/db'
import { pauseOfferTasksBatch } from '@/lib/campaign-offer-tasks'

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

export async function runCampaignPausedTaskCheck(
  pauseReason: string,
  pauseMessage: string
): Promise<CampaignPausedTaskCheckResult> {
  const db = await getDatabase()
  const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'

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
    return {
      summary: {
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
      },
      details: [],
    }
  }

  const userOfferMap = new Map<number, number[]>()
  for (const pair of pausedOfferPairs) {
    if (!userOfferMap.has(pair.user_id)) {
      userOfferMap.set(pair.user_id, [])
    }
    userOfferMap.get(pair.user_id)!.push(pair.offer_id)
  }

  const details: CampaignPausedTaskCheckUserResult[] = []
  let totalOffersAttempted = 0
  let totalOffersSucceeded = 0
  let totalOffersFailed = 0
  let totalOffersChanged = 0
  let totalOffersNoop = 0
  let totalClickFarmTasksPaused = 0
  let totalUrlSwapTasksDisabled = 0
  let totalErrors = 0

  for (const [userId, offerIdArray] of userOfferMap.entries()) {
    let userOffersAttempted = 0
    let userOffersSucceeded = 0
    let userOffersFailed = 0
    let userOffersChanged = 0
    let userOffersNoop = 0
    let userClickFarmPaused = 0
    let userUrlSwapDisabled = 0

    try {
      const batchResults = await pauseOfferTasksBatch(offerIdArray, userId, pauseReason, pauseMessage)

      for (const { result, error } of batchResults) {
        userOffersAttempted++
        if (error) {
          userOffersFailed++
          totalErrors++
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
      userOffersAttempted += offerIdArray.length
      userOffersFailed += offerIdArray.length
      totalErrors += offerIdArray.length
    }

    totalOffersAttempted += userOffersAttempted
    totalOffersSucceeded += userOffersSucceeded
    totalOffersFailed += userOffersFailed
    totalOffersChanged += userOffersChanged
    totalOffersNoop += userOffersNoop
    totalClickFarmTasksPaused += userClickFarmPaused
    totalUrlSwapTasksDisabled += userUrlSwapDisabled

    details.push({
      userId,
      offerIds: offerIdArray,
      offersAttempted: userOffersAttempted,
      offersSucceeded: userOffersSucceeded,
      offersFailed: userOffersFailed,
      offersChanged: userOffersChanged,
      offersNoop: userOffersNoop,
      clickFarmTasksPaused: userClickFarmPaused,
      urlSwapTasksDisabled: userUrlSwapDisabled,
    })
  }

  return {
    summary: {
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
    },
    details,
  }
}
