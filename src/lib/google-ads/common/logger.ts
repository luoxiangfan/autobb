import { logger } from '@/lib/structured-logger'

export type GoogleAdsLogScope =
  | 'oauth'
  | 'credentials'
  | 'verify'
  | 'accounts'
  | 'keyword'
  | 'api'
  | 'campaign'
  | 'sync'
  | 'conversion'
  | 'settings'
  | 'performance'

export type GoogleAdsLogFields = Record<string, unknown>

function scopedMessage(scope: GoogleAdsLogScope, event: string): string {
  return `google_ads.${scope} ${event}`
}

function errorMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined
  return error instanceof Error ? error.message : String(error)
}

export function createGoogleAdsLogger(scope: GoogleAdsLogScope) {
  return {
    debug(event: string, fields: GoogleAdsLogFields = {}) {
      logger.debug(scopedMessage(scope, event), { scope, event, ...fields })
    },
    info(event: string, fields: GoogleAdsLogFields = {}) {
      logger.info(scopedMessage(scope, event), { scope, event, ...fields })
    },
    warn(event: string, fields: GoogleAdsLogFields = {}, error?: unknown) {
      const errMsg = errorMessage(error)
      logger.warn(scopedMessage(scope, event), {
        scope,
        event,
        ...fields,
        ...(errMsg !== undefined ? { errMessage: errMsg } : {}),
      })
    },
    error(event: string, fields: GoogleAdsLogFields = {}, error?: unknown) {
      logger.error(scopedMessage(scope, event), { scope, event, ...fields }, error)
    },
  }
}

export const googleAdsKeywordLogger = createGoogleAdsLogger('keyword')
export const googleAdsSyncLogger = createGoogleAdsLogger('sync')
export const googleAdsAccountsLogger = createGoogleAdsLogger('accounts')
export const googleAdsCampaignLogger = createGoogleAdsLogger('campaign')
export const googleAdsApiLogger = createGoogleAdsLogger('api')
export const googleAdsOAuthLogger = createGoogleAdsLogger('oauth')
export const googleAdsCredentialsLogger = createGoogleAdsLogger('credentials')
export const googleAdsSettingsLogger = createGoogleAdsLogger('settings')
export const googleAdsConversionLogger = createGoogleAdsLogger('conversion')
export const googleAdsPerformanceLogger = createGoogleAdsLogger('performance')
