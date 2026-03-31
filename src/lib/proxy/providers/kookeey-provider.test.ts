import { describe, expect, it } from 'vitest'
import { KookeeyProvider } from './kookeey-provider'
import { ProxyProviderRegistry } from './provider-registry'

describe('KookeeyProvider', () => {
  it('validates Kookeey direct format and extracts country code from password suffix', () => {
    const provider = new KookeeyProvider()
    const result = provider.validate('gate.kookeey.info:1000:username:passowrd-US')

    expect(result.isValid).toBe(true)
    expect(result.countryCode).toBe('US')
  })

  it('rejects unsupported hostname', () => {
    const provider = new KookeeyProvider()
    const result = provider.validate('gate.otherproxy.info:1000:username:passowrd-US')

    expect(result.isValid).toBe(false)
    expect(result.errors.join(',')).toContain('kookeey.info')
  })
})

describe('ProxyProviderRegistry', () => {
  it('routes Kookeey format to Kookeey provider', () => {
    const provider = ProxyProviderRegistry.getProvider('gate.kookeey.info:1000:username:passowrd-US')
    expect(provider.name).toBe('Kookeey')
  })

  it('no longer supports Abcproxy / IpMars / Ipidea formats', () => {
    expect(ProxyProviderRegistry.isSupported('na.02b22e116103ae77.abcproxy.vip:4950:user:pass')).toBe(false)
    expect(ProxyProviderRegistry.isSupported('node.ipmars.com:4950:user:pass')).toBe(false)
    expect(ProxyProviderRegistry.isSupported('node.ipidea.online:2333:user:pass')).toBe(false)
  })
})
