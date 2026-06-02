import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { isOpenclawEnabledForUser, resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import {
  buildUserLabelMap,
  getAffiliateCommissionBrandDetail,
  getAffiliateCommissionDateDetail,
  getAffiliateCommissionDateBounds,
  getAffiliateCommissionReport,
  parseRequestedUserIds,
  resolveTargetUserIds,
  type AffiliateCommissionReportPlatformFilter,
  type AffiliateCommissionReportViewMode,
} from '@/lib/openclaw/affiliate-commission-raw-report'

export const dynamic = 'force-dynamic'

function parseIsoDateQuery(value: string | null, fieldName: string): string | undefined {
  if (value === null) return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName} 格式错误，应为 YYYY-MM-DD`)
  }
  return normalized
}

function parsePlatformFilter(value: string | null): AffiliateCommissionReportPlatformFilter {
  const normalized = String(value || 'all').trim().toLowerCase()
  if (normalized === 'yeahpromos' || normalized === 'partnerboost') {
    return normalized
  }
  return 'all'
}

function parseViewMode(value: string | null): AffiliateCommissionReportViewMode {
  const normalized = String(value || 'brand').trim().toLowerCase()
  return normalized === 'date' ? 'date' : 'brand'
}

function defaultStartDate(): string {
  const date = new Date()
  date.setDate(date.getDate() - 29)
  return date.toISOString().slice(0, 10)
}

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10)
}

async function resolveReportAccess(request: NextRequest): Promise<{
  currentUserId: number
  isAdmin: boolean
} | null> {
  const sessionAuth = await verifyAuth(request)
  if (sessionAuth.authenticated && sessionAuth.user) {
    const isAdmin = sessionAuth.user.role === 'admin'
    if (!isAdmin) {
      const openclawEnabled = await isOpenclawEnabledForUser(sessionAuth.user.userId)
      if (!openclawEnabled) return null
    }
    return {
      currentUserId: sessionAuth.user.userId,
      isAdmin,
    }
  }

  const openclawAuth = await resolveOpenclawRequestUser(request)
  if (!openclawAuth) return null

  return {
    currentUserId: openclawAuth.userId,
    isAdmin: false,
  }
}

export async function GET(request: NextRequest) {
  const access = await resolveReportAccess(request)
  if (!access) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const searchParams = request.nextUrl.searchParams
  const detailType = String(searchParams.get('detail') || '').trim().toLowerCase()

  try {
    const startDate = parseIsoDateQuery(
      searchParams.get('startDate') || searchParams.get('start_date'),
      'startDate'
    ) || defaultStartDate()
    const endDate = parseIsoDateQuery(
      searchParams.get('endDate') || searchParams.get('end_date'),
      'endDate'
    ) || defaultEndDate()

    if (startDate > endDate) {
      return NextResponse.json({ error: '开始日期不能晚于结束日期' }, { status: 400 })
    }

    const platform = parsePlatformFilter(searchParams.get('platform'))
    const viewMode = parseViewMode(searchParams.get('viewMode') || searchParams.get('view_mode'))
    const requestedUserIds = access.isAdmin
      ? parseRequestedUserIds(searchParams.get('userIds') || searchParams.get('user_ids'))
      : []
    const targetUserIds = await resolveTargetUserIds({
      isAdmin: access.isAdmin,
      currentUserId: access.currentUserId,
      requestedUserIds,
    })
    const userLabels = await buildUserLabelMap(targetUserIds)
    const showUserScope = access.isAdmin

    if (searchParams.get('meta') === 'bounds') {
      const dateBounds = await getAffiliateCommissionDateBounds({
        userIds: targetUserIds,
        platform,
      })

      return NextResponse.json({
        success: true,
        isAdmin: access.isAdmin,
        dateBounds,
      })
    }

    if (detailType === 'brand') {
      const brandKey = String(searchParams.get('brandKey') || searchParams.get('brand_key') || '').trim()
      if (!brandKey) {
        return NextResponse.json({ error: 'brandKey 不能为空' }, { status: 400 })
      }

      const items = await getAffiliateCommissionBrandDetail({
        userIds: targetUserIds,
        userLabels,
        startDate,
        endDate,
        platform,
        brandKey,
        showUserScope,
      })

      return NextResponse.json({
        success: true,
        detailType: 'brand',
        brandKey,
        startDate,
        endDate,
        platform,
        showUserScope,
        items,
      })
    }

    if (detailType === 'date') {
      const reportDate = parseIsoDateQuery(
        searchParams.get('reportDate') || searchParams.get('report_date'),
        'reportDate'
      )
      if (!reportDate) {
        return NextResponse.json({ error: 'reportDate 不能为空' }, { status: 400 })
      }

      const items = await getAffiliateCommissionDateDetail({
        userIds: targetUserIds,
        userLabels,
        reportDate,
        platform,
        showUserScope,
      })

      return NextResponse.json({
        success: true,
        detailType: 'date',
        reportDate,
        platform,
        showUserScope,
        items,
      })
    }

    const report = await getAffiliateCommissionReport({
      userIds: targetUserIds,
      userLabels,
      startDate,
      endDate,
      platform,
      viewMode,
      showUserScope,
    })

    return NextResponse.json({
      success: true,
      isAdmin: access.isAdmin,
      report,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '查询联盟佣金原始数据失败' },
      { status: 400 }
    )
  }
}
