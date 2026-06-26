import { describe, expect, it } from 'vitest'
import {
  expandProxyUrlCountries,
  proxyCountryCodesOverlap,
  resolvePrimaryProxyCountryCode,
  resolveProxyCountryCandidates,
} from '@/lib/common/proxy-country'

describe('proxy-country', () => {
  it('expands GB and UK as mutual aliases', () => {
    expect(resolveProxyCountryCandidates('GB').sort()).toEqual(['GB', 'UK'])
    expect(resolveProxyCountryCandidates('UK').sort()).toEqual(['GB', 'UK'])
  })

  it('keeps unrelated country codes unchanged', () => {
    expect(resolveProxyCountryCandidates('US')).toEqual(['US'])
  })

  it('detects overlap across GB/UK aliases', () => {
    expect(proxyCountryCodesOverlap('GB', 'UK')).toBe(true)
    expect(proxyCountryCodesOverlap('US', 'UK')).toBe(false)
  })

  it('expands proxy URL configs by country aliases', () => {
    const expanded = expandProxyUrlCountries([{ country: 'UK', url: 'https://proxy.example/uk' }])

    expect(expanded).toHaveLength(2)
    expect(expanded.map((item) => item.country).sort()).toEqual(['GB', 'UK'])
    expect(new Set(expanded.map((item) => item.url)).size).toBe(1)
  })

  it('deduplicates expanded country/url pairs', () => {
    const expanded = expandProxyUrlCountries([
      { country: 'GB', url: 'https://proxy.example/uk' },
      { country: 'UK', url: 'https://proxy.example/uk' },
    ])

    expect(expanded).toHaveLength(2)
  })

  it('normalizes primary proxy country code', () => {
    expect(resolvePrimaryProxyCountryCode('uk')).toBe('GB')
    expect(resolvePrimaryProxyCountryCode('US')).toBe('US')
  })
})
