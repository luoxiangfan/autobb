import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PERFORMANCE_RELEASE_FLAGS,
  getPerformanceReleaseSnapshot,
  isPerformanceReleaseEnabled,
  validatePerformanceReleaseDependencies,
} from '@/lib/feature-flags'

describe('performance release flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses configured defaults for performance release flags', () => {
    const snapshot = getPerformanceReleaseSnapshot()
    const flagNames = Object.keys(PERFORMANCE_RELEASE_FLAGS) as Array<keyof typeof PERFORMANCE_RELEASE_FLAGS>

    flagNames.forEach((flag) => {
      expect(snapshot[flag].enabled).toBe(PERFORMANCE_RELEASE_FLAGS[flag].enabled)
      expect(snapshot[flag].source).toBe('default')
      expect(isPerformanceReleaseEnabled(flag)).toBe(PERFORMANCE_RELEASE_FLAGS[flag].enabled)
    })
  })

  it('reads env override for a flag', () => {
    vi.stubEnv('FF_NAV_LINK', 'true')
    vi.stubEnv('FF_DASHBOARD_DEFER', '0')

    expect(isPerformanceReleaseEnabled('navLink')).toBe(true)
    expect(isPerformanceReleaseEnabled('dashboardDefer')).toBe(false)

    const snapshot = getPerformanceReleaseSnapshot()
    expect(snapshot.navLink.source).toBe('env')
    expect(snapshot.dashboardDefer.source).toBe('env')
  })

  it('validates dependency relationships', () => {
    vi.stubEnv('FF_OFFERS_SERVER_PAGING', 'true')
    vi.stubEnv('FF_OFFERS_INCREMENTAL_POLL', 'false')

    const result = validatePerformanceReleaseDependencies()
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('offersServerPaging requires offersIncrementalPoll to be enabled')
  })
})
