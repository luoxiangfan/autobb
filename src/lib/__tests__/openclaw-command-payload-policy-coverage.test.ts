import { describe, expect, it } from 'vitest'
import { OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS } from '../openclaw/canonical-routes'
import {
  OPENCLAW_COMMAND_PAYLOAD_POLICIES,
  OPENCLAW_COMMAND_QUERY_POLICIES,
} from '../openclaw/commands/payload-policy'

function toRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

describe('openclaw command payload policy coverage', () => {
  it('covers every canonical write route', () => {
    const canonicalRouteKeys = new Set(
      OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS.map((route) => toRouteKey(route.method, route.pattern))
    )

    const payloadPolicyKeys = new Set(
      OPENCLAW_COMMAND_PAYLOAD_POLICIES.map((policy) => toRouteKey(policy.method, policy.path))
    )

    const missingPolicies = Array.from(canonicalRouteKeys).filter((routeKey) => !payloadPolicyKeys.has(routeKey))

    expect(missingPolicies).toEqual([])
  })

  it('does not define stale policies outside canonical write routes', () => {
    const canonicalRouteKeys = new Set(
      OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS.map((route) => toRouteKey(route.method, route.pattern))
    )

    const payloadPolicyKeys = new Set(
      OPENCLAW_COMMAND_PAYLOAD_POLICIES.map((policy) => toRouteKey(policy.method, policy.path))
    )

    const stalePolicies = Array.from(payloadPolicyKeys).filter((policyKey) => !canonicalRouteKeys.has(policyKey))

    expect(stalePolicies).toEqual([])
  })

  it('keeps query-policy routes within canonical write routes', () => {
    const canonicalRouteKeys = new Set(
      OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS.map((route) => toRouteKey(route.method, route.pattern))
    )

    const queryPolicyKeys = new Set(
      OPENCLAW_COMMAND_QUERY_POLICIES.map((policy) => toRouteKey(policy.method, policy.path))
    )

    const staleQueryPolicies = Array.from(queryPolicyKeys).filter(
      (policyKey) => !canonicalRouteKeys.has(policyKey)
    )

    expect(staleQueryPolicies).toEqual([])
  })
})
