import { logger } from '@/lib/logger'

type OAuthRouteLogFields = Record<string, string | number | boolean | null | undefined>

export function logGoogleAdsOAuthDebug(event: string, fields?: OAuthRouteLogFields): void {
  logger.debug(`[google_ads_oauth] ${event}`, fields ?? {})
}

export function logGoogleAdsOAuthInfo(event: string, fields?: OAuthRouteLogFields): void {
  logger.info(`[google_ads_oauth] ${event}`, fields ?? {})
}

export function logGoogleAdsOAuthError(
  event: string,
  error: unknown,
  fields?: OAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`[google_ads_oauth] ${event}`, { ...fields, message })
}
