type ReleaseFn = () => void

class AsyncSemaphore {
  private inFlight = 0
  private waiters: Array<(release: ReleaseFn) => void> = []

  constructor(private readonly maxInFlight: number) {}

  async acquire(): Promise<ReleaseFn> {
    if (this.inFlight < this.maxInFlight) {
      this.inFlight++
      return () => this.release()
    }

    return await new Promise<ReleaseFn>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private release() {
    this.inFlight = Math.max(0, this.inFlight - 1)
    const next = this.waiters.shift()
    if (next) {
      this.inFlight++
      next(() => this.release())
    }
  }
}

export function resolveAffiliateDirectHttpConcurrencyLimit(envValue: string | undefined): number {
  const parsed = Number.parseInt(envValue ?? '3', 10)
  if (!Number.isFinite(parsed)) return 3
  return Math.max(1, Math.min(parsed, 10))
}

export function resolveAffiliateDirectHttpMinGapMs(envValue: string | undefined): number {
  const parsed = Number.parseInt(envValue ?? '300', 10)
  if (!Number.isFinite(parsed)) return 300
  return Math.max(0, Math.min(parsed, 5000))
}

const directHttpSemaphore = new AsyncSemaphore(
  resolveAffiliateDirectHttpConcurrencyLimit(process.env.AFFILIATE_DIRECT_HTTP_CONCURRENCY)
)

let lastDirectHttpStartAt = 0

/**
 * 限制联盟跟踪域直连 HTTP 的全局并发，避免批量解析时打满同一出口 IP。
 */
export async function runWithAffiliateDirectHttpConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  const release = await directHttpSemaphore.acquire()
  try {
    const minGapMs = resolveAffiliateDirectHttpMinGapMs(
      process.env.AFFILIATE_DIRECT_HTTP_MIN_GAP_MS
    )
    if (minGapMs > 0) {
      const elapsed = Date.now() - lastDirectHttpStartAt
      if (lastDirectHttpStartAt > 0 && elapsed < minGapMs) {
        await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed))
      }
      lastDirectHttpStartAt = Date.now()
    }
    return await fn()
  } finally {
    release()
  }
}
