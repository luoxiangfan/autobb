import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { triggerDataSync } from '@/lib/queue-triggers'

export const dynamic = 'force-dynamic'

function parsePositiveInteger(value: string | null | undefined): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

function parseBooleanFlag(value: string | null | undefined, fallback = false): boolean {
  if (value === null || value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toIso(value: unknown): string | null {
  if (!value) return null
  const raw = String(value)
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function getAgeMinutes(iso: string | null): number | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return null
  return Math.max(0, Math.floor((Date.now() - ts) / 60000))
}

function formatDateInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || 'USD'
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = auth.user.userId
    const { searchParams } = new URL(request.url)
    const accountId = parsePositiveInteger(searchParams.get('accountId'))
    if (!accountId) {
      return NextResponse.json({ error: '缺少有效的 accountId' }, { status: 400 })
    }

    const syncIfStale = parseBooleanFlag(searchParams.get('syncIfStale'), false)
    const staleMinutesRaw = Number(searchParams.get('staleMinutes') || 45)
    const staleMinutes = Number.isFinite(staleMinutesRaw)
      ? Math.min(360, Math.max(5, Math.floor(staleMinutesRaw)))
      : 45

    const db = await getDatabase()
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

    const account = await db.queryOne<{
      id: number
      customer_id: string
      currency: string | null
      timezone: string | null
      last_sync_at: string | null
    }>(
      `
        SELECT id, customer_id, currency, timezone, last_sync_at
        FROM google_ads_accounts
        WHERE user_id = ? AND id = ? AND ${isActiveCondition}
        LIMIT 1
      `,
      [userId, accountId]
    )

    if (!account) {
      return NextResponse.json({ error: 'Google Ads 账号不存在或未激活' }, { status: 404 })
    }

    const reportingDate = formatDateInTimezone(new Date(), account.timezone || 'UTC')

    const spendAgg = await db.queryOne<{
      spend: number
      clicks: number
      impressions: number
      conversions: number
      campaign_count: number
    }>(
      `
        SELECT
          COALESCE(SUM(cp.cost), 0) as spend,
          COALESCE(SUM(cp.clicks), 0) as clicks,
          COALESCE(SUM(cp.impressions), 0) as impressions,
          COALESCE(SUM(cp.conversions), 0) as conversions,
          COUNT(DISTINCT cp.campaign_id) as campaign_count
        FROM campaign_performance cp
        JOIN campaigns c ON c.id = cp.campaign_id
        WHERE cp.user_id = ?
          AND c.user_id = ?
          AND c.google_ads_account_id = ?
          AND cp.date = ?
      `,
      [userId, userId, accountId, reportingDate]
    )

    const enabledCampaignAgg = await db.queryOne<{ count: number }>(
      `
        SELECT COUNT(*) as count
        FROM campaigns
        WHERE user_id = ?
          AND google_ads_account_id = ?
          AND UPPER(COALESCE(status, '')) = 'ENABLED'
      `,
      [userId, accountId]
    )

    const latestSync = await db.queryOne<{
      status: string | null
      started_at: string | null
      completed_at: string | null
      error_message: string | null
      created_at: string | null
    }>(
      `
        SELECT status, started_at, completed_at, error_message, created_at
        FROM sync_logs
        WHERE user_id = ? AND google_ads_account_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [userId, accountId]
    )

    const latestSyncCompletedAt = toIso(latestSync?.completed_at)
    const latestSyncStartedAt = toIso(latestSync?.started_at)
    const ageMinutes = getAgeMinutes(latestSyncCompletedAt || latestSyncStartedAt)
    const syncStatus = String(latestSync?.status || '').trim().toLowerCase() || null
    const isRunning = syncStatus === 'running'
    const isStale = isRunning ? false : (ageMinutes === null || ageMinutes > staleMinutes)

    let syncTriggered = false
    let syncTaskId: string | null = null
    let syncTriggerError: string | null = null

    if (syncIfStale && isStale && !isRunning) {
      try {
        syncTaskId = await triggerDataSync(userId, {
          syncType: 'manual',
          priority: 'high',
          googleAdsAccountId: accountId,
          maxRetries: 0,
        })
        syncTriggered = true
      } catch (error: any) {
        syncTriggerError = error?.message || '触发数据同步失败'
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        accountId,
        customerId: account.customer_id,
        currency: normalizeCurrency(account.currency),
        timezone: account.timezone || 'UTC',
        reportingDate,
        spend: toNumber(spendAgg?.spend),
        clicks: toNumber(spendAgg?.clicks),
        impressions: toNumber(spendAgg?.impressions),
        conversions: toNumber(spendAgg?.conversions),
        campaignCount: toNumber(spendAgg?.campaign_count),
        enabledCampaignCount: toNumber(enabledCampaignAgg?.count),
        source: 'campaign_performance',
        staleMinutes,
        latestSync: {
          status: syncStatus,
          startedAt: latestSyncStartedAt,
          completedAt: latestSyncCompletedAt,
          errorMessage: latestSync?.error_message || null,
          ageMinutes,
          isStale,
        },
        syncTriggered,
        syncTaskId,
        syncTriggerError,
      },
    })
  } catch (error: any) {
    console.error('获取实时花费失败:', error)
    return NextResponse.json(
      { error: error?.message || '获取实时花费失败' },
      { status: 500 }
    )
  }
}
