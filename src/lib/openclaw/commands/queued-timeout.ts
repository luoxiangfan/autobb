import type { DatabaseAdapter } from '@/lib/db'
import { nowFunc } from '@/lib/db-helpers'

const OPENCLAW_QUEUED_STALE_SECONDS_DEFAULT = 15 * 60
const OPENCLAW_QUEUED_STALE_SECONDS_MIN = 60
const OPENCLAW_QUEUED_STALE_SECONDS_MAX = 24 * 60 * 60

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export function getOpenclawQueuedStaleSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_QUEUED_STALE_SECONDS)
  if (!Number.isFinite(envValue)) {
    return OPENCLAW_QUEUED_STALE_SECONDS_DEFAULT
  }
  return clamp(
    envValue,
    OPENCLAW_QUEUED_STALE_SECONDS_MIN,
    OPENCLAW_QUEUED_STALE_SECONDS_MAX
  )
}

export async function failStaleQueuedCommandRuns(params: {
  db: Pick<DatabaseAdapter, 'type' | 'exec'>
  userId?: number
  staleSeconds?: number
}): Promise<number> {
  const db = params.db
  const staleSeconds = clamp(
    Number(params.staleSeconds ?? getOpenclawQueuedStaleSeconds()),
    OPENCLAW_QUEUED_STALE_SECONDS_MIN,
    OPENCLAW_QUEUED_STALE_SECONDS_MAX
  )
  const nowSql = nowFunc(db.type)
  const staleMessage = `队列任务超过 ${staleSeconds}s 未开始执行，系统已自动标记失败，请重试`
  const staleCondition = db.type === 'postgres'
    ? `created_at <= (${nowSql} - (? * INTERVAL '1 second'))`
    : `created_at <= datetime('now', '-' || ? || ' seconds')`

  const hasUserScope = Number.isFinite(Number(params.userId))
  const userFilterSql = hasUserScope ? 'AND user_id = ?' : ''
  const queryParams: any[] = [staleMessage, staleSeconds]
  if (hasUserScope) {
    queryParams.push(Number(params.userId))
  }

  const result = await db.exec(
    `UPDATE openclaw_command_runs
     SET status = 'failed',
         response_status = COALESCE(response_status, 504),
         error_message = CASE
           WHEN error_message IS NULL OR TRIM(error_message) = '' THEN ?
           ELSE error_message
         END,
         completed_at = ${nowSql},
         updated_at = ${nowSql}
     WHERE status = 'queued'
       AND started_at IS NULL
       AND completed_at IS NULL
       AND ${staleCondition}
       ${userFilterSql}`,
    queryParams
  )

  const changes = Number((result as any)?.changes || 0)
  return Number.isFinite(changes) && changes > 0 ? changes : 0
}
