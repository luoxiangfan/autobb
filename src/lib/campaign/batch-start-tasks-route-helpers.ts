import { NextRequest, NextResponse } from 'next/server'
import type { BatchStartTasksResult } from '@/lib/campaign/server'

export type BatchStartSelectionIdKind = 'offer' | 'campaign'

export type BatchStartTasksApiData = BatchStartTasksResult & {
  /* * 请求体中去重后的 ID 语义：Offer ID 或 Campaign ID */
  selectionIdKind: BatchStartSelectionIdKind
  /* * 请求体中去重后的 ID 个数 */
  requestedIdsCount: number
  /* * 数据库命中并参与批量处理的 Offer 行数 */
  matchedOfferCount: number
  /**
   * max(0, requestedIdsCount - matchedOfferCount)。
   * Offer：未命中库中可处理行的去重 ID 数量上界。
   * Campaign：去重系列数与 DISTINCT Offer 行数之差；多系列同 Offer 时会计入，仅作参考。
   */
  unmatchedIdsCount: number
  /* * 客户端可选传入，用于日志与排障 */
  clientRequestId?: string
}

/* * 将 JSON 中的开关规范为布尔，避免 `"false"` 被当成 true。 */
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

/**
 * 解析 POST JSON body；非法 JSON 或非对象返回 400，便于与业务错误区分。
 */
export async function parseBatchStartRequestBody(
  request: NextRequest
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '请求体须为合法 JSON', code: 'INVALID_JSON' },
        { status: 400 }
      ),
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '请求体须为 JSON 对象', code: 'INVALID_BODY' },
        { status: 400 }
      ),
    }
  }
  return { ok: true, body: raw as Record<string, unknown> }
}

function appendUnmatchedHint(
  message: string,
  unmatchedIdsCount: number,
  selectionIdKind: BatchStartSelectionIdKind
): string {
  if (unmatchedIdsCount <= 0) return message
  if (selectionIdKind === 'campaign') {
    return `${message}（约 ${unmatchedIdsCount} 个广告系列相关 ID 与批处理 Offer 行数不完全对应，可能含无效系列或多系列合并至同一 Offer）`
  }
  return `${message}（已跳过 ${unmatchedIdsCount} 个未命中的 Offer ID）`
}

export function buildBatchStartTasksApiData(
  result: BatchStartTasksResult,
  requestedIdsCount: number,
  matchedOfferCount: number,
  selectionIdKind: BatchStartSelectionIdKind,
  clientRequestId?: string
): BatchStartTasksApiData {
  const unmatchedIdsCount = Math.max(0, requestedIdsCount - matchedOfferCount)
  return {
    ...result,
    selectionIdKind,
    requestedIdsCount,
    matchedOfferCount,
    unmatchedIdsCount,
    ...(clientRequestId ? { clientRequestId } : {}),
  }
}

/* * 计算 HTTP status、对用户展示 message、以及带路由元数据的 data。 */
export function buildBatchStartTasksHttpParts(params: {
  result: BatchStartTasksResult
  requestedIdsCount: number
  matchedOfferCount: number
  selectionIdKind: BatchStartSelectionIdKind
  clientRequestId?: string
}): { status: number; message: string; data: BatchStartTasksApiData } {
  const { result, requestedIdsCount, matchedOfferCount, selectionIdKind, clientRequestId } = params
  const data = buildBatchStartTasksApiData(
    result,
    requestedIdsCount,
    matchedOfferCount,
    selectionIdKind,
    clientRequestId
  )
  const u = data.unmatchedIdsCount

  const completedClickFarm = result.clickFarmTasksCreated + result.clickFarmTasksUpdated
  const completedUrlSwap = result.urlSwapTasksCreated + result.urlSwapTasksUpdated

  const status = result.success ? 200 : result.partialSuccess ? 207 : 500
  let message: string
  if (result.success) {
    message = appendUnmatchedHint(
      `成功处理 ${completedClickFarm} 个补点击任务和 ${completedUrlSwap} 个换链接任务`,
      u,
      selectionIdKind
    )
  } else if (result.partialSuccess) {
    message = appendUnmatchedHint(
      `部分成功：已处理 ${completedClickFarm} 个补点击任务和 ${completedUrlSwap} 个换链接任务，失败 ${result.failedOfferCount} 个 Offer`,
      u,
      selectionIdKind
    )
  } else {
    message = appendUnmatchedHint('批量开启任务失败', u, selectionIdKind)
  }

  return { status, message, data }
}

export function logBatchStartTasksHttpOutcome(
  route: 'offers' | 'campaigns',
  userId: number,
  httpStatus: number,
  data: BatchStartTasksApiData
): void {
  const errorsPreview =
    (httpStatus === 207 || httpStatus === 500) && data.errors.length > 0
      ? data.errors.slice(0, 5).map((e) => ({
          offerId: e.offerId,
          type: e.type,
          error:
            typeof e.error === 'string' && e.error.length > 200
              ? `${e.error.slice(0, 200)}…`
              : e.error,
        }))
      : undefined

  const base: Record<string, unknown> = {
    clientRequestId: data.clientRequestId,
    selectionIdKind: data.selectionIdKind,
    requestedIdsCount: data.requestedIdsCount,
    matchedOfferCount: data.matchedOfferCount,
    unmatchedIdsCount: data.unmatchedIdsCount,
    partialSuccess: data.partialSuccess,
    failedOfferCount: data.failedOfferCount,
    failedOperationCount: data.errors.length,
  }
  if (errorsPreview) {
    base.errorsPreview = errorsPreview
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
