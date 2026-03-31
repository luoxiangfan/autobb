export type OpenclawCommandRiskLevel = 'low' | 'medium' | 'high' | 'critical'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const HIGH_RISK_PATH_PATTERNS: RegExp[] = [
  /\/delete\b/i,
  /\/offline\b/i,
  /\/blacklist\b/i,
  /\/pause\b/i,
  /\/publish\b/i,
  /\/budget\b/i,
  /\/offers?\//i,
  /\/campaigns?\//i,
  /\/settings(?:\/|$)/i,
  /\/google-ads(?:\/|$)/i,
  /\/google-ads-accounts(?:\/|$)/i,
  /\/sync\/(trigger|scheduler|config)\b/i,
]

const CRITICAL_PATH_PATTERNS: RegExp[] = [
  /\/bulk\b/i,
  /\/batch\b/i,
  /\/all\b/i,
]

type RouteRiskPolicy = {
  method: string
  path: string
  riskLevel: OpenclawCommandRiskLevel
}

type CompiledRouteRiskPolicy = RouteRiskPolicy & {
  method: string
  regex: RegExp
}

export type OpenclawCommandRouteRiskPolicyDefinition = Readonly<{
  method: string
  path: string
  riskLevel: OpenclawCommandRiskLevel
}>

function normalizePathPattern(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return trimmed
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return trimmed.slice(0, -1)
  }
  return trimmed
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePathPattern(pathPattern: string): RegExp {
  const normalizedPattern = normalizePathPattern(pathPattern)
  const segments = normalizedPattern.split('/').filter(Boolean)
  const source = segments
    .map((segment) => {
      if (segment.startsWith(':')) {
        return '[^/]+'
      }
      return escapeForRegex(segment)
    })
    .join('/')

  return new RegExp(`^/${source}$`)
}

function deriveRiskByHeuristics(method: string, path: string): OpenclawCommandRiskLevel {
  if (method === 'DELETE') {
    if (CRITICAL_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      return 'critical'
    }
    return 'high'
  }

  const isCritical = CRITICAL_PATH_PATTERNS.some((pattern) => pattern.test(path))
  const isHigh = HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(path))

  if (isCritical && isHigh) {
    return 'critical'
  }
  if (isHigh) {
    return 'high'
  }

  return 'medium'
}

const ROUTE_RISK_POLICIES: RouteRiskPolicy[] = [
  { method: 'PUT', path: '/api/offers/:id', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/offers/:id', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/scrape', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/rebuild', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/unlink', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/blacklist', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/offers/:id/blacklist', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/keyword-ideas', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/keyword-pool', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/offers/:id/keyword-pool', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/launch-ads', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/pause-campaigns', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/resolve-url', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/validate-url', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/launch-score', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/launch-score/compare', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/batch/:batchId/cancel', riskLevel: 'critical' },
  { method: 'POST', path: '/api/offers/extract', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/extract/stream', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/:id/generate-creatives-queue', riskLevel: 'high' },
  { method: 'POST', path: '/api/offers/batch/generate-creatives-queue', riskLevel: 'critical' },
  { method: 'PUT', path: '/api/ad-creatives/:id', riskLevel: 'medium' },
  { method: 'DELETE', path: '/api/ad-creatives/:id', riskLevel: 'high' },
  { method: 'POST', path: '/api/ad-creatives/:id/select', riskLevel: 'medium' },
  { method: 'POST', path: '/api/ad-creatives/:id/conversion-feedback', riskLevel: 'medium' },
  { method: 'POST', path: '/api/campaigns', riskLevel: 'medium' },
  { method: 'POST', path: '/api/campaigns/publish', riskLevel: 'high' },
  { method: 'PUT', path: '/api/campaigns/:id', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/campaigns/:id', riskLevel: 'high' },
  { method: 'PUT', path: '/api/campaigns/:id/toggle-status', riskLevel: 'high' },
  { method: 'POST', path: '/api/campaigns/:id/offline', riskLevel: 'high' },
  { method: 'PUT', path: '/api/campaigns/:id/update-cpc', riskLevel: 'high' },
  { method: 'PUT', path: '/api/campaigns/:id/update-budget', riskLevel: 'high' },
  { method: 'POST', path: '/api/campaigns/:id/sync', riskLevel: 'high' },
  { method: 'POST', path: '/api/campaigns/circuit-break', riskLevel: 'high' },
  { method: 'POST', path: '/api/url-swap/tasks', riskLevel: 'medium' },
  { method: 'PUT', path: '/api/url-swap/tasks/:id', riskLevel: 'medium' },
  { method: 'DELETE', path: '/api/url-swap/tasks/:id', riskLevel: 'high' },
  { method: 'POST', path: '/api/url-swap/tasks/:id/swap-now', riskLevel: 'medium' },
  { method: 'POST', path: '/api/url-swap/tasks/:id/disable', riskLevel: 'medium' },
  { method: 'POST', path: '/api/url-swap/tasks/:id/enable', riskLevel: 'medium' },
  { method: 'POST', path: '/api/url-swap/tasks/:id/targets/refresh', riskLevel: 'medium' },
  { method: 'POST', path: '/api/products/sync/:platform', riskLevel: 'medium' },
  { method: 'POST', path: '/api/products/:id/sync', riskLevel: 'medium' },
  { method: 'POST', path: '/api/products/:id/create-offer', riskLevel: 'medium' },
  { method: 'POST', path: '/api/products/:id/link-offer', riskLevel: 'medium' },
  { method: 'POST', path: '/api/products/:id/offline', riskLevel: 'high' },
  { method: 'POST', path: '/api/products/:id/blacklist', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/products/:id/blacklist', riskLevel: 'high' },
  { method: 'POST', path: '/api/products/batch-offline', riskLevel: 'medium' },
  { method: 'POST', path: '/api/products/batch-create-offers', riskLevel: 'medium' },
  { method: 'POST', path: '/api/products/clear', riskLevel: 'medium' },
  { method: 'POST', path: '/api/click-farm/tasks', riskLevel: 'medium' },
  { method: 'PUT', path: '/api/click-farm/tasks/:id', riskLevel: 'medium' },
  { method: 'DELETE', path: '/api/click-farm/tasks/:id', riskLevel: 'high' },
  { method: 'POST', path: '/api/click-farm/tasks/:id/stop', riskLevel: 'medium' },
  { method: 'POST', path: '/api/click-farm/tasks/:id/restart', riskLevel: 'medium' },
  { method: 'POST', path: '/api/click-farm/tasks/:id/trigger', riskLevel: 'medium' },
  { method: 'POST', path: '/api/click-farm/distribution/generate', riskLevel: 'medium' },
  { method: 'POST', path: '/api/click-farm/distribution/normalize', riskLevel: 'medium' },
  { method: 'POST', path: '/api/risk-alerts', riskLevel: 'medium' },
  { method: 'PATCH', path: '/api/risk-alerts/:id', riskLevel: 'medium' },
  { method: 'PUT', path: '/api/settings', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/settings', riskLevel: 'high' },
  { method: 'PUT', path: '/api/settings/:category/:key', riskLevel: 'high' },
  { method: 'POST', path: '/api/settings/validate', riskLevel: 'high' },
  { method: 'POST', path: '/api/settings/proxy/validate', riskLevel: 'high' },
  { method: 'POST', path: '/api/google-ads/credentials', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/google-ads/credentials', riskLevel: 'high' },
  { method: 'POST', path: '/api/google-ads/credentials/verify', riskLevel: 'high' },
  { method: 'POST', path: '/api/google-ads/service-account', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/google-ads/service-account', riskLevel: 'high' },
  { method: 'POST', path: '/api/google-ads/test-mcc/diagnose', riskLevel: 'high' },
  { method: 'POST', path: '/api/google-ads-accounts', riskLevel: 'high' },
  { method: 'PUT', path: '/api/google-ads-accounts/:id', riskLevel: 'high' },
  { method: 'DELETE', path: '/api/google-ads-accounts/:id', riskLevel: 'high' },
  { method: 'PUT', path: '/api/sync/config', riskLevel: 'high' },
  { method: 'POST', path: '/api/sync/scheduler', riskLevel: 'high' },
  { method: 'POST', path: '/api/sync/trigger', riskLevel: 'high' },
]

export const OPENCLAW_COMMAND_ROUTE_RISK_POLICIES: readonly OpenclawCommandRouteRiskPolicyDefinition[] =
  Object.freeze(
    ROUTE_RISK_POLICIES.map((policy) => ({
      method: policy.method.toUpperCase(),
      path: normalizePathPattern(policy.path),
      riskLevel: policy.riskLevel,
    }))
  )

const COMPILED_ROUTE_RISK_POLICIES: CompiledRouteRiskPolicy[] = ROUTE_RISK_POLICIES.map((policy) => ({
  ...policy,
  method: policy.method.toUpperCase(),
  regex: compilePathPattern(policy.path),
}))

function findRouteRiskPolicy(method: string, path: string): CompiledRouteRiskPolicy | undefined {
  const normalizedMethod = method.toUpperCase()
  return COMPILED_ROUTE_RISK_POLICIES.find(
    (policy) => policy.method === normalizedMethod && policy.regex.test(path)
  )
}

function parseBoolean(value?: string | null): boolean {
  if (!value) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function deriveOpenclawCommandRiskLevel(params: {
  method: string
  path: string
  strictCanonicalWrite?: boolean
}): OpenclawCommandRiskLevel {
  const method = params.method.toUpperCase()
  const path = params.path

  if (!WRITE_METHODS.has(method)) {
    return 'low'
  }

  const policy = findRouteRiskPolicy(method, path)
  if (policy) {
    return policy.riskLevel
  }

  if (params.strictCanonicalWrite) {
    throw new Error(`Invalid risk policy: missing route risk policy for ${method} ${path}`)
  }

  return deriveRiskByHeuristics(method, path)
}

export function requiresOpenclawCommandConfirmation(riskLevel: OpenclawCommandRiskLevel): boolean {
  if (riskLevel === 'critical' || riskLevel === 'high') {
    return true
  }

  if (riskLevel === 'medium') {
    return parseBoolean(process.env.OPENCLAW_CONFIRM_MEDIUM_RISK)
  }

  return false
}
