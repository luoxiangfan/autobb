import { logger } from '@/lib/logger'

type GoogleAdsAuthRouteLogFields = Record<string, string | number | boolean | null | undefined>

function scopedPrefix(scope: 'oauth' | 'credentials' | 'verify' | 'accounts'): string {
  return `[google_ads_${scope}]`
}

export function logGoogleAdsOAuthDebug(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  logger.debug(`${scopedPrefix('oauth')} ${event}`, fields ?? {})
}

export function logGoogleAdsOAuthInfo(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  logger.info(`${scopedPrefix('oauth')} ${event}`, fields ?? {})
}

export function logGoogleAdsOAuthError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`${scopedPrefix('oauth')} ${event}`, { ...fields, message })
}

export function logGoogleAdsCredentialsDebug(
  event: string,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  logger.debug(`${scopedPrefix('credentials')} ${event}`, fields ?? {})
}

export function logGoogleAdsCredentialsInfo(
  event: string,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  logger.info(`${scopedPrefix('credentials')} ${event}`, fields ?? {})
}

export function logGoogleAdsCredentialsWarn(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.warn(`${scopedPrefix('credentials')} ${event}`, { ...fields, message })
}

export function logGoogleAdsCredentialsError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`${scopedPrefix('credentials')} ${event}`, { ...fields, message })
}

export function logGoogleAdsVerifyDebug(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  logger.debug(`${scopedPrefix('verify')} ${event}`, fields ?? {})
}

export function logGoogleAdsVerifyInfo(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  logger.info(`${scopedPrefix('verify')} ${event}`, fields ?? {})
}

export function logGoogleAdsVerifyWarn(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.warn(`${scopedPrefix('verify')} ${event}`, { ...fields, message })
}

export function logGoogleAdsVerifyError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`${scopedPrefix('verify')} ${event}`, { ...fields, message })
}

export function logGoogleAdsAccountsDebug(
  event: string,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  logger.debug(`${scopedPrefix('accounts')} ${event}`, fields ?? {})
}

export function logGoogleAdsAccountsWarn(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.warn(`${scopedPrefix('accounts')} ${event}`, { ...fields, message })
}

export function logGoogleAdsAccountsError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`${scopedPrefix('accounts')} ${event}`, { ...fields, message })
}
