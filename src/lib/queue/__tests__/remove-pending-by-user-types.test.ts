import { describe, expect, it, vi } from 'vitest'

import { RedisQueueAdapter } from '@/lib/queue/redis-adapter'

describe('RedisQueueAdapter.removePendingTasksByUserAndTypes', () => {
  it('removes only matching types from a user pending index using a pipeline', async () => {
    const adapter = new RedisQueueAdapter('redis://example.invalid')

    const zrange = vi.fn().mockResolvedValue(['t1', 't2', 't3'])
    const hmget = vi.fn().mockResolvedValue([
      JSON.stringify({ id: 't1', type: 'click-farm', status: 'pending', userId: 42 }),
      JSON.stringify({ id: 't2', type: 'url-swap', status: 'pending', userId: 42 }),
      JSON.stringify({ id: 't3', type: 'sync', status: 'pending', userId: 42 }),
    ])

    const pipeline = {
      hdel: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }
    const pipelineFactory = vi.fn().mockReturnValue(pipeline)

    ;(adapter as any).client = {
      zrange,
      hmget,
      pipeline: pipelineFactory,
    }

    const result = await adapter.removePendingTasksByUserAndTypes(42, ['click-farm', 'url-swap'])

    expect(zrange).toHaveBeenCalledWith('queue:user:42:pending', 0, -1)
    expect(hmget).toHaveBeenCalledWith('queue:tasks', 't1', 't2', 't3')
    expect(pipelineFactory).toHaveBeenCalledTimes(1)

    expect(pipeline.hdel).toHaveBeenCalledWith('queue:tasks', 't1')
    expect(pipeline.hdel).toHaveBeenCalledWith('queue:tasks', 't2')
    expect(pipeline.hdel).not.toHaveBeenCalledWith('queue:tasks', 't3')

    expect(pipeline.zrem).toHaveBeenCalledWith('queue:pending:all', 't1')
    expect(pipeline.zrem).toHaveBeenCalledWith('queue:pending:click-farm', 't1')
    expect(pipeline.zrem).toHaveBeenCalledWith('queue:user:42:pending', 't1')
    expect(pipeline.zrem).toHaveBeenCalledWith('queue:pending:url-swap', 't2')

    expect(pipeline.exec).toHaveBeenCalledTimes(1)
    expect(result.removedCount).toBe(2)
    expect(result.removedTaskIds.sort()).toEqual(['t1', 't2'])
  })
})

