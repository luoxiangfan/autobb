import { describe, expect, it } from 'vitest'

import { UnifiedQueueManager } from '@/lib/queue/unified-queue-manager'

describe('UnifiedQueueManager.purgePendingTasksByUserAndTypes', () => {
  it('purges pending tasks without starting the worker loop', async () => {
    const queue = new UnifiedQueueManager({
      redisUrl: undefined,
      autoStartOnEnqueue: false,
    })

    await queue.enqueue('click-farm', { taskId: 'cf1' } as any, 1, { maxRetries: 0 })
    await queue.enqueue('url-swap', { taskId: 'us1' } as any, 1, { maxRetries: 0 })
    await queue.enqueue('sync', { syncType: 'auto' } as any, 1, { maxRetries: 0 })
    await queue.enqueue('click-farm', { taskId: 'cf2' } as any, 2, { maxRetries: 0 })

    const before = await queue.getPendingTasks()
    expect(before).toHaveLength(4)

    const result = await queue.purgePendingTasksByUserAndTypes(1, ['click-farm', 'url-swap'])
    expect(result.removedCount).toBe(2)

    const after = await queue.getPendingTasks()
    expect(after).toHaveLength(2)
    expect(after.some((t) => t.userId === 1 && (t.type === 'click-farm' || t.type === 'url-swap'))).toBe(false)
  })
})

