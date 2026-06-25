import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import {
  apiCache,
  generateCacheKey,
  parseQueryBooleanParam,
  parseYmdQueryParam,
} from '@/lib/common/server'
import { withPerformanceMonitoring } from '@/lib/common/server'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-commission/affiliate-attribution-failures'
import { convertCurrency } from '@/lib/common/server'

/**
 * KPI数据响应
 * 转化口径改为佣金。
 */
interface KPIData {
  current: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    commission: number
    roas: number | null
    roasInfinite: boolean
    ctr: number
    cpc: number
    conversionRate: number
    commissionPerClick: number
    currency?: string
    costs?: Array<{ currency: string; amount: number }>
  }
  previous: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    commission: number
    roas: number | null
    roasInfinite: boolean
  }
  changes: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    commission: number
    roas: number | null
    roasInfinite: boolean
  }
  period: {
    current: { start: string; end: string }
    previous: { start: string; end: string }
  }
}

const SHORT_KPI_CACHE_DEFAULT_TTL_MS = 20 * 1000
const SHORT_KPI_CACHE_MIN_TTL_MS = 15 * 1000
const SHORT_KPI_CACHE_MAX_TTL_MS = 30 * 1000

function resolveKpiCacheTtlMs(): number {
  const parsed = Number.parseInt(process.env.KPI_SHORT_TTL_MS || '', 10)
  if (!Number.isFinite(parsed)) {
    return SHORT_KPI_CACHE_DEFAULT_TTL_MS
  }

  return Math.min(Math.max(parsed, SHORT_KPI_CACHE_MIN_TTL_MS), SHORT_KPI_CACHE_MAX_TTL_MS)
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function calculateRoas(
  commission: number,
  cost: number
): { value: number | null; infinite: boolean } {
  const normalizedCommission = Number(commission) || 0
  const normalizedCost = Number(cost) || 0
  if (normalizedCost <= 0) {
    if (normalizedCommission > 0) {
      return { value: null, infinite: true }
    }
    return { value: 0, infinite: false }
  }

  return {
    value: roundTo2(normalizedCommission / normalizedCost),
    infinite: false,
  }
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [year, month, day] = ymd.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const startTs = Date.parse(`${startYmd}T00:00:00Z`)
  const endTs = Date.parse(`${endYmd}T00:00:00Z`)
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 1
  return Math.max(1, Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1)
}

/**
 * GET /api/dashboard/kpis
 * 获取核心KPI指标（展示、点击、花费、佣金）
 * Query参数
 * days: 统计天数（默认7天）
 * start_date: 自定义开始日期（可选，YYYY-MM-DD）
 * end_date: 自定义结束日期（可选，YYYY-MM-DD）
 */
export const dynamic = 'force-dynamic'

const getHandler = withPerformanceMonitoring(
  withAuth(async (request: NextRequest, user) => {
    try {
      const { searchParams } = new URL(request.url)

      const allUsersParam = searchParams.get('allUsers')
      const targetUserIdParam = searchParams.get('userId')

      let userId: number
      let isAllUsers = false

      const isAdmin = user.role === 'admin'

      if ((allUsersParam === 'true' || !targetUserIdParam) && isAdmin) {
        userId = 0
        isAllUsers = true
      } else if (targetUserIdParam && isAdmin) {
        userId = parseInt(targetUserIdParam, 10)
        if (!Number.isFinite(userId)) {
          return NextResponse.json({ error: '无效的 userId 参数' }, { status: 400 })
        }
      } else {
        userId = user.userId
      }

      const rawDays = parseInt(searchParams.get('days') || '7', 10)
      const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 3650) : 7
      const startDateQuery = parseYmdQueryParam(searchParams.get('start_date'))
      const endDateQuery = parseYmdQueryParam(searchParams.get('end_date'))
      const hasCustomRangeQuery = searchParams.has('start_date') || searchParams.has('end_date')
      if (hasCustomRangeQuery) {
        if (!startDateQuery || !endDateQuery) {
          return NextResponse.json(
            { error: 'start_date 和 end_date 必须同时提供，且格式为 YYYY-MM-DD' },
            { status: 400 }
          )
        }
        if (startDateQuery > endDateQuery) {
          return NextResponse.json({ error: 'start_date 不能晚于 end_date' }, { status: 400 })
        }
      }
      const refresh = parseQueryBooleanParam(searchParams.get('refresh'))
      const noCache = parseQueryBooleanParam(searchParams.get('noCache'))
      const shouldBypassReadCache = refresh || noCache
      const shouldWriteCache = !noCache
      const kpiCacheTtlMs = resolveKpiCacheTtlMs()

      const cacheKey = generateCacheKey('kpis', userId, {
        days,
        startDate: startDateQuery || '',
        endDate: endDateQuery || '',
        allUsers: isAllUsers,
      })

      const buildResult = async () => {
        let currentStartDate = startDateQuery || ''
        let currentEndDate = endDateQuery || ''
        let rangeDays = days
        if (!currentStartDate || !currentEndDate) {
          const endDate = new Date()
          const startDate = new Date(endDate)
          startDate.setDate(startDate.getDate() - days + 1)
          currentStartDate = formatDate(startDate)
          currentEndDate = formatDate(endDate)
          rangeDays = days
        } else {
          rangeDays = diffDaysInclusive(currentStartDate, currentEndDate)
        }

        const previousEndDate = shiftYmd(currentStartDate, -1)
        const previousStartDate = shiftYmd(previousEndDate, -(rangeDays - 1))

        const db = await getDatabase()

        const currencyQuery = `
        SELECT DISTINCT currency
        FROM campaign_performance
        WHERE ${isAllUsers ? '1=1' : 'user_id = ?'}
          AND date >= ?
          AND date <= ?
      `
        const currencyParams = isAllUsers
          ? [currentStartDate, currentEndDate]
          : [userId, currentStartDate, currentEndDate]
        const currencies = (await db.query(currencyQuery, currencyParams)) as Array<{
          currency: string
        }>

        const uniqueCurrencies = currencies.map((c) => c.currency).filter(Boolean)
        const isSingleCurrency = uniqueCurrencies.length === 1
        const isMultiCurrency = uniqueCurrencies.length > 1

        const currentPeriodQuery = isMultiCurrency
          ? `
        SELECT
          currency,
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost
        FROM campaign_performance
        WHERE ${isAllUsers ? '1=1' : 'user_id = ?'}
          AND date >= ?
          AND date <= ?
        GROUP BY currency
      `
          : `
        SELECT
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost
        FROM campaign_performance
        WHERE ${isAllUsers ? '1=1' : 'user_id = ?'}
          AND date >= ?
          AND date <= ?
      `

        const currentParams = isAllUsers
          ? [currentStartDate, currentEndDate]
          : [userId, currentStartDate, currentEndDate]
        const currentDataRaw = isMultiCurrency
          ? await db.query(currentPeriodQuery, currentParams)
          : [await db.queryOne(currentPeriodQuery, currentParams)]

        const currentData = currentDataRaw as Array<{
          currency?: string | null
          impressions: number | null
          clicks: number | null
          cost: number | null
        }>

        const previousPeriodQuery = `
        SELECT
          COALESCE(currency, 'USD') as currency,
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost
        FROM campaign_performance
        WHERE ${isAllUsers ? '1=1' : 'user_id = ?'}
          AND date >= ?
          AND date <= ?
        GROUP BY COALESCE(currency, 'USD')
      `

        const previousParams = isAllUsers
          ? [previousStartDate, previousEndDate]
          : [userId, previousStartDate, previousEndDate]
        const previousData = (await db.query(previousPeriodQuery, previousParams)) as Array<{
          currency?: string | null
          impressions: number | null
          clicks: number | null
          cost: number | null
        }>

        const queryAttributedCommissionTotals = async (params: {
          start: string
          end: string
        }): Promise<number> => {
          const commissionQuery = `
          SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
          FROM affiliate_commission_attributions
          WHERE ${isAllUsers ? '1=1' : 'user_id = ?'}
            AND report_date >= ?
            AND report_date <= ?
        `
          const commissionParams = isAllUsers
            ? [params.start, params.end]
            : [userId, params.start, params.end]
          const row = await db.queryOne<{ total_commission: number }>(
            commissionQuery,
            commissionParams
          )

          return Number(row?.total_commission) || 0
        }

        const queryUnattributedCommissionTotals = async (params: {
          start: string
          end: string
        }): Promise<number> => {
          // Include all unattributed commissions (including campaign_mapping_miss)
          // to match affiliate backend totals and campaigns summary/trends
          const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
            includePendingWithinGrace: true,
            includeAllFailures: true,
          })
          try {
            const commissionQuery = `
            SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
            FROM openclaw_affiliate_attribution_failures
            WHERE ${isAllUsers ? '1=1' : 'user_id = ?'}
              AND report_date >= ?
              AND report_date <= ?
              AND ${unattributedFailureFilter.sql}
          `
            const commissionParams = isAllUsers
              ? [params.start, params.end, ...unattributedFailureFilter.values]
              : [userId, params.start, params.end, ...unattributedFailureFilter.values]
            const row = await db.queryOne<{ total_commission: number }>(
              commissionQuery,
              commissionParams
            )

            return Number(row?.total_commission) || 0
          } catch (error: any) {
            const message = String(error?.message || '')
            if (
              /openclaw_affiliate_attribution_failures/i.test(message) &&
              /(no such table|does not exist)/i.test(message)
            ) {
              return 0
            }
            throw error
          }
        }

        const currentAttributedCommissionTotal = await queryAttributedCommissionTotals({
          start: currentStartDate,
          end: currentEndDate,
        })
        const previousAttributedCommissionTotal = await queryAttributedCommissionTotals({
          start: previousStartDate,
          end: previousEndDate,
        })
        // Admin dashboard commission uses attributed records only (excludes attribution failures).
        const currentUnattributedCommissionTotal = isAdmin
          ? 0
          : await queryUnattributedCommissionTotals({
              start: currentStartDate,
              end: currentEndDate,
            })
        const previousUnattributedCommissionTotal = isAdmin
          ? 0
          : await queryUnattributedCommissionTotals({
              start: previousStartDate,
              end: previousEndDate,
            })

        const totalImpressions = currentData.reduce(
          (sum, row) => sum + (Number(row?.impressions) || 0),
          0
        )
        const totalClicks = currentData.reduce((sum, row) => sum + (Number(row?.clicks) || 0), 0)

        // 多货币时需要先转换为USD再相加
        const totalCost = isMultiCurrency
          ? currentData.reduce((sum, row) => {
              const cost = Number(row?.cost) || 0
              const currency = row?.currency || 'USD'
              try {
                // 将每个货币的花费转换为USD
                const costInUSD = convertCurrency(cost, currency, 'USD')
                return sum + costInUSD
              } catch (error) {
                console.warn(`货币转换失败: ${currency} -> USD, 使用原值`, error)
                return sum + cost
              }
            }, 0)
          : currentData.reduce((sum, row) => sum + (Number(row?.cost) || 0), 0)

        const totalCommission =
          currentAttributedCommissionTotal + currentUnattributedCommissionTotal

        const current = {
          impressions: totalImpressions,
          clicks: totalClicks,
          cost: totalCost,
          conversions: totalCommission,
          commission: totalCommission,
          roas: null as number | null,
          roasInfinite: false,
          ctr: 0,
          cpc: 0,
          conversionRate: 0,
          commissionPerClick: 0,
          currency: isSingleCurrency ? uniqueCurrencies[0] : isMultiCurrency ? 'MIXED' : 'USD',
          costs: isMultiCurrency
            ? currentData.map((row) => ({
                currency: row.currency || 'USD',
                amount: Number(row.cost) || 0,
              }))
            : undefined,
        }

        const previousCommission =
          previousAttributedCommissionTotal + previousUnattributedCommissionTotal
        const previous = {
          impressions: previousData.reduce((sum, row) => sum + (Number(row?.impressions) || 0), 0),
          clicks: previousData.reduce((sum, row) => sum + (Number(row?.clicks) || 0), 0),
          cost: previousData.reduce((sum, row) => {
            const cost = Number(row?.cost) || 0
            const currency = row?.currency || 'USD'
            try {
              return sum + convertCurrency(cost, currency, 'USD')
            } catch (error) {
              console.warn(`历史花费货币转换失败: ${currency} -> USD, 使用原值`, error)
              return sum + cost
            }
          }, 0),
          conversions: previousCommission,
          commission: previousCommission,
          roas: null as number | null,
          roasInfinite: false,
        }

        const roasAvailable = !isMultiCurrency
        // 修改: 多货币时也计算ROAS（基于转换后的USD总额），与Campaigns页面保持一致
        const currentRoas = calculateRoas(current.commission, current.cost)
        const previousRoas = calculateRoas(previous.commission, previous.cost)
        current.roas = currentRoas.value
        current.roasInfinite = currentRoas.infinite
        previous.roas = previousRoas.value
        previous.roasInfinite = previousRoas.infinite

        if (current.impressions > 0) {
          current.ctr = (current.clicks / current.impressions) * 100
        }
        if (current.clicks > 0) {
          current.cpc = current.cost / current.clicks
          current.conversionRate = current.commission / current.clicks
          current.commissionPerClick = current.commission / current.clicks
        }

        const calculateChange = (currentValue: number, previousValue: number): number => {
          if (previousValue === 0) return currentValue > 0 ? 100 : 0
          return ((currentValue - previousValue) / previousValue) * 100
        }

        const commissionChange =
          Number(calculateChange(current.commission, previous.commission)) || 0

        const changes = {
          impressions: Number(calculateChange(current.impressions, previous.impressions)) || 0,
          clicks: Number(calculateChange(current.clicks, previous.clicks)) || 0,
          cost: Number(calculateChange(current.cost, previous.cost)) || 0,
          conversions: commissionChange,
          commission: commissionChange,
          roas: null as number | null,
          roasInfinite: false,
        }

        if (roasAvailable) {
          if (current.roasInfinite) {
            changes.roasInfinite = true
          } else if (
            !previous.roasInfinite &&
            typeof previous.roas === 'number' &&
            previous.roas > 0 &&
            typeof current.roas === 'number'
          ) {
            changes.roas = roundTo2(((current.roas - previous.roas) / previous.roas) * 100)
          }
        }

        const response: KPIData = {
          current,
          previous,
          changes,
          period: {
            current: {
              start: currentStartDate,
              end: currentEndDate,
            },
            previous: {
              start: previousStartDate,
              end: previousEndDate,
            },
          },
        }

        return {
          success: true,
          data: response,
        }
      }

      if (!shouldBypassReadCache) {
        const result = await apiCache.getOrSet(cacheKey, buildResult, kpiCacheTtlMs)
        return NextResponse.json(result)
      }

      const result = await buildResult()
      if (shouldWriteCache) {
        apiCache.set(cacheKey, result, kpiCacheTtlMs)
      }
      return NextResponse.json(result)
    } catch (error) {
      console.error('获取KPI数据失败:', error)
      return NextResponse.json(
        {
          error: '获取KPI数据失败',
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  }) as (request: NextRequest) => Promise<NextResponse>,
  { path: '/api/dashboard/kpis' }
)

export const GET = getHandler

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
