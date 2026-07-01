import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueMock = {
  initialize: vi.fn(),
  getRunningTasks: vi.fn(),
  getPendingTasks: vi.fn(),
  enqueue: vi.fn(),
}

const markProductScoreRequeueNeededMock = vi.fn()
const isProductScoreCalculationPausedMock = vi.fn()

vi.mock('@/lib/queue/queue-routing', () => ({
  getQueueManagerForTaskType: vi.fn(async () => queueMock),
}))

vi.mock('@/lib/launch-score/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/launch-score/server')>()
  return {
    ...actual,
    findExistingProductScoreTask: vi.fn(async (queue: any, userId: number) => {
      await queue.initialize()
      const [running, pending] = await Promise.all([
        queue.getRunningTasks(),
        queue.getPendingTasks(),
      ])
      return [...running, ...pending].find((task: any) => task.userId === userId) || null
    }),
    markProductScoreRequeueNeeded: markProductScoreRequeueNeededMock,
    isProductScoreCalculationPaused: isProductScoreCalculationPausedMock,
    ProductScoreCalculationPausedError: class ProductScoreCalculationPausedError extends Error {},
  }
})

describe('scheduleProductScoreCalculation', () => {
  beforeEach(() => {
    queueMock.initialize.mockReset().mockResolvedValue(undefined)
    queueMock.getRunningTasks.mockReset().mockResolvedValue([])
    queueMock.getPendingTasks.mockReset().mockResolvedValue([])
    queueMock.enqueue.mockReset().mockResolvedValue('new-task-id')
    markProductScoreRequeueNeededMock.mockReset().mockResolvedValue(undefined)
    isProductScoreCalculationPausedMock.mockReset().mockResolvedValue(false)
  })

  it('reuses an existing running task for the same user and marks follow-up', async () => {
    queueMock.getRunningTasks.mockResolvedValue([
      { id: 'running-1', type: 'product-score-calculation', userId: 42, status: 'running' },
    ])

    const { scheduleProductScoreCalculation } =
      await import('@/lib/queue/schedulers/product-score-scheduler')
    const taskId = await scheduleProductScoreCalculation(42, {
      trigger: 'sync-complete',
      forceRecalculate: true,
      productIds: [101],
    })

    expect(taskId).toBe('running-1')
    expect(queueMock.enqueue).not.toHaveBeenCalled()
    expect(markProductScoreRequeueNeededMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        trigger: 'sync-complete',
        forceRecalculate: true,
        productIds: [101],
      })
    )
  })

  it('does not enqueue a duplicate when a pending task already exists', async () => {
    queueMock.getPendingTasks.mockResolvedValue([
      { id: 'pending-1', type: 'product-score-calculation', userId: 7, status: 'pending' },
    ])

    const { scheduleProductScoreCalculation } =
      await import('@/lib/queue/schedulers/product-score-scheduler')
    const taskId = await scheduleProductScoreCalculation(7)

    expect(taskId).toBe('pending-1')
    expect(queueMock.enqueue).not.toHaveBeenCalled()
    expect(markProductScoreRequeueNeededMock).not.toHaveBeenCalled()
  })

  it('throws when score calculation is paused', async () => {
    isProductScoreCalculationPausedMock.mockResolvedValue(true)

    const { scheduleProductScoreCalculation } =
      await import('@/lib/queue/schedulers/product-score-scheduler')
    await expect(scheduleProductScoreCalculation(9)).rejects.toThrow('推荐指数计算已暂停')
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })
})
