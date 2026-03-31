import { describe, expect, it } from 'vitest'
import {
  deriveOpenclawCommandRiskLevel,
  requiresOpenclawCommandConfirmation,
} from '../openclaw/commands/risk-policy'

describe('openclaw risk policy', () => {
  it('marks settings write operations as high risk', () => {
    const riskLevel = deriveOpenclawCommandRiskLevel({
      method: 'PUT',
      path: '/api/settings',
    })

    expect(riskLevel).toBe('high')
    expect(requiresOpenclawCommandConfirmation(riskLevel)).toBe(true)
  })

  it('marks sync trigger operations as high risk', () => {
    const riskLevel = deriveOpenclawCommandRiskLevel({
      method: 'POST',
      path: '/api/sync/trigger',
    })

    expect(riskLevel).toBe('high')
    expect(requiresOpenclawCommandConfirmation(riskLevel)).toBe(true)
  })

  it('marks google ads credential writes as high risk', () => {
    const riskLevel = deriveOpenclawCommandRiskLevel({
      method: 'POST',
      path: '/api/google-ads/credentials',
    })

    expect(riskLevel).toBe('high')
    expect(requiresOpenclawCommandConfirmation(riskLevel)).toBe(true)
  })

  it('keeps read-only routes low risk', () => {
    const riskLevel = deriveOpenclawCommandRiskLevel({
      method: 'GET',
      path: '/api/dashboard/kpis',
    })

    expect(riskLevel).toBe('low')
    expect(requiresOpenclawCommandConfirmation(riskLevel)).toBe(false)
  })

  it('fails closed for unknown write route when strict mode is enabled', () => {
    expect(() =>
      deriveOpenclawCommandRiskLevel({
        method: 'POST',
        path: '/api/unknown/internal-write',
        strictCanonicalWrite: true,
      })
    ).toThrow('missing route risk policy')
  })

  it('keeps non-strict mode fallback for parser-only unknown route', () => {
    const riskLevel = deriveOpenclawCommandRiskLevel({
      method: 'DELETE',
      path: '/api/offers/123/delete',
      strictCanonicalWrite: false,
    })

    expect(riskLevel).toBe('high')
    expect(requiresOpenclawCommandConfirmation(riskLevel)).toBe(true)
  })
})
