import { type Customer, enums } from 'google-ads-api'
import { isGoogleAdsAccountAccessError } from '@/lib/google-ads/oauth/login-customer'
import { getGoogleAdsGeoTargetId } from '../../common/server'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { withRetry } from '../../common/server'
import { trackOAuthApiCall } from './shared'

export function getGeoTargetConstantId(countryCode: string): number | null {
  const geoTargetIdString = getGoogleAdsGeoTargetId(countryCode)
  const geoTargetId = parseInt(geoTargetIdString, 10)
  return Number.isFinite(geoTargetId) ? geoTargetId : null
}

/**
 * 语言代码/名称到Language Constant ID的映射
 * 参考: https://developers.google.com/google-ads/api/reference/data/codes-formats
 *
 * 支持两种输入格式：
 * 1. 语言代码：'en', 'zh', 'es' 等
 * 2. 语言名称：'English', 'Chinese', 'Spanish' 等
 */
export function getLanguageConstantId(input: string): number | null {
  // 语言代码到Constant ID的映射
  const languageCodeMap: Record<string, number> = {
    en: 1000, // English
    zh: 1017, // Chinese (Simplified)
    'zh-cn': 1017, // Chinese (Simplified)
    'zh-tw': 1018, // Chinese (Traditional)
    ja: 1005, // Japanese
    de: 1001, // German
    fr: 1002, // French
    es: 1003, // Spanish
    it: 1004, // Italian
    ko: 1012, // Korean
    ru: 1031, // Russian
    pt: 1014, // Portuguese
    ar: 1019, // Arabic
    hi: 1023, // Hindi
  }

  // 语言名称到语言代码的映射
  const languageNameMap: Record<string, string> = {
    english: 'en',
    'chinese (simplified)': 'zh-cn',
    'chinese (traditional)': 'zh-tw',
    chinese: 'zh',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    japanese: 'ja',
    korean: 'ko',
    portuguese: 'pt',
    italian: 'it',
    russian: 'ru',
    arabic: 'ar',
    hindi: 'hi',
  }

  const normalized = input.toLowerCase().trim()

  // 先尝试直接匹配语言代码
  if (languageCodeMap[normalized]) {
    return languageCodeMap[normalized]
  }

  // 再尝试匹配语言名称
  const code = languageNameMap[normalized]
  if (code && languageCodeMap[code]) {
    return languageCodeMap[code]
  }

  return null
}

/**
 * 创建Google Ads广告系列
 */
export function isDuplicateCampaignNameError(error: any): boolean {
  const errors = error?.errors
  if (!Array.isArray(errors)) return false
  return errors.some((e: any) => {
    const code = e?.error_code?.campaign_error
    return code === 'DUPLICATE_CAMPAIGN_NAME' || code === 12
  })
}

export function escapeGaqlStringLiteral(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
}

function normalizeCampaignDateValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined

  const ymd = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  if (ymd) return ymd[1]

  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`

  return normalized
}

export function formatCampaignDateTimeForMutate(value: Date | string, endOfDay = false): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid campaign date: ${String(value)}`)
  }
  const ymd = date.toISOString().split('T')[0]
  return endOfDay ? `${ymd} 23:59:59` : `${ymd} 00:00:00`
}

// 兼容 Google Ads API v23：Campaign.start_date/end_date 已迁移为 *_date_time
export function normalizeCampaignDateFields(rows: any[]): any[] {
  return rows.map((row: any) => {
    const campaign = row?.campaign
    if (!campaign || typeof campaign !== 'object') {
      return row
    }

    const startDate =
      normalizeCampaignDateValue(campaign.start_date_time) ??
      normalizeCampaignDateValue(campaign.start_date)
    const endDate =
      normalizeCampaignDateValue(campaign.end_date_time) ??
      normalizeCampaignDateValue(campaign.end_date)

    return {
      ...row,
      campaign: {
        ...campaign,
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
      },
    }
  })
}

export async function createCampaignBudget(
  customer: Customer,
  params: {
    name: string
    amount: number
    deliveryMethod: 'STANDARD' | 'ACCELERATED'
    userId: number
    customerId: string
  }
): Promise<string> {
  // Google Ads：平均日预算默认可被多个系列引用（explicitly_shared 默认 true，见 share-budgets 文档）。
  // 本系统每系列独立预算，必须显式 explicitly_shared=false。
  const budget = {
    name: params.name,
    amount_micros: params.amount * 1000000, // 转换为micros (1 USD = 1,000,000 micros)
    delivery_method:
      params.deliveryMethod === 'STANDARD'
        ? enums.BudgetDeliveryMethod.STANDARD
        : enums.BudgetDeliveryMethod.ACCELERATED,
    explicitly_shared: false,
  }

  const response = await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/campaign-budget/create',
    () =>
      withRetry(() => customer.campaignBudgets.create([budget]), {
        maxRetries: 3,
        initialDelay: 1000,
        // login_customer_id 权限错误应立即切换候选，不应在同一候选上指数退避重试。
        shouldRetry: (error) => !isGoogleAdsAccountAccessError(error),
        operationName: `Create Budget: ${params.name}`,
      })
  )

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建预算失败')
  }

  return response.results[0].resource_name || ''
}
