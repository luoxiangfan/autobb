import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { toNumber } from '@/lib/utils'
import { withPerformanceMonitoring } from '@/lib/api-performance'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-attribution-failures'

/**
 * Campaign性能数据
 * 🔧 修复(2025-12-30): 增加currency字段支持多货币
 */
interface CampaignPerformance {
  campaignId: number
  campaignName: string
  status: string
  offerBrand: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  conversionRate: number
  createdAt: string
  currency?: string // 🔧 新增: 货币代码
}

/**
 * GET /api/dashboard/campaigns
 * 获取Campaign列表及其性能数据
 * Query参数：
 * - days: 统计天数（默认7）
 * - sortBy: 排序字段（cost/clicks/conversions，默认cost）
 * - sortOrder: 排序方向（asc/desc，默认desc）
 * - page: 页码（默认1）
 * - pageSize: 每页数量（默认10）
 * - status: 筛选状态（可选）
 * - search: 搜索关键词（可选）
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return getHandler(request)
}

const getHandler = withPerformanceMonitoring<any>(async (request: NextRequest) => {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)
    const sortBy = searchParams.get('sortBy') || 'cost'
    const sortOrderRaw = (searchParams.get('sortOrder') || 'desc').toLowerCase()
    const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc'
    const pageRaw = parseInt(searchParams.get('page') || '1', 10)
    const pageSizeRaw = parseInt(searchParams.get('pageSize') || '10', 10)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
    const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, 100) : 10
    const statusFilter = searchParams.get('status')
    const searchQuery = (searchParams.get('search') || '').trim()

    // 验证排序字段
    const validSortFields = ['cost', 'clicks', 'conversions', 'impressions', 'ctr', 'cpc']
    if (!validSortFields.includes(sortBy)) {
      return NextResponse.json(
        { error: `无效的排序字段: ${sortBy}` },
        { status: 400 }
      )
    }

    // 计算日期范围（使用本地时区，days=7 表示含今天在内的7天窗口）
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days + 1)
    const startDateStr = formatDate(startDate)
    const endDateStr = formatDate(endDate)

    const db = await getDatabase()
    const likeOperator = db.type === 'postgres' ? 'ILIKE' : 'LIKE'
    const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
      includePendingWithinGrace: true,
      includeAllFailures: true,
    })

    // 构建查询条件
    const conditions: string[] = ['c.user_id = ?']
    const params: any[] = [userId]

    if (statusFilter) {
      conditions.push('c.status = ?')
      params.push(statusFilter)
    }

    if (searchQuery) {
      conditions.push(`(c.campaign_name ${likeOperator} ? OR o.brand ${likeOperator} ?)`)
      params.push(`%${searchQuery}%`, `%${searchQuery}%`)
    }

    const whereClause = conditions.join(' AND ')

    const sortFieldSqlMap: Record<string, string> = {
      cost: 'cost',
      clicks: 'clicks',
      conversions: 'conversions',
      impressions: 'impressions',
      ctr: 'ctr',
      cpc: 'cpc',
    }
    const sortFieldSql = sortFieldSqlMap[sortBy] || 'cost'
    const sortDirectionSql = sortOrder === 'asc' ? 'ASC' : 'DESC'

    const offset = (page - 1) * pageSize

    // 📌 性能优化：下推排序/分页到数据库，避免全量加载后在内存排序
    // 🔧 修复(2025-12-30): 增加currency字段支持多货币
    const pageQuery = `
      SELECT
        c.id as campaignId,
        c.campaign_name as campaignName,
        c.status,
        o.brand as offerBrand,
        c.created_at as createdAt,
        COALESCE(SUM(cp.impressions), 0) as impressions,
        COALESCE(SUM(cp.clicks), 0) as clicks,
        COALESCE(SUM(cp.cost), 0) as cost,
        ROUND(COALESCE(MAX(acaAgg.commission), 0) + COALESCE(MAX(acfAgg.commission), 0), 2) as conversions,
        COALESCE(cpcur.currency, 'USD') as currency,
        ROUND(
          CASE
            WHEN COALESCE(SUM(cp.impressions), 0) > 0
              THEN (COALESCE(SUM(cp.clicks), 0) * 1.0 / COALESCE(SUM(cp.impressions), 0)) * 100
            ELSE 0
          END,
          2
        ) as ctr,
        ROUND(
          CASE
            WHEN COALESCE(SUM(cp.clicks), 0) > 0
              THEN COALESCE(SUM(cp.cost), 0) * 1.0 / COALESCE(SUM(cp.clicks), 0)
            ELSE 0
          END,
          2
        ) as cpc,
        ROUND(
          CASE
            WHEN COALESCE(SUM(cp.clicks), 0) > 0
              THEN (COALESCE(MAX(acaAgg.commission), 0) + COALESCE(MAX(acfAgg.commission), 0)) * 1.0 / COALESCE(SUM(cp.clicks), 0)
            ELSE 0
          END,
          2
        ) as conversionRate
      FROM campaigns c
      LEFT JOIN offers o ON c.offer_id = o.id
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND cp.date >= ?
        AND cp.date <= ?
      LEFT JOIN (
        SELECT
          campaign_id,
          MAX(COALESCE(currency, 'USD')) as currency
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
        GROUP BY campaign_id
      ) cpcur ON cpcur.campaign_id = c.id
      LEFT JOIN (
        SELECT
          campaign_id,
          COALESCE(SUM(commission_amount), 0) as commission
        FROM affiliate_commission_attributions
        WHERE user_id = ?
          AND report_date >= ?
          AND report_date <= ?
          AND campaign_id IS NOT NULL
        GROUP BY campaign_id
      ) acaAgg ON acaAgg.campaign_id = c.id
      LEFT JOIN (
        SELECT
          campaign_id,
          COALESCE(SUM(commission_amount), 0) as commission
        FROM openclaw_affiliate_attribution_failures
        WHERE user_id = ?
          AND report_date >= ?
          AND report_date <= ?
          AND campaign_id IS NOT NULL
          AND ${unattributedFailureFilter.sql}
        GROUP BY campaign_id
      ) acfAgg ON acfAgg.campaign_id = c.id
      WHERE ${whereClause}
      GROUP BY c.id, c.campaign_name, c.status, o.brand, c.created_at, cpcur.currency
      ORDER BY ${sortFieldSql} ${sortDirectionSql}
      LIMIT ?
      OFFSET ?
    `

    const summaryQuery = `
      SELECT
        COUNT(*) as totalCampaigns,
        COALESCE(SUM(CASE WHEN c.status = 'ENABLED' THEN 1 ELSE 0 END), 0) as activeCampaigns,
        COALESCE(SUM(CASE WHEN c.status = 'PAUSED' THEN 1 ELSE 0 END), 0) as pausedCampaigns,
        COALESCE(SUM(COALESCE(cpAgg.impressions, 0)), 0) as totalImpressions,
        COALESCE(SUM(COALESCE(cpAgg.clicks, 0)), 0) as totalClicks,
        COALESCE(SUM(COALESCE(cpAgg.cost, 0)), 0) as totalCost,
        COALESCE(SUM(COALESCE(acaAgg.commission, 0) + COALESCE(acfAgg.commission, 0)), 0) as totalConversions
      FROM campaigns c
      LEFT JOIN offers o ON c.offer_id = o.id
      LEFT JOIN (
        SELECT
          campaign_id,
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
        GROUP BY campaign_id
      ) cpAgg ON cpAgg.campaign_id = c.id
      LEFT JOIN (
        SELECT
          campaign_id,
          COALESCE(SUM(commission_amount), 0) as commission
        FROM affiliate_commission_attributions
        WHERE user_id = ?
          AND report_date >= ?
          AND report_date <= ?
          AND campaign_id IS NOT NULL
        GROUP BY campaign_id
      ) acaAgg ON acaAgg.campaign_id = c.id
      LEFT JOIN (
        SELECT
          campaign_id,
          COALESCE(SUM(commission_amount), 0) as commission
        FROM openclaw_affiliate_attribution_failures
        WHERE user_id = ?
          AND report_date >= ?
          AND report_date <= ?
          AND campaign_id IS NOT NULL
          AND ${unattributedFailureFilter.sql}
        GROUP BY campaign_id
      ) acfAgg ON acfAgg.campaign_id = c.id
      WHERE ${whereClause}
    `

    const [rawRows, rawSummary] = await Promise.all([
      db.query(pageQuery, [
        startDateStr,
        endDateStr,
        userId,
        startDateStr,
        endDateStr,
        userId,
        startDateStr,
        endDateStr,
        userId,
        startDateStr,
        endDateStr,
        ...unattributedFailureFilter.values,
        ...params,
        pageSize,
        offset,
      ]) as Promise<
        Array<{
          campaignId: number
          campaignName: string
          status: string
          offerBrand: string
          createdAt: string
          impressions: number
          clicks: number
          cost: number
          conversions: number
          currency?: string
          ctr: number
          cpc: number
          conversionRate: number
        }>
      >,
      db.queryOne(summaryQuery, [
        userId,
        startDateStr,
        endDateStr,
        userId,
        startDateStr,
        endDateStr,
        userId,
        startDateStr,
        endDateStr,
        ...unattributedFailureFilter.values,
        ...params,
      ]) as Promise<
        | {
            totalCampaigns: number
            activeCampaigns: number
            pausedCampaigns: number
            totalImpressions: number
            totalClicks: number
            totalCost: number
            totalConversions: number
          }
        | undefined
      >,
    ])

    const campaigns: CampaignPerformance[] = (rawRows || []).map((row) => ({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      status: row.status,
      offerBrand: row.offerBrand,
      createdAt: row.createdAt,
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      cost: toNumber(row.cost),
      conversions: toNumber(row.conversions),
      ctr: toNumber(row.ctr),
      cpc: toNumber(row.cpc),
      conversionRate: toNumber(row.conversionRate),
      currency: row.currency || 'USD',
    }))

    const summary = {
      totalCampaigns: toNumber(rawSummary?.totalCampaigns),
      activeCampaigns: toNumber(rawSummary?.activeCampaigns),
      pausedCampaigns: toNumber(rawSummary?.pausedCampaigns),
      totalImpressions: toNumber(rawSummary?.totalImpressions),
      totalClicks: toNumber(rawSummary?.totalClicks),
      totalCost: toNumber(rawSummary?.totalCost),
      totalConversions: toNumber(rawSummary?.totalConversions),
    }

    const total = summary.totalCampaigns
    const totalPages = Math.ceil(total / pageSize)

    return NextResponse.json({
      success: true,
      data: {
        campaigns,
        summary,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        filters: {
          days,
          sortBy,
          sortOrder,
          status: statusFilter,
          search: searchQuery,
        },
      },
    })
  } catch (error) {
    console.error('获取Campaign列表失败:', error)
    return NextResponse.json(
      {
        error: '获取Campaign列表失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}, { path: '/api/dashboard/campaigns' })

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
