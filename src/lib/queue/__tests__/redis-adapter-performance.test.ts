import { describe, expect, it, vi } from 'vitest'

import { RedisQueueAdapter } from '@/lib/queue/redis-adapter'

describe('RedisQueueAdapter performance-critical methods', () => {
  it('getStats uses HSCAN to avoid per-task HGET', async () => {
    const adapter = new RedisQueueAdapter('redis://example.invalid')

    const hscan = vi.fn().mockResolvedValue([
      '0',
      [
        '1', JSON.stringify({ id: '1', type: 'ad-creative', status: 'pending', userId: 1 }),
        '2', JSON.stringify({ id: '2', type: 'ad-creative', status: 'running', userId: 1 }),
        '3', JSON.stringify({ id: '3', type: 'ad-creative', status: 'completed', userId: 2 }),
        '4', 'not-json',
        '5', JSON.stringify({ id: '4', type: 'ad-creative', status: 'failed', userId: 0 }),
      ],
    ])

    ;(adapter as any).client = {
      hscan,
    }

    const stats = await adapter.getStats()

    expect(hscan).toHaveBeenCalledTimes(1)
    expect(hscan).toHaveBeenCalledWith('queue:tasks', '0', 'COUNT', '1000')

    expect(stats.total).toBe(3)
    expect(stats.pending).toBe(1)
    expect(stats.running).toBe(1)
    expect(stats.completed).toBe(1)
    expect(stats.failed).toBe(0)

    expect(stats.byType['ad-creative']).toBe(3)
    expect(stats.byTypeRunning['ad-creative']).toBe(1)
    expect(stats.byUser[1]).toMatchObject({ pending: 1, running: 1, completed: 0, failed: 0 })
    expect(stats.byUser[2]).toMatchObject({ pending: 0, running: 0, completed: 1, failed: 0 })
  })

  it('getRunningTasks uses HMGET for batch fetch', async () => {
    const adapter = new RedisQueueAdapter('redis://example.invalid')

    const smembers = vi.fn().mockResolvedValue(['1', '2'])
    const hmget = vi.fn().mockResolvedValue([
      JSON.stringify({ id: '1', type: 'ad-creative', status: 'running', userId: 1 }),
      JSON.stringify({ id: '2', type: 'ad-creative', status: 'running', userId: 2 }),
    ])

    ;(adapter as any).client = {
      smembers,
      hmget,
    }

    const tasks = await adapter.getRunningTasks()

    expect(smembers).toHaveBeenCalledTimes(1)
    expect(smembers).toHaveBeenCalledWith('queue:running')
    expect(hmget).toHaveBeenCalledTimes(1)
    expect(hmget).toHaveBeenCalledWith('queue:tasks', '1', '2')
    expect(tasks).toHaveLength(2)
  })
})
