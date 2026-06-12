import {
  createGoogleAdsLogger,
  type GoogleAdsLogFields,
  type GoogleAdsLogScope,
} from '../common/logger'

type GoogleAdsAuthRouteLogFields = Record<string, string | number | boolean | null | undefined>

function toLogFields(fields?: GoogleAdsAuthRouteLogFields): GoogleAdsLogFields {
  return fields ?? {}
}

function scopedLogger(scope: GoogleAdsLogScope) {
  return createGoogleAdsLogger(scope)
}

const oauthLog = scopedLogger('oauth')
const credentialsLog = scopedLogger('credentials')
const verifyLog = scopedLogger('verify')
const accountsLog = scopedLogger('accounts')

export function logGoogleAdsOAuthDebug(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  oauthLog.debug(event, toLogFields(fields))
}

export function logGoogleAdsOAuthInfo(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  oauthLog.info(event, toLogFields(fields))
}

export function logGoogleAdsOAuthError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  oauthLog.error(event, toLogFields(fields), error)
}

export function logGoogleAdsCredentialsDebug(
  event: string,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  credentialsLog.debug(event, toLogFields(fields))
}

export function logGoogleAdsCredentialsInfo(
  event: string,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  credentialsLog.info(event, toLogFields(fields))
}

export function logGoogleAdsCredentialsWarn(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  credentialsLog.warn(event, toLogFields(fields), error)
}

export function logGoogleAdsCredentialsError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  credentialsLog.error(event, toLogFields(fields), error)
}

export function logGoogleAdsVerifyDebug(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  verifyLog.debug(event, toLogFields(fields))
}

export function logGoogleAdsVerifyInfo(event: string, fields?: GoogleAdsAuthRouteLogFields): void {
  verifyLog.info(event, toLogFields(fields))
}

export function logGoogleAdsVerifyWarn(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  verifyLog.warn(event, toLogFields(fields), error)
}

export function logGoogleAdsVerifyError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  verifyLog.error(event, toLogFields(fields), error)
}

export function logGoogleAdsAccountsDebug(
  event: string,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  accountsLog.debug(event, toLogFields(fields))
}

export function logGoogleAdsAccountsWarn(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  accountsLog.warn(event, toLogFields(fields), error)
}

export function logGoogleAdsAccountsError(
  event: string,
  error: unknown,
  fields?: GoogleAdsAuthRouteLogFields
): void {
  accountsLog.error(event, toLogFields(fields), error)
}

export { createGoogleAdsLogger } from '../common/logger'
export type { GoogleAdsLogFields, GoogleAdsLogScope } from '../common/logger'
