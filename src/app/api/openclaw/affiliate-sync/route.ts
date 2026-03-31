import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { formatOpenclawLocalDate, normalizeOpenclawReportDate } from '@/lib/openclaw/report-date'
import { getOpenclawSettingsWithAffiliateSyncMap } from '@/lib/openclaw/settings'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'

export const dynamic = 'force-dynamic'

const DEFAULT_BACKFILL_DAYS = 7
const MIN_BACKFILL_DAYS = 7
const MAX_BACKFILL_DAYS = 30

function parseReportDate(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('date 参数格式错误，应为 YYYY-MM-DD')
  }
  return raw
}

function parseBackfillDays(value: unknown): number {
  const raw = Number(value)
  if (!Number.isFinite(raw)) {
    return DEFAULT_BACKFILL_DAYS
  }
  return Math.min(MAX_BACKFILL_DAYS, Math.max(MIN_BACKFILL_DAYS, Math.floor(raw)))
}

function shiftYmdDate(ymd: string, daysOffset: number): string {
  const parsed = new Date(`${ymd}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return ymd
  parsed.setUTCDate(parsed.getUTCDate() + daysOffset)
  return parsed.toISOString().slice(0, 10)
}

function buildBackfillDates(endDate: string, days: number): string[] {
  const dates: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(shiftYmdDate(endDate, -offset))
  }
  return dates
}

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as {
    date?: string
    days?: number
  }

  let parsedDate: string | undefined
  try {
    parsedDate = parseReportDate(body.date)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'date 参数不合法' },
      { status: 400 }
    )
  }

  const reportDate = normalizeOpenclawReportDate(parsedDate || formatOpenclawLocalDate(new Date()))
  const backfillDays = parseBackfillDays(body.days)
  const reportDates = buildBackfillDates(reportDate, backfillDays)

  try {
    const settings = await getOpenclawSettingsWithAffiliateSyncMap(auth.userId)
    const partnerboostToken = String(settings.partnerboost_token || '').trim()
    const yeahpromosToken = String(settings.yeahpromos_token || '').trim()
    const yeahpromosSiteId = String(settings.yeahpromos_site_id || '').trim()
    const hasPlatformCredentials = Boolean(
      partnerboostToken || (yeahpromosToken && yeahpromosSiteId)
    )

    if (!hasPlatformCredentials) {
      return NextResponse.json(
        {
          error: '请先配置联盟平台 Token（PartnerBoost 或 YeahPromos），再触发手动同步',
          code: 'AFFILIATE_PLATFORM_NOT_CONFIGURED',
        },
        { status: 400 }
      )
    }

    const syncMode = String(settings.openclaw_affiliate_sync_mode || '').trim().toLowerCase() === 'realtime'
      ? 'realtime'
      : 'incremental'

    const queue = getQueueManagerForTaskType('openclaw-affiliate-sync')
    await queue.initialize()

    const queueTaskIds: string[] = []
    for (const [index, date] of reportDates.entries()) {
      const taskId = await queue.enqueue(
        'openclaw-affiliate-sync',
        {
          userId: auth.userId,
          date,
          syncMode,
          trigger: 'manual',
        },
        auth.userId,
        {
          priority: 'high',
          maxRetries: 1,
          taskId: `openclaw-affiliate-sync-manual:${auth.userId}:${date}:${Date.now()}:${index}`,
          parentRequestId: request.headers.get('x-request-id') || undefined,
        }
      )
      queueTaskIds.push(taskId)
    }

    return NextResponse.json({
      success: true,
      trigger: 'manual',
      syncMode,
      backfillDays,
      reportDates,
      queuedCount: queueTaskIds.length,
      queueTaskIds,
      message: `已触发联盟成交/佣金同步（${reportDates[0]} ~ ${reportDates[reportDates.length - 1]}）`,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '手动触发联盟佣金同步失败' },
      { status: 500 }
    )
  }
}
