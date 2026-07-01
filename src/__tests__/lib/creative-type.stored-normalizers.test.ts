import { describe, expect, it } from 'vitest'

import {
  deriveCanonicalCreativeType,
  normalizeCanonicalCreativeType,
  normalizeCreativeBucketSlot,
  normalizeStoredCreativeBucketSlot,
  normalizeStoredCreativeType,
} from '@/lib/creatives/creative-type'

describe('normalizeCanonicalCreativeType', () => {
  it('accepts canonical creative types only', () => {
    expect(normalizeCanonicalCreativeType('brand_intent')).toBe('brand_intent')
    expect(normalizeCanonicalCreativeType('model_intent')).toBe('model_intent')
    expect(normalizeCanonicalCreativeType('product_intent')).toBe('product_intent')
  })

  it('rejects legacy creative type aliases', () => {
    expect(normalizeCanonicalCreativeType('brand_focus')).toBeNull()
    expect(normalizeCanonicalCreativeType('model_focus')).toBeNull()
    expect(normalizeCanonicalCreativeType('brand_product')).toBeNull()
  })
})

describe('normalizeStoredCreativeType', () => {
  it('maps legacy creative type aliases when reading stored rows', () => {
    expect(normalizeStoredCreativeType('brand_focus')).toBe('brand_intent')
    expect(normalizeStoredCreativeType('model_focus')).toBe('model_intent')
    expect(normalizeStoredCreativeType('brand_product')).toBe('product_intent')
  })
})

describe('normalizeCreativeBucketSlot', () => {
  it('accepts canonical buckets only', () => {
    expect(normalizeCreativeBucketSlot('A')).toBe('A')
    expect(normalizeCreativeBucketSlot('B')).toBe('B')
    expect(normalizeCreativeBucketSlot('D')).toBe('D')
  })

  it('rejects legacy bucket aliases', () => {
    expect(normalizeCreativeBucketSlot('C')).toBeNull()
    expect(normalizeCreativeBucketSlot('S')).toBeNull()
  })
})

describe('normalizeStoredCreativeBucketSlot', () => {
  it('maps legacy bucket aliases when reading stored rows', () => {
    expect(normalizeStoredCreativeBucketSlot('C')).toBe('B')
    expect(normalizeStoredCreativeBucketSlot('S')).toBe('D')
  })
})

describe('deriveCanonicalCreativeType', () => {
  it('derives from stored legacy creativeType values', () => {
    expect(
      deriveCanonicalCreativeType({
        creativeType: 'model_focus',
        keywordBucket: null,
      })
    ).toBe('model_intent')
  })

  it('derives from stored legacy keyword buckets', () => {
    expect(
      deriveCanonicalCreativeType({
        creativeType: null,
        keywordBucket: 'C',
      })
    ).toBe('model_intent')
  })
})
