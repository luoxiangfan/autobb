import { verifyOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { verifyOpenclawUserToken } from '@/lib/openclaw/tokens'
import { fetchAutoadsAsUser } from '@/lib/openclaw/autoads-client'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'
import { checkOpenclawRateLimit } from '@/lib/openclaw/rate-limit'
import { resolveOpenclawUserFromBinding } from '@/lib/openclaw/bindings'
import { isOpenclawEnabledForUser } from '@/lib/openclaw/request-auth'
import { executeOpenclawCommand } from '@/lib/openclaw/commands/command-service'
import { resolveOpenclawParentRequestId, type OpenclawParentRequestIdSource } from '@/lib/openclaw/request-correlation'
import {
  assertOpenclawProxyRouteAllowed,
  isOpenclawWriteMethod,
  validateOpenclawApiRequest,
} from '@/lib/openclaw/canonical-routes'

export type OpenclawProxyRequest = {
  method: string
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: any
  intent?: string | null
  idempotencyKey?: string | null
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
  tenantKey?: string | null
  parentRequestId?: string | null
  parentRequestIdSource?: OpenclawParentRequestIdSource
}

type ResolvedOpenclawUser = {
  userId: number
  authType: 'user-token' | 'gateway-binding'
}

type ProxyQuery = Record<string, string | number | boolean | null | undefined>

type NormalizedProxyTarget = {
  path: string
  query: ProxyQuery | undefined
  rewritten: boolean
}

type OpenclawPollingRouteKind = 'offer-extract-status' | 'creative-task-status'

const OPENCLAW_TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled', 'expired'])
const OPENCLAW_POLLING_INTERVAL_MIN_MS = 2000
const OPENCLAW_POLLING_INTERVAL_MAX_MS = 8000
const OPENCLAW_POLLING_TIMEOUT_MS = 30000

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const OPENCLAW_PROXY_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.OPENCLAW_PROXY_TIMEOUT_MS,
  45000
)
const OPENCLAW_PROXY_STREAM_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.OPENCLAW_PROXY_STREAM_TIMEOUT_MS,
  30 * 60 * 1000
)

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const value = authHeader.trim()
  if (!value) return null
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim()
  }
  return value
}

async function resolveOpenclawUser(params: {
  authHeader: string | null
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
  tenantKey?: string | null
}): Promise<ResolvedOpenclawUser | null> {
  const token = extractBearerToken(params.authHeader)
  if (!token) return null

  if (await verifyOpenclawGatewayToken(token)) {
    const userId = await resolveOpenclawUserFromBinding(params.channel, params.senderId, {
      accountId: params.accountId,
      tenantKey: params.tenantKey,
    })
    if (!userId) return null
    return { userId, authType: 'gateway-binding' }
  }

  const tokenRecord = await verifyOpenclawUserToken(token)
  if (!tokenRecord) return null
  return { userId: tokenRecord.user_id, authType: 'user-token' }
}

function withQueryPatch(
  baseQuery: ProxyQuery | undefined,
  patch: ProxyQuery
): ProxyQuery | undefined {
  const merged: ProxyQuery = {
    ...(baseQuery || {}),
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || String(value).trim() === '') {
      continue
    }
    merged[key] = value
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export function normalizeOpenclawProxyTarget(params: {
  path: string
  query?: ProxyQuery
}): NormalizedProxyTarget {
  const path = (params.path || '').trim()
  const query = params.query

  // Legacy Google Ads account listing aliases (read-only):
  // map them to canonical /api/google-ads-accounts to avoid
  // accidental match with /api/campaigns/:id (NaN id errors).
  if (
    path === '/api/google-ads/accounts'
    || path === '/api/campaigns/accounts'
    || path === '/api/campaigns/google-ads-accounts'
  ) {
    return {
      path: '/api/google-ads-accounts',
      query,
      rewritten: true,
    }
  }

  const googleAdsAccountDetailMatch = path.match(/^\/api\/google-ads\/accounts\/(\d+)$/)
  if (googleAdsAccountDetailMatch) {
    return {
      path: `/api/google-ads-accounts/${googleAdsAccountDetailMatch[1]}`,
      query,
      rewritten: true,
    }
  }

  if (path === '/api/reports/campaigns' || path === '/api/google-ads/reports') {
    return {
      path: '/api/campaigns/performance',
      query,
      rewritten: true,
    }
  }

  if (path === '/api/google-ads/campaigns') {
    return {
      path: '/api/campaigns',
      query,
      rewritten: true,
    }
  }

  const accountCampaignsMatch = path.match(/^\/api\/google-ads\/accounts\/(\d+)\/campaigns$/)
  if (accountCampaignsMatch) {
    return {
      path: '/api/campaigns',
      query: withQueryPatch(query, { googleAdsAccountId: accountCampaignsMatch[1] }),
      rewritten: true,
    }
  }

  const campaignMetricsMatch = path.match(/^\/api\/campaigns\/(\d+)\/(metrics|performance)$/)
  if (campaignMetricsMatch) {
    return {
      path: '/api/campaigns/performance',
      query: withQueryPatch(query, { campaignId: campaignMetricsMatch[1] }),
      rewritten: true,
    }
  }

  return {
    path,
    query,
    rewritten: false,
  }
}

function deriveTarget(path: string): { targetType?: string; targetId?: string } {
  const clean = path.split('?')[0]
  const parts = clean.split('/').filter(Boolean)
  if (parts.length < 2 || parts[0] !== 'api') {
    return {}
  }
  return {
    targetType: parts[1],
    targetId: parts[2],
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(value: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseNestedJsonValue(value: unknown): unknown {
  let current = value
  for (let depth = 0; depth < 2; depth += 1) {
    if (typeof current !== 'string') return current
    const trimmed = current.trim()
    if (!trimmed) return null
    try {
      current = JSON.parse(trimmed)
    } catch {
      return current
    }
  }
  return current
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : null
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toOptionalNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clampPollingIntervalMs(value: number | null): number {
  if (value === null) return OPENCLAW_POLLING_INTERVAL_MIN_MS
  const normalized = Math.round(value)
  if (normalized < OPENCLAW_POLLING_INTERVAL_MIN_MS) {
    return OPENCLAW_POLLING_INTERVAL_MIN_MS
  }
  if (normalized > OPENCLAW_POLLING_INTERVAL_MAX_MS) {
    return OPENCLAW_POLLING_INTERVAL_MAX_MS
  }
  return normalized
}

function summarizeOfferExtractResult(result: unknown): Record<string, any> | null {
  const parsed = parseNestedJsonValue(result)
  if (!isPlainObject(parsed)) return null

  const offer = isPlainObject(parsed.offer) ? parsed.offer : null
  const summary: Record<string, any> = {}

  const offerId = toPositiveInteger(parsed.offerId ?? parsed.offer_id ?? offer?.id)
  if (offerId) summary.offerId = offerId

  const asin = toNonEmptyString(parsed.asin)
  if (asin) summary.asin = asin

  const brand = toNonEmptyString(parsed.brand)
  if (brand) summary.brand = brand

  const productName = toNonEmptyString(parsed.productName ?? parsed.product_name)
  if (productName) summary.productName = productName

  const productPriceRaw = parsed.productPrice ?? parsed.product_price
  const productPriceNumber = toOptionalNumber(productPriceRaw)
  if (productPriceNumber !== null) {
    summary.productPrice = productPriceNumber
  } else {
    const productPrice = toNonEmptyString(productPriceRaw)
    if (productPrice) summary.productPrice = productPrice
  }

  const finalUrl = toNonEmptyString(parsed.finalUrl ?? parsed.final_url)
  if (finalUrl) summary.finalUrl = finalUrl

  return Object.keys(summary).length > 0 ? summary : null
}

function summarizeCreativeTaskResult(result: unknown): Record<string, any> | null {
  const parsed = parseNestedJsonValue(result)
  if (!isPlainObject(parsed)) return null

  const creative = isPlainObject(parsed.creative) ? parsed.creative : null
  const offer = isPlainObject(parsed.offer) ? parsed.offer : null
  const summary: Record<string, any> = {}

  if (typeof parsed.success === 'boolean') {
    summary.success = parsed.success
  }

  const offerId = toPositiveInteger(parsed.offerId ?? parsed.offer_id ?? offer?.id ?? offer?.offerId)
  if (offerId) summary.offerId = offerId

  const creativeId = toPositiveInteger(parsed.creativeId ?? parsed.creative_id ?? creative?.id)
  if (creativeId) summary.creativeId = creativeId

  const adStrength = toNonEmptyString(parsed.adStrength ?? creative?.adStrength)
  if (adStrength) summary.adStrength = adStrength

  const bucket = toNonEmptyString(parsed.bucket ?? creative?.bucket)
  if (bucket) summary.bucket = bucket

  if (Array.isArray(creative?.headlines)) {
    summary.headlinesCount = creative.headlines.length
  }
  if (Array.isArray(creative?.descriptions)) {
    summary.descriptionsCount = creative.descriptions.length
  }
  if (Array.isArray(creative?.keywords)) {
    summary.keywordsCount = creative.keywords.length
  }

  return Object.keys(summary).length > 0 ? summary : null
}

function resolvePollingRouteKind(path: string): OpenclawPollingRouteKind | null {
  if (/^\/api\/offers\/extract\/status\/[^/]+$/.test(path)) {
    return 'offer-extract-status'
  }
  if (/^\/api\/creative-tasks\/[^/]+$/.test(path)) {
    return 'creative-task-status'
  }
  return null
}

function isJsonContentType(contentType: string): boolean {
  const normalized = String(contentType || '').toLowerCase()
  return normalized.includes('application/json') || normalized.includes('+json')
}

function compactPollingStatusResponse(params: {
  path: string
  bodyText: string
}): { compacted: boolean; bodyText: string } {
  const routeKind = resolvePollingRouteKind(params.path)
  if (!routeKind) {
    return {
      compacted: false,
      bodyText: params.bodyText,
    }
  }

  const parsed = parseJsonObject(params.bodyText)
  if (!parsed) {
    return {
      compacted: false,
      bodyText: params.bodyText,
    }
  }

  if (typeof parsed.taskId !== 'string' || typeof parsed.status !== 'string') {
    return {
      compacted: false,
      bodyText: params.bodyText,
    }
  }

  const compacted: Record<string, any> = {}
  const passthroughFields = [
    'taskId',
    'status',
    'stage',
    'progress',
    'message',
    'error',
    'errorDetails',
    'createdAt',
    'updatedAt',
    'startedAt',
    'completedAt',
    'recommendedPollIntervalMs',
    'streamSupported',
    'streamUrl',
    'waitApplied',
  ]
  for (const field of passthroughFields) {
    if (parsed[field] !== undefined) {
      compacted[field] = parsed[field]
    }
  }

  const resultSummary = routeKind === 'offer-extract-status'
    ? summarizeOfferExtractResult(parsed.result)
    : summarizeCreativeTaskResult(parsed.result)

  compacted.result = resultSummary
  compacted.resultSummary = resultSummary

  const normalizedStatus = String(parsed.status || '').trim().toLowerCase()
  const terminal = OPENCLAW_TERMINAL_TASK_STATUSES.has(normalizedStatus)
  const recommendedPollIntervalMs = clampPollingIntervalMs(toOptionalNumber(parsed.recommendedPollIntervalMs))
  const updatedAt = toNonEmptyString(parsed.updatedAt)
  compacted.polling = {
    terminal,
    shouldStop: terminal,
    status: normalizedStatus || null,
    nextPollInMs: terminal ? 0 : recommendedPollIntervalMs,
    nextRequest: terminal || !updatedAt ? null : {
      method: 'GET',
      path: params.path,
      query: {
        waitForUpdate: '1',
        lastUpdatedAt: updatedAt,
        timeoutMs: String(OPENCLAW_POLLING_TIMEOUT_MS),
      },
    },
  }

  return {
    compacted: true,
    bodyText: JSON.stringify(compacted),
  }
}

export async function handleOpenclawProxyRequest(params: {
  request: OpenclawProxyRequest
  authHeader: string | null
}): Promise<Response> {
  const { request } = params
  const resolved = await resolveOpenclawUser({
    authHeader: params.authHeader,
    channel: request.channel,
    senderId: request.senderId,
    accountId: request.accountId,
    tenantKey: request.tenantKey,
  })

  if (!resolved) {
    throw new Error('OpenClaw authentication failed')
  }

  const openclawEnabled = await isOpenclawEnabledForUser(resolved.userId)
  if (!openclawEnabled) {
    throw new Error('OpenClaw access denied')
  }

  const requestedTarget = validateOpenclawApiRequest(request.method || 'GET', String(request.path || '').trim())

  checkOpenclawRateLimit(`user:${resolved.userId}`)

  const resolvedParentRequestId = await resolveOpenclawParentRequestId({
    explicitParentRequestId: request.parentRequestId || undefined,
    explicitSource: request.parentRequestIdSource || undefined,
    userId: resolved.userId,
    channel: request.channel || null,
    senderId: request.senderId || null,
    accountId: request.accountId || null,
  })

  // Backward compatibility bridge:
  // if caller still sends write operations to /api/openclaw/proxy,
  // route them through the command queue so we keep run/confirm/action linkage.
  if (isOpenclawWriteMethod(requestedTarget.method)) {
    const result = await executeOpenclawCommand({
      userId: resolved.userId,
      authType: resolved.authType,
      method: requestedTarget.method,
      path: requestedTarget.path,
      query: request.query,
      body: request.body,
      channel: request.channel || null,
      senderId: request.senderId || null,
      intent: request.intent || undefined,
      idempotencyKey: request.idempotencyKey || undefined,
      parentRequestId: resolvedParentRequestId,
    })

    const status = result.status === 'pending_confirm' ? 202 : 200
    return Response.json(
      {
        success: true,
        bridged: true,
        ...result,
      },
      {
        status,
        headers: {
          'x-openclaw-proxy-bridge': 'commands-execute',
        },
      }
    )
  }

  const normalizedTarget = normalizeOpenclawProxyTarget({
    path: requestedTarget.path,
    query: request.query,
  })

  const canonicalTarget = assertOpenclawProxyRouteAllowed({
    method: requestedTarget.method,
    path: normalizedTarget.path,
  })

  const method = canonicalTarget.method
  const finalPath = canonicalTarget.normalizedPath

  const { targetType, targetId } = deriveTarget(finalPath)
  const actionPath = normalizedTarget.rewritten
    ? `${requestedTarget.path} -> ${finalPath}`
    : finalPath
  const action = `${method} ${actionPath}`
  const requestBodyString = request.body ? JSON.stringify(request.body) : null
  const startedAt = Date.now()
  const timeoutMs = finalPath.includes('/stream')
    ? OPENCLAW_PROXY_STREAM_TIMEOUT_MS
    : OPENCLAW_PROXY_TIMEOUT_MS
  let upstream: Response

  try {
    upstream = await fetchAutoadsAsUser({
      userId: resolved.userId,
      path: finalPath,
      method,
      query: normalizedTarget.query,
      body: request.body,
      timeoutMs,
    })
  } catch (error: any) {
    const latencyMs = Date.now() - startedAt
    const errorMessage = error?.message || 'OpenClaw proxy upstream request failed'
    await recordOpenclawAction({
      userId: resolved.userId,
      channel: request.channel || null,
      senderId: request.senderId || null,
      action,
      targetType,
      targetId,
      requestBody: requestBodyString,
      status: 'error',
      errorMessage,
      latencyMs,
    })
    throw error
  }

  const latencyMs = Date.now() - startedAt

  const contentType = upstream.headers.get('content-type') || ''
  const isEventStream = contentType.includes('text/event-stream')

  let responseBodyText: string | null = null
  let responseBodyForClient: string | null = null
  if (!isEventStream) {
    const cloned = upstream.clone()
    try {
      responseBodyText = await cloned.text()
    } catch {
      responseBodyText = null
    }

    if (responseBodyText !== null && isJsonContentType(contentType)) {
      const compacted = compactPollingStatusResponse({
        path: finalPath,
        bodyText: responseBodyText,
      })
      if (compacted.compacted) {
        responseBodyText = compacted.bodyText
        responseBodyForClient = compacted.bodyText
      }
    }
  }

  await recordOpenclawAction({
    userId: resolved.userId,
    channel: request.channel || null,
    senderId: request.senderId || null,
    action,
    targetType,
    targetId,
    requestBody: requestBodyString,
    responseBody: responseBodyText,
    status: upstream.ok ? 'success' : 'error',
    errorMessage: upstream.ok ? null : responseBodyText,
    latencyMs,
  })

  if (responseBodyForClient !== null) {
    const headers = new Headers(upstream.headers)
    headers.delete('content-length')
    return new Response(responseBodyForClient, {
      status: upstream.status,
      headers,
    })
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
}
