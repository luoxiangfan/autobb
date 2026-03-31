import { describe, expect, it } from 'vitest'
import { getCountryName, validateProxyUrl } from '@/lib/proxy/validate-url'

describe('validateProxyUrl', () => {
  it('accepts IE (Ireland) cc code', () => {
    const url = 'https://api.iprocket.io/api?username=user&password=pass&cc=IE&ips=1&proxyType=http&responseType=txt'
    const result = validateProxyUrl(url)
    expect(result.isValid).toBe(true)
    expect(result.countryCode).toBe('IE')
    expect(getCountryName('IE')).toContain('Ireland')
  })

  it('accepts NZ (New Zealand) cc code', () => {
    const url = 'https://api.iprocket.io/api?username=user&password=pass&cc=NZ&ips=1&proxyType=http&responseType=txt'
    const result = validateProxyUrl(url)
    expect(result.isValid).toBe(true)
    expect(result.countryCode).toBe('NZ')
    expect(getCountryName('NZ')).toContain('New Zealand')
  })
})

