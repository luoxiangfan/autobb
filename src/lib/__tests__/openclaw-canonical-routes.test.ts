import { describe, expect, it } from 'vitest'
import {
  assertOpenclawCommandRouteAllowed,
  assertOpenclawProxyRouteAllowed,
  normalizeOpenclawApiPath,
  validateOpenclawApiRequest,
} from '../openclaw/canonical-routes'

describe('openclaw canonical routes', () => {
  it('normalizes query/hash/trailing slash from path', () => {
    expect(normalizeOpenclawApiPath('/api/campaigns/performance/?daysBack=7#section')).toBe(
      '/api/campaigns/performance'
    )
  })

  it('accepts write command route from canonical web flow', () => {
    const route = assertOpenclawCommandRouteAllowed({
      method: 'POST',
      path: '/api/campaigns/publish',
    })

    expect(route.normalizedPath).toBe('/api/campaigns/publish')
    expect(route.feature).toBe('campaign-management')
  })

  it('rejects non-canonical command route', () => {
    expect(() =>
      assertOpenclawCommandRouteAllowed({
        method: 'POST',
        path: '/api/campaigns/123/some-internal-action',
      })
    ).toThrow('OpenClaw command route not in canonical web flow')
  })

  it('rejects deprecated offer create path with actionable alternatives', () => {
    expect(() =>
      assertOpenclawCommandRouteAllowed({
        method: 'POST',
        path: '/api/offers',
      })
    ).toThrow('Offer creation must use POST /api/offers/extract or POST /api/offers/extract/stream')
  })

  it('rejects multipart-only offer batch create route in command channel', () => {
    expect(() =>
      assertOpenclawCommandRouteAllowed({
        method: 'POST',
        path: '/api/offers/batch/create',
      })
    ).toThrow('OpenClaw command route not in canonical web flow')
  })

  it('rejects legacy creative generation paths and enforces A/B/D flow', () => {
    expect(() =>
      assertOpenclawCommandRouteAllowed({
        method: 'POST',
        path: '/api/offers/10/generate-creatives',
      })
    ).toThrow('Creative generation must follow A/B/D flow')

    expect(() =>
      assertOpenclawCommandRouteAllowed({
        method: 'POST',
        path: '/api/ad-creatives',
      })
    ).toThrow('Creative generation must follow A/B/D flow')

    expect(() =>
      assertOpenclawCommandRouteAllowed({
        method: 'POST',
        path: '/api/offers/10/generate-ad-creative',
      })
    ).toThrow('Creative generation is long-running')
  })

  it('rejects GET requests in command channel', () => {
    expect(() =>
      assertOpenclawCommandRouteAllowed({
        method: 'GET',
        path: '/api/campaigns',
      })
    ).toThrow('OpenClaw commands only supports write methods')
  })

  it('accepts canonical read route in proxy channel', () => {
    const route = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/url-swap/tasks/15',
    })

    expect(route.feature).toBe('url-swap')
    expect(route.pattern).toBe('/api/url-swap/tasks/:id')
  })

  it('accepts newly-added web read routes', () => {
    const keywordPool = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/offers/77/keyword-pool',
    })
    const bonusScore = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/ad-creatives/99/bonus-score',
    })

    expect(keywordPool.feature).toBe('offer-management')
    expect(bonusScore.feature).toBe('creative-management')
  })

  it('accepts newly-added dashboard/settings/google-ads/sync read routes', () => {
    const dashboardKpis = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/dashboard/kpis',
    })
    const riskAlerts = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/risk-alerts',
    })
    const settings = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/settings',
    })
    const googleAdsAccounts = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/google-ads/credentials/accounts',
    })
    const syncStatus = assertOpenclawProxyRouteAllowed({
      method: 'GET',
      path: '/api/sync/status',
    })

    expect(dashboardKpis.feature).toBe('analytics-query')
    expect(riskAlerts.feature).toBe('risk-management')
    expect(settings.feature).toBe('settings-management')
    expect(googleAdsAccounts.feature).toBe('google-ads-management')
    expect(syncStatus.feature).toBe('sync-management')
  })

  it('rejects write method in proxy channel', () => {
    expect(() =>
      assertOpenclawProxyRouteAllowed({
        method: 'POST',
        path: '/api/url-swap/tasks',
      })
    ).toThrow('OpenClaw proxy only supports read methods')
  })

  it('rejects blocked internal path before matching canonical flow', () => {
    expect(() => validateOpenclawApiRequest('GET', '/api/admin/users')).toThrow('Path blocked: /api/admin')
  })

  it('accepts newly-added web write routes', () => {
    const launchAds = assertOpenclawCommandRouteAllowed({
      method: 'POST',
      path: '/api/offers/12/launch-ads',
    })
    const productCreateOffer = assertOpenclawCommandRouteAllowed({
      method: 'POST',
      path: '/api/products/56/create-offer',
    })
    const productLinkOffer = assertOpenclawCommandRouteAllowed({
      method: 'POST',
      path: '/api/products/56/link-offer',
    })
    const campaignSync = assertOpenclawCommandRouteAllowed({
      method: 'POST',
      path: '/api/campaigns/201/sync',
    })

    expect(launchAds.feature).toBe('offer-management')
    expect(productCreateOffer.feature).toBe('product-sync')
    expect(productLinkOffer.feature).toBe('product-sync')
    expect(campaignSync.feature).toBe('campaign-management')
  })

  it('accepts dashboard/settings/google-ads/sync write routes', () => {
    const riskAcknowledge = assertOpenclawCommandRouteAllowed({
      method: 'PATCH',
      path: '/api/risk-alerts/88',
    })
    const saveSettings = assertOpenclawCommandRouteAllowed({
      method: 'PUT',
      path: '/api/settings',
    })
    const verifyGoogleAds = assertOpenclawCommandRouteAllowed({
      method: 'POST',
      path: '/api/google-ads/credentials/verify',
    })
    const triggerSync = assertOpenclawCommandRouteAllowed({
      method: 'POST',
      path: '/api/sync/trigger',
    })

    expect(riskAcknowledge.feature).toBe('risk-management')
    expect(saveSettings.feature).toBe('settings-management')
    expect(verifyGoogleAds.feature).toBe('google-ads-management')
    expect(triggerSync.feature).toBe('sync-management')
  })
})
