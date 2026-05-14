import type { BatchStartTasksResult } from '@/lib/batch-start-tasks'

export type BatchStartTasksApiData = BatchStartTasksResult & {
  /** 请求体中去重后的 ID 个数（Offer ID 或 Campaign ID，取决于路由） */
  requestedIdsCount: number
  /** 数据库命中并参与批量处理的 Offer 行数 */
  matchedOfferCount: number
  /**
   * max(0, requestedIdsCount - matchedOfferCount)。
   * Offer 路由：可理解为去重后请求里未命中库中可处理 Offer 的数量上界。
   * Campaign 路由：选中系列数与 DISTINCT 到的 Offer 行数之差；多系列指向同一 Offer 时会被计入，仅作提示。
   */
  unmatchedIdsCount: number
  /** 客户端可选传入，用于日志与排障 */
  clientRequestId?: string
}

/** 将 JSON 中的开关规范为布尔，避免 `"false"` 被当成 true。 */
export function coerceBatchStartTaskFlag(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    if (s === 'false' || s === '0' || s === '') return false
    if (s === 'true' || s === '1') return true
    return defaultValue
  }
  if (value === false || value === null || value === 0) return false
  if (value === true || value === 1) return true
  return defaultValue
}

export function normalizeBatchStartClientRequestId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  return trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed
}

function appendUnmatchedHint(message: string, unmatchedIdsCount: number): string {
  if (unmatchedIdsCount <= 0) return message
  return `${message}（已跳过 ${unmatchedIdsCount} 个未命中的请求 ID）`
}

export function buildBatchStartTasksApiData(
  result: BatchStartTasksResult,
  requestedIdsCount: number,
  matchedOfferCount: number,
  clientRequestId?: string
): BatchStartTasksApiData {
  const unmatchedIdsCount = Math.max(0, requestedIdsCount - matchedOfferCount)
  return {
    ...result,
    requestedIdsCount,
    matchedOfferCount,
    unmatchedIdsCount,
    ...(clientRequestId ? { clientRequestId } : {}),
  }
}

/** 计算 HTTP status、对用户展示 message、以及带路由元数据的 data。 */
export function buildBatchStartTasksHttpParts(params: {
  result: BatchStartTasksResult
  requestedIdsCount: number
  matchedOfferCount: number
  clientRequestId?: string
}): { status: number; message: string; data: BatchStartTasksApiData } {
  const { result, requestedIdsCount, matchedOfferCount, clientRequestId } = params
  const data = buildBatchStartTasksApiData(result, requestedIdsCount, matchedOfferCount, clientRequestId)
  const u = data.unmatchedIdsCount

  const completedClickFarm = result.clickFarmTasksCreated + result.clickFarmTasksUpdated
  const completedUrlSwap = result.urlSwapTasksCreated + result.urlSwapTasksUpdated

  const status = result.success ? 200 : result.partialSuccess ? 207 : 500
  let message: string
  if (result.success) {
    message = appendUnmatchedHint(
      `成功处理 ${completedClickFarm} 个补点击任务和 ${completedUrlSwap} 个换链接任务`,
      u
    )
  } else if (result.partialSuccess) {
    message = appendUnmatchedHint(
      `部分成功：已处理 ${completedClickFarm} 个补点击任务和 ${completedUrlSwap} 个换链接任务，失败 ${result.failedOfferCount} 个 Offer`,
      u
    )
  } else {
    message = appendUnmatchedHint('批量开启任务失败', u)
  }

  return { status, message, data }
}

export function logBatchStartTasksHttpOutcome(
  route: 'offers' | 'campaigns',
  userId: number,
  httpStatus: number,
  data: BatchStartTasksApiData
): void {
  const base = {
    clientRequestId: data.clientRequestId,
    requestedIdsCount: data.requestedIdsCount,
    matchedOfferCount: data.matchedOfferCount,
    unmatchedIdsCount: data.unmatchedIdsCount,
    partialSuccess: data.partialSuccess,
    failedOfferCount: data.failedOfferCount,
    failedOperationCount: data.errors.length,
  }
  if (httpStatus === 207 || httpStatus === 500) {
    console.warn(
      '[batch-start-tasks]',
      JSON.stringify({
        event: 'batch_start_tasks_http',
        route,
        userId,
        httpStatus,
        ts: new Date().toISOString(),
        ...base,
      })
    )
  }
  if (httpStatus === 200 && data.unmatchedIdsCount > 0) {
    console.info(
      '[batch-start-tasks]',
      JSON.stringify({
        event: 'batch_start_tasks_skipped_ids',
        route,
        userId,
        httpStatus,
        ts: new Date().toISOString(),
        ...base,
      })
    )
  }
}
