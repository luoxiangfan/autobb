export type OpenclawHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type OpenclawCanonicalRouteMatch = {
  method: OpenclawHttpMethod
  pattern: string
  feature: string
  normalizedPath: string
}

export type OpenclawCanonicalRouteDefinition = Readonly<{
  method: OpenclawHttpMethod
  pattern: string
  feature: string
}>

type CanonicalRouteDefinition = {
  method: OpenclawHttpMethod
  pattern: string
  feature: string
}

type CompiledCanonicalRoute = CanonicalRouteDefinition & {
  regex: RegExp
}

const ALLOWED_METHODS = new Set<OpenclawHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const READ_METHODS = new Set<OpenclawHttpMethod>(['GET'])
const WRITE_METHODS = new Set<OpenclawHttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE'])
const BLOCKED_PREFIXES = ['/api/admin', '/api/cron', '/api/test', '/api/openclaw']
const MAX_PATH_LENGTH = 512

const READ_ROUTE_DEFINITIONS: CanonicalRouteDefinition[] = [
  // Offer 管理/链路可视化
  { method: 'GET', pattern: '/api/offers', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id/creatives', feature: 'creative-management' },
  { method: 'GET', pattern: '/api/offers/:id/performance', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id/trends', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id/campaigns', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/offers/:id/campaigns/status', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/offers/:id/url-swap-task', feature: 'url-swap' },
  { method: 'GET', pattern: '/api/offers/:id/click-farm-task', feature: 'click-farm' },
  { method: 'GET', pattern: '/api/offers/:id/generate-ad-creative', feature: 'creative-management' },
  { method: 'GET', pattern: '/api/offers/:id/keyword-pool', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id/google-ads-ids', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id/launch-score', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id/launch-score/history', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/:id/launch-score/performance', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/batch-template', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/batch/status/:batchId', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/batch/stream/:batchId', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/batch/upload-records', feature: 'offer-management' },
  {
    method: 'GET',
    pattern: '/api/offers/batch/upload-records/:recordId',
    feature: 'offer-management',
  },
  { method: 'GET', pattern: '/api/offers/extract/status/:taskId', feature: 'offer-management' },
  { method: 'GET', pattern: '/api/offers/extract/stream/:taskId', feature: 'offer-management' },

  // 广告系列管理
  { method: 'GET', pattern: '/api/campaigns', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/campaigns/:id', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/campaigns/:id/cpc', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/campaigns/performance', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/campaigns/trends', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/campaigns/compare', feature: 'campaign-management' },
  { method: 'GET', pattern: '/api/campaigns/active-brand-snapshot', feature: 'campaign-management' },

  // 创意管理
  { method: 'GET', pattern: '/api/ad-creatives', feature: 'creative-management' },
  { method: 'GET', pattern: '/api/ad-creatives/:id', feature: 'creative-management' },
  { method: 'GET', pattern: '/api/ad-creatives/:id/bonus-score', feature: 'creative-management' },
  {
    method: 'GET',
    pattern: '/api/ad-creatives/:id/conversion-feedback',
    feature: 'creative-management',
  },
  { method: 'GET', pattern: '/api/creative-tasks/:taskId', feature: 'creative-management' },
  { method: 'GET', pattern: '/api/creative-tasks/:taskId/stream', feature: 'creative-management' },

  // 换链接
  { method: 'GET', pattern: '/api/url-swap/tasks', feature: 'url-swap' },
  { method: 'GET', pattern: '/api/url-swap/tasks/:id', feature: 'url-swap' },
  { method: 'GET', pattern: '/api/url-swap/tasks/:id/history', feature: 'url-swap' },
  { method: 'GET', pattern: '/api/url-swap/stats', feature: 'url-swap' },

  // 商品同步
  { method: 'GET', pattern: '/api/products', feature: 'product-sync' },
  { method: 'GET', pattern: '/api/products/sync-runs', feature: 'product-sync' },

  // 补点击
  { method: 'GET', pattern: '/api/click-farm/tasks', feature: 'click-farm' },
  { method: 'GET', pattern: '/api/click-farm/tasks/:id', feature: 'click-farm' },
  { method: 'GET', pattern: '/api/click-farm/tasks/:id/details', feature: 'click-farm' },
  { method: 'GET', pattern: '/api/click-farm/stats', feature: 'click-farm' },
  { method: 'GET', pattern: '/api/click-farm/notifications', feature: 'click-farm' },
  { method: 'GET', pattern: '/api/click-farm/hourly-distribution', feature: 'click-farm' },

  // Dashboard / Analytics / Risk Alerts（查询）
  { method: 'GET', pattern: '/api/dashboard/kpis', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/dashboard/summary', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/dashboard/insights', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/dashboard/api-quota', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/dashboard/ai-token-cost', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/analytics/roi', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/analytics/budget', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/analytics/spend-realtime', feature: 'analytics-query' },
  { method: 'GET', pattern: '/api/risk-alerts', feature: 'risk-management' },

  // Settings / Google Ads（查询）
  { method: 'GET', pattern: '/api/settings', feature: 'settings-management' },
  { method: 'GET', pattern: '/api/settings/:category/:key', feature: 'settings-management' },
  { method: 'GET', pattern: '/api/settings/proxy', feature: 'settings-management' },
  { method: 'GET', pattern: '/api/google-ads/credentials', feature: 'google-ads-management' },
  {
    method: 'GET',
    pattern: '/api/google-ads/credentials/accounts',
    feature: 'google-ads-management',
  },
  { method: 'GET', pattern: '/api/google-ads/service-account', feature: 'google-ads-management' },
  { method: 'GET', pattern: '/api/google-ads/idle-accounts', feature: 'google-ads-management' },
  { method: 'GET', pattern: '/api/google-ads/test-credentials', feature: 'google-ads-management' },
  { method: 'GET', pattern: '/api/google-ads-accounts', feature: 'google-ads-management' },
  { method: 'GET', pattern: '/api/google-ads-accounts/:id', feature: 'google-ads-management' },

  // 同步中心（查询）
  { method: 'GET', pattern: '/api/sync/status', feature: 'sync-management' },
  { method: 'GET', pattern: '/api/sync/config', feature: 'sync-management' },
  { method: 'GET', pattern: '/api/sync/logs', feature: 'sync-management' },
  { method: 'GET', pattern: '/api/sync/scheduler', feature: 'sync-management' },
]

const WRITE_ROUTE_DEFINITIONS: CanonicalRouteDefinition[] = [
  // Offer 管理
  { method: 'PUT', pattern: '/api/offers/:id', feature: 'offer-management' },
  { method: 'DELETE', pattern: '/api/offers/:id', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/scrape', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/rebuild', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/unlink', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/blacklist', feature: 'offer-management' },
  { method: 'DELETE', pattern: '/api/offers/:id/blacklist', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/keyword-ideas', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/keyword-pool', feature: 'offer-management' },
  { method: 'DELETE', pattern: '/api/offers/:id/keyword-pool', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/launch-ads', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/pause-campaigns', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/resolve-url', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/validate-url', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/launch-score', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/:id/launch-score/compare', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/batch/:batchId/cancel', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/extract', feature: 'offer-management' },
  { method: 'POST', pattern: '/api/offers/extract/stream', feature: 'offer-management' },

  // 创意管理（仅正统 A/B/D 生成链路，统一走异步队列）
  { method: 'POST', pattern: '/api/offers/:id/generate-creatives-queue', feature: 'creative-management' },
  {
    method: 'POST',
    pattern: '/api/offers/batch/generate-creatives-queue',
    feature: 'creative-management',
  },
  { method: 'PUT', pattern: '/api/ad-creatives/:id', feature: 'creative-management' },
  { method: 'DELETE', pattern: '/api/ad-creatives/:id', feature: 'creative-management' },
  { method: 'POST', pattern: '/api/ad-creatives/:id/select', feature: 'creative-management' },
  {
    method: 'POST',
    pattern: '/api/ad-creatives/:id/conversion-feedback',
    feature: 'creative-management',
  },

  // 广告系列管理（发布 / 下线 / 调整 CPC）
  { method: 'POST', pattern: '/api/campaigns', feature: 'campaign-management' },
  { method: 'POST', pattern: '/api/campaigns/publish', feature: 'campaign-management' },
  { method: 'PUT', pattern: '/api/campaigns/:id', feature: 'campaign-management' },
  { method: 'DELETE', pattern: '/api/campaigns/:id', feature: 'campaign-management' },
  { method: 'PUT', pattern: '/api/campaigns/:id/toggle-status', feature: 'campaign-management' },
  { method: 'POST', pattern: '/api/campaigns/:id/offline', feature: 'campaign-management' },
  { method: 'PUT', pattern: '/api/campaigns/:id/update-cpc', feature: 'campaign-management' },
  { method: 'PUT', pattern: '/api/campaigns/:id/update-budget', feature: 'campaign-management' },
  { method: 'POST', pattern: '/api/campaigns/:id/sync', feature: 'campaign-management' },
  { method: 'POST', pattern: '/api/campaigns/circuit-break', feature: 'campaign-management' },

  // 换链接
  { method: 'POST', pattern: '/api/url-swap/tasks', feature: 'url-swap' },
  { method: 'PUT', pattern: '/api/url-swap/tasks/:id', feature: 'url-swap' },
  { method: 'DELETE', pattern: '/api/url-swap/tasks/:id', feature: 'url-swap' },
  { method: 'POST', pattern: '/api/url-swap/tasks/:id/swap-now', feature: 'url-swap' },
  { method: 'POST', pattern: '/api/url-swap/tasks/:id/disable', feature: 'url-swap' },
  { method: 'POST', pattern: '/api/url-swap/tasks/:id/enable', feature: 'url-swap' },
  { method: 'POST', pattern: '/api/url-swap/tasks/:id/targets/refresh', feature: 'url-swap' },

  // 商品同步
  { method: 'POST', pattern: '/api/products/sync/:platform', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/:id/sync', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/:id/create-offer', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/:id/link-offer', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/:id/offline', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/:id/blacklist', feature: 'product-sync' },
  { method: 'DELETE', pattern: '/api/products/:id/blacklist', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/batch-offline', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/batch-create-offers', feature: 'product-sync' },
  { method: 'POST', pattern: '/api/products/clear', feature: 'product-sync' },

  // 补点击
  { method: 'POST', pattern: '/api/click-farm/tasks', feature: 'click-farm' },
  { method: 'PUT', pattern: '/api/click-farm/tasks/:id', feature: 'click-farm' },
  { method: 'DELETE', pattern: '/api/click-farm/tasks/:id', feature: 'click-farm' },
  { method: 'POST', pattern: '/api/click-farm/tasks/:id/stop', feature: 'click-farm' },
  { method: 'POST', pattern: '/api/click-farm/tasks/:id/restart', feature: 'click-farm' },
  { method: 'POST', pattern: '/api/click-farm/tasks/:id/trigger', feature: 'click-farm' },
  { method: 'POST', pattern: '/api/click-farm/distribution/generate', feature: 'click-farm' },
  { method: 'POST', pattern: '/api/click-farm/distribution/normalize', feature: 'click-farm' },

  // Risk Alerts（操作）
  { method: 'POST', pattern: '/api/risk-alerts', feature: 'risk-management' },
  { method: 'PATCH', pattern: '/api/risk-alerts/:id', feature: 'risk-management' },

  // Settings（操作）
  { method: 'PUT', pattern: '/api/settings', feature: 'settings-management' },
  { method: 'DELETE', pattern: '/api/settings', feature: 'settings-management' },
  { method: 'PUT', pattern: '/api/settings/:category/:key', feature: 'settings-management' },
  { method: 'POST', pattern: '/api/settings/validate', feature: 'settings-management' },
  { method: 'POST', pattern: '/api/settings/proxy/validate', feature: 'settings-management' },

  // Google Ads（操作）
  { method: 'POST', pattern: '/api/google-ads/credentials', feature: 'google-ads-management' },
  { method: 'DELETE', pattern: '/api/google-ads/credentials', feature: 'google-ads-management' },
  { method: 'POST', pattern: '/api/google-ads/credentials/verify', feature: 'google-ads-management' },
  { method: 'POST', pattern: '/api/google-ads/service-account', feature: 'google-ads-management' },
  { method: 'DELETE', pattern: '/api/google-ads/service-account', feature: 'google-ads-management' },
  { method: 'POST', pattern: '/api/google-ads/test-mcc/diagnose', feature: 'google-ads-management' },
  { method: 'POST', pattern: '/api/google-ads-accounts', feature: 'google-ads-management' },
  { method: 'PUT', pattern: '/api/google-ads-accounts/:id', feature: 'google-ads-management' },
  { method: 'DELETE', pattern: '/api/google-ads-accounts/:id', feature: 'google-ads-management' },

  // 同步中心（操作）
  { method: 'PUT', pattern: '/api/sync/config', feature: 'sync-management' },
  { method: 'POST', pattern: '/api/sync/scheduler', feature: 'sync-management' },
  { method: 'POST', pattern: '/api/sync/trigger', feature: 'sync-management' },
]

const CREATIVE_LEGACY_PATHS: RegExp[] = [
  /^\/api\/offers\/[^/]+\/generate-creatives$/,
  /^\/api\/ad-creatives$/,
  /^\/api\/offers\/[^/]+\/creatives\/generate-differentiated$/,
]
const CREATIVE_SYNC_PATH = /^\/api\/offers\/[^/]+\/generate-ad-creative$/

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim()
  if (!trimmed) return trimmed
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return trimmed.slice(0, -1)
  }
  return trimmed
}

function compileRouteDefinitions(definitions: CanonicalRouteDefinition[]): CompiledCanonicalRoute[] {
  return definitions.map((definition) => {
    const normalizedPattern = normalizePattern(definition.pattern)
    const segments = normalizedPattern.split('/').filter(Boolean)
    const source = segments
      .map((segment) => {
        if (segment.startsWith(':')) {
          return '[^/]+'
        }
        return escapeForRegex(segment)
      })
      .join('/')

    return {
      ...definition,
      pattern: normalizedPattern,
      regex: new RegExp(`^/${source}$`),
    }
  })
}

function snapshotRouteDefinitions(
  definitions: CanonicalRouteDefinition[]
): OpenclawCanonicalRouteDefinition[] {
  return definitions.map((definition) => ({
    method: definition.method,
    pattern: normalizePattern(definition.pattern),
    feature: definition.feature,
  }))
}

export const OPENCLAW_CANONICAL_READ_ROUTE_DEFINITIONS: readonly OpenclawCanonicalRouteDefinition[] =
  Object.freeze(snapshotRouteDefinitions(READ_ROUTE_DEFINITIONS))

export const OPENCLAW_CANONICAL_WRITE_ROUTE_DEFINITIONS: readonly OpenclawCanonicalRouteDefinition[] =
  Object.freeze(snapshotRouteDefinitions(WRITE_ROUTE_DEFINITIONS))

const READ_ROUTES = compileRouteDefinitions(READ_ROUTE_DEFINITIONS)
const WRITE_ROUTES = compileRouteDefinitions(WRITE_ROUTE_DEFINITIONS)

export function normalizeOpenclawApiPath(path: string): string {
  const trimmed = String(path || '').trim()
  if (!trimmed) return trimmed

  const withoutHash = trimmed.split('#')[0]
  const withoutQuery = withoutHash.split('?')[0]

  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1)
  }

  return withoutQuery
}

export function normalizeOpenclawApiMethod(method: string): OpenclawHttpMethod {
  const normalized = String(method || '').trim().toUpperCase() as OpenclawHttpMethod
  if (!ALLOWED_METHODS.has(normalized)) {
    throw new Error(`Method not allowed: ${normalized || method}`)
  }
  return normalized
}

export function validateOpenclawApiRequest(method: string, path: string): {
  method: OpenclawHttpMethod
  path: string
} {
  const normalizedMethod = normalizeOpenclawApiMethod(method)
  const rawPath = String(path || '').trim()

  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Invalid path')
  }

  if (rawPath.length > MAX_PATH_LENGTH) {
    throw new Error('Path too long')
  }

  if (rawPath.includes('://')) {
    throw new Error('Absolute URLs are not allowed')
  }

  const normalizedPath = normalizeOpenclawApiPath(rawPath)
  if (!normalizedPath.startsWith('/api/')) {
    throw new Error('Only /api routes are allowed')
  }

  if (normalizedPath.includes('..')) {
    throw new Error('Invalid path traversal')
  }

  for (const prefix of BLOCKED_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      throw new Error(`Path blocked: ${prefix}`)
    }
  }

  return {
    method: normalizedMethod,
    path: normalizedPath,
  }
}

export function isOpenclawReadMethod(method: OpenclawHttpMethod): boolean {
  return READ_METHODS.has(method)
}

export function isOpenclawWriteMethod(method: OpenclawHttpMethod): boolean {
  return WRITE_METHODS.has(method)
}

function findCanonicalRoute(
  method: OpenclawHttpMethod,
  normalizedPath: string,
  routes: CompiledCanonicalRoute[]
): CompiledCanonicalRoute | null {
  for (const route of routes) {
    if (route.method !== method) continue
    if (route.regex.test(normalizedPath)) {
      return route
    }
  }
  return null
}

function buildRouteNotAllowedError(prefix: string, method: OpenclawHttpMethod, path: string): Error {
  return new Error(`${prefix}: ${method} ${path}`)
}

export function assertOpenclawProxyRouteAllowed(params: {
  method: string
  path: string
}): OpenclawCanonicalRouteMatch {
  const { method, path } = validateOpenclawApiRequest(params.method, params.path)

  if (!isOpenclawReadMethod(method)) {
    throw new Error('OpenClaw proxy only supports read methods (GET)')
  }

  const route = findCanonicalRoute(method, path, READ_ROUTES)
  if (!route) {
    throw buildRouteNotAllowedError('OpenClaw proxy route not in canonical web flow', method, path)
  }

  return {
    method,
    pattern: route.pattern,
    feature: route.feature,
    normalizedPath: path,
  }
}

export function assertOpenclawCommandRouteAllowed(params: {
  method: string
  path: string
}): OpenclawCanonicalRouteMatch {
  const { method, path } = validateOpenclawApiRequest(params.method, params.path)

  if (!isOpenclawWriteMethod(method)) {
    throw new Error(
      'OpenClaw commands only supports write methods (POST/PUT/PATCH/DELETE). Use /api/openclaw/proxy for reads.'
    )
  }

  if (method === 'POST' && CREATIVE_LEGACY_PATHS.some((pattern) => pattern.test(path))) {
    throw new Error(
      'Creative generation must follow A/B/D flow: use /api/offers/:id/generate-creatives-queue (with bucket A/B/D).'
    )
  }

  if (method === 'POST' && CREATIVE_SYNC_PATH.test(path)) {
    throw new Error(
      'Creative generation is long-running. Use /api/offers/:id/generate-creatives-queue (with bucket A/B/D) for async execution.'
    )
  }

  if (method === 'POST' && path === '/api/offers') {
    throw new Error(
      'OpenClaw command route not in canonical web flow: POST /api/offers. Offer creation must use POST /api/offers/extract or POST /api/offers/extract/stream.'
    )
  }

  const route = findCanonicalRoute(method, path, WRITE_ROUTES)
  if (!route) {
    throw buildRouteNotAllowedError('OpenClaw command route not in canonical web flow', method, path)
  }

  return {
    method,
    pattern: route.pattern,
    feature: route.feature,
    normalizedPath: path,
  }
}
