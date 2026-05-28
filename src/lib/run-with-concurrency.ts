/**
 * Run async work over items with a bounded concurrency pool.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return
  }

  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) {
        return
      }
      await worker(items[index], index)
    }
  })

  await Promise.all(workers)
}

/**
 * Map items with bounded concurrency; results preserve input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  await runWithConcurrency(items, concurrency, async (item, index) => {
    results[index] = await mapper(item, index)
  })
  return results
}

export function resolveBatchEvaluateConcurrency(envValue: string | undefined): number {
  const parsed = Number.parseInt(envValue ?? '8', 10)
  if (!Number.isFinite(parsed)) {
    return 8
  }
  return Math.max(1, Math.min(parsed, 20))
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} 超时（${timeoutMs}ms）`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }) as Promise<T>
}
