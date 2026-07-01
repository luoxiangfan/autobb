import { describe, expect, it } from 'vitest'
import { normalizeSingleCreativeSelection } from '@/lib/creatives/server'

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

  it('rejects legacy bucket C', () => {
    const result = normalizeSingleCreativeSelection({
      creativeType: undefined,
      bucket: 'C',
      hasExplicitCreativeType: false,
      hasExplicitBucket: true,
    })

    expect(result.errorCode).toBe('invalid-bucket')
    expect(result.requestedBucket).toBeNull()
  })

  it('rejects legacy bucket S', () => {
    const result = normalizeSingleCreativeSelection({
      creativeType: undefined,
      bucket: 'S',
      hasExplicitCreativeType: false,
      hasExplicitBucket: true,
    })

    expect(result.errorCode).toBe('invalid-bucket')
    expect(result.requestedBucket).toBeNull()
  })

  it('rejects legacy creativeType aliases', () => {
    const result = normalizeSingleCreativeSelection({
      creativeType: 'brand_focus',
      bucket: undefined,
      hasExplicitCreativeType: true,
      hasExplicitBucket: false,
    })

    expect(result.errorCode).toBe('invalid-creative-type')
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

  it('keeps canonical B as-is', () => {
    const result = normalizeSingleCreativeSelection({
      creativeType: undefined,
      bucket: 'B',
      hasExplicitCreativeType: false,
      hasExplicitBucket: true,
    })

    expect(result.errorCode).toBeNull()
    expect(result.requestedBucket).toBe('B')
  })
})
