import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedEligibility = vi.hoisted(() => ({
  assertUserExecutionAllowed: vi.fn(),
  isUserExecutionSuspendedError: vi.fn((error: any) => error?.code === 'USER_EXECUTION_SUSPENDED'),
}))

vi.mock('@/lib/user-execution-eligibility', () => ({
  assertUserExecutionAllowed: mockedEligibility.assertUserExecutionAllowed,
  isUserExecutionSuspendedError: mockedEligibility.isUserExecutionSuspendedError,
  USER_EXECUTION_SUSPENDED_ERROR_CODE: 'USER_EXECUTION_SUSPENDED',
}))

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

describe('UnifiedQueueManager user execution gate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedEligibility.isUserExecutionSuspendedError.mockImplementation((error: any) => error?.code === 'USER_EXECUTION_SUSPENDED')
  })

  it('fails task without retry when user execution is suspended', async () => {
    const queue = new UnifiedQueueManager({
      globalConcurrency: 10,
      perUserConcurrency: 10,
    })
    const executor = vi.fn(async () => ({ ok: true }))
    queue.registerExecutor('sync', executor as any)
    queue.registerAllExecutors()

    const suspendedError = new Error('blocked')
    ;(suspendedError as any).code = 'USER_EXECUTION_SUSPENDED'
    ;(suspendedError as any).reason = 'inactive'
    mockedEligibility.assertUserExecutionAllowed.mockRejectedValue(suspendedError)

    try {
      const taskId = await queue.enqueue('sync', { userId: 42, syncType: 'auto' } as any, 42, {
        maxRetries: 2,
      })

      await waitFor(async () => {
        const task = await queue.getTask(taskId)
        return task?.status === 'failed'
      })

      const task = await queue.getTask(taskId)
      expect(task?.status).toBe('failed')
      expect(task?.retryCount || 0).toBe(0)
      expect(executor).not.toHaveBeenCalled()
      expect(mockedEligibility.assertUserExecutionAllowed).toHaveBeenCalled()
    } finally {
      await queue.stop()
    }
  })

  it('executes task when user eligibility gate passes', async () => {
    const queue = new UnifiedQueueManager({
      globalConcurrency: 10,
      perUserConcurrency: 10,
    })
    const executor = vi.fn(async () => ({ ok: true }))
    queue.registerExecutor('sync', executor as any)
    queue.registerAllExecutors()
    mockedEligibility.assertUserExecutionAllowed.mockResolvedValue(undefined)

    try {
      const taskId = await queue.enqueue('sync', { userId: 7, syncType: 'manual' } as any, 7, {
        maxRetries: 0,
      })

      await waitFor(async () => {
        const task = await queue.getTask(taskId)
        return task?.status === 'completed'
      })

      const task = await queue.getTask(taskId)
      expect(task?.status).toBe('completed')
      expect(executor).toHaveBeenCalledTimes(1)
      expect(mockedEligibility.assertUserExecutionAllowed).toHaveBeenCalled()
    } finally {
      await queue.stop()
    }
  })
})
