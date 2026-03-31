import { describe, expect, it } from 'vitest'
import {
  extractGoogleAdsRetryDelaySeconds,
  isGoogleAdsQuotaRateError,
} from '@/lib/google-ads-quota-error'

describe('google-ads-quota-error', () => {
  it('extracts retry delay from message text', () => {
    const error = {
      errors: [
        {
          message: 'Too many requests. Retry in 3065 seconds.',
        },
      ],
      request_id: 'abc',
    }

    expect(extractGoogleAdsRetryDelaySeconds(error)).toBe(3065)
  })

  it('extracts retry delay from quota_error_details', () => {
    const error = {
      errors: [
        {
          details: {
            quota_error_details: {
              retry_delay: {
                seconds: {
                  low: '42',
                },
              },
            },
          },
        },
      ],
    }

    expect(extractGoogleAdsRetryDelaySeconds(error)).toBe(42)
  })

  it('detects quota error from error code', () => {
    const error = {
      errors: [
        {
          error_code: {
            quota_error: 2,
          },
          message: 'rate limit',
        },
      ],
    }

    expect(isGoogleAdsQuotaRateError(error)).toBe(true)
  })

  it('detects quota error from explorer operation message', () => {
    const error = new Error(
      'Number of operations for explorer access exceeded temporarily'
    )

    expect(isGoogleAdsQuotaRateError(error)).toBe(true)
  })

  it('returns false for non-quota errors', () => {
    const error = {
      errors: [
        {
          error_code: {
            authorization_error: 2,
          },
          message: "User doesn't have permission to access customer.",
        },
      ],
    }

    expect(isGoogleAdsQuotaRateError(error)).toBe(false)
    expect(extractGoogleAdsRetryDelaySeconds(error)).toBeNull()
  })
})
