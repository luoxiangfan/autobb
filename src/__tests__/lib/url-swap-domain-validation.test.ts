import { describe, expect, it } from 'vitest'
import { validateUrlSwapDomainChange } from '@/lib/url-swap/url-swap-domain-validation'

describe('validateUrlSwapDomainChange', () => {
  it('uses sitelink-specific message for sitelink context', () => {
    const result = validateUrlSwapDomainChange(
      'https://shop.example.com/a',
      'https://other.example.com/b',
      'sitelink'
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Sitelink 落地页域名发生变化')
  })

  it('uses campaign-specific message for campaign context', () => {
    const result = validateUrlSwapDomainChange(
      'https://shop.example.com/a',
      'https://other.example.com/b',
      'campaign'
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('与当前记录的 Final URL 不一致')
  })
})
