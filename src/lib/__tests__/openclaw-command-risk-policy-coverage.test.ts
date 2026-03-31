import { describe, expect, it } from 'vitest'
import { OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS } from '../openclaw/canonical-routes'
import { OPENCLAW_COMMAND_ROUTE_RISK_POLICIES } from '../openclaw/commands/risk-policy'

function toRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

describe('openclaw command risk policy coverage', () => {
  it('covers every canonical write route', () => {
    const canonicalRouteKeys = new Set(
      OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS.map((route) => toRouteKey(route.method, route.pattern))
    )

    const riskPolicyKeys = new Set(
      OPENCLAW_COMMAND_ROUTE_RISK_POLICIES.map((policy) => toRouteKey(policy.method, policy.path))
    )

    const missingRiskPolicies = Array.from(canonicalRouteKeys).filter(
      (routeKey) => !riskPolicyKeys.has(routeKey)
    )

    expect(missingRiskPolicies).toEqual([])
  })

  it('does not define stale risk policies outside canonical write routes', () => {
    const canonicalRouteKeys = new Set(
      OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS.map((route) => toRouteKey(route.method, route.pattern))
    )

    const riskPolicyKeys = new Set(
      OPENCLAW_COMMAND_ROUTE_RISK_POLICIES.map((policy) => toRouteKey(policy.method, policy.path))
    )

    const staleRiskPolicies = Array.from(riskPolicyKeys).filter(
      (policyKey) => !canonicalRouteKeys.has(policyKey)
    )

    expect(staleRiskPolicies).toEqual([])
  })
})
