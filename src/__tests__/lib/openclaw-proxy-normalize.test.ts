import { describe, expect, it } from 'vitest'
import { assertOpenclawProxyRouteAllowed } from '@/lib/openclaw/gateway/canonical-routes'

describe('OpenClaw proxy canonical read routes', () => {
  it('accepts canonical campaign and account list paths without rewrite', () => {
    const campaigns = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/campaigns',
    })
    const accounts = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/google-ads-accounts',
    })
    const performance = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/campaigns/performance',
    })

    expect(campaigns.normalizedPath).toBe('/api/campaigns')
    expect(campaigns.feature).toBe('campaign-management')
    expect(accounts.normalizedPath).toBe('/api/google-ads-accounts')
    expect(accounts.feature).toBe('google-ads-management')
    expect(performance.normalizedPath).toBe('/api/campaigns/performance')
    expect(performance.feature).toBe('campaign-management')
  })

  it('rejects legacy google ads alias paths that are no longer rewritten', () => {
    expect(() =>
      assertOpenclawProxyRouteAllowed({
        method: 'GET',
        path: '/api/google-ads/accounts',
      })
    ).toThrow('OpenClaw proxy route not in canonical web flow')

    expect(() =>
      assertOpenclawProxyRouteAllowed({
        method: 'GET',
        path: '/api/reports/campaigns',
      })
    ).toThrow('OpenClaw proxy route not in canonical web flow')
  })
})
