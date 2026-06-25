import type {
  GoogleAdsAccountsFetchParams,
  GoogleAdsAccountsFetchResult,
} from '@/lib/google-ads/accounts/fetch'
import {
  hasServiceAccountPermissionDetails,
  type GoogleAdsAccountsFetchUiHandlers,
  type ServiceAccountPermissionDetails,
} from '@/lib/google-ads/accounts/fetch'

export type GoogleAdsAccountsCoreApplyHandlersConfig = {
  setAuthConfigWarning: (warning: string | null) => void
  setGoogleAdsDualStack: (dualStack: boolean) => void
  setNeedsReauth: (needsReauth: boolean) => void
  setPermissionError: (details: ServiceAccountPermissionDetails | null) => void
  onErrorMessage: (message: string) => void
  onPollFailure: (message: string) => void
  onClearForceRefresh: () => void
  /* * 出现可展示的权限错误时隐藏/清空账户列表 */
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

/* * 关闭权限错误提示并清空可能残留的账户列表状态 */
export function createDismissGoogleAdsPermissionErrorHandler(options: {
  setPermissionError: (details: ServiceAccountPermissionDetails | null) => void
  onAccountsHidden?: () => void
  onDismiss?: () => void
}): () => void {
  return () => {
    options.setPermissionError(null)
    options.onAccountsHidden?.()
    options.onDismiss?.()
  }
}
