import { describe, expect, it, vi } from 'vitest'
import { registerAllExecutors } from '../index'

describe('registerAllExecutors', () => {
  it('always registers openclaw-command executor even when split mode skips background executors in web process', () => {
    const prevSplit = process.env.QUEUE_SPLIT_BACKGROUND
    const prevWorker = process.env.QUEUE_BACKGROUND_WORKER
    const prevOverride = process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB

    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.QUEUE_BACKGROUND_WORKER = 'false'
    process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB = 'false'

    const registerExecutor = vi.fn()
    const queue = { registerExecutor } as any

    registerAllExecutors(queue)

    expect(registerExecutor).toHaveBeenCalledWith('openclaw-command', expect.any(Function))
    expect(registerExecutor).not.toHaveBeenCalledWith('click-farm', expect.anything())
    expect(registerExecutor).not.toHaveBeenCalledWith('url-swap', expect.anything())

    process.env.QUEUE_SPLIT_BACKGROUND = prevSplit
    process.env.QUEUE_BACKGROUND_WORKER = prevWorker
    process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB = prevOverride
  })
})
