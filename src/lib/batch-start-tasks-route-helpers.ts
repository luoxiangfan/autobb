import type { BatchStartTasksResult } from '@/lib/batch-start-tasks'

export type BatchStartTasksApiData = BatchStartTasksResult & {
  /** 请求体中去重后的 ID 个数（Offer ID 或 Campaign ID，取决于路由） */
  requestedIdsCount: number
  /** 数据库命中并参与批量处理的 Offer 行数 */
  matchedOfferCount: number
  /** 客户端可选传入，用于日志与排障 */
  clientRequestId?: string
}

export function normalizeBatchStartClientRequestId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  return trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed
}

export function buildBatchStartTasksApiData(
  result: BatchStartTasksResult,
  requestedIdsCount: number,
  matchedOfferCount: number,
  clientRequestId?: string
): BatchStartTasksApiData {
  return {
    ...result,
    requestedIdsCount,
    matchedOfferCount,
    ...(clientRequestId ? { clientRequestId } : {}),
  }
}

export function logBatchStartTasksHttpOutcome(
  route: 'offers' | 'campaigns',
  userId: number,
  httpStatus: number,
  fields: Record<string, unknown>
): void {
  if (httpStatus !== 207 && httpStatus !== 500) return
  console.warn(
    '[batch-start-tasks]',
    JSON.stringify({
      event: 'batch_start_tasks_http',
      route,
      userId,
      httpStatus,
      ts: new Date().toISOString(),
      ...fields,
    })
  )
}
