import { describe, expect, it, vi } from 'vitest'
import { failStaleQueuedCommandRuns, getOpenclawQueuedStaleSeconds } from './queued-timeout'

describe('openclaw queued timeout guard', () => {
  it('uses default stale seconds when env is missing', () => {
    const prev = process.env.OPENCLAW_QUEUED_STALE_SECONDS
    delete process.env.OPENCLAW_QUEUED_STALE_SECONDS
    expect(getOpenclawQueuedStaleSeconds()).toBe(900)
    if (prev === undefined) {
      delete process.env.OPENCLAW_QUEUED_STALE_SECONDS
    } else {
      process.env.OPENCLAW_QUEUED_STALE_SECONDS = prev
    }
  })

  it('fails stale queued runs with user scope', async () => {
    const exec = vi.fn().mockResolvedValue({ changes: 2 })
    const changed = await failStaleQueuedCommandRuns({
      db: {
        type: 'sqlite',
        exec,
      } as any,
      userId: 7,
      staleSeconds: 600,
    })

    expect(changed).toBe(2)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toContain("status = 'queued'")
    expect(exec.mock.calls[0][0]).toContain('AND user_id = ?')
    expect(exec.mock.calls[0][1]).toEqual([
      '队列任务超过 600s 未开始执行，系统已自动标记失败，请重试',
      600,
      7,
    ])
  })

  it('supports global sweep without user scope', async () => {
    const exec = vi.fn().mockResolvedValue({ changes: 1 })
    const changed = await failStaleQueuedCommandRuns({
      db: {
        type: 'postgres',
        exec,
      } as any,
      staleSeconds: 720,
    })

    expect(changed).toBe(1)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).not.toContain('AND user_id = ?')
    expect(exec.mock.calls[0][1]).toEqual([
      '队列任务超过 720s 未开始执行，系统已自动标记失败，请重试',
      720,
    ])
  })
})
