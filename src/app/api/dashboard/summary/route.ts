/**
 * ⚡ P0性能优化: 仪表盘数据聚合API
 * 将3个独立的API请求合并为一个，减少网络往返时间
 * 添加服务端缓存，提升响应速度
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { apiCache, generateCacheKey } from '@/lib/api-cache'
import { getDatabase } from '@/lib/db'
import { listOffers } from '@/lib/offers'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-attribution-failures'

function parseBooleanParam(value: string | null): boolean {
  if (value === null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function resolveStartDateYmd(days: number): string {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days + 1)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startDate)
}

// 从现有API导入逻辑
async function getKPIs(userId: number, days: number = 30) {
  // 这里调用kpis API的核心逻辑
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：生产库中 is_deleted 可能仍是 INTEGER，需同时兼容 BOOLEAN/INTEGER
  const notDeletedCondition = db.type === 'postgres'
    ? "(o.is_deleted IS NULL OR o.is_deleted::text IN ('0', 'f', 'false'))"
    : '(o.is_deleted = 0 OR o.is_deleted IS NULL)'

  const startDateStr = resolveStartDateYmd(days)

  // 获取基础KPI数据
  const result = await db.queryOne(`
    SELECT
      COUNT(DISTINCT CASE WHEN c.status != 'REMOVED' THEN c.id END) as total_campaigns,
      COUNT(DISTINCT CASE WHEN c.status != 'REMOVED' THEN o.id END) as total_offers,
      COALESCE(SUM(cp.clicks), 0) as total_clicks,
      COALESCE(SUM(cp.impressions), 0) as total_impressions,
      COALESCE(SUM(cp.cost), 0) as total_cost,
      COALESCE(AVG(CASE WHEN cp.clicks > 0 THEN (cp.cost / cp.clicks) ELSE 0 END), 0) as avg_cpc,
      COALESCE(AVG(CASE WHEN cp.impressions > 0 THEN (cp.clicks * 1.0 / cp.impressions) ELSE 0 END), 0) as avg_ctr
    FROM campaigns c
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id AND cp.date >= ?
    LEFT JOIN offers o ON c.offer_id = o.id
    WHERE c.user_id = ?
      AND ${notDeletedCondition}
  `, [startDateStr, userId]) as any

  const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
    includePendingWithinGrace: true,
    includeAllFailures: true,
  })

  const attributedRow = await db.queryOne(`
    SELECT COALESCE(SUM(commission_amount), 0) as total_commission
    FROM affiliate_commission_attributions
    WHERE user_id = ?
      AND report_date >= ?
  `, [userId, startDateStr]) as any

  let unattributedRow: any = { total_commission: 0 }
  try {
    unattributedRow = await db.queryOne(`
      SELECT COALESCE(SUM(commission_amount), 0) as total_commission
      FROM openclaw_affiliate_attribution_failures
      WHERE user_id = ?
        AND report_date >= ?
        AND ${unattributedFailureFilter.sql}
    `, [userId, startDateStr, ...unattributedFailureFilter.values]) as any
  } catch (error: any) {
    const message = String(error?.message || '')
    if (
      !/openclaw_affiliate_attribution_failures/i.test(message)
      || !/(no such table|does not exist)/i.test(message)
    ) {
      throw error
    }
  }

  const totalCommission = (Number(attributedRow?.total_commission) || 0)
    + (Number(unattributedRow?.total_commission) || 0)

  return {
    totalCampaigns: result?.total_campaigns || 0,
    totalOffers: result?.total_offers || 0,
    totalClicks: result?.total_clicks || 0,
    totalImpressions: result?.total_impressions || 0,
    totalCost: result?.total_cost || 0,
    totalConversions: totalCommission,
    totalCommission,
    avgCPC: result?.avg_cpc || 0,
    avgCTR: result?.avg_ctr || 0,
    dateRange: days
  }
}

async function getRiskAlerts(userId: number, limit: number = 3) {
  const db = await getDatabase()
  const startDateStr = resolveStartDateYmd(7)

  // 🔧 PostgreSQL兼容性：生产库中 is_deleted 可能仍是 INTEGER，需同时兼容 BOOLEAN/INTEGER
  const notDeletedCondition = db.type === 'postgres'
    ? "(o.is_deleted IS NULL OR o.is_deleted::text IN ('0', 'f', 'false'))"
    : '(o.is_deleted = 0 OR o.is_deleted IS NULL)'

  // 获取最近7天的风险警报
  const alerts = await db.query(`
    SELECT
      c.id as campaign_id,
      c.campaign_name as campaign_name,
      o.brand,
      cp.date,
      cp.clicks,
      cp.impressions,
      cp.cost,
      cp.conversions,
      CASE
        WHEN cp.clicks > 0 THEN (cp.clicks * 1.0 / cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN cp.clicks > 0 THEN (cp.cost / cp.clicks)
        ELSE 0
      END as cpc
    FROM campaign_performance cp
    INNER JOIN campaigns c ON cp.campaign_id = c.id
    INNER JOIN offers o ON c.offer_id = o.id
    WHERE c.user_id = ?
      AND ${notDeletedCondition}
      AND cp.date >= ?
      AND (
        (cp.clicks > 0 AND (cp.clicks * 1.0 / cp.impressions) < 0.01)
        OR (cp.clicks > 0 AND (cp.cost / cp.clicks) > 5.0)
        OR (cp.impressions > 1000 AND cp.clicks = 0)
      )
    ORDER BY cp.date DESC, cp.cost DESC
    LIMIT ?
  `, [userId, startDateStr, limit]) as any[]

  return alerts.map(alert => ({
    campaignId: alert.campaign_id,
    campaignName: alert.campaign_name,
    brand: alert.brand,
    date: alert.date,
    type: alert.ctr < 0.01 ? 'low_ctr' : alert.cpc > 5.0 ? 'high_cpc' : 'no_clicks',
    severity: alert.ctr < 0.005 || alert.cpc > 10.0 ? 'high' : 'medium',
    metrics: {
      clicks: alert.clicks,
      impressions: alert.impressions,
      cost: alert.cost,
      conversions: alert.conversions,
      ctr: alert.ctr,
      cpc: alert.cpc
    }
  }))
}

async function getTopOffers(userId: number, limit: number = 5) {
  const result = await listOffers(userId, {
    limit,
    isActive: true
  })

  return result.offers
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '30')
    const refresh = parseBooleanParam(searchParams.get('refresh'))
    const noCache = parseBooleanParam(searchParams.get('noCache'))
    const shouldBypassReadCache = refresh || noCache
    const shouldWriteCache = !noCache

    // 检查缓存
    const cacheKey = generateCacheKey('dashboard-summary', userId, { days })
    if (!shouldBypassReadCache) {
      const cached = apiCache.get(cacheKey)
      if (cached) {
        return NextResponse.json({
          ...cached,
          cached: true
        })
      }
    }

    const buildResult = async () => {
      // 并行获取所有数据
      const [kpis, riskAlerts, topOffers] = await Promise.all([
        getKPIs(userId, days),
        getRiskAlerts(userId, 3),
        getTopOffers(userId, 5)
      ])

      return {
        kpis,
        riskAlerts,
        topOffers,
        timestamp: new Date().toISOString()
      }
    }

    const result = await buildResult()
    if (shouldWriteCache) {
      apiCache.set(cacheKey, result, 2 * 60 * 1000)
    }

    return NextResponse.json({
      ...result,
      cached: false
    })
  } catch (error: any) {
    console.error('获取仪表盘摘要失败:', error)
    return NextResponse.json(
      { error: '获取仪表盘摘要失败', details: error.message },
      { status: 500 }
    )
  }
}
