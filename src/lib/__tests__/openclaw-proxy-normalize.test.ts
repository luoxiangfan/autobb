import { describe, expect, it } from 'vitest'
import { normalizeOpenclawProxyTarget } from '../openclaw/proxy'
import { assertOpenclawProxyRouteAllowed } from '../openclaw/canonical-routes'

describe('normalizeOpenclawProxyTarget', () => {
  it('keeps current valid path unchanged', () => {
    const result = normalizeOpenclawProxyTarget({
      path: '/api/campaigns',
      query: { limit: 10 },
    })

    expect(result).toEqual({
      path: '/api/campaigns',
      query: { limit: 10 },
      rewritten: false,
    })
  })

  it('rewrites legacy reports path to campaigns performance', () => {
    const result = normalizeOpenclawProxyTarget({
      path: '/api/reports/campaigns',
      query: { daysBack: 7 },
    })

    expect(result).toEqual({
      path: '/api/campaigns/performance',
      query: { daysBack: 7 },
      rewritten: true,
    })
  })

  it('rewrites legacy google ads campaigns list path', () => {
    const result = normalizeOpenclawProxyTarget({
      path: '/api/google-ads/campaigns',
      query: { limit: 20 },
    })

    expect(result).toEqual({
      path: '/api/campaigns',
      query: { limit: 20 },
      rewritten: true,
    })
  })

  it('rewrites legacy google ads accounts list aliases to canonical account list path', () => {
    const aliasPaths = [
      '/api/google-ads/accounts',
      '/api/campaigns/accounts',
      '/api/campaigns/google-ads-accounts',
    ]

    for (const aliasPath of aliasPaths) {
      const result = normalizeOpenclawProxyTarget({
        path: aliasPath,
        query: { limit: 20 },
      })

      expect(result).toEqual({
        path: '/api/google-ads-accounts',
        query: { limit: 20 },
        rewritten: true,
      })
    }
  })

  it('rewrites legacy google ads account detail path to canonical account detail path', () => {
    const result = normalizeOpenclawProxyTarget({
      path: '/api/google-ads/accounts/856',
      query: { includeStats: true },
    })

    expect(result).toEqual({
      path: '/api/google-ads-accounts/856',
      query: { includeStats: true },
      rewritten: true,
    })
  })

  it('rewrites legacy account campaigns path and injects googleAdsAccountId', () => {
    const result = normalizeOpenclawProxyTarget({
      path: '/api/google-ads/accounts/109/campaigns',
      query: { limit: 10 },
    })

    expect(result).toEqual({
      path: '/api/campaigns',
      query: {
        limit: 10,
        googleAdsAccountId: '109',
      },
      rewritten: true,
    })
  })

  it('rewrites legacy campaign metrics path and injects campaignId', () => {
    const result = normalizeOpenclawProxyTarget({
      path: '/api/campaigns/1724/metrics',
      query: { daysBack: 30 },
    })

    expect(result).toEqual({
      path: '/api/campaigns/performance',
      query: {
        daysBack: 30,
        campaignId: '1724',
      },
      rewritten: true,
    })
  })

  it('rewritten target remains canonical and read-only', () => {
    const normalized = normalizeOpenclawProxyTarget({
      path: '/api/google-ads/campaigns',
      query: { limit: 20 },
    })

    const route = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: normalized.path,
    })

    expect(route.normalizedPath).toBe('/api/campaigns')
    expect(route.feature).toBe('campaign-management')
  })
})
