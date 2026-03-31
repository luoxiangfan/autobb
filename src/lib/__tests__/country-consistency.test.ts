import { describe, expect, it } from 'vitest'
import { getSupportedCountries, hasGoogleAdsGeoTargetId } from '@/lib/language-country-codes'
import { validateProxyUrl } from '@/lib/proxy/validate-url'

describe('country consistency', () => {
  it('Google Ads geo targets cover all supported countries', () => {
    const missing = getSupportedCountries()
      .map(c => c.code)
      .filter(code => !hasGoogleAdsGeoTargetId(code))

    expect(missing).toEqual([])
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

