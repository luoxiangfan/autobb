/**
 * 风险提示系统
 *
 * 功能：
 * - 链接可用性检测
 * - 风险提示创建和管理
 * - 每日自动检查
 */

import { getDatabase } from '@/lib/db'
import { nowFunc, dateMinusDays } from '@/lib/db-helpers'
import { proxyHead } from './proxy-axios'
import { buildUserExecutionEligibleSql } from '@/lib/user-execution-eligibility'

export interface RiskAlert {
  id: number
  userId: number
  alertType: string
  severity: 'critical' | 'warning' | 'info'
  resourceType: 'campaign' | 'creative' | 'offer' | null
  resourceId: number | null
  title: string
  message: string
  details: string | null
  status: 'active' | 'acknowledged' | 'resolved'
  createdAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolutionNote: string | null
}

export interface LinkCheckResult {
  id: number
  offerId: number
  url: string
  statusCode: number | null
  responseTime: number | null
  isAccessible: boolean
  isRedirected: boolean
  finalUrl: string | null
  checkCountry: string
  errorMessage: string | null
  checkedAt: string
}

/**
 * 检查单个链接的可用性
 * 使用统一的代理axios客户端（支持真实地理位置访问）
 */
export async function checkLink(
  url: string,
  country: string = 'US',
  timeout: number = 10000,
  proxyUrl?: string
): Promise<{
  isAccessible: boolean
  statusCode: number | null
  responseTime: number
  isRedirected: boolean
  finalUrl: string | null
  errorMessage: string | null
}> {
  const startTime = Date.now()

  try {
    // 模拟目标国家的User-Agent
    const userAgents: Record<string, string> = {
      US: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      CN: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      UK: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      default: 'Mozilla/5.0 (compatible; GoogleBot/2.1; +http://www.google.com/bot.html)'
    }

    // 使用统一的代理axios客户端发送HEAD请求
    const response = await proxyHead(
      url,
      {
        headers: {
          'User-Agent': userAgents[country] || userAgents.default,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': country === 'CN' ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9'
        },
        maxRedirects: 5, // 允许自动重定向
        validateStatus: (status) => status >= 200 && status < 600, // 接受所有HTTP状态码
        timeout
      },
      {
        customProxyUrl: proxyUrl,
        timeout,
        useCache: true
      }
    )

    const responseTime = Date.now() - startTime

    // 检查是否重定向（通过比较请求URL和最终URL）
    const finalUrl = response.request?.res?.responseUrl
    const isRedirected = finalUrl && finalUrl !== url

    // 2xx和3xx状态码视为可访问
    const isAccessible = response.status >= 200 && response.status < 400

    return {
      isAccessible,
      statusCode: response.status,
      responseTime,
      isRedirected: !!isRedirected,
      finalUrl: isRedirected ? finalUrl : null,
      errorMessage: !isAccessible ? `HTTP ${response.status}` : null
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime

    // 处理axios错误
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout')

    return {
      isAccessible: false,
      statusCode: error.response?.status || null,
      responseTime,
      isRedirected: false,
      finalUrl: null,
      errorMessage: isTimeout
        ? 'Request timeout'
        : error.response?.statusText || error.message || 'Network error'
    }
  }
}

/**
 * 保存链接检查结果
 */
export async function saveLinkCheckResult(
  userId: number,
  offerId: number,
  url: string,
  result: Awaited<ReturnType<typeof checkLink>>,
  country: string = 'US'
): Promise<number> {
  const db = await getDatabase()

  const info = await db.queryOne<{ id: number }>(
    `
    INSERT INTO link_check_history (
      user_id,
      offer_id,
      url,
      status_code,
      response_time,
      is_accessible,
      is_redirected,
      final_url,
      check_country,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
    [
      userId,
      offerId,
      url,
      result.statusCode,
      result.responseTime,
      // 🔧 PostgreSQL兼容性：确保boolean转换为正确的值
      db.type === 'postgres' ? result.isAccessible : (result.isAccessible ? 1 : 0),
      db.type === 'postgres' ? result.isRedirected : (result.isRedirected ? 1 : 0),
      result.finalUrl,
      country,
      result.errorMessage,
    ]
  )

  return info?.id ?? 0
}

/**
 * 创建风险提示
 */
export async function createRiskAlert(
  userId: number,
  alertType: string,
  severity: 'critical' | 'warning' | 'info',
  title: string,
  message: string,
  options?: {
    resourceType?: 'campaign' | 'creative' | 'offer'
    resourceId?: number
    details?: Record<string, any>
  }
): Promise<number> {
  const db = await getDatabase()
  const recentCutoffExpr = dateMinusDays(1, db.type)
  const createdAtExpr = db.type === 'postgres' ? `created_at::timestamp` : 'created_at'

  // 检查是否已存在相同的活跃提示（避免重复）
  const resourceId = options?.resourceId ?? null
  let existingQuery = `
    SELECT id FROM risk_alerts
    WHERE user_id = ?
      AND alert_type = ?
      AND status = 'active'
      AND ${createdAtExpr} >= ${recentCutoffExpr}
  `

  const existingParams: any[] = [userId, alertType]

  if (resourceId === null) {
    existingQuery += ` AND resource_id IS NULL`
  } else {
    existingQuery += ` AND resource_id = ?`
    existingParams.push(resourceId)
  }

  const existing = await db.queryOne(existingQuery, existingParams)

  if (existing) {
    // 已存在相同提示，不重复创建
    return (existing as any).id
  }

  // 创建新提示
  // 🔧 PostgreSQL兼容性：确保undefined值转换为null
  const result = await db.queryOne<{ id: number }>(
    `
    INSERT INTO risk_alerts (
      user_id,
      alert_type,
      severity,
      resource_type,
      resource_id,
      title,
      message,
      details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
    [
      userId,
      alertType,
      severity,
      options?.resourceType ?? null,
      options?.resourceId ?? null,
      title,
      message,
      options?.details ? JSON.stringify(options.details) : null,
    ]
  )

  return result?.id ?? 0
}

/**
 * 获取用户的风险提示列表
 */
export async function getUserRiskAlerts(
  userId: number,
  status?: 'active' | 'acknowledged' | 'resolved',
  limit?: number
): Promise<RiskAlert[]> {
  const db = await getDatabase()
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Number(limit), 50)) : null

  let query = `
    SELECT * FROM risk_alerts
    WHERE user_id = ?
  `

  const params: any[] = [userId]

  if (status) {
    query += ` AND status = ?`
    params.push(status)
  }

  query += ` ORDER BY
    CASE severity
      WHEN 'critical' THEN 0
      WHEN 'warning' THEN 1
      WHEN 'info' THEN 2
    END,
    created_at DESC
  `

  if (normalizedLimit !== null) {
    query += ` LIMIT ?`
    params.push(normalizedLimit)
  }

  const alerts = await db.query(query, params) as any[]

  return alerts.map(a => ({
    id: a.id,
    userId: a.user_id,
    alertType: a.alert_type,
    severity: a.severity,
    resourceType: a.resource_type,
    resourceId: a.resource_id,
    title: a.title,
    message: a.message,
    details: a.details,
    status: a.status,
    createdAt: a.created_at,
    acknowledgedAt: a.acknowledged_at,
    resolvedAt: a.resolved_at,
    resolutionNote: a.resolution_note
  }))
}

/**
 * 更新风险提示状态
 */
export async function updateAlertStatus(
  alertId: number,
  userId: number,
  status: 'acknowledged' | 'resolved',
  note?: string
): Promise<boolean> {
  const db = await getDatabase()

  const stmt = `
    UPDATE risk_alerts
    SET status = ?,
        ${status === 'acknowledged' ? `acknowledged_at = ${nowFunc(db.type)}` : ''},
        ${status === 'resolved' ? `resolved_at = ${nowFunc(db.type)}` : ''},
        resolution_note = ?
    WHERE id = ? AND user_id = ?
  `

  const result = await db.exec(stmt, [status, note || null, alertId, userId])
  return result.changes > 0
}

/**
 * 检查所有用户的Offer链接
 * 需求24: 使用国家特定代理进行真实访问
 */
export async function checkAllUserLinks(userId: number): Promise<{
  totalChecked: number
  accessible: number
  broken: number
  redirected: number
  newAlerts: number
}> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：布尔字段兼容性处理
  const isDeletedFalse = db.type === 'postgres' ? false : 0

  // 获取用户的所有活跃Offers（包含目标国家）
  const offers = await db.query(
    `
    SELECT id, affiliate_link, url, brand, target_country
    FROM offers
    WHERE user_id = ?
      AND affiliate_link IS NOT NULL
      AND affiliate_link != ''
      AND (is_deleted = ? OR is_deleted IS NULL)
  `,
    [userId, isDeletedFalse]
  ) as any[]

  let totalChecked = 0
  let accessible = 0
  let broken = 0
  let redirected = 0
  let newAlerts = 0

  for (const offer of offers) {
    const url = offer.affiliate_link || offer.url
    // 使用Offer的目标国家（需求24要求配置相应国家的代理）
    const country = offer.target_country || 'US'

    // 检查链接（使用国家特定代理）
    const result = await checkLink(url, country, 10000)

    // 保存检查结果
    await saveLinkCheckResult(userId, offer.id, url, result, country)

    totalChecked++

    if (result.isAccessible) {
      accessible++
      if (result.isRedirected) {
        redirected++

        // 创建重定向提示
        await createRiskAlert(
          userId,
          'link_redirect',
          'warning',
          `链接重定向 - ${offer.brand}`,
          `Offer "${offer.brand}" 的链接发生了重定向`,
          {
            resourceType: 'offer',
            resourceId: offer.id,
            details: {
              originalUrl: url,
              finalUrl: result.finalUrl,
              country
            }
          }
        )
        newAlerts++
      }
    } else {
      broken++

      // 创建链接失效提示
      const severity = result.errorMessage?.includes('timeout')
        ? 'warning'
        : 'critical'

      await createRiskAlert(
        userId,
        result.errorMessage?.includes('timeout') ? 'link_timeout' : 'link_broken',
        severity,
        `链接${severity === 'critical' ? '失效' : '超时'} - ${offer.brand}`,
        `Offer "${offer.brand}" 的链接无法访问`,
        {
          resourceType: 'offer',
          resourceId: offer.id,
          details: {
            url,
            statusCode: result.statusCode,
            errorMessage: result.errorMessage,
            country
          }
        }
      )
      newAlerts++
    }
  }

  return {
    totalChecked,
    accessible,
    broken,
    redirected,
    newAlerts
  }
}

/**
 * 检查用户的Google Ads账号状态
 * 需求24: 检测账号暂停、限制投放等状态
 */
export async function checkAdsAccountStatus(userId: number): Promise<{
  totalChecked: number
  activeAccounts: number
  problemAccounts: number
  newAlerts: number
}> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性修复: is_active在PostgreSQL中是BOOLEAN类型
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  // 获取用户的所有活跃Ads账号
  const accounts = await db.query(
    `
    SELECT id, customer_id, account_name, is_active
    FROM google_ads_accounts
    WHERE user_id = ?
      AND ${isActiveCondition}
  `,
    [userId]
  ) as any[]

  if (accounts.length === 0) {
    return {
      totalChecked: 0,
      activeAccounts: 0,
      problemAccounts: 0,
      newAlerts: 0
    }
  }

  // ⚡ P0性能优化: 修复N+1查询问题
  // 原问题: 循环N个accounts，每个执行3次查询 = 3N次查询
  // 优化后: 3次批量查询，使用Map分组 = 3次查询（与accounts数量无关）

  const accountIds = accounts.map(a => a.id)
  const placeholders = accountIds.map(() => '?').join(',')

  // 批量查询1: 所有账号的campaigns count（单次查询）
  const campaignCounts = await db.query(
    `
    SELECT
      google_ads_account_id,
      COUNT(*) as count
    FROM campaigns
    WHERE google_ads_account_id IN (${placeholders})
      AND user_id = ?
      AND status IN ('ENABLED', 'PAUSED')
    GROUP BY google_ads_account_id
  `,
    [...accountIds, userId]
  ) as any[]
  const campaignCountMap = new Map<number, number>()
  for (const row of campaignCounts) {
    campaignCountMap.set(row.google_ads_account_id, row.count)
  }

  // 批量查询2: 所有账号的sync errors count（单次查询）
  const syncErrorsData = await db.query(
    `
    SELECT
      google_ads_account_id,
      COUNT(*) as count
    FROM sync_logs
    WHERE google_ads_account_id IN (${placeholders})
      AND user_id = ?
      AND status = 'failed'
      AND started_at >= datetime('now', '-7 days')
    GROUP BY google_ads_account_id
  `,
    [...accountIds, userId]
  ) as any[]
  const syncErrorsMap = new Map<number, number>()
  for (const row of syncErrorsData) {
    syncErrorsMap.set(row.google_ads_account_id, row.count)
  }

  // 批量查询3: 所有账号的last sync time（单次查询）
  const lastSyncData = await db.query(
    `
    SELECT
      google_ads_account_id,
      MAX(completed_at) as lastSync
    FROM sync_logs
    WHERE google_ads_account_id IN (${placeholders})
      AND user_id = ?
      AND status = 'success'
    GROUP BY google_ads_account_id
  `,
    [...accountIds, userId]
  ) as any[]
  const lastSyncMap = new Map<number, string | null>()
  for (const row of lastSyncData) {
    lastSyncMap.set(row.google_ads_account_id, row.lastSync)
  }

  let totalChecked = 0
  let activeAccounts = 0
  let problemAccounts = 0
  let newAlerts = 0

  // 循环处理每个账号（基于预查询的Map，无额外查询）
  for (const account of accounts) {
    totalChecked++

    const campaignCount = campaignCountMap.get(account.id) || 0
    const syncErrors = syncErrorsMap.get(account.id) || 0

    if (syncErrors > 3) {
      problemAccounts++
      await createRiskAlert(
        userId,
        'account_sync_error',
        'warning',
        `账号同步异常 - ${account.account_name || account.customer_id}`,
        `Google Ads账号近7天内多次同步失败，请检查账号状态`,
        {
          resourceType: 'campaign',
          resourceId: account.id,
          details: {
            customerId: account.customer_id,
            syncErrors,
            campaignCount
          }
        }
      )
      newAlerts++
    } else {
      activeAccounts++
    }

    // 检查账号是否长时间未同步
    const lastSync = lastSyncMap.get(account.id)

    if (lastSync) {
      const daysSinceSync = Math.floor(
        (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60 * 24)
      )

      if (daysSinceSync > 7) {
        await createRiskAlert(
          userId,
          'account_stale_data',
          'info',
          `数据未更新 - ${account.account_name || account.customer_id}`,
          `Google Ads账号已${daysSinceSync}天未同步数据`,
          {
            resourceType: 'campaign',
            resourceId: account.id,
            details: {
              customerId: account.customer_id,
              lastSync,
              daysSinceSync
            }
          }
        )
        newAlerts++
      }
    }
  }

  return {
    totalChecked,
    activeAccounts,
    problemAccounts,
    newAlerts
  }
}

/**
 * 每日链接检查（所有用户）
 * 需求24: 包含链接检查和账号状态检查
 */
export async function dailyLinkCheck(): Promise<{
  totalUsers: number
  totalLinks: number
  totalAlerts: number
  accountChecks: {
    totalAccounts: number
    problemAccounts: number
  }
  results: Record<number, Awaited<ReturnType<typeof checkAllUserLinks>>>
}> {
  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ dbType: db.type, userAlias: 'u' })

  // 🔧 PostgreSQL兼容性：布尔字段兼容性处理
  const isDeletedFalse = db.type === 'postgres' ? false : 0

  // 获取所有有Offers的用户
  const users = await db.query(
    `
    SELECT DISTINCT o.user_id
    FROM offers o
    INNER JOIN users u ON u.id = o.user_id
    WHERE o.affiliate_link IS NOT NULL
      AND o.affiliate_link != ''
      AND (o.is_deleted = ? OR o.is_deleted IS NULL)
      AND ${userEligibleCondition}
  `,
    [isDeletedFalse]
  ) as { user_id: number }[]

  const results: Record<number, Awaited<ReturnType<typeof checkAllUserLinks>>> = {}
  let totalLinks = 0
  let totalAlerts = 0
  let totalAccounts = 0
  let problemAccounts = 0

  for (const user of users) {
    // 检查链接
    const linkResult = await checkAllUserLinks(user.user_id)
    results[user.user_id] = linkResult
    totalLinks += linkResult.totalChecked
    totalAlerts += linkResult.newAlerts

    // 检查账号状态（需求24）
    const accountResult = await checkAdsAccountStatus(user.user_id)
    totalAccounts += accountResult.totalChecked
    problemAccounts += accountResult.problemAccounts
    totalAlerts += accountResult.newAlerts
  }

  return {
    totalUsers: users.length,
    totalLinks,
    totalAlerts,
    accountChecks: {
      totalAccounts,
      problemAccounts
    },
    results
  }
}

/**
 * 获取链接检查历史
 */
export async function getLinkCheckHistory(
  userId: number,
  offerId?: number,
  limit: number = 50
): Promise<LinkCheckResult[]> {
  const db = await getDatabase()

  let query = `
    SELECT * FROM link_check_history
    WHERE user_id = ?
  `

  const params: any[] = [userId]

  if (offerId) {
    query += ` AND offer_id = ?`
    params.push(offerId)
  }

  query += ` ORDER BY checked_at DESC LIMIT ?`
  params.push(limit)

  const history = await db.query(query, params) as any[]

  return history.map(h => ({
    id: h.id,
    offerId: h.offer_id,
    url: h.url,
    statusCode: h.status_code,
    responseTime: h.response_time,
    isAccessible: h.is_accessible === 1,
    isRedirected: h.is_redirected === 1,
    finalUrl: h.final_url,
    checkCountry: h.check_country,
    errorMessage: h.error_message,
    checkedAt: h.checked_at
  }))
}

/**
 * 获取风险统计
 */
export async function getRiskStatistics(userId: number): Promise<{
  total: number
  active: number
  critical: number
  warning: number
  info: number
  byType: Record<string, number>
}> {
  const db = await getDatabase()
  const recentCutoffExpr = dateMinusDays(30, db.type)
  const createdAtExpr = db.type === 'postgres' ? `created_at::timestamp` : 'created_at'

  const rows = await db.query(
    `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN severity = 'critical' AND status = 'active' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN severity = 'warning' AND status = 'active' THEN 1 ELSE 0 END) as warning,
      SUM(CASE WHEN severity = 'info' AND status = 'active' THEN 1 ELSE 0 END) as info,
      alert_type,
      COUNT(*) as type_count
    FROM risk_alerts
    WHERE user_id = ?
      AND ${createdAtExpr} >= ${recentCutoffExpr}
    GROUP BY alert_type
  `,
    [userId]
  ) as any[]

  const byType: Record<string, number> = {}
  let total = 0
  let active = 0
  let critical = 0
  let warning = 0
  let info = 0

  rows.forEach(row => {
    byType[row.alert_type] = row.type_count
    total += row.total
    active += row.active
    critical += row.critical
    warning += row.warning
    info += row.info
  })

  return {
    total,
    active,
    critical,
    warning,
    info,
    byType
  }
}
