import { describe, expect, it } from 'vitest'
import {
  getSupportedCountries,
  hasGoogleAdsGeoTargetId,
  resolveCountryCodeFromGoogleAdsGeoTargetId,
} from '@/lib/common/server'
import { validateProxyUrl } from '@/lib/proxy/validate-url'

describe('country consistency', () => {
  it('Google Ads geo targets cover all supported countries', () => {
    const missing = getSupportedCountries()
      .map((c) => c.code)
      .filter((code) => !hasGoogleAdsGeoTargetId(code))

    expect(missing).toEqual([])
  })

  it('resolves Google Ads geo target IDs back to country codes', () => {
    expect(resolveCountryCodeFromGoogleAdsGeoTargetId('2840')).toBe('US')
    expect(resolveCountryCodeFromGoogleAdsGeoTargetId(2826)).toBe('GB')
    expect(resolveCountryCodeFromGoogleAdsGeoTargetId('999999')).toBe('999999')
  })

  it('proxy cc validation accepts all supported countries', () => {
    const failures: Array<{ code: string; errors: string[] }> = []

    for (const { code } of getSupportedCountries()) {
      const url = `https://api.iprocket.io/api?username=user&password=pass&cc=${code}&ips=1&proxyType=http&responseType=txt`
      const result = validateProxyUrl(url)
      if (!result.isValid) failures.push({ code, errors: result.errors })
    }

    expect(failures).toEqual([])
  })
})
