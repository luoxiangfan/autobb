import { trackApiUsage, type ApiOperationType } from '@/lib/google-ads/api/tracker'

export function serializeGoogleAdsError(error: unknown): string {
  const primaryMessage = String((error as any)?.message || '').trim()
  const googleAdsErrors = Array.isArray((error as any)?.errors) ? (error as any).errors : []
  const googleAdsDetail = googleAdsErrors
    .map((item: any) => String(item?.message || '').trim())
    .filter(Boolean)
    .join(' | ')

  if (primaryMessage && googleAdsDetail && !primaryMessage.includes(googleAdsDetail)) {
    return `${primaryMessage} | ${googleAdsDetail}`.slice(0, 4000)
  }
  if (primaryMessage) {
    return primaryMessage.slice(0, 4000)
  }
  if (googleAdsDetail) {
    return googleAdsDetail.slice(0, 4000)
  }

  try {
    const serialized = JSON.stringify(error)
    if (serialized && serialized !== '{}') {
      return serialized.slice(0, 4000)
    }
  } catch {
    // ignore JSON serialization failure and fall back to string coercion
  }

  return String(error || 'Unknown Google Ads error').slice(0, 4000)
}

/**
 * 🔧 新增(2025-01-05): OAuth API 调用追踪包装器
 * 用于在 OAuth 模式下追踪 Google Ads API 调用
 */
export async function trackOAuthApiCall<T>(
  userId: number,
  customerId: string,
  operationType: ApiOperationType,
  endpoint: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()
  try {
    const result = await fn()
    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: true,
    })
    return result
  } catch (error: any) {
    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: false,
      errorMessage: serializeGoogleAdsError(error),
    })
    throw error
  }
}
