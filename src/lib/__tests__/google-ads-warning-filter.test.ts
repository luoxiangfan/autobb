import { describe, expect, it } from 'vitest'

import {
  normalizeProcessWarningArgs,
  shouldSuppressGoogleAdsProcessWarning,
  shouldSuppressGoogleAdsWarningText,
} from '@/lib/google-ads-warning-filter'

describe('google-ads warning filter', () => {
  it('parses emitWarning(message, options) shape used by MetadataLookupWarning', () => {
    const normalized = normalizeProcessWarningArgs([
      'received unexpected error = All promises were rejected code = UNKNOWN',
      { type: 'MetadataLookupWarning', code: 'UNKNOWN' },
    ])

    expect(normalized).toEqual({
      name: 'MetadataLookupWarning',
      code: 'UNKNOWN',
      message: 'received unexpected error = All promises were rejected code = UNKNOWN',
    })
  })

  it('suppresses MetadataLookupWarning emitted via warning type options', () => {
    const suppressed = shouldSuppressGoogleAdsProcessWarning([
      'received unexpected error = All promises were rejected code = UNKNOWN',
      { type: 'MetadataLookupWarning', code: 'UNKNOWN' },
    ])

    expect(suppressed).toBe(true)
  })

  it('does not suppress unrelated warnings', () => {
    const suppressed = shouldSuppressGoogleAdsProcessWarning([
      'Visible warning',
      { type: 'Warning', code: 'OPENCLAW_TEST_WARNING' },
    ])

    expect(suppressed).toBe(false)
  })

  it('filters noisy warning text from console/stderr paths', () => {
    expect(shouldSuppressGoogleAdsWarningText('(node:39) MetadataLookupWarning: received unexpected error = All promises were rejected code = UNKNOWN')).toBe(true)
    expect(shouldSuppressGoogleAdsWarningText('regular warning')).toBe(false)
  })
})
