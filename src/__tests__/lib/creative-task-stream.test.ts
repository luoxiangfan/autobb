import { describe, expect, it } from 'vitest'
import {
  buildCreativeTaskStreamEvents,
  resolveCreativeTaskStreamGenerationMode,
  shouldPushCreativeTaskUpdate,
} from '@/lib/creatives/server'

const baseTask = {
  id: 'task-1',
  user_id: 1,
  status: 'running' as const,
  stage: 'generating',
  progress: 42,
  message: '生成中',
  current_attempt: 1,
  max_retries: 1,
  generation_mode: 'balanced',
  result: null,
  error: null,
  updated_at: '2026-03-20T10:00:00.000Z',
}

describe('creative-task-stream', () => {
  it('shouldPushCreativeTaskUpdate only when updated_at changes', () => {
    expect(shouldPushCreativeTaskUpdate(baseTask, null)).toBe(true)
    expect(shouldPushCreativeTaskUpdate(baseTask, baseTask.updated_at)).toBe(false)
  })

  it('buildCreativeTaskStreamEvents includes generationMode on progress', () => {
    const events = buildCreativeTaskStreamEvents(baseTask)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'progress',
      generationMode: 'balanced',
      details: { generationMode: 'balanced', maxRetries: 1 },
    })
  })

  it('buildCreativeTaskStreamEvents includes generationMode on result', () => {
    const events = buildCreativeTaskStreamEvents({
      ...baseTask,
      status: 'completed',
      result: JSON.stringify({ adStrength: { rating: 'GOOD', score: 80 } }),
    })
    expect(events[0]).toMatchObject({
      type: 'result',
      generationMode: 'balanced',
    })
  })

  it('resolveCreativeTaskStreamGenerationMode falls back to result payload', () => {
    const mode = resolveCreativeTaskStreamGenerationMode(
      { ...baseTask, generation_mode: null },
      { generationMode: 'fast' }
    )
    expect(mode).toBe('fast')
  })
})
