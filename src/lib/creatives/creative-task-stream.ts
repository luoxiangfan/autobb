import { parseJsonField } from '@/lib/db'
import { resolveStoredGenerationMode } from '@/lib/creatives'
import { normalizeCreativeTaskError, toCreativeTaskErrorResponseFields } from '@/lib/creatives'

export interface CreativeTaskStreamRow {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  current_attempt: number
  max_retries: number | null
  generation_mode: string | null
  result: unknown
  error: unknown
  updated_at: string
}

export function shouldPushCreativeTaskUpdate(
  task: CreativeTaskStreamRow,
  lastUpdatedAt: string | null
): boolean {
  return task.updated_at !== lastUpdatedAt
}

export function resolveCreativeTaskStreamGenerationMode(
  task: CreativeTaskStreamRow,
  parsedResult?: Record<string, unknown> | null
): string | undefined {
  const fromTask = resolveStoredGenerationMode(task.generation_mode)
  if (fromTask) return fromTask

  const fromResult = parsedResult?.generationMode ?? parsedResult?.generation_mode
  return resolveStoredGenerationMode(fromResult) ?? undefined
}

export function buildCreativeTaskStreamEvents(
  task: CreativeTaskStreamRow
): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  const generationMode = resolveCreativeTaskStreamGenerationMode(task)

  if (task.status === 'running' || task.status === 'pending') {
    events.push({
      type: 'progress',
      step: task.stage || 'init',
      progress: task.progress,
      message: task.message || '处理中...',
      generationMode,
      details: {
        attempt: task.current_attempt,
        maxRetries: task.max_retries ?? undefined,
        generationMode,
      },
    })
  }

  if (task.status === 'completed') {
    const result = parseJsonField<Record<string, unknown>>(task.result, {})
    const resultGenerationMode = resolveCreativeTaskStreamGenerationMode(task, result)
    events.push({
      type: 'result',
      ...result,
      generationMode: resultGenerationMode ?? generationMode,
    })
  }

  if (task.status === 'failed') {
    const parsedError = parseJsonField<unknown>(task.error, task.error)
    const normalizedError = normalizeCreativeTaskError(
      parsedError ?? task.error ?? task.message ?? '任务失败',
      task.message || '任务失败'
    )
    events.push({
      type: 'error',
      error: normalizedError.userMessage,
      message: normalizedError.userMessage,
      details: normalizedError.details || {},
      generationMode,
      ...toCreativeTaskErrorResponseFields(normalizedError),
    })
  }

  return events
}

export function isCreativeTaskStreamTerminal(task: CreativeTaskStreamRow): boolean {
  return task.status === 'completed' || task.status === 'failed'
}
