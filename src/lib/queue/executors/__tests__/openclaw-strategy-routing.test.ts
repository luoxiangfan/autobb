import { describe, expect, it } from 'vitest'
import { getQueueManagerForTaskType, isBackgroundQueueSplitEnabled } from '@/lib/queue/queue-routing'
import { getBackgroundQueueManager, getQueueManager } from '@/lib/queue/unified-queue-manager'

describe('openclaw-strategy queue routing', () => {
  it('routes to background queue when split enabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

    expect(isBackgroundQueueSplitEnabled()).toBe(true)

    const routed = getQueueManagerForTaskType('openclaw-strategy')
    const background = getBackgroundQueueManager()
    expect(routed).toBe(background)
  })

  it('falls back to core queue when split disabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'false'

    const routed = getQueueManagerForTaskType('openclaw-strategy')
    const core = getQueueManager()
    expect(routed).toBe(core)
  })
})

describe('affiliate-product-sync queue routing', () => {
  it('routes to background queue when split enabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

    expect(isBackgroundQueueSplitEnabled()).toBe(true)

    const routed = getQueueManagerForTaskType('affiliate-product-sync')
    const background = getBackgroundQueueManager()
    expect(routed).toBe(background)
  })

  it('falls back to core queue when split disabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'false'

    const routed = getQueueManagerForTaskType('affiliate-product-sync')
    const core = getQueueManager()
    expect(routed).toBe(core)
  })
})

describe('openclaw-command queue routing', () => {
  it('routes to background queue when split enabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

    expect(isBackgroundQueueSplitEnabled()).toBe(true)

    const routed = getQueueManagerForTaskType('openclaw-command')
    const background = getBackgroundQueueManager()
    expect(routed).toBe(background)
  })

  it('falls back to core queue when split disabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'false'

    const routed = getQueueManagerForTaskType('openclaw-command')
    const core = getQueueManager()
    expect(routed).toBe(core)
  })
})

describe('openclaw-affiliate-sync queue routing', () => {
  it('routes to background queue when split enabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

    expect(isBackgroundQueueSplitEnabled()).toBe(true)

    const routed = getQueueManagerForTaskType('openclaw-affiliate-sync')
    const background = getBackgroundQueueManager()
    expect(routed).toBe(background)
  })

  it('falls back to core queue when split disabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'false'

    const routed = getQueueManagerForTaskType('openclaw-affiliate-sync')
    const core = getQueueManager()
    expect(routed).toBe(core)
  })
})

describe('openclaw-report-send queue routing', () => {
  it('routes to background queue when split enabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

    expect(isBackgroundQueueSplitEnabled()).toBe(true)

    const routed = getQueueManagerForTaskType('openclaw-report-send')
    const background = getBackgroundQueueManager()
    expect(routed).toBe(background)
  })

  it('falls back to core queue when split disabled', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'false'

    const routed = getQueueManagerForTaskType('openclaw-report-send')
    const core = getQueueManager()
    expect(routed).toBe(core)
  })
})
