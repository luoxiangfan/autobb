import { describe, expect, it } from 'vitest'
import {
  resolveAffiliateDirectHttpConcurrencyLimit,
  resolveAffiliateDirectHttpMinGapMs,
} from '@/lib/scraping/affiliate-direct-http-concurrency'

describe('affiliate-direct-http-concurrency', () => {
  it('clamps concurrency limit to 1..10 with default 3', () => {
    expect(resolveAffiliateDirectHttpConcurrencyLimit(undefined)).toBe(3)
    expect(resolveAffiliateDirectHttpConcurrencyLimit('0')).toBe(1)
    expect(resolveAffiliateDirectHttpConcurrencyLimit('99')).toBe(10)
    expect(resolveAffiliateDirectHttpConcurrencyLimit('5')).toBe(5)
  })

  it('clamps min gap to 0..5000 with default 300ms', () => {
    expect(resolveAffiliateDirectHttpMinGapMs(undefined)).toBe(300)
    expect(resolveAffiliateDirectHttpMinGapMs('-1')).toBe(0)
    expect(resolveAffiliateDirectHttpMinGapMs('99999')).toBe(5000)
    expect(resolveAffiliateDirectHttpMinGapMs('150')).toBe(150)
  })
})
