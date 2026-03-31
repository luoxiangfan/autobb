import { NextRequest, NextResponse } from 'next/server'
import { getDailyUsageStats, getUsageTrend, checkQuotaLimit } from '@/lib/google-ads-api-tracker'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getDatabase } from '@/lib/db'

type RateLimitEvent = {
  occurredAt: string
  message: string
  endpoint: string | null
}

const RATE_LIMIT_MESSAGE_PATTERNS = [
  'too many requests',
  'quota_error',
  'retry in',
  'number of operations for explorer access',
]

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * GET /api/dashboard/api-quota
 * 获取Google Ads API配额使用情况
 *
 * 🔧 修复(2025-12-12): 独立账号模式 - 每个用户只能查看自己的API使用统计
 * - 如果用户配置了自己的Google Ads API凭证 → 显示该用户的API使用统计
 * - 如果用户未配置凭证 → 返回空数据，不再回退到管理员数据
 *
 * 🔧 修复(2025-01-05): 同时支持 OAuth 和服务账号两种认证模式
 * - OAuth 用户: 检查 google_ads_credentials 表
 * - 服务账号用户: 检查 google_ads_service_accounts 表
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7', 10)
    const currentUserId = parseInt(userId, 10)

    // 🔧 修复(2025-01-05): 同时检查 OAuth 和服务账号凭证
    const userCredentials = await getGoogleAdsCredentials(currentUserId)
    const db = await getDatabase()
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
    const serviceAccount = await db.queryOne(
      `SELECT id FROM google_ads_service_accounts WHERE user_id = ? AND ${isActiveCondition} LIMIT 1`,
      [currentUserId]
    ) as { id: string } | undefined

    // 如果两种认证模式都没有配置，返回空数据
    if (!userCredentials && !serviceAccount) {
      return NextResponse.json({
        success: true,
        data: {
          today: {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            avgResponseTimeMs: 0
          },
          trend: [],
          quotaCheck: {
            isOverLimit: false,
            isNearLimit: false,
            usage: 0,
            limit: 0
          },
          recommendations: ['ℹ️ 您尚未配置 Google Ads API 凭证，请先在设置页面完成配置'],
          hasCredentials: false,
          latestRateLimitEvent: null,
        }
      })
    }

    // 获取今天的使用统计
    const todayStats = await getDailyUsageStats(currentUserId)

    // 获取最近N天的趋势
    const trend = await getUsageTrend(currentUserId, days)

    // 检查配额限制
    const quotaCheck = await checkQuotaLimit(currentUserId, 0.8)

    // 🔧 友好化：提取当天最常见的失败原因，给出更具体的建议
    const topFailureMessage = await getTopFailureMessageForToday(currentUserId)
    const latestRateLimitEvent = await getLatestRateLimitEventForToday(currentUserId)

    return NextResponse.json({
      success: true,
      data: {
        today: todayStats,
        trend,
        quotaCheck,
        recommendations: generateRecommendations(todayStats, quotaCheck, topFailureMessage),
        hasCredentials: true,
        latestRateLimitEvent,
      }
    })
  } catch (error: any) {
    console.error('获取API配额统计失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取API配额统计失败',
      },
      { status: 500 }
    )
  }
}

/**
 * 根据使用情况生成建议
 */
function generateRecommendations(stats: any, check: any, topFailureMessage?: string | null): string[] {
  const recommendations: string[] = []

  if (check.isOverLimit) {
    recommendations.push('⚠️ 已超出每日配额限制，请明天再试或联系技术支持提升配额')
  } else if (check.isNearLimit) {
    recommendations.push('⚠️ 接近每日配额限制，请谨慎使用API操作')
  }

  // 改进：只有当样本量足够大（>=5次）且失败率超过20%时才提示
  // 避免小样本量时的误报警
  if (stats.totalOperations >= 5 && stats.failedOperations > stats.totalOperations * 0.2) {
    const msg = (topFailureMessage || '').toLowerCase()
    if (msg.includes('developer token') && msg.includes('not valid')) {
      recommendations.push('💡 Developer Token 无效：检查是否包含多余空格/换行，并确认 Token 属于当前 GCP 项目')
    } else if (msg.includes('developer_token_not_approved') || msg.includes('only approved for use with test accounts') || (msg.includes('developer token') && msg.includes('not approved'))) {
      recommendations.push('💡 Developer Token 仍为测试权限（Test access）/未通过生产审核：只能访问测试账号，请先升级 Token 权限')
    } else {
      recommendations.push('💡 失败操作较多，建议检查API调用参数和权限')
    }
  }

  if (stats.avgResponseTimeMs && stats.avgResponseTimeMs > 2000) {
    recommendations.push('💡 平均响应时间较长，建议使用批量操作或优化查询')
  }

  // 不再添加"API使用正常，配额充足"文案
  // 如果没有任何警告或建议，返回空数组（不显示Alert组件）

  return recommendations
}

async function getTopFailureMessageForToday(userId: number): Promise<string | null> {
  try {
    const db = await getDatabase()
    const today = formatLocalYmd(new Date())
    const isFailureCondition = db.type === 'postgres' ? 'is_success = false' : 'is_success = 0'

    const row = await db.queryOne(
      `
        SELECT error_message, COUNT(*) as cnt
        FROM google_ads_api_usage
        WHERE user_id = ?
          AND date = ?
          AND ${isFailureCondition}
          AND error_message IS NOT NULL
          AND TRIM(error_message) != ''
        GROUP BY error_message
        ORDER BY cnt DESC
        LIMIT 1
      `,
      [userId, today]
    ) as { error_message?: string | null } | undefined

    return row?.error_message ? String(row.error_message) : null
  } catch {
    return null
  }
}

function normalizeRateLimitEventMessage(input: string): string {
  const normalized = input.replace(/\s+/g, ' ').trim()
  const retryInMatch = normalized.match(/retry in\s+\d+\s+seconds\.?/i)
  if (retryInMatch) {
    return retryInMatch[0]
  }
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized
}

async function getLatestRateLimitEventForToday(userId: number): Promise<RateLimitEvent | null> {
  try {
    const db = await getDatabase()
    const today = formatLocalYmd(new Date())
    const isFailureCondition = db.type === 'postgres' ? 'is_success = false' : 'is_success = 0'

    const likeClauses = RATE_LIMIT_MESSAGE_PATTERNS
      .map(() => 'LOWER(error_message) LIKE ?')
      .join(' OR ')
    const likeValues = RATE_LIMIT_MESSAGE_PATTERNS.map((pattern) => `%${pattern}%`)

    const row = await db.queryOne(
      `
        SELECT created_at, error_message, endpoint
        FROM google_ads_api_usage
        WHERE user_id = ?
          AND date = ?
          AND ${isFailureCondition}
          AND error_message IS NOT NULL
          AND TRIM(error_message) != ''
          AND (${likeClauses})
        ORDER BY CASE WHEN endpoint = 'publishCampaign' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
      `,
      [userId, today, ...likeValues]
    ) as {
      created_at?: string | null
      error_message?: string | null
      endpoint?: string | null
    } | undefined

    const message = String(row?.error_message || '').trim()
    const occurredAt = String(row?.created_at || '').trim()
    if (!message || !occurredAt) return null

    return {
      occurredAt,
      message: normalizeRateLimitEventMessage(message),
      endpoint: row?.endpoint ?? null,
    }
  } catch {
    return null
  }
}
