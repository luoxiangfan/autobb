import { afterEach, describe, expect, it } from 'vitest'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { getBackgroundQueueManager } from '@/lib/queue/unified-queue-manager'

const ENV_KEYS = [
  'QUEUE_SPLIT_BACKGROUND',
  'QUEUE_BACKGROUND_WORKER',
  'QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB',
  'REDIS_URL',
] as const

const ORIGINAL_ENV: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  QUEUE_SPLIT_BACKGROUND: process.env.QUEUE_SPLIT_BACKGROUND,
  QUEUE_BACKGROUND_WORKER: process.env.QUEUE_BACKGROUND_WORKER,
  QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB: process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB,
  REDIS_URL: process.env.REDIS_URL,
}

function resetQueueSingletons() {
  ;(globalThis as any).__queueManager = undefined
  ;(globalThis as any).__backgroundQueueManager = undefined
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key]
    if (typeof original === 'string') {
      process.env[key] = original
    } else {
      delete process.env[key]
    }
  }
}

describe.sequential('background queue guard', () => {
  afterEach(() => {
    restoreEnv()
    resetQueueSingletons()
  })

  it('forces producer-only mode in non-worker split process', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.QUEUE_BACKGROUND_WORKER = 'false'
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    delete process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB

    const queue = getBackgroundQueueManager({ autoStartOnEnqueue: true })
    expect(queue.getConfig().autoStartOnEnqueue).toBe(false)
  })

  it('keeps default auto-start enabled in background worker process', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.QUEUE_BACKGROUND_WORKER = 'true'
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    delete process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB

    const queue = getBackgroundQueueManager()
    expect(queue.getConfig().autoStartOnEnqueue).toBe(true)
  })

  it('routes background task to producer-only background queue in non-worker split mode', () => {
    process.env.QUEUE_SPLIT_BACKGROUND = 'true'
    process.env.QUEUE_BACKGROUND_WORKER = 'false'
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    delete process.env.QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB

    const routed = getQueueManagerForTaskType('url-swap')
    const background = getBackgroundQueueManager()

    expect(routed).toBe(background)
    expect(routed.getConfig().autoStartOnEnqueue).toBe(false)
  })
})

