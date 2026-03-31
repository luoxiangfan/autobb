import { findUserById } from '@/lib/auth'
import { generateToken } from '@/lib/jwt'

type CachedUser = {
  user: { id: number; email: string; role: string; package_type: string }
  expiresAt: number
}

type CachedToken = {
  token: string
  expiresAt: number
}

const userCache = new Map<number, CachedUser>()
const tokenCache = new Map<number, CachedToken>()

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const USER_CACHE_TTL_MS = parseNumber(process.env.OPENCLAW_USER_CACHE_TTL_MS, 5 * 60 * 1000)
const TOKEN_CACHE_TTL_MS = parseNumber(process.env.OPENCLAW_JWT_CACHE_TTL_MS, 10 * 60 * 1000)
const MAX_CACHE_SIZE = parseNumber(process.env.OPENCLAW_CACHE_MAX_ENTRIES, 5000)

function cleanupCache(now: number) {
  if (userCache.size <= MAX_CACHE_SIZE && tokenCache.size <= MAX_CACHE_SIZE) {
    return
  }
  for (const [key, entry] of userCache.entries()) {
    if (entry.expiresAt <= now) {
      userCache.delete(key)
    }
  }
  for (const [key, entry] of tokenCache.entries()) {
    if (entry.expiresAt <= now) {
      tokenCache.delete(key)
    }
  }
}

async function resolveUser(userId: number) {
  const cached = userCache.get(userId)
  const now = Date.now()
  cleanupCache(now)
  if (cached && cached.expiresAt > now) {
    return cached.user
  }
  if (cached) {
    userCache.delete(userId)
  }

  const user = await findUserById(userId)
  if (!user) return null

  const normalized = {
    id: user.id,
    email: user.email,
    role: user.role,
    package_type: user.package_type,
  }
  userCache.set(userId, { user: normalized, expiresAt: now + USER_CACHE_TTL_MS })
  return normalized
}

function resolveUserToken(user: { id: number; email: string; role: string; package_type: string }) {
  const cached = tokenCache.get(user.id)
  const now = Date.now()
  cleanupCache(now)
  if (cached && cached.expiresAt > now) {
    return cached.token
  }
  if (cached) {
    tokenCache.delete(user.id)
  }

  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    packageType: user.package_type,
  })
  tokenCache.set(user.id, { token, expiresAt: now + TOKEN_CACHE_TTL_MS })
  return token
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = String(value || '').trim().replace(/\/+$/, '')
  if (!normalized) return ''

  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Invalid INTERNAL_APP_URL: must start with http:// or https://')
  }

  return normalized
}

function resolveAutoadsBaseUrl(): string {
  const internal = normalizeBaseUrl(process.env.INTERNAL_APP_URL)
  if (internal) {
    return internal
  }

  const port = String(process.env.PORT || '3000').trim() || '3000'
  return `http://127.0.0.1:${port}`
}

function toQueryString(query?: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams()
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      params.set(key, String(value))
    }
  }
  return params.toString()
}

export async function fetchAutoadsAsUser<T = any>(params: {
  userId: number
  path: string
  method?: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: any
  headers?: Record<string, string>
  timeoutMs?: number
}): Promise<Response> {
  const user = await resolveUser(params.userId)
  if (!user) {
    throw new Error(`User not found: ${params.userId}`)
  }

  const token = resolveUserToken(user)

  const baseUrl = resolveAutoadsBaseUrl()
  const queryString = toQueryString(params.query)
  const url = `${baseUrl}${params.path}${queryString ? `?${queryString}` : ''}`
  const method = (params.method || 'GET').toUpperCase()

  const headers: Record<string, string> = {
    'Cookie': `auth_token=${token}`,
    ...(params.headers || {}),
  }

  let body: string | undefined
  if (params.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = typeof params.body === 'string' ? params.body : JSON.stringify(params.body)
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }
  }

  const normalizedTimeoutMs = Number.isFinite(Number(params.timeoutMs))
    ? Math.max(0, Math.floor(Number(params.timeoutMs)))
    : 0
  const controller = normalizedTimeoutMs > 0 ? new AbortController() : null
  const timeoutHandle = controller
    ? setTimeout(() => controller.abort(), normalizedTimeoutMs)
    : null

  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: controller?.signal,
    })
  } catch (error: any) {
    if (normalizedTimeoutMs > 0 && error?.name === 'AbortError') {
      throw new Error(`AutoAds API timeout after ${normalizedTimeoutMs}ms: ${method} ${params.path}`)
    }
    throw error
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

export async function fetchAutoadsJson<T = any>(params: {
  userId: number
  path: string
  method?: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: any
  timeoutMs?: number
}): Promise<T> {
  const response = await fetchAutoadsAsUser({
    userId: params.userId,
    path: params.path,
    method: params.method,
    query: params.query,
    body: params.body,
    timeoutMs: params.timeoutMs,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AutoAds API error (${response.status}): ${text}`)
  }
  return await response.json() as T
}
