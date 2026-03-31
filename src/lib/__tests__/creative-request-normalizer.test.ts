import { describe, expect, it, vi } from 'vitest'
import { normalizeSingleCreativeSelection } from '@/lib/creative-request-normalizer'

describe('normalizeSingleCreativeSelection', () => {
  it('rejects invalid explicit creativeType', () => {
    const result = normalizeSingleCreativeSelection({
      creativeType: 'unknown_type',
      bucket: undefined,
      hasExplicitCreativeType: true,
      hasExplicitBucket: false,
    })

    expect(result.errorCode).toBe('invalid-creative-type')
    expect(result.requestedBucket).toBeNull()
  })

  it('rejects invalid explicit bucket', () => {
    const result = normalizeSingleCreativeSelection({
      creativeType: undefined,
      bucket: 'X',
      hasExplicitCreativeType: false,
      hasExplicitBucket: true,
    })

    expect(result.errorCode).toBe('invalid-bucket')
    expect(result.requestedBucket).toBeNull()
  })

  it('rejects creativeType and bucket conflicts', () => {
    const result = normalizeSingleCreativeSelection({
      creativeType: 'model_intent',
      bucket: 'D',
      hasExplicitCreativeType: true,
      hasExplicitBucket: true,
    })

    expect(result.errorCode).toBe('creative-type-bucket-conflict')
    expect(result.requestedBucket).toBeNull()
  })

  it('falls back legacy C to D when model intent evidence is not verified', () => {
    const resolveLegacyModelIntent = vi.fn(() => false)
    const result = normalizeSingleCreativeSelection({
      creativeType: undefined,
      bucket: 'C',
      hasExplicitCreativeType: false,
      hasExplicitBucket: true,
      resolveLegacyModelIntent,
    })

    expect(resolveLegacyModelIntent).toHaveBeenCalledTimes(1)
    expect(result.errorCode).toBeNull()
    expect(result.requestedBucket).toBe('D')
    expect(result.legacyFallbackToProduct).toBe(true)
  })

  it('keeps canonical B as-is without triggering legacy fallback callback', () => {
    const resolveLegacyModelIntent = vi.fn(() => false)
    const result = normalizeSingleCreativeSelection({
      creativeType: undefined,
      bucket: 'B',
      hasExplicitCreativeType: false,
      hasExplicitBucket: true,
      resolveLegacyModelIntent,
    })

    expect(resolveLegacyModelIntent).not.toHaveBeenCalled()
    expect(result.errorCode).toBeNull()
    expect(result.requestedBucket).toBe('B')
    expect(result.legacyFallbackToProduct).toBe(false)
  })
})
