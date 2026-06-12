import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { getUserOnlySetting } from '@/lib/settings'
import type { AffiliatePlatform, SyncMode } from './types'
import { AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY } from './constants'
import { roundTo2 } from './parsing'
import {
  isMissingTableError,
  parseDateToTimestamp,
  toHourBucketIso,
  toSafeNonNegativeInt,
} from './query'

export async function createAffiliateProductSyncRun(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  triggerSource?: string
  status?: 'queued' | 'running' | 'completed' | 'failed'
}): Promise<number> {
  const db = await getDatabase()
  const nowIso = new Date().toISOString()
  const result = await db.exec(
    `
      INSERT INTO affiliate_product_sync_runs
      (user_id, platform, mode, status, trigger_source, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      params.userId,
      params.platform,
      params.mode,
      params.status || 'queued',
      params.triggerSource || null,
      params.status === 'running' ? nowIso : null,
      nowIso,
      nowIso,
    ]
  )

  return getInsertedId(result)
}

export async function updateAffiliateProductSyncRun(params: {
  runId: number
  status?: 'queued' | 'running' | 'completed' | 'failed'
  totalItems?: number
  createdCount?: number
  updatedCount?: number
  failedCount?: number
  cursorPage?: number | null
  cursorScope?: string | null
  processedBatches?: number
  lastHeartbeatAt?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}): Promise<void> {
  const db = await getDatabase()
  const updates: string[] = []
  const values: any[] = []

  // Log all update parameters for debugging
  console.log(`[affiliate-sync] updateAffiliateProductSyncRun called for run #${params.runId}:`, {
    status: params.status,
    totalItems: params.totalItems,
    createdCount: params.createdCount,
    updatedCount: params.updatedCount,
    cursorPage: params.cursorPage,
    cursorScope: params.cursorScope,
    hasHeartbeat: params.lastHeartbeatAt !== undefined,
  })

  if (params.status !== undefined) {
    updates.push('status = ?')
    values.push(params.status)
  }
  if (params.totalItems !== undefined) {
    updates.push('total_items = ?')
    values.push(params.totalItems)
  }
  if (params.createdCount !== undefined) {
    updates.push('created_count = ?')
    values.push(params.createdCount)
  }
  if (params.updatedCount !== undefined) {
    updates.push('updated_count = ?')
    values.push(params.updatedCount)
  }
  if (params.failedCount !== undefined) {
    updates.push('failed_count = ?')
    values.push(params.failedCount)
  }
  if (params.cursorPage !== undefined) {
    updates.push('cursor_page = ?')
    values.push(params.cursorPage === null ? 0 : params.cursorPage)
  }
  if (params.cursorScope !== undefined) {
    updates.push('cursor_scope = ?')
    values.push(params.cursorScope || null)
  }
  if (params.processedBatches !== undefined) {
    updates.push('processed_batches = ?')
    values.push(params.processedBatches)
  }
  if (params.lastHeartbeatAt !== undefined) {
    updates.push('last_heartbeat_at = ?')
    values.push(params.lastHeartbeatAt)
  }
  if (params.errorMessage !== undefined) {
    updates.push('error_message = ?')
    values.push(params.errorMessage)
  }
  if (params.startedAt !== undefined) {
    updates.push('started_at = ?')
    values.push(params.startedAt)
  }
  if (params.completedAt !== undefined) {
    updates.push('completed_at = ?')
    values.push(params.completedAt)
  }

  if (updates.length === 0) return

  updates.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(params.runId)

  try {
    await db.exec(
      `
        UPDATE affiliate_product_sync_runs
        SET ${updates.join(', ')}
        WHERE id = ?
      `,
      values
    )

    // Log status updates for debugging
    if (params.status) {
      console.log(`[affiliate-sync] Updated run #${params.runId} status to '${params.status}'`)
    }
  } catch (error: any) {
    console.error(
      `[affiliate-sync] Failed to update run #${params.runId}:`,
      error?.message || error
    )
    throw error
  }
}

export async function getAffiliateProductSyncRunById(params: {
  runId: number
  userId?: number
}): Promise<{
  id: number
  user_id: number
  platform: AffiliatePlatform
  mode: SyncMode
  status: string
  trigger_source: string | null
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  cursor_page: number
  cursor_scope: string | null
  processed_batches: number
  last_heartbeat_at: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
} | null> {
  const db = await getDatabase()
  const whereUser = params.userId ? 'AND user_id = ?' : ''
  const values = params.userId ? [params.runId, params.userId] : [params.runId]

  const row = await db.queryOne<any>(
    `
      SELECT *
      FROM affiliate_product_sync_runs
      WHERE id = ?
      ${whereUser}
      LIMIT 1
    `,
    values
  )

  if (!row) return null

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    platform: row.platform,
    mode: row.mode,
    status: String(row.status || ''),
    trigger_source: row.trigger_source ?? null,
    total_items: Number(row.total_items || 0),
    created_count: Number(row.created_count || 0),
    updated_count: Number(row.updated_count || 0),
    failed_count: Number(row.failed_count || 0),
    cursor_page: Number(row.cursor_page || 0),
    cursor_scope: row.cursor_scope ?? null,
    processed_batches: Number(row.processed_batches || 0),
    last_heartbeat_at: row.last_heartbeat_at ?? null,
    error_message: row.error_message ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getLatestFailedAffiliateProductSyncRun(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  excludeRunId?: number
}): Promise<{
  id: number
  user_id: number
  platform: AffiliatePlatform
  mode: SyncMode
  status: string
  trigger_source: string | null
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  cursor_page: number
  cursor_scope: string | null
  processed_batches: number
  last_heartbeat_at: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
} | null> {
  const db = await getDatabase()
  const excludeClause = params.excludeRunId ? 'AND id <> ?' : ''
  const values = params.excludeRunId
    ? [params.userId, params.platform, params.mode, params.excludeRunId]
    : [params.userId, params.platform, params.mode]

  const row = await db.queryOne<any>(
    `
      SELECT *
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
        AND platform = ?
        AND mode = ?
        AND status = 'failed'
        AND cursor_page > 0
        ${excludeClause}
      ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
      LIMIT 1
    `,
    values
  )

  if (!row) return null

  // 仅当“最近一次终态”仍是 failed 时才允许续跑。
  // 如果失败游标之后已有 completed 任务，说明链路已经成功跑通，
  // 再继续续跑旧失败游标会导致手动全量误从历史断点启动。
  const newerCompleted = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
        AND platform = ?
        AND mode = ?
        AND status = 'completed'
        AND id > ?
      LIMIT 1
    `,
    [params.userId, params.platform, params.mode, Number(row.id)]
  )
  if (newerCompleted?.id) {
    return null
  }

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    platform: row.platform,
    mode: row.mode,
    status: String(row.status || ''),
    trigger_source: row.trigger_source ?? null,
    total_items: Number(row.total_items || 0),
    created_count: Number(row.created_count || 0),
    updated_count: Number(row.updated_count || 0),
    failed_count: Number(row.failed_count || 0),
    cursor_page: Number(row.cursor_page || 0),
    cursor_scope: row.cursor_scope ?? null,
    processed_batches: Number(row.processed_batches || 0),
    last_heartbeat_at: row.last_heartbeat_at ?? null,
    error_message: row.error_message ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getAffiliateProductSyncRuns(
  userId: number,
  limit: number = 20
): Promise<
  Array<{
    id: number
    platform: AffiliatePlatform
    mode: SyncMode
    status: string
    trigger_source: string | null
    total_items: number
    created_count: number
    updated_count: number
    failed_count: number
    error_message: string | null
    started_at: string | null
    completed_at: string | null
    created_at: string
  }>
> {
  const db = await getDatabase()
  const safeLimit = Math.max(1, Math.min(limit, 100))
  return await db.query(
    `
      SELECT
        id,
        platform,
        mode,
        status,
        trigger_source,
        total_items,
        created_count,
        updated_count,
        failed_count,
        error_message,
        started_at,
        completed_at,
        created_at
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [userId, safeLimit]
  )
}

export async function recordAffiliateProductSyncHourlySnapshot(params: {
  userId: number
  runId: number
  platform: AffiliatePlatform
  totalItems: number
  timestamp?: Date
}): Promise<void> {
  const totalItems = toSafeNonNegativeInt(params.totalItems)
  const now = params.timestamp || new Date()
  const nowIso = now.toISOString()
  const hourBucket = toHourBucketIso(now)
  const db = await getDatabase()

  try {
    await db.exec(
      `
          INSERT INTO affiliate_product_sync_hourly_stats (
            user_id,
            run_id,
            platform,
            hour_bucket,
            max_total_items,
            sample_count,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (run_id, hour_bucket)
          DO UPDATE SET
            max_total_items = GREATEST(affiliate_product_sync_hourly_stats.max_total_items, EXCLUDED.max_total_items),
            sample_count = affiliate_product_sync_hourly_stats.sample_count + 1,
            updated_at = EXCLUDED.updated_at
        `,
      [params.userId, params.runId, params.platform, hourBucket, totalItems, nowIso, nowIso]
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      return
    }
    throw error
  }
}

export async function getYeahPromosSyncMonitor(userId: number): Promise<YeahPromosSyncMonitor> {
  const fallback: YeahPromosSyncMonitor = {
    runId: null,
    runStatus: null,
    targetItems: null,
    fetchedItems: 0,
    remainingItems: null,
    avgItemsPerHour: null,
    etaAt: null,
    windowCloseAt: null,
    canFinishInWindow: null,
    statsUpdatedAt: null,
    hourlyStats: [],
  }

  const targetSetting = await getUserOnlySetting(
    'system',
    AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY,
    userId
  )
  const targetItemsParsed = toSafeNonNegativeInt(targetSetting?.value || null)
  const targetItems = targetItemsParsed > 0 ? targetItemsParsed : null

  const db = await getDatabase()
  const activeRunFreshnessSql =
    "COALESCE(last_heartbeat_at, updated_at, created_at) >= NOW() - INTERVAL '45 minutes'"
  const latestRun = await db.queryOne<{
    id: number
    status: string
    total_items: number
    started_at: string | null
    completed_at: string | null
    last_heartbeat_at: string | null
    updated_at: string
  }>(
    `
      SELECT
        id,
        status,
        total_items,
        started_at,
        completed_at,
        last_heartbeat_at,
        updated_at
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
        AND platform = 'yeahpromos'
      ORDER BY
        CASE
          WHEN status = 'running' AND (${activeRunFreshnessSql}) THEN 0
          WHEN status = 'queued' AND (${activeRunFreshnessSql}) THEN 1
          ELSE 2
        END,
        COALESCE(last_heartbeat_at, updated_at, created_at) DESC,
        created_at DESC
      LIMIT 1
    `,
    [userId]
  )

  if (!latestRun?.id) {
    return {
      ...fallback,
      targetItems,
    }
  }

  const runId = Number(latestRun.id)
  const fetchedItems = toSafeNonNegativeInt(latestRun.total_items)

  let hourlyRows: Array<{
    hour_bucket: string
    max_total_items: number
    sample_count: number
    updated_at: string | null
  }> = []
  try {
    hourlyRows = await db.query(
      `
        SELECT
          hour_bucket,
          max_total_items,
          sample_count,
          updated_at
        FROM affiliate_product_sync_hourly_stats
        WHERE user_id = ?
          AND run_id = ?
        ORDER BY hour_bucket DESC
        LIMIT 36
      `,
      [userId, runId]
    )
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error
    }
  }

  const rowsAsc = [...hourlyRows].reverse()
  const hourlyStats: AffiliateProductSyncHourlyStat[] = []
  let previousCumulative = 0
  for (const row of rowsAsc) {
    const cumulativeFetched = Math.max(
      previousCumulative,
      toSafeNonNegativeInt(row.max_total_items)
    )
    const fetchedCount = Math.max(0, cumulativeFetched - previousCumulative)
    previousCumulative = cumulativeFetched
    hourlyStats.push({
      hourBucket: String(row.hour_bucket || ''),
      fetchedCount,
      cumulativeFetched,
      sampleCount: toSafeNonNegativeInt(row.sample_count),
      updatedAt: row.updated_at || null,
    })
  }

  const recentStats = hourlyStats.slice(-6).filter((item) => item.fetchedCount > 0)
  let avgItemsPerHour =
    recentStats.length > 0
      ? roundTo2(recentStats.reduce((sum, item) => sum + item.fetchedCount, 0) / recentStats.length)
      : null

  if ((avgItemsPerHour === null || avgItemsPerHour <= 0) && fetchedItems > 0) {
    const startedAtMs = parseDateToTimestamp(latestRun.started_at)
    if (startedAtMs !== null) {
      const elapsedHours = Math.max(0, (Date.now() - startedAtMs) / (60 * 60 * 1000))
      if (elapsedHours >= 0.1) {
        avgItemsPerHour = roundTo2(fetchedItems / elapsedHours)
      }
    }
  }

  const remainingItems = targetItems !== null ? Math.max(0, targetItems - fetchedItems) : null

  let etaAt: string | null = null
  if (remainingItems !== null) {
    if (remainingItems === 0) {
      etaAt = latestRun.completed_at || new Date().toISOString()
    } else if (avgItemsPerHour !== null && avgItemsPerHour > 0) {
      const etaMs = Date.now() + (remainingItems / avgItemsPerHour) * 60 * 60 * 1000
      etaAt = new Date(etaMs).toISOString()
    }
  }

  const statsUpdatedAt =
    hourlyStats.length > 0
      ? hourlyStats[hourlyStats.length - 1].updatedAt || null
      : latestRun.last_heartbeat_at || latestRun.updated_at || null

  return {
    runId,
    runStatus: latestRun.status || null,
    targetItems,
    fetchedItems,
    remainingItems,
    avgItemsPerHour,
    etaAt,
    windowCloseAt: null,
    canFinishInWindow: null,
    statsUpdatedAt,
    hourlyStats,
  }
}

export type AffiliateProductSyncCheckpoint = {
  cursorPage: number
  cursorScope?: string | null
  processedBatches: number
  totalFetched: number
  createdCount: number
  updatedCount: number
  failedCount: number
}

export type AffiliateProductSyncHourlyStat = {
  hourBucket: string
  fetchedCount: number
  cumulativeFetched: number
  sampleCount: number
  updatedAt: string | null
}

export type YeahPromosSyncMonitor = {
  runId: number | null
  runStatus: string | null
  targetItems: number | null
  fetchedItems: number
  remainingItems: number | null
  avgItemsPerHour: number | null
  etaAt: string | null
  windowCloseAt: string | null
  canFinishInWindow: boolean | null
  statsUpdatedAt: string | null
  hourlyStats: AffiliateProductSyncHourlyStat[]
}
