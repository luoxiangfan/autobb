import { NextRequest, NextResponse } from 'next/server'
import {
  ConfigRequiredError,
  checkAffiliatePlatformConfig,
  createAffiliateProductSyncRun,
  getLatestFailedAffiliateProductSyncRun,
  normalizeAffiliatePlatform,
  type SyncMode,
  updateAffiliateProductSyncRun,
} from '@/lib/affiliate-products'
import { getDatabase } from '@/lib/db'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'
import { getYeahPromosSessionState, checkYeahPromosSessionValidForSync } from '@/lib/yeahpromos-session'

type RouteParams = {
  platform: string
}

type SyncStrategy = 'light' | 'full'

function parseBooleanFlag(value: unknown, defaultValue: boolean = false): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return defaultValue
  return text === '1' || text === 'true' || text === 'yes' || text === 'on'
}

function resolveSyncMode(params: {
  platform: 'partnerboost' | 'yeahpromos'
  strategy?: string
}): { mode: SyncMode; strategy: SyncStrategy } {
  const strategyRaw = String(params.strategy || '').trim().toLowerCase()
  const strategy: SyncStrategy = strategyRaw === 'full' ? 'full' : strategyRaw === 'light' ? 'light' : (
    params.platform === 'partnerboost' ? 'light' : 'full'
  )

  return {
    mode: strategy === 'full' ? 'platform' : 'delta',
    strategy,
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  try {
    const userIdRaw = request.headers.get('x-user-id')
    if (!userIdRaw) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = Number(userIdRaw)
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const resolved = await params
    const platform = normalizeAffiliatePlatform(resolved.platform)
    if (!platform) {
      return NextResponse.json({ error: '不支持的平台' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const { mode } = resolveSyncMode({
      platform,
      strategy: body?.strategy,
    })
    // 默认从头开始全量，避免沿用历史失败游标导致“看起来在续跑但无新增”。
    // 如需明确续跑，调用方可显式传 resumeFailedRun: true。
    const resumeFailedRun = parseBooleanFlag(body?.resumeFailedRun, false)

    const configCheck = await checkAffiliatePlatformConfig(userId, platform)
    if (!configCheck.configured) {
      throw new ConfigRequiredError(platform, configCheck.missingKeys)
    }

    // 防止同平台重复手动提交：优先阻止“近期仍活跃”的 queued/running run。
    const db = await getDatabase()
    const activeRunFreshnessSql = db.type === 'postgres'
      ? "COALESCE(last_heartbeat_at, updated_at, created_at) >= NOW() - INTERVAL '45 minutes'"
      : "COALESCE(last_heartbeat_at, updated_at, created_at) >= datetime('now', '-45 minutes')"
    const activeRun = await db.queryOne<{
      id: number
      status: string
      mode: string
      created_at: string
    }>(
      `
        SELECT
          id,
          status,
          mode,
          created_at
        FROM affiliate_product_sync_runs
        WHERE user_id = ?
          AND platform = ?
          AND status IN ('queued', 'running')
          AND (${activeRunFreshnessSql})
        ORDER BY
          CASE
            WHEN status = 'running' THEN 0
            WHEN status = 'queued' THEN 1
            ELSE 2
          END,
          COALESCE(last_heartbeat_at, updated_at, created_at) DESC,
          created_at DESC
        LIMIT 1
      `,
      [userId, platform]
    )

    if (activeRun?.id) {
      return NextResponse.json(
        {
          error: `当前已有进行中的同步任务 #${activeRun.id}（${activeRun.status}），请等待完成后再试`,
          code: 'SYNC_ALREADY_RUNNING',
          runId: Number(activeRun.id),
          runStatus: String(activeRun.status || ''),
          runMode: String(activeRun.mode || ''),
          runCreatedAt: activeRun.created_at || null,
        },
        { status: 409 }
      )
    }

    if (platform === 'yeahpromos') {
      const session = await getYeahPromosSessionState(userId)
      if (!session.hasSession) {
        return NextResponse.json(
          {
            error: session.isExpired
              ? 'YeahPromos 登录态已过期，请在商品页重新完成手动登录态采集'
              : '请先在商品页完成 YeahPromos 手动登录态采集',
            code: 'YP_SESSION_REQUIRED',
            redirect: '/products',
          },
          { status: 400 }
        )
      }

      // 检查session剩余有效期（platform模式需要更长的有效期）
      const minRemainingMs = mode === 'platform' ? 2 * 60 * 60 * 1000 : 60 * 60 * 1000 // platform: 2小时, delta: 1小时
      const sessionCheck = await checkYeahPromosSessionValidForSync(userId, minRemainingMs)
      if (!sessionCheck.valid) {
        const remainingMinutes = sessionCheck.remainingMs ? Math.floor(sessionCheck.remainingMs / 60000) : 0
        const requiredMinutes = Math.floor(minRemainingMs / 60000)
        return NextResponse.json(
          {
            error: sessionCheck.isExpired
              ? 'YeahPromos 登录态已过期，请在商品页重新完成手动登录态采集'
              : `YeahPromos 登录态剩余有效期不足（剩余 ${remainingMinutes} 分钟，需要至少 ${requiredMinutes} 分钟），请重新采集登录态以确保同步任务能够完成`,
            code: 'YP_SESSION_EXPIRING_SOON',
            redirect: '/products',
            remainingMinutes,
            requiredMinutes,
          },
          { status: 400 }
        )
      }
    }

    const runId = await createAffiliateProductSyncRun({
      userId,
      platform,
      mode,
      triggerSource: 'manual',
      status: 'queued',
    })

    let resumedFromRunId: number | null = null
    if (mode === 'platform' && resumeFailedRun) {
      const latestFailedRun = await getLatestFailedAffiliateProductSyncRun({
        userId,
        platform,
        mode: 'platform',
        excludeRunId: runId,
      })

      if (latestFailedRun && latestFailedRun.cursor_page > 0) {
        const totalItems = Math.max(0, Number(latestFailedRun.total_items || 0))
        const createdCount = Math.max(0, Number(latestFailedRun.created_count || 0))
        const updatedCount = Math.max(0, Number(latestFailedRun.updated_count || 0))
        const processedBatches = Math.max(0, Number(latestFailedRun.processed_batches || 0))
        const cursorPage = Math.max(1, Number(latestFailedRun.cursor_page || 1))
        const cursorScope = String(latestFailedRun.cursor_scope || '').trim() || null

        await updateAffiliateProductSyncRun({
          runId,
          totalItems,
          createdCount,
          updatedCount,
          failedCount: 0,
          cursorPage,
          cursorScope,
          processedBatches,
          // 续跑场景沿用原失败任务的 started_at，确保状态基线覆盖整条续跑链路
          startedAt: latestFailedRun.started_at || null,
          lastHeartbeatAt: null,
          errorMessage: null,
          completedAt: null,
        })
        resumedFromRunId = latestFailedRun.id
      }
    }

    const queue = getQueueManagerForTaskType('affiliate-product-sync')
    const taskId = await queue.enqueue(
      'affiliate-product-sync',
      {
        userId,
        platform,
        mode,
        runId,
        trigger: 'manual',
      },
      userId,
      {
        priority: 'normal',
        maxRetries: 1,
        parentRequestId: request.headers.get('x-request-id') || undefined,
      }
    )

    return NextResponse.json({
      success: true,
      runId,
      resumedFromRunId,
      resumeFailedRun,
      taskId,
      message: '商品同步任务已提交',
    })
  } catch (error: any) {
    if (error instanceof ConfigRequiredError) {
      return NextResponse.json(
        {
          error: '请先在商品管理页完成联盟平台配置',
          code: error.code,
          platform: error.platform,
          missingKeys: error.missingKeys,
          redirect: '/products',
        },
        { status: 400 }
      )
    }

    console.error('[POST /api/products/sync/:platform] failed:', error)
    return NextResponse.json(
      { error: error?.message || '提交同步任务失败' },
      { status: 500 }
    )
  }
}
