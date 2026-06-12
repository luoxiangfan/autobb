import {
  formatErrorMessage,
  GOOGLE_ADS_NOT_CONFIGURED_MESSAGE,
  type AccountsFetchBlockedUiEffects,
} from '@/lib/google-ads/common/credentials-errors'

export type GoogleAdsAccountsApiData = {
  accounts: unknown[]
  total: number
  refreshInProgress: boolean
  refreshError: string | null
  authConfigWarning: string | null
  dualStack: boolean
  cached?: boolean
  cacheStale?: boolean
  refreshFailed?: boolean
  lastSyncAt?: string | null
}

export type GoogleAdsAccountsFetchParams = {
  forceRefresh?: boolean
  isPoll?: boolean
  skipCredentialsRefresh?: boolean
  fallbackServiceAccountId?: string | null
  /** 额外 query（如 filterByUserMcc、offerId） */
  query?: Record<string, string | undefined>
}

export type GoogleAdsAccountsFetchResult =
  | {
      ok: true
      authForRequest: { authType: 'oauth' | 'service_account'; serviceAccountId?: string }
      data: GoogleAdsAccountsApiData
    }
  | { ok: false; kind: 'blocked'; effects: AccountsFetchBlockedUiEffects }
  | { ok: false; kind: 'permission_denied'; details: unknown }
  | {
      ok: false
      kind: 'error'
      error: Error & { needsReauth?: boolean; authConfigWarning?: string | null }
    }

export type ServiceAccountPermissionDetails = {
  serviceAccountEmail?: string
  mccCustomerId?: string
  solution?: { steps: string[]; docsUrl?: string }
}

export const DEFAULT_SERVICE_ACCOUNT_PERMISSION_STEPS = [
  '登录 Google Ads UI: https://ads.google.com',
  '切换到 MCC 账户',
  '进入「管理」→「访问权限和安全」',
  '添加服务账号并授予「标准访问」或「管理员」权限',
  '保存后等待几分钟，然后刷新此页面',
] as const

export function buildDefaultServiceAccountPermissionSteps(
  details: Pick<ServiceAccountPermissionDetails, 'serviceAccountEmail' | 'mccCustomerId'>
): string[] {
  return DEFAULT_SERVICE_ACCOUNT_PERMISSION_STEPS.map((step) => {
    if (step.includes('MCC 账户') && details.mccCustomerId) {
      return `切换到 MCC 账户: ${details.mccCustomerId}`
    }
    if (step.includes('添加服务账号') && details.serviceAccountEmail) {
      return `添加服务账号: ${details.serviceAccountEmail}`
    }
    return step
  })
}

export function hasServiceAccountPermissionDetails(
  details: ServiceAccountPermissionDetails | null | undefined
): details is ServiceAccountPermissionDetails {
  if (!details) return false
  return Boolean(
    details.serviceAccountEmail ||
    details.mccCustomerId ||
    (details.solution?.steps?.length ?? 0) > 0
  )
}

export const SERVICE_ACCOUNT_PERMISSION_DENIED_FALLBACK_MESSAGE =
  '服务账号权限不足，请检查 MCC 访问权限'

export type GoogleAdsAccountsFetchUiEffects = {
  kind: 'ok' | 'blocked' | 'permission_denied' | 'error'
  authConfigWarning?: string | null
  dualStack?: boolean
  clearForceRefreshState?: boolean
  errorMessage?: string
  needsReauth?: boolean
  permissionDetails?: ServiceAccountPermissionDetails | null
  pollFailureMessage?: string
  data?: GoogleAdsAccountsApiData
  shouldSchedulePoll?: boolean
}

export function shouldRefreshCredentialsAfterAccountsFetchOk(
  effects: GoogleAdsAccountsFetchUiEffects
): boolean {
  return effects.kind === 'ok' && !effects.shouldSchedulePoll
}

/** 合并 query 后再由 forceRefresh 强制 refresh/async，避免 caller query 覆盖 forceRefresh */
export function buildGoogleAdsAccountsSearchParams(
  params: Pick<GoogleAdsAccountsFetchParams, 'forceRefresh' | 'query'>
): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (params.query) {
    for (const [key, value] of Object.entries(params.query)) {
      if (value !== undefined && value !== '') {
        searchParams.set(key, value)
      }
    }
  }
  if (params.forceRefresh) {
    searchParams.set('refresh', 'true')
    searchParams.set('async', 'true')
  }
  return searchParams
}

export function parseServiceAccountPermissionDetails(
  details: unknown
): ServiceAccountPermissionDetails | null {
  if (!details || typeof details !== 'object') {
    return null
  }
  const record = details as Record<string, unknown>
  const solutionRaw = record.solution
  const solution =
    solutionRaw && typeof solutionRaw === 'object'
      ? {
          steps: Array.isArray((solutionRaw as { steps?: unknown }).steps)
            ? ((solutionRaw as { steps: unknown[] }).steps.filter(
                (step): step is string => typeof step === 'string'
              ) as string[])
            : [],
          docsUrl:
            typeof (solutionRaw as { docsUrl?: unknown }).docsUrl === 'string'
              ? (solutionRaw as { docsUrl: string }).docsUrl
              : undefined,
        }
      : undefined

  const serviceAccountEmail =
    typeof record.serviceAccountEmail === 'string' ? record.serviceAccountEmail : undefined
  const mccCustomerId = typeof record.mccCustomerId === 'string' ? record.mccCustomerId : undefined

  if (!serviceAccountEmail && !mccCustomerId && !(solution?.steps.length ?? 0)) {
    return null
  }

  const normalizedSolution =
    solution && solution.steps.length > 0
      ? solution
      : {
          steps: buildDefaultServiceAccountPermissionSteps({ serviceAccountEmail, mccCustomerId }),
          docsUrl: solution?.docsUrl ?? '/docs/service-account-setup',
        }

  return {
    serviceAccountEmail,
    mccCustomerId,
    solution: normalizedSolution,
  }
}

export function getAccountsPollFailureMessage(result: GoogleAdsAccountsFetchResult): string {
  if (result.ok) {
    return '账号同步状态查询失败'
  }
  if (result.kind === 'blocked') {
    return (
      result.effects.errorMessage ??
      result.effects.authConfigWarning ??
      GOOGLE_ADS_NOT_CONFIGURED_MESSAGE
    )
  }
  if (result.kind === 'permission_denied') {
    return '服务账号权限不足，无法继续同步账号列表'
  }
  return formatErrorMessage(result.error) || '账号同步失败，请稍后重试'
}

export function resolveGoogleAdsAccountsFetchUiEffects(
  result: GoogleAdsAccountsFetchResult,
  opts?: { forceRefresh?: boolean; isPoll?: boolean }
): GoogleAdsAccountsFetchUiEffects {
  if (result.ok === false && result.kind === 'blocked') {
    const { effects } = result
    return {
      kind: 'blocked',
      authConfigWarning: effects.authConfigWarning ?? null,
      dualStack: effects.authConfigWarning ? true : undefined,
      errorMessage: effects.errorMessage,
      clearForceRefreshState: effects.clearForceRefreshState || opts?.isPoll,
      pollFailureMessage: opts?.isPoll ? getAccountsPollFailureMessage(result) : undefined,
    }
  }

  if (result.ok === false && result.kind === 'permission_denied') {
    return {
      kind: 'permission_denied',
      permissionDetails: parseServiceAccountPermissionDetails(result.details),
      clearForceRefreshState: opts?.forceRefresh || opts?.isPoll,
      pollFailureMessage: opts?.isPoll ? getAccountsPollFailureMessage(result) : undefined,
    }
  }

  if (result.ok === false && result.kind === 'error') {
    const err = result.error
    return {
      kind: 'error',
      needsReauth: err.needsReauth,
      authConfigWarning: err.authConfigWarning ?? null,
      dualStack: err.authConfigWarning ? true : undefined,
      errorMessage: formatErrorMessage(err) || '获取账户列表失败',
      clearForceRefreshState: opts?.forceRefresh || opts?.isPoll,
      pollFailureMessage: opts?.isPoll ? getAccountsPollFailureMessage(result) : undefined,
    }
  }

  if (!result.ok) {
    return {
      kind: 'error',
      errorMessage: '获取账户列表失败',
      clearForceRefreshState: opts?.forceRefresh || opts?.isPoll,
      pollFailureMessage: opts?.isPoll ? getAccountsPollFailureMessage(result) : undefined,
    }
  }

  const { data } = result
  const shouldSchedulePoll = Boolean((opts?.forceRefresh || opts?.isPoll) && data.refreshInProgress)

  return {
    kind: 'ok',
    authConfigWarning: data.authConfigWarning,
    dualStack: data.dualStack,
    data,
    shouldSchedulePoll,
    clearForceRefreshState:
      (opts?.forceRefresh || opts?.isPoll) && !data.refreshInProgress ? true : undefined,
  }
}

export type GoogleAdsAccountsFetchUiHandlers = {
  onAuthConfigWarning?: (warning: string | null) => void
  onDualStack?: (dualStack: boolean) => void
  onNeedsReauth?: (needsReauth: boolean) => void
  onErrorMessage?: (message: string) => void
  onPermissionDetails?: (details: ServiceAccountPermissionDetails | null) => void
  onClearForceRefresh?: () => void
  onPollFailure?: (message: string) => void
  onOkData?: (data: GoogleAdsAccountsApiData) => void
  onSchedulePoll?: () => void
}

function notifyPermissionDeniedFallback(handlers: GoogleAdsAccountsFetchUiHandlers): void {
  handlers.onErrorMessage?.(SERVICE_ACCOUNT_PERMISSION_DENIED_FALLBACK_MESSAGE)
}

/** 将 resolveGoogleAdsAccountsFetchUiEffects 的结果应用到页面 state / toast */
export function applyGoogleAdsAccountsFetchUiEffects(
  effects: GoogleAdsAccountsFetchUiEffects,
  handlers: GoogleAdsAccountsFetchUiHandlers
): 'ok' | 'failure' {
  if (effects.pollFailureMessage) {
    handlers.onPollFailure?.(effects.pollFailureMessage)
    if (effects.kind === 'permission_denied') {
      handlers.onPermissionDetails?.(effects.permissionDetails ?? null)
    } else {
      handlers.onPermissionDetails?.(null)
    }
    if (effects.clearForceRefreshState) {
      handlers.onClearForceRefresh?.()
    }
    return 'failure'
  }

  if (effects.kind === 'blocked') {
    handlers.onPermissionDetails?.(null)
    if (effects.authConfigWarning !== undefined) {
      handlers.onAuthConfigWarning?.(effects.authConfigWarning)
      if (effects.authConfigWarning) {
        handlers.onDualStack?.(true)
      }
    }
    if (effects.errorMessage) {
      handlers.onErrorMessage?.(effects.errorMessage)
    } else if (effects.authConfigWarning) {
      handlers.onErrorMessage?.(effects.authConfigWarning)
    }
    if (effects.clearForceRefreshState) {
      handlers.onClearForceRefresh?.()
    }
    return 'failure'
  }

  if (effects.kind === 'permission_denied') {
    handlers.onPermissionDetails?.(effects.permissionDetails ?? null)
    if (!hasServiceAccountPermissionDetails(effects.permissionDetails)) {
      notifyPermissionDeniedFallback(handlers)
    }
    if (effects.clearForceRefreshState) {
      handlers.onClearForceRefresh?.()
    }
    return 'failure'
  }

  if (effects.kind === 'error') {
    handlers.onPermissionDetails?.(null)
    if (effects.needsReauth) {
      handlers.onNeedsReauth?.(true)
    }
    if (effects.authConfigWarning) {
      handlers.onAuthConfigWarning?.(effects.authConfigWarning)
      handlers.onDualStack?.(true)
    }
    if (effects.errorMessage) {
      handlers.onErrorMessage?.(effects.errorMessage)
    }
    if (effects.clearForceRefreshState) {
      handlers.onClearForceRefresh?.()
    }
    return 'failure'
  }

  if (effects.kind === 'ok' && effects.data) {
    handlers.onAuthConfigWarning?.(effects.data.authConfigWarning)
    handlers.onDualStack?.(effects.data.dualStack)
    handlers.onNeedsReauth?.(false)
    handlers.onPermissionDetails?.(null)
    handlers.onOkData?.(effects.data)
    if (effects.shouldSchedulePoll) {
      handlers.onSchedulePoll?.()
    } else if (effects.clearForceRefreshState) {
      handlers.onClearForceRefresh?.()
    }
    return 'ok'
  }

  return 'failure'
}
