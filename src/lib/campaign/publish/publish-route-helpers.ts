import type { ScoreAnalysis } from '@/lib/launch-score/server'
import { isGoogleAdsAccountAccessError } from '@/lib/google-ads/oauth/login-customer'

export const SINGLE_BRAND_PER_ACCOUNT_ENFORCED =
  (process.env.CAMPAIGN_PUBLISH_ENFORCE_SINGLE_BRAND_PER_ACCOUNT || 'true').trim().toLowerCase() !==
  'false'

export function normalizeBrand(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

const MAX_INT32 = 2147483647

export function normalizeAccountIdInput(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
}

export function toSafePositiveInt32(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_INT32) {
    return null
  }
  return parsed
}

export function normalizeCustomerId(value: string): string {
  return value.replace(/-/g, '')
}

export function isOAuthTokenExpiredOrRevoked(err: any): boolean {
  const message = String(err?.message || '')
  const causeMessage = String(err?.cause?.message || '')
  const combined = `${message}\n${causeMessage}`
  return (
    combined.includes('invalid_grant') || combined.includes('Token has been expired or revoked')
  )
}

export function extractGoogleAdsRequestId(error: any): string | undefined {
  const candidates = [
    error?.request_id,
    error?.requestId,
    error?.response?.request_id,
    error?.response?.requestId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return undefined
}

export function isGoogleAdsAccountPermissionDenied(error: any): boolean {
  return isGoogleAdsAccountAccessError(error)
}

export function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') {
    return true
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true'
  }

  return false
}

/**
 * 从ScoreAnalysis中提取所有问题（v4.0 - 4维度）
 */
export function extractAllIssues(analysis: ScoreAnalysis): string[] {
  return [
    ...(analysis.launchViability?.issues || []),
    ...(analysis.adQuality?.issues || []),
    ...(analysis.keywordStrategy?.issues || []),
    ...(analysis.basicConfig?.issues || []),
  ]
}

/**
 * 从ScoreAnalysis中提取所有建议（v4.0 - 4维度）
 */
export function extractAllSuggestions(analysis: ScoreAnalysis): string[] {
  return [
    ...(analysis.launchViability?.suggestions || []),
    ...(analysis.adQuality?.suggestions || []),
    ...(analysis.keywordStrategy?.suggestions || []),
    ...(analysis.basicConfig?.suggestions || []),
  ]
}
