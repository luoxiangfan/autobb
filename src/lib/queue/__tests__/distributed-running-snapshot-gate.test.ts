import { describe, expect, it, vi } from 'vitest'

import { UnifiedQueueManager } from '@/lib/queue/unified-queue-manager'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 2000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await sleep(intervalMs)
  }
  throw new Error('waitFor timeout')
}

describe('UnifiedQueueManager distributed running snapshot gate', () => {
  it('requeues pending task when cross-process running snapshot already hits concurrency limit', async () => {
    const queue = new UnifiedQueueManager({
      globalConcurrency: 10,
      perUserConcurrency: 10,
    })

    queue.updateConfig({
      perTypeConcurrency: {
        'ad-creative': 3,
      },
    })

    const executor = vi.fn(async () => ({ ok: true }))
    queue.registerExecutor('ad-creative', executor as any)
    queue.registerAllExecutors()

    try {
      const adapter = (queue as any).adapter as any
      adapter.getRunningConcurrencySnapshot = vi.fn(async () => ({
        globalCoreRunning: 3,
        userCoreRunning: 3,
        typeRunning: 3,
      }))

      const taskId = await queue.enqueue('ad-creative', { offerId: 12345 }, 42, {
        maxRetries: 0,
      })

      await waitFor(async () => {
        return (adapter.getRunningConcurrencySnapshot as ReturnType<typeof vi.fn>).mock.calls.length > 0
      })

      const task = await queue.getTask(taskId)
      expect(task?.status).toBe('pending')
      expect(executor).not.toHaveBeenCalled()
    } finally {
      await queue.stop()
    }
  })
})
