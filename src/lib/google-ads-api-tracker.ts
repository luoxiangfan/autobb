/**
 * Google Ads API调用追踪器
 * 用于记录和监控API配额使用情况
 *
 * 根据 https://developers.google.com/google-ads/api/docs/best-practices/quotas
 * - Explorer Access: 2,880 次操作/天
 * - Basic Access: 15,000 次操作/天
 * - Standard Access: 无限次/天
 * - Mutate操作权重更高
 * - Report/Search操作权重较低
 */

import { getDatabase } from './db'

const QUOTA_LIMITS = {
  test: 0,        // Test access: 只能访问测试账号，生产环境配额为0
  explorer: 2880,
  basic: 15000,
  standard: -1,   // -1 表示无限配额
} as const

const DEFAULT_EXPLORER_DAILY_QUOTA_LIMIT = QUOTA_LIMITS.explorer

function parsePositiveInt(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

async function resolveDailyQuotaLimit(userId: number): Promise<number> {
  const envLimit = parsePositiveInt(process.env.GOOGLE_ADS_DAILY_QUOTA_LIMIT)
  if (envLimit) return envLimit

  try {
    const db = getDatabase()

    // 首先尝试从用户的 Google Ads 凭证中获取 API 访问级别
    const credentialsRow = await db.queryOne(`
      SELECT api_access_level
      FROM google_ads_credentials
      WHERE user_id = ?
      LIMIT 1
    `, [userId]) as { api_access_level?: string } | undefined

    if (credentialsRow?.api_access_level) {
      const level = credentialsRow.api_access_level.toLowerCase()
      if (level === 'test') return QUOTA_LIMITS.test
      if (level === 'basic') return QUOTA_LIMITS.basic
      if (level === 'explorer') return QUOTA_LIMITS.explorer
      if (level === 'standard') return QUOTA_LIMITS.standard
    }

    // 如果没有 OAuth 凭证，尝试从服务账号获取
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
    const serviceAccountRow = await db.queryOne(`
      SELECT api_access_level
      FROM google_ads_service_accounts
      WHERE user_id = ? AND ${isActiveCondition}
      LIMIT 1
    `, [userId]) as { api_access_level?: string } | undefined

    if (serviceAccountRow?.api_access_level) {
      const level = serviceAccountRow.api_access_level.toLowerCase()
      if (level === 'test') return QUOTA_LIMITS.test
      if (level === 'basic') return QUOTA_LIMITS.basic
      if (level === 'explorer') return QUOTA_LIMITS.explorer
      if (level === 'standard') return QUOTA_LIMITS.standard
    }

    // 最后尝试从 system_settings 获取
    const row = await db.queryOne(`
      SELECT value
      FROM system_settings
      WHERE category = 'google_ads'
        AND key IN ('daily_quota_limit', 'quota_limit')
        AND (user_id = ? OR user_id IS NULL)
      ORDER BY
        CASE WHEN user_id = ? THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1
    `, [userId, userId]) as { value?: unknown } | undefined

    const settingsLimit = parsePositiveInt(row?.value)
    if (settingsLimit) return settingsLimit
  } catch {
    // system_settings 在少数极简部署中可能不存在，不影响主流程
  }

  return DEFAULT_EXPLORER_DAILY_QUOTA_LIMIT
}

/**
 * API操作类型
 * 根据Google Ads API配额文档分类
 */
export enum ApiOperationType {
  // 查询操作（权重：1）
  SEARCH = 'search',
  SEARCH_STREAM = 'search_stream',

  // 变更操作（权重：取决于操作数量）
  MUTATE = 'mutate',
  MUTATE_BATCH = 'mutate_batch',

  // 报告操作（权重：1）
  REPORT = 'report',

  // 其他操作
  GET_RECOMMENDATIONS = 'get_recommendations',
  GET_KEYWORD_IDEAS = 'get_keyword_ideas',
  GET_AD_STRENGTH = 'get_ad_strength',

  // OAuth和账号操作（不计入配额）
  OAUTH = 'oauth',
  LIST_ACCOUNTS = 'list_accounts',
}

export interface ApiUsageRecord {
  userId: number
  operationType: ApiOperationType
  endpoint: string
  customerId?: string
  requestCount?: number // 实际API操作计数（mutate操作可能>1）
  responseTimeMs?: number
  isSuccess: boolean
  errorMessage?: string
}

/**
 * 记录API调用
 * 如果调用失败，尝试从错误消息中检测API访问级别
 */
export async function trackApiUsage(record: ApiUsageRecord): Promise<void> {
  try {
    const db = getDatabase()
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    // PostgreSQL需要true/false，SQLite需要1/0
    const isSuccessValue = db.type === 'postgres' ? record.isSuccess : (record.isSuccess ? 1 : 0)

    await db.exec(`
      INSERT INTO google_ads_api_usage (
        user_id,
        operation_type,
        endpoint,
        customer_id,
        request_count,
        response_time_ms,
        is_success,
        error_message,
        date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      record.userId,
      record.operationType,
      record.endpoint,
      record.customerId || null,
      record.requestCount || 1,
      record.responseTimeMs || null,
      isSuccessValue,
      record.errorMessage || null,
      today
    ])

    // 🆕 如果API调用失败且有错误消息，尝试检测访问级别
    if (!record.isSuccess && record.errorMessage) {
      try {
        const { detectAndUpdateFromError } = await import('./google-ads-access-level-detector')
        const { getUserAuthType } = await import('./google-ads-oauth')

        const auth = await getUserAuthType(record.userId)
        await detectAndUpdateFromError(record.userId, auth.authType, record.errorMessage)
      } catch (detectError) {
        // 不影响主流程
        console.debug('尝试从错误检测访问级别失败:', detectError)
      }
    }
  } catch (error) {
    // 不阻塞主流程，但记录错误
    console.error('Failed to track API usage:', error)
  }
}

/**
 * 获取今天的API使用统计
 */
export interface DailyUsageStats {
  date: string
  totalRequests: number
  totalOperations: number
  successfulOperations: number
  failedOperations: number
  avgResponseTimeMs: number | null
  maxResponseTimeMs: number | null
  quotaUsagePercent: number
  quotaLimit: number
  quotaRemaining: number
  operationBreakdown: {
    [key: string]: number
  }
}

export async function getDailyUsageStats(userId: number, date?: string): Promise<DailyUsageStats> {
  const db = getDatabase()
  const targetDate = date || new Date().toISOString().split('T')[0]

  // 根据数据库类型调整 SQL（PostgreSQL 使用 BOOLEAN，SQLite 使用 INTEGER）
  const isSuccessCondition = db.type === 'postgres'
    ? "CASE WHEN is_success = true THEN 1 ELSE 0 END"
    : "CASE WHEN is_success = 1 THEN 1 ELSE 0 END"

  const isFailureCondition = db.type === 'postgres'
    ? "CASE WHEN is_success = false THEN 1 ELSE 0 END"
    : "CASE WHEN is_success = 0 THEN 1 ELSE 0 END"

  // 获取汇总统计
  const summary = await db.queryOne(`
    SELECT
      SUM(request_count) as total_requests,
      COUNT(*) as total_operations,
      SUM(${isSuccessCondition}) as successful_operations,
      SUM(${isFailureCondition}) as failed_operations,
      AVG(response_time_ms) as avg_response_time_ms,
      MAX(response_time_ms) as max_response_time_ms
    FROM google_ads_api_usage
    WHERE user_id = ? AND date = ?
  `, [userId, targetDate]) as any

  // 获取操作类型分布
  const breakdownRows = await db.query(`
    SELECT
      operation_type,
      SUM(request_count) as count
    FROM google_ads_api_usage
    WHERE user_id = ? AND date = ?
    GROUP BY operation_type
  `, [userId, targetDate]) as any[]

  const operationBreakdown: { [key: string]: number } = {}
  breakdownRows.forEach(row => {
    operationBreakdown[row.operation_type] = Number(row.count) || 0
  })

  const totalRequests = Number(summary?.total_requests) || 0
  const quotaLimit = await resolveDailyQuotaLimit(userId)
  const isUnlimitedQuota = quotaLimit < 0
  const quotaUsagePercent = isUnlimitedQuota
    ? 0
    : quotaLimit === 0
      ? (totalRequests > 0 ? 100 : 0)
      : (totalRequests / quotaLimit) * 100
  const quotaRemaining = isUnlimitedQuota ? -1 : Math.max(0, quotaLimit - totalRequests)

  return {
    date: targetDate,
    totalRequests,
    totalOperations: Number(summary?.total_operations) || 0,
    successfulOperations: Number(summary?.successful_operations) || 0,
    failedOperations: Number(summary?.failed_operations) || 0,
    avgResponseTimeMs: summary?.avg_response_time_ms ? Number(summary.avg_response_time_ms) : null,
    maxResponseTimeMs: summary?.max_response_time_ms ? Number(summary.max_response_time_ms) : null,
    quotaUsagePercent,
    quotaLimit,
    quotaRemaining,
    operationBreakdown
  }
}

/**
 * 获取最近N天的使用趋势
 */
export interface UsageTrend {
  date: string
  totalRequests: number
  successRate: number
}

export async function getUsageTrend(userId: number, days: number = 7): Promise<UsageTrend[]> {
  const db = getDatabase()

  // 根据数据库类型调整 SQL
  const isSuccessCondition = db.type === 'postgres'
    ? "CASE WHEN is_success = true THEN 1 ELSE 0 END"
    : "CASE WHEN is_success = 1 THEN 1 ELSE 0 END"

  // PostgreSQL 和 SQLite 的日期函数不同
  // 由于 date 字段是 TEXT 类型（存储 'YYYY-MM-DD' 格式），需要返回相同格式进行比较
  const dateCondition = db.type === 'postgres'
    ? `date >= to_char(CURRENT_DATE - INTERVAL '${days} days', 'YYYY-MM-DD')`
    : `date >= date('now', '-${days} days')`

  const rows = await db.query(`
    SELECT
      date,
      SUM(request_count) as total_requests,
      SUM(${isSuccessCondition}) * 100.0 / COUNT(*) as success_rate
    FROM google_ads_api_usage
    WHERE user_id = ?
      AND ${dateCondition}
    GROUP BY date
    ORDER BY date DESC
  `, [userId]) as any[]

  return rows.map(row => ({
    date: row.date,
    totalRequests: Number(row.total_requests) || 0,
    successRate: Number(row.success_rate) || 0
  }))
}

/**
 * 检查是否接近配额限制
 */
export async function checkQuotaLimit(userId: number, warningThreshold: number = 0.8): Promise<{
  isNearLimit: boolean
  isOverLimit: boolean
  currentUsage: number
  limit: number
  percentUsed: number
}> {
  const stats = await getDailyUsageStats(userId)
  const isUnlimitedQuota = stats.quotaLimit < 0
  const percentUsed = isUnlimitedQuota
    ? 0
    : stats.quotaLimit === 0
      ? (stats.totalRequests > 0 ? 1 : 0)
      : (stats.quotaUsagePercent / 100)

  return {
    isNearLimit: !isUnlimitedQuota && percentUsed >= warningThreshold,
    isOverLimit: !isUnlimitedQuota && percentUsed >= 1.0,
    currentUsage: stats.totalRequests,
    limit: stats.quotaLimit,
    percentUsed: stats.quotaUsagePercent
  }
}
