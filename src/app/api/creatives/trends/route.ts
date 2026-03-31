import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

function parsePossiblyNestedJsonObject(value: unknown, maxDepth = 2): Record<string, any> | null {
  let current: unknown = value

  for (let i = 0; i < maxDepth; i += 1) {
    if (typeof current !== 'string') break
    const trimmed = current.trim()
    if (!trimmed) return null
    try {
      current = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  if (!current || typeof current !== 'object' || Array.isArray(current)) return null
  return current as Record<string, any>
}

function resolveCreativeKeywordAudit(adStrengthPayload: Record<string, any> | null): Record<string, any> | null {
  if (!adStrengthPayload) return null
  return (
    parsePossiblyNestedJsonObject(adStrengthPayload.audit)
    || parsePossiblyNestedJsonObject(adStrengthPayload.keywordSourceAudit)
  )
}

function normalizeCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, number> = {}

  for (const [rawKey, rawValue] of Object.entries(value as Record<string, any>)) {
    const key = String(rawKey || '').trim()
    if (!key) continue

    let count = 0
    if (typeof rawValue === 'number') {
      count = Number(rawValue) || 0
    } else if (rawValue && typeof rawValue === 'object') {
      count = Number((rawValue as any).count) || 0
    }

    if (count > 0) {
      result[key] = (result[key] || 0) + count
    }
  }

  return result
}

function mergeCountMap(target: Record<string, number>, incoming: Record<string, number>): void {
  for (const [key, value] of Object.entries(incoming)) {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey) continue
    target[normalizedKey] = (target[normalizedKey] || 0) + (Number(value) || 0)
  }
}

function formatLocalYmd(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseYmdParam(value: string | null): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const [year, month, day] = normalized.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return normalized
}

function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const startTs = Date.parse(`${startYmd}T00:00:00Z`)
  const endTs = Date.parse(`${endYmd}T00:00:00Z`)
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 1
  return Math.max(1, Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1)
}

function parseLocalYmdToDate(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day)
}

/**
 * GET /api/creatives/trends
 *
 * 获取创意维度的统计趋势数据（按日期聚合）
 * - 每日新增创意数量
 * - 创意质量评分分布
 * - 创意状态分布
 * - Ad Strength分布
 *
 * Query Parameters:
 * - daysBack: number (可选，默认7天)
 * - start_date: string (可选，YYYY-MM-DD)
 * - end_date: string (可选，YYYY-MM-DD)
 * - offerId: number (可选，筛选特定Offer的创意)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const rawDaysBack = parseInt(searchParams.get('daysBack') || '7', 10)
    const daysBack = Number.isFinite(rawDaysBack) ? Math.min(Math.max(rawDaysBack, 1), 3650) : 7
    const startDateQuery = parseYmdParam(searchParams.get('start_date'))
    const endDateQuery = parseYmdParam(searchParams.get('end_date'))
    const hasCustomRangeQuery = searchParams.has('start_date') || searchParams.has('end_date')
    if (hasCustomRangeQuery) {
      if (!startDateQuery || !endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 和 end_date 必须同时提供，且格式为 YYYY-MM-DD' },
          { status: 400 }
        )
      }
      if (startDateQuery > endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 不能晚于 end_date' },
          { status: 400 }
        )
      }
    }
    const offerId = searchParams.get('offerId')

    const db = await getDatabase()

    // 2. 计算日期范围
    let startDateStr = startDateQuery || ''
    let endDateStr = endDateQuery || ''
    let rangeDays = daysBack
    if (!startDateStr || !endDateStr) {
      const endDate = new Date()
      const startDate = new Date(endDate)
      // 修复 daysBack 计算：当选择7天时，应该返回7天的数据（今天 + 过去6天 = 7天）
      startDate.setDate(startDate.getDate() - daysBack + 1)
      startDateStr = formatLocalYmd(startDate)
      endDateStr = formatLocalYmd(endDate)
      rangeDays = daysBack
    } else {
      rangeDays = diffDaysInclusive(startDateStr, endDateStr)
    }

    const startDate = parseLocalYmdToDate(startDateStr)
    const endDate = parseLocalYmdToDate(endDateStr)

    // 格式化日期函数（PostgreSQL返回的DATE类型需要提取YYYY-MM-DD）
    const formatDate = (dateValue: any): string => {
      if (!dateValue) return ''
      // 如果是 Date 对象，提取 YYYY-MM-DD
      if (dateValue instanceof Date) {
        const year = dateValue.getFullYear()
        const month = String(dateValue.getMonth() + 1).padStart(2, '0')
        const day = String(dateValue.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }
      // 如果已经是字符串，直接返回
      return String(dateValue)
    }

    // PostgreSQL/SQLite 兼容性条件
    const isSelectedTrue = db.type === 'postgres' ? 'is_selected = true' : 'is_selected = 1'
    const isSelectedFalse = db.type === 'postgres' ? 'is_selected = false' : 'is_selected = 0'
    const isDeletedCheck = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

    // DATE() 函数兼容性：PostgreSQL的created_at是TEXT类型，需要转换
    const dateFunc = db.type === 'postgres' ? '(created_at::date)' : 'DATE(created_at)'

    // 3. 查询每日新增创意数量趋势
    // 🔧 修复(2025-01-01): 使用正确的日期参数占位符，不要在SQL中包含::date转换
    let dailyCreativesQuery = `
      SELECT
        ${dateFunc} as date,
        COUNT(*) as newCreatives,
        AVG(COALESCE(score, 0)) as avgScore,
        SUM(CASE WHEN score >= 80 THEN 1 ELSE 0 END) as highQuality,
        SUM(CASE WHEN score >= 60 AND score < 80 THEN 1 ELSE 0 END) as mediumQuality,
        SUM(CASE WHEN score < 60 OR score IS NULL THEN 1 ELSE 0 END) as lowQuality
      FROM ad_creatives
      WHERE user_id = ? AND ${isDeletedCheck}
        AND ${dateFunc} >= ?
        AND ${dateFunc} <= ?
    `
    const params: any[] = [userId, startDateStr, endDateStr]

    if (offerId) {
      dailyCreativesQuery += ` AND offer_id = ?`
      params.push(parseInt(offerId))
    }

    dailyCreativesQuery += `
      GROUP BY ${dateFunc}
      ORDER BY date ASC
    `

    const dailyTrends = await db.query(dailyCreativesQuery, params) as any[]

    // 🔧 调试日志：检查原始查询结果
    console.log('[Trends API] 原始查询结果:', JSON.stringify(dailyTrends, null, 2))
    console.log('[Trends API] 日期范围:', { startDateStr, endDateStr, rangeDays, userId, offerId: offerId || '全部' })

    // 10. 补全缺失的日期（确保返回完整的日期范围，包括没有数据的日期）
    const allDates: string[] = []
    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      allDates.push(formatLocalYmd(currentDate))
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // 创建日期到数据的映射
    const trendsMap = new Map<string, typeof dailyTrends[0]>()
    dailyTrends.forEach(row => {
      const dateKey = formatDate(row.date)
      trendsMap.set(dateKey, row)
    })

    // 补全所有日期，缺失的日期值为0
    const completeTrends = allDates.map(date => {
      const row = trendsMap.get(date)
      return {
        date,
        newCreatives: row ? Number(row.newcreatives) || 0 : 0,
        avgQualityScore: row && row.avgscore ? Math.round((Number(row.avgscore) || 0) * 10) / 10 : 0,
        highQuality: row ? Number(row.highquality) || 0 : 0,
        mediumQuality: row ? Number(row.mediumquality) || 0 : 0,
        lowQuality: row ? Number(row.lowquality) || 0 : 0,
      }
    })

    // 🔧 调试日志：检查格式化后的结果
    console.log('[Trends API] 完整趋势数据（含缺失日期）:', JSON.stringify(completeTrends, null, 2))

    // 4. 查询创意是否被选中的分布（使用is_selected字段）
    let statusQuery = `
      SELECT
        CASE
          WHEN ${isSelectedTrue} THEN 'selected'
          ELSE 'draft'
        END as status,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ? AND ${isDeletedCheck}
    `
    const statusParams: any[] = [userId]

    if (offerId) {
      statusQuery += ` AND offer_id = ?`
      statusParams.push(parseInt(offerId))
    }

    statusQuery += ` GROUP BY status`

    const statusDistribution = await db.query(statusQuery, statusParams) as any[]

    // 5. 查询Ad Strength分布（当前总量）
    const adStrengthExpr = db.type === 'postgres'
      ? `COALESCE(NULLIF(trim(both '\"' from NULLIF(ad_strength_data::text, 'null')), ''), 'UNKNOWN')`
      : `COALESCE(ad_strength_data, 'UNKNOWN')`
    let adStrengthQuery = `
      SELECT
        ${adStrengthExpr} as ad_strength,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ? AND ${isDeletedCheck}
    `
    const adStrengthParams: any[] = [userId]

    if (offerId) {
      adStrengthQuery += ` AND offer_id = ?`
      adStrengthParams.push(parseInt(offerId))
    }

    adStrengthQuery += ` GROUP BY ${adStrengthExpr}`

    const adStrengthDistribution = await db.query(adStrengthQuery, adStrengthParams) as any[]

    // 5.1 查询关键词来源审计聚合（主字段 ad_strength_data.audit，兼容 keywordSourceAudit）
    let keywordAuditQuery = `
      SELECT ad_strength_data
      FROM ad_creatives
      WHERE user_id = ? AND ${isDeletedCheck}
    `
    const keywordAuditParams: any[] = [userId]
    if (offerId) {
      keywordAuditQuery += ` AND offer_id = ?`
      keywordAuditParams.push(parseInt(offerId))
    }
    const keywordAuditRows = await db.query(
      keywordAuditQuery,
      keywordAuditParams
    ) as Array<{ ad_strength_data: unknown }>

    const keywordSourceByRawSource: Record<string, number> = {}
    const keywordSourceBySubtype: Record<string, number> = {}
    const keywordSourceByField: Record<string, number> = {}
    const fallbackModeDistribution: Record<string, number> = {}
    const noVolumeModeDistribution: Record<string, number> = {}
    const contextFallbackDistribution: Record<string, number> = {}
    const sourceQuotaBlockedByCap = {
      lowTrust: 0,
      ai: 0,
      aiLlmRaw: 0,
    }
    const sourceQuotaRefill = {
      triggered: 0,
      refillCount: 0,
      underfillBeforeRefill: 0,
      deferredCount: 0,
      acceptedCount: 0,
    }
    let creativesWithKeywordAudit = 0
    let totalKeywordsFromAudit = 0

    for (const row of keywordAuditRows) {
      const adStrengthPayload = parsePossiblyNestedJsonObject(row?.ad_strength_data)
      const keywordAudit = resolveCreativeKeywordAudit(adStrengthPayload)
      if (!keywordAudit) continue

      creativesWithKeywordAudit += 1
      totalKeywordsFromAudit += Number(keywordAudit.totalKeywords) || 0

      mergeCountMap(keywordSourceByRawSource, normalizeCountMap(keywordAudit.byRawSource))
      mergeCountMap(keywordSourceBySubtype, normalizeCountMap(keywordAudit.bySourceSubtype))
      mergeCountMap(keywordSourceByField, normalizeCountMap(keywordAudit.bySourceField))

      const fallbackKey = String(Boolean(keywordAudit.fallbackMode))
      fallbackModeDistribution[fallbackKey] = (fallbackModeDistribution[fallbackKey] || 0) + 1

      const noVolumeKey = String(Boolean(keywordAudit.noVolumeMode))
      noVolumeModeDistribution[noVolumeKey] = (noVolumeModeDistribution[noVolumeKey] || 0) + 1

      const contextFallbackStrategy = String(keywordAudit.contextFallbackStrategy || 'unknown').trim() || 'unknown'
      contextFallbackDistribution[contextFallbackStrategy] =
        (contextFallbackDistribution[contextFallbackStrategy] || 0) + 1

      const sourceQuotaAudit = parsePossiblyNestedJsonObject(keywordAudit.sourceQuotaAudit)
      if (sourceQuotaAudit) {
        sourceQuotaBlockedByCap.lowTrust += Number(sourceQuotaAudit?.blockedByCap?.lowTrust) || 0
        sourceQuotaBlockedByCap.ai += Number(sourceQuotaAudit?.blockedByCap?.ai) || 0
        sourceQuotaBlockedByCap.aiLlmRaw += Number(sourceQuotaAudit?.blockedByCap?.aiLlmRaw) || 0

        sourceQuotaRefill.triggered += sourceQuotaAudit.deferredRefillTriggered ? 1 : 0
        sourceQuotaRefill.refillCount += Number(sourceQuotaAudit.deferredRefillCount) || 0
        sourceQuotaRefill.underfillBeforeRefill += Number(sourceQuotaAudit.underfillBeforeRefill) || 0
        sourceQuotaRefill.deferredCount += Number(sourceQuotaAudit.deferredCount) || 0
        sourceQuotaRefill.acceptedCount += Number(sourceQuotaAudit.acceptedCount) || 0
      }
    }

    // 6. 查询质量评分分布（当前总量）
    let qualityQuery = `
      SELECT
        CASE
          WHEN score >= 90 THEN 'excellent'
          WHEN score >= 75 THEN 'good'
          WHEN score >= 60 THEN 'average'
          ELSE 'poor'
        END as quality_level,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ? AND ${isDeletedCheck}
    `
    const qualityParams: any[] = [userId]

    if (offerId) {
      qualityQuery += ` AND offer_id = ?`
      qualityParams.push(parseInt(offerId))
    }

    qualityQuery += ` GROUP BY quality_level`

    const qualityDistribution = await db.query(qualityQuery, qualityParams) as any[]

    // 7. 查询主题分布
    let themeQuery = `
      SELECT
        COALESCE(theme, 'unknown') as theme,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ? AND ${isDeletedCheck}
    `
    const themeParams: any[] = [userId]

    if (offerId) {
      themeQuery += ` AND offer_id = ?`
      themeParams.push(parseInt(offerId))
    }

    themeQuery += ` GROUP BY theme`

    const themeDistribution = await db.query(themeQuery, themeParams) as any[]

    // 8. 查询创意使用情况
    let usageQuery = `
      SELECT
        SUM(CASE WHEN ${isSelectedTrue} THEN 1 ELSE 0 END) as selected,
        SUM(CASE WHEN ${isSelectedFalse} OR is_selected IS NULL THEN 1 ELSE 0 END) as notSelected,
        COUNT(*) as total
      FROM ad_creatives
      WHERE user_id = ? AND ${isDeletedCheck}
    `
    const usageParams: any[] = [userId]

    if (offerId) {
      usageQuery += ` AND offer_id = ?`
      usageParams.push(parseInt(offerId))
    }

    const usageStats = await db.queryOne(usageQuery, usageParams) as any

    // 🔧 调试日志：检查最终返回数据
    console.log('[Trends API] 最终返回数据:', {
      trendsCount: completeTrends.length,
      trendsSample: completeTrends.slice(0, 3),
      distributions: {
        statusCount: statusDistribution.length,
        qualityCount: qualityDistribution.length,
        themeCount: themeDistribution.length,
        keywordAuditCreatives: creativesWithKeywordAudit,
        keywordSourceAuditKeywords: totalKeywordsFromAudit,
      },
      usage: {
        total: Number(usageStats?.total) || 0,
        selected: Number(usageStats?.selected) || 0,
      }
    })

    const keywordAuditDistribution = {
      creativesWithAudit: creativesWithKeywordAudit,
      totalKeywords: totalKeywordsFromAudit,
      byRawSource: keywordSourceByRawSource,
      bySourceSubtype: keywordSourceBySubtype,
      bySourceField: keywordSourceByField,
      fallbackMode: fallbackModeDistribution,
      noVolumeMode: noVolumeModeDistribution,
      contextFallbackStrategy: contextFallbackDistribution,
      sourceQuotaAudit: {
        blockedByCap: sourceQuotaBlockedByCap,
        deferredRefillTriggeredCount: sourceQuotaRefill.triggered,
        deferredRefillCount: sourceQuotaRefill.refillCount,
        underfillBeforeRefill: sourceQuotaRefill.underfillBeforeRefill,
        deferredCount: sourceQuotaRefill.deferredCount,
        acceptedCount: sourceQuotaRefill.acceptedCount,
      },
    }

    // 11. 返回结果（使用 completeTrends 而不是 formattedTrends）
    return NextResponse.json({
      success: true,
      // 每日趋势数据（使用补全后的 completeTrends）
      trends: completeTrends,
      // 分布统计（确保 count 转换为 number）
      distributions: {
        // 状态分布
        status: statusDistribution.reduce((acc, item) => {
          acc[item.status || 'unknown'] = Number(item.count) || 0
          return acc
        }, {} as Record<string, number>),
        // Ad Strength分布
        adStrength: adStrengthDistribution.reduce((acc, item) => {
          acc[item.ad_strength] = Number(item.count) || 0
          return acc
        }, {} as Record<string, number>),
        // 质量评分分布
        quality: qualityDistribution.reduce((acc, item) => {
          acc[item.quality_level] = Number(item.count) || 0
          return acc
        }, {} as Record<string, number>),
        // 主题分布
        theme: themeDistribution.reduce((acc, item) => {
          acc[item.theme] = Number(item.count) || 0
          return acc
        }, {} as Record<string, number>),
        // 关键词来源审计聚合（主字段）
        audit: keywordAuditDistribution,
        // 兼容别名（逐步淘汰）
        keywordSourceAudit: keywordAuditDistribution,
      },
      // 使用统计（确保转换为 number）
      usage: {
        selected: Number(usageStats?.selected) || 0,
        notSelected: Number(usageStats?.notSelected) || 0,
        total: Number(usageStats?.total) || 0,
        usageRate: usageStats?.total > 0
          ? Math.round((Number(usageStats.selected) / Number(usageStats.total)) * 100)
          : 0,
      },
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: rangeDays,
      },
    })
  } catch (error: any) {
    console.error('Get creatives trends error:', error)
    return NextResponse.json(
      { error: error.message || '获取趋势数据失败' },
      { status: 500 }
    )
  }
}
