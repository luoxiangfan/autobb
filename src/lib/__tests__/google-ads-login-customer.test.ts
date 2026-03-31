import { describe, expect, it } from 'vitest'
import {
  resolveLoginCustomerId,
  resolveLoginCustomerCandidates,
  isGoogleAdsAccountAccessError,
} from '@/lib/google-ads-login-customer'

describe('resolveLoginCustomerId', () => {
  it('prefers account parent MCC in oauth mode', () => {
    const result = resolveLoginCustomerId({
      authType: 'oauth',
      accountParentMccId: '8551016013',
      oauthLoginCustomerId: '7137504017',
    })

    expect(result).toBe('8551016013')
  })

  it('falls back to oauth credential login customer id when parent MCC is missing', () => {
    const result = resolveLoginCustomerId({
      authType: 'oauth',
      accountParentMccId: null,
      oauthLoginCustomerId: '7137504017',
    })

    expect(result).toBe('7137504017')
  })

  it('uses service account MCC first in service_account mode', () => {
    const result = resolveLoginCustomerId({
      authType: 'service_account',
      accountParentMccId: '8551016013',
      serviceAccountMccId: '9998887776',
      oauthLoginCustomerId: '7137504017',
    })

    expect(result).toBe('9998887776')
  })

  it('returns ordered fallback candidates in oauth mode', () => {
    const result = resolveLoginCustomerCandidates({
      authType: 'oauth',
      accountParentMccId: '3139800184',
      oauthLoginCustomerId: '4077212437',
      targetCustomerId: '7512164048',
    })

    expect(result).toEqual([
      '3139800184',
      '4077212437',
      '7512164048',
      undefined,
    ])
  })

  it('deduplicates fallback candidates when values repeat', () => {
    const result = resolveLoginCustomerCandidates({
      authType: 'oauth',
      accountParentMccId: '4077212437',
      oauthLoginCustomerId: '4077212437',
      targetCustomerId: '4077212437',
    })

    expect(result).toEqual(['4077212437', undefined])
  })
})

describe('isGoogleAdsAccountAccessError', () => {
  it('detects permission denied by nested google ads errors', () => {
    const result = isGoogleAdsAccountAccessError({
      errors: [
        {
          error_code: { authorization_error: 'USER_PERMISSION_DENIED' },
          message: "User doesn't have permission to access customer",
        },
      ],
    })

    expect(result).toBe(true)
  })

  it('detects account disabled messages', () => {
    const result = isGoogleAdsAccountAccessError({
      message: 'The customer account is not yet enabled',
    })

    expect(result).toBe(true)
  })

  it('does not classify generic timeout as access error', () => {
    const result = isGoogleAdsAccountAccessError({
      message: 'fetch failed: connect timeout',
    })

    expect(result).toBe(false)
  })
})
