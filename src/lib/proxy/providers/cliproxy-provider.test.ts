import { describe, expect, it } from 'vitest'
import { CliproxyProvider } from './cliproxy-provider'
import { ProxyProviderRegistry } from './provider-registry'

describe('CliproxyProvider', () => {
  it('validates Cliproxy direct format and extracts country code from username', () => {
    const provider = new CliproxyProvider()
    const result = provider.validate('us.cliproxy.io:3010:username-region-US:passowrd')

    expect(result.isValid).toBe(true)
    expect(result.countryCode).toBe('US')
  })

  it('rejects unsupported hostname', () => {
    const provider = new CliproxyProvider()
    const result = provider.validate('us.otherproxy.io:3010:username-region-US:passowrd')

    expect(result.isValid).toBe(false)
    expect(result.errors.join(',')).toContain('cliproxy.io')
  })
})

describe('ProxyProviderRegistry with Cliproxy', () => {
  it('routes Cliproxy format to Cliproxy provider', () => {
    const provider = ProxyProviderRegistry.getProvider('us.cliproxy.io:3010:username-region-US:passowrd')
    expect(provider.name).toBe('Cliproxy')
  })
})
