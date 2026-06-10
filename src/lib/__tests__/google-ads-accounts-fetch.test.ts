import { describe, it, expect, vi } from 'vitest'
import {
  applyGoogleAdsAccountsFetchUiEffects,
  buildGoogleAdsAccountsSearchParams,
  getAccountsPollFailureMessage,
  parseServiceAccountPermissionDetails,
  resolveGoogleAdsAccountsFetchUiEffects,
  SERVICE_ACCOUNT_PERMISSION_DENIED_FALLBACK_MESSAGE,
  shouldRefreshCredentialsAfterAccountsFetchOk,
} from '../google-ads-accounts-fetch'
import {
  createGoogleAdsAccountsCoreApplyHandlers,
  withAccountsListSchedulePoll,
} from '../google-ads-accounts-fetch-handlers'

describe('buildGoogleAdsAccountsSearchParams', () => {
  it('applies query first then forceRefresh overrides refresh/async', () => {
    const params = buildGoogleAdsAccountsSearchParams({
      forceRefresh: true,
      query: { refresh: 'false', offerId: '42', filterByUserMcc: 'true' },
    })
    expect(params.get('refresh')).toBe('true')
    expect(params.get('async')).toBe('true')
    expect(params.get('offerId')).toBe('42')
    expect(params.get('filterByUserMcc')).toBe('true')
  })

  it('skips empty query values', () => {
    const params = buildGoogleAdsAccountsSearchParams({
      query: { offerId: '', filterByUserMcc: 'true' },
    })
    expect(params.has('offerId')).toBe(false)
    expect(params.get('filterByUserMcc')).toBe('true')
  })
})

describe('parseServiceAccountPermissionDetails', () => {
  it('parses API permission payload', () => {
    const parsed = parseServiceAccountPermissionDetails({
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      mccCustomerId: '1234567890',
      solution: { steps: ['step 1', 'step 2'], docsUrl: '/docs/sa' },
    })
    expect(parsed?.serviceAccountEmail).toBe('sa@test.iam.gserviceaccount.com')
    expect(parsed?.mccCustomerId).toBe('1234567890')
    expect(parsed?.solution?.steps).toEqual(['step 1', 'step 2'])
  })

  it('returns null for invalid payload', () => {
    expect(parseServiceAccountPermissionDetails(null)).toBeNull()
    expect(parseServiceAccountPermissionDetails('x')).toBeNull()
    expect(parseServiceAccountPermissionDetails({})).toBeNull()
  })

  it('fills default steps when email is present without solution', () => {
    const parsed = parseServiceAccountPermissionDetails({
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      mccCustomerId: '1234567890',
    })
    expect(parsed?.solution?.steps.length).toBeGreaterThan(0)
    expect(parsed?.solution?.steps.some((step) => step.includes('1234567890'))).toBe(true)
  })
})

describe('resolveGoogleAdsAccountsFetchUiEffects', () => {
  it('maps permission_denied with poll failure message', () => {
    const effects = resolveGoogleAdsAccountsFetchUiEffects(
      {
        ok: false,
        kind: 'permission_denied',
        details: {
          serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
          mccCustomerId: '123',
          solution: { steps: ['fix it'] },
        },
      },
      { isPoll: true }
    )
    expect(effects.kind).toBe('permission_denied')
    expect(effects.permissionDetails?.serviceAccountEmail).toBe('sa@test.iam.gserviceaccount.com')
    expect(effects.pollFailureMessage).toContain('权限')
    expect(effects.clearForceRefreshState).toBe(true)
  })

  it('maps ok result with shouldSchedulePoll when refresh in progress', () => {
    const effects = resolveGoogleAdsAccountsFetchUiEffects(
      {
        ok: true,
        authForRequest: { authType: 'oauth' },
        data: {
          accounts: [],
          total: 0,
          refreshInProgress: true,
          refreshError: null,
          authConfigWarning: null,
          dualStack: false,
        },
      },
      { forceRefresh: true }
    )
    expect(effects.kind).toBe('ok')
    expect(effects.shouldSchedulePoll).toBe(true)
    expect(effects.clearForceRefreshState).toBeUndefined()
  })

  it('clears refresh state for blocked poll failures', () => {
    const effects = resolveGoogleAdsAccountsFetchUiEffects(
      {
        ok: false,
        kind: 'blocked',
        effects: { errorMessage: '未配置' },
      },
      { isPoll: true }
    )
    expect(effects.clearForceRefreshState).toBe(true)
    expect(effects.pollFailureMessage).toBe('未配置')
  })
})

describe('getAccountsPollFailureMessage', () => {
  it('returns blocked message for not configured', () => {
    const message = getAccountsPollFailureMessage({
      ok: false,
      kind: 'blocked',
      effects: { errorMessage: '未配置' },
    })
    expect(message).toBe('未配置')
  })
})

describe('applyGoogleAdsAccountsFetchUiEffects', () => {
  it('invokes onPollFailure and clears refresh state on poll permission error', () => {
    const onPollFailure = vi.fn()
    const onClearForceRefresh = vi.fn()
    const onPermissionDetails = vi.fn()

    applyGoogleAdsAccountsFetchUiEffects(
      resolveGoogleAdsAccountsFetchUiEffects(
        {
          ok: false,
          kind: 'permission_denied',
          details: { serviceAccountEmail: 'sa@test.iam.gserviceaccount.com' },
        },
        { isPoll: true }
      ),
      { onPollFailure, onClearForceRefresh, onPermissionDetails }
    )

    expect(onPollFailure).toHaveBeenCalled()
    expect(onClearForceRefresh).toHaveBeenCalled()
    expect(onPermissionDetails).toHaveBeenCalled()
  })

  it('clears stale permission details on blocked failures', () => {
    const onPermissionDetails = vi.fn()

    applyGoogleAdsAccountsFetchUiEffects(
      resolveGoogleAdsAccountsFetchUiEffects(
        {
          ok: false,
          kind: 'blocked',
          effects: { errorMessage: '双栈配置冲突' },
        },
        { forceRefresh: true }
      ),
      { onPermissionDetails }
    )

    expect(onPermissionDetails).toHaveBeenCalledWith(null)
  })

  it('clears stale permission details on error failures', () => {
    const onPermissionDetails = vi.fn()
    const onClearForceRefresh = vi.fn()

    applyGoogleAdsAccountsFetchUiEffects(
      resolveGoogleAdsAccountsFetchUiEffects(
        {
          ok: false,
          kind: 'error',
          error: new Error('network'),
        },
        { forceRefresh: true }
      ),
      { onPermissionDetails, onClearForceRefresh }
    )

    expect(onPermissionDetails).toHaveBeenCalledWith(null)
    expect(onClearForceRefresh).toHaveBeenCalled()
  })

  it('shows fallback message when permission_denied details cannot be parsed', () => {
    const onErrorMessage = vi.fn()

    applyGoogleAdsAccountsFetchUiEffects(
      resolveGoogleAdsAccountsFetchUiEffects(
        {
          ok: false,
          kind: 'permission_denied',
          details: {},
        },
        { forceRefresh: true }
      ),
      { onErrorMessage, onPermissionDetails: vi.fn() }
    )

    expect(onErrorMessage).toHaveBeenCalledWith(SERVICE_ACCOUNT_PERMISSION_DENIED_FALLBACK_MESSAGE)
  })
})

describe('shouldRefreshCredentialsAfterAccountsFetchOk', () => {
  it('returns false while background sync poll should continue', () => {
    expect(
      shouldRefreshCredentialsAfterAccountsFetchOk({
        kind: 'ok',
        shouldSchedulePoll: true,
        data: {
          accounts: [],
          total: 0,
          refreshInProgress: true,
          refreshError: null,
          authConfigWarning: null,
          dualStack: false,
        },
      })
    ).toBe(false)
  })

  it('returns true when sync completes', () => {
    expect(
      shouldRefreshCredentialsAfterAccountsFetchOk({
        kind: 'ok',
        shouldSchedulePoll: false,
        data: {
          accounts: [],
          total: 0,
          refreshInProgress: false,
          refreshError: null,
          authConfigWarning: null,
          dualStack: false,
        },
      })
    ).toBe(true)
  })
})

describe('google-ads-accounts-fetch-handlers', () => {
  it('createGoogleAdsAccountsCoreApplyHandlers clears accounts on permission error', () => {
    const onPermissionAccountsHidden = vi.fn()
    const handlers = createGoogleAdsAccountsCoreApplyHandlers({
      setAuthConfigWarning: vi.fn(),
      setGoogleAdsDualStack: vi.fn(),
      setNeedsReauth: vi.fn(),
      setPermissionError: vi.fn(),
      onErrorMessage: vi.fn(),
      onPollFailure: vi.fn(),
      onClearForceRefresh: vi.fn(),
      onPermissionAccountsHidden,
    })

    handlers.onPermissionDetails?.({
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      solution: { steps: ['fix'] },
    })

    expect(onPermissionAccountsHidden).toHaveBeenCalled()
  })

  it('withAccountsListSchedulePoll wires poll callback', () => {
    const scheduleAccountsPoll = vi.fn()
    const onPollResult = vi.fn()
    const baseParamsRef = { current: { forceRefresh: true } }
    const handlers = withAccountsListSchedulePoll(
      {},
      scheduleAccountsPoll,
      baseParamsRef,
      onPollResult
    )

    handlers.onSchedulePoll?.()

    expect(scheduleAccountsPoll).toHaveBeenCalledWith(baseParamsRef.current, onPollResult)
  })
})
