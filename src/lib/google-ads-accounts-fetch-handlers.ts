import type {
  GoogleAdsAccountsFetchParams,
  GoogleAdsAccountsFetchResult,
} from './google-ads-accounts-fetch'
import {
  hasServiceAccountPermissionDetails,
  type GoogleAdsAccountsFetchUiHandlers,
  type ServiceAccountPermissionDetails,
} from './google-ads-accounts-fetch'

export type GoogleAdsAccountsCoreApplyHandlersConfig = {
  setAuthConfigWarning: (warning: string | null) => void
  setGoogleAdsDualStack: (dualStack: boolean) => void
  setNeedsReauth: (needsReauth: boolean) => void
  setPermissionError: (details: ServiceAccountPermissionDetails | null) => void
  onErrorMessage: (message: string) => void
  onPollFailure: (message: string) => void
  onClearForceRefresh: () => void
  /** 出现可展示的权限错误时隐藏/清空账户列表 */
  onPermissionAccountsHidden?: () => void
}

export function createGoogleAdsAccountsCoreApplyHandlers(
  config: GoogleAdsAccountsCoreApplyHandlersConfig
): Pick<
  GoogleAdsAccountsFetchUiHandlers,
  | 'onAuthConfigWarning'
  | 'onDualStack'
  | 'onNeedsReauth'
  | 'onPermissionDetails'
  | 'onErrorMessage'
  | 'onPollFailure'
  | 'onClearForceRefresh'
> {
  return {
    onAuthConfigWarning: config.setAuthConfigWarning,
    onDualStack: config.setGoogleAdsDualStack,
    onNeedsReauth: config.setNeedsReauth,
    onPermissionDetails: (details) => {
      config.setPermissionError(details)
      if (hasServiceAccountPermissionDetails(details)) {
        config.onPermissionAccountsHidden?.()
      }
    },
    onErrorMessage: config.onErrorMessage,
    onPollFailure: config.onPollFailure,
    onClearForceRefresh: config.onClearForceRefresh,
  }
}

export function withAccountsListSchedulePoll(
  handlers: GoogleAdsAccountsFetchUiHandlers,
  scheduleAccountsPoll: (
    baseParams: GoogleAdsAccountsFetchParams,
    onResult: (result: GoogleAdsAccountsFetchResult) => void
  ) => void,
  baseParamsRef: { current: GoogleAdsAccountsFetchParams },
  onPollResult: (result: GoogleAdsAccountsFetchResult) => void
): GoogleAdsAccountsFetchUiHandlers {
  return {
    ...handlers,
    onSchedulePoll: () => {
      scheduleAccountsPoll(baseParamsRef.current, onPollResult)
    },
  }
}
