import { getSetting } from '@/lib/settings'
import { getOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { createHash } from 'crypto'

const DEFAULT_GATEWAY_PORT = 18789
const DEFAULT_INVOKE_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_DELAY_MS = 250
const DEFAULT_DEDUPE_WINDOW_MS = 30_000
const ALLOWED_MESSAGE_ACTIONS = new Set([
  'send',
  'reply',
  'thread-reply',
  'sendAttachment',
  'sendWithEffect',
])
const inflightInvocations = new Map<string, Promise<any>>()
const recentInvocationResults = new Map<string, { expiresAt: number; value: any }>()

type InvokeOpenclawToolOptions = {
  timeoutMs?: number
  maxRetries?: number
  retryBaseDelayMs?: number
  idempotencyKey?: string
  dedupeWindowMs?: number
}

function parseGatewayPort(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const trimmed = String(value).trim()
  if (!trimmed) return fallback
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback
  return parsed
}

function resolveGatewayHost(bind: string | null | undefined): string {
  const normalized = (bind || '').trim().toLowerCase()
  if (!normalized || normalized === 'loopback') {
    return '127.0.0.1'
  }
  if (normalized === 'auto' || normalized === 'lan' || normalized === 'tailnet') {
    return '127.0.0.1'
  }
  return '127.0.0.1'
}

export async function resolveOpenclawGatewayBaseUrl(): Promise<string> {
  const override = (process.env.OPENCLAW_GATEWAY_URL || '').trim()
  if (override) return override.replace(/\/+$/, '')

  const portSetting = await getSetting('openclaw', 'gateway_port')
  const bindSetting = await getSetting('openclaw', 'gateway_bind')
  const port = parseGatewayPort(portSetting?.value, DEFAULT_GATEWAY_PORT)
  const host = resolveGatewayHost(bindSetting?.value)

  return `http://${host}:${port}`
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = String((error as any).name || '')
  return name === 'AbortError'
}

function shouldRetryStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return true
  return status >= 500
}

function shouldRetryError(error: unknown): boolean {
  if (isAbortError(error)) return true
  if (!error || typeof error !== 'object') return false
  const name = String((error as any).name || '')
  return name === 'TypeError' || name === 'FetchError'
}

function computeBackoffMs(attempt: number, baseDelayMs: number): number {
  const jitter = 0.75 + Math.random() * 0.5
  return Math.max(25, Math.floor(baseDelayMs * (2 ** attempt) * jitter))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanupRecentInvocationCache(now: number) {
  for (const [key, entry] of recentInvocationResults.entries()) {
    if (entry.expiresAt <= now) {
      recentInvocationResults.delete(key)
    }
  }
}

function assertAllowedOpenclawToolInvocation(payload: {
  tool: string
  action?: string
}) {
  const tool = String(payload.tool || '').trim()
  const action = String(payload.action || '').trim()

  if (tool !== 'message') {
    throw new Error(`OpenClaw tool not allowed by AutoAds policy: ${tool || 'unknown'}`)
  }

  if (!action || !ALLOWED_MESSAGE_ACTIONS.has(action)) {
    const allowed = Array.from(ALLOWED_MESSAGE_ACTIONS).join(', ')
    throw new Error(
      `OpenClaw message action not allowed by AutoAds policy: ${action || 'unknown'} (allowed: ${allowed})`
    )
  }
}

export async function invokeOpenclawTool(payload: {
  tool: string
  action?: string
  args?: Record<string, any>
  sessionKey?: string
}, options: InvokeOpenclawToolOptions = {}): Promise<any> {
  assertAllowedOpenclawToolInvocation(payload)

  const timeoutMs = options.timeoutMs
    ?? parsePositiveInt(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS, DEFAULT_INVOKE_TIMEOUT_MS)
  const maxRetries = options.maxRetries
    ?? parseNonNegativeInt(process.env.OPENCLAW_GATEWAY_MAX_RETRIES, DEFAULT_MAX_RETRIES)
  const retryBaseDelayMs = options.retryBaseDelayMs
    ?? parsePositiveInt(process.env.OPENCLAW_GATEWAY_RETRY_BASE_DELAY_MS, DEFAULT_RETRY_BASE_DELAY_MS)
  const dedupeWindowMs = options.dedupeWindowMs
    ?? parseNonNegativeInt(process.env.OPENCLAW_GATEWAY_DEDUPE_WINDOW_MS, DEFAULT_DEDUPE_WINDOW_MS)
  const explicitIdempotencyKey = String(options.idempotencyKey || '').trim() || undefined
  const inflightKey = explicitIdempotencyKey || hashPayload(payload)
  const now = Date.now()

  cleanupRecentInvocationCache(now)
  if (explicitIdempotencyKey) {
    const cached = recentInvocationResults.get(explicitIdempotencyKey)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }
  }

  const existing = inflightInvocations.get(inflightKey)
  if (existing) {
    return existing
  }

  const execution = (async () => {
    const baseUrl = await resolveOpenclawGatewayBaseUrl()
    const token = await getOpenclawGatewayToken()

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    if (explicitIdempotencyKey) {
      headers['X-Idempotency-Key'] = explicitIdempotencyKey
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetch(`${baseUrl}/tools/invoke`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        if (!response.ok) {
          const text = await response.text()
          const error = new Error(`OpenClaw gateway error (${response.status}): ${text}`)
          if (attempt < maxRetries && shouldRetryStatus(response.status)) {
            lastError = error
            await sleep(computeBackoffMs(attempt, retryBaseDelayMs))
            continue
          }
          throw error
        }

        const value = await response.json()
        if (explicitIdempotencyKey && dedupeWindowMs > 0) {
          recentInvocationResults.set(explicitIdempotencyKey, {
            value,
            expiresAt: Date.now() + dedupeWindowMs,
          })
        }
        return value
      } catch (error) {
        if (attempt < maxRetries && shouldRetryError(error)) {
          lastError = error
          await sleep(computeBackoffMs(attempt, retryBaseDelayMs))
          continue
        }

        if (isAbortError(error)) {
          throw new Error(`OpenClaw gateway timeout after ${timeoutMs}ms`)
        }
        throw error
      } finally {
        clearTimeout(timeoutHandle)
      }
    }

    if (isAbortError(lastError)) {
      throw new Error(`OpenClaw gateway timeout after ${timeoutMs}ms`)
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('OpenClaw gateway invocation failed')
  })()

  inflightInvocations.set(inflightKey, execution)
  try {
    return await execution
  } finally {
    inflightInvocations.delete(inflightKey)
  }
}

export function resetOpenclawGatewayInvokeCachesForTests() {
  inflightInvocations.clear()
  recentInvocationResults.clear()
}
