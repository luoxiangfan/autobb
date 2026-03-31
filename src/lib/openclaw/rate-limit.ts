type RateLimitEntry = {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const WINDOW_MS = parseNumber(process.env.OPENCLAW_PROXY_RATE_WINDOW_MS, 60_000)
const MAX_REQUESTS = parseNumber(process.env.OPENCLAW_PROXY_MAX_REQUESTS, 300)

export function checkOpenclawRateLimit(identifier: string): { remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = rateLimitStore.get(identifier)

  if (!entry || now > entry.resetAt) {
    const resetAt = now + WINDOW_MS
    rateLimitStore.set(identifier, { count: 1, resetAt })
    return { remaining: Math.max(0, MAX_REQUESTS - 1), resetAt }
  }

  if (entry.count >= MAX_REQUESTS) {
    const secondsRemaining = Math.ceil((entry.resetAt - now) / 1000)
    throw new Error(`OpenClaw请求过于频繁，请在${secondsRemaining}秒后重试`)
  }

  entry.count += 1
  return { remaining: Math.max(0, MAX_REQUESTS - entry.count), resetAt: entry.resetAt }
}
