import { NextRequest, NextResponse } from 'next/server'
import { buildOpenclawDailyReport, getOrCreateDailyReport } from '@/lib/openclaw/reports'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { getAffiliateSyncSettingsMap } from '@/lib/openclaw/settings'

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function normalizeAffiliateSyncMode(value: string | null | undefined): 'incremental' | 'realtime' {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'realtime' ? 'realtime' : 'incremental'
}

function parseIsoDateQuery(value: string | null): string | undefined {
  if (value === null) return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('日期参数格式错误，应为 YYYY-MM-DD')
  }
  return normalized
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  let date: string | undefined
  let rangeStartDate: string | undefined
  let rangeEndDate: string | undefined
  try {
    date = parseIsoDateQuery(request.nextUrl.searchParams.get('date'))
    rangeStartDate = parseIsoDateQuery(
      request.nextUrl.searchParams.get('start_date')
      || request.nextUrl.searchParams.get('startDate')
    )
    rangeEndDate = parseIsoDateQuery(
      request.nextUrl.searchParams.get('end_date')
      || request.nextUrl.searchParams.get('endDate')
    )
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '日期参数不合法' }, { status: 400 })
  }

  const hasDateRangeQuery = Boolean(rangeStartDate || rangeEndDate)
  const effectiveEndDate = rangeEndDate || date || rangeStartDate
  const effectiveStartDate = rangeStartDate || effectiveEndDate
  if (
    hasDateRangeQuery
    && effectiveStartDate
    && effectiveEndDate
    && effectiveStartDate > effectiveEndDate
  ) {
    return NextResponse.json({ error: '开始日期不能晚于结束日期' }, { status: 400 })
  }

  const forceRealtimeFromQuery = (
    parseBooleanQuery(request.nextUrl.searchParams.get('force_realtime'))
    || parseBooleanQuery(request.nextUrl.searchParams.get('forceRealtime'))
    || parseBooleanQuery(request.nextUrl.searchParams.get('refresh'))
    || parseBooleanQuery(request.nextUrl.searchParams.get('realtime'))
  )

  let forceRefresh = forceRealtimeFromQuery
  let forceRefreshReason: 'query' | 'feishu_mode' | null = forceRealtimeFromQuery ? 'query' : null

  if (!forceRefresh && auth.authType === 'gateway-binding') {
    const channel = String(request.headers.get('x-openclaw-channel') || '').trim().toLowerCase()
    if (channel === 'feishu') {
      const settings = await getAffiliateSyncSettingsMap(auth.userId)
      const syncMode = normalizeAffiliateSyncMode(settings.openclaw_affiliate_sync_mode)
      if (syncMode === 'realtime') {
        forceRefresh = true
        forceRefreshReason = 'feishu_mode'
      }
    }
  }

  const report = hasDateRangeQuery && effectiveStartDate && effectiveEndDate
    ? await buildOpenclawDailyReport(auth.userId, effectiveEndDate, { startDate: effectiveStartDate })
    : await getOrCreateDailyReport(auth.userId, date, { forceRefresh })

  return NextResponse.json({
    success: true,
    report,
    forceRefreshApplied: hasDateRangeQuery ? true : forceRefresh,
    forceRefreshReason,
  })
}
