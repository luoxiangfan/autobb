import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedEligibility = vi.hoisted(() => ({
  assertUserExecutionAllowed: vi.fn(),
  isUserExecutionSuspendedError: vi.fn((error: any) => error?.code === 'USER_EXECUTION_SUSPENDED'),
}))

vi.mock('@/lib/campaign', () => ({
  assertUserExecutionAllowed: mockedEligibility.assertUserExecutionAllowed,
  isUserExecutionSuspendedError: mockedEligibility.isUserExecutionSuspendedError,
  USER_EXECUTION_SUSPENDED_ERROR_CODE: 'USER_EXECUTION_SUSPENDED',
}))

import { UnifiedQueueManager } from '@/lib/queue'

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

describe('UnifiedQueueManager running index consistency', () => {
  beforeEach(() => {
    mockedEligibility.assertUserExecutionAllowed.mockResolvedValue(undefined)
  })

  it('does not keep deferred pending tasks in the running index when per-user concurrency blocks', async () => {
    const queue = new UnifiedQueueManager({
      globalConcurrency: 10,
      perUserConcurrency: 4,
    })

    queue.updateConfig({
      perTypeConcurrency: {
        'ad-creative': 10,
      },
    })

    queue.registerExecutor('ad-creative', async () => {
      await sleep(800)
      return { ok: true }
    })

    // 防止 ensureStarted() 自动导入并注册全量执行器（会引入较多副作用）
    queue.registerAllExecutors()

    const userId = 123

    try {
      for (let i = 0; i < 10; i++) {
        await queue.enqueue('ad-creative', { index: i }, userId)
      }

      await waitFor(async () => {
        const stats = await queue.getStats()
        return stats.running === 4 && stats.pending >= 1
      })

      const stats = await queue.getStats()
      const runningTasks = await queue.getRunningTasks()

      expect(runningTasks.length).toBe(stats.running)
      expect(runningTasks.every((t) => t.status === 'running')).toBe(true)
      expect(runningTasks.filter((t) => t.userId === userId).length).toBeLessThanOrEqual(4)
    } finally {
      await queue.stop()
    }
  })
})
