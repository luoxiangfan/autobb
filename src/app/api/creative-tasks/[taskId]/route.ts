/**
 * GET /api/creative-tasks/[taskId]
 *
 * 轮询查询 - 获取创意生成任务状态（用于SSE断开后的fallback）
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'
import { normalizeCreativeTaskError, toCreativeTaskErrorResponseFields } from '@/lib/creative-task-error'

interface CreativeTaskRow {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  result: unknown
  error: unknown
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

function parseBooleanQuery(value: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function parseTimeoutMs(value: string | null, fallback = 8000): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1000, Math.min(30000, parsed))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveRecommendedPollIntervalMs(task: CreativeTaskRow): number {
  if (task.status === 'completed' || task.status === 'failed') {
    return 0
  }

  const stage = String(task.stage || '').trim().toLowerCase()
  if (task.status === 'pending') return 3000
  if (stage === 'generating' || stage === 'evaluating') return 2500
  if (stage === 'preparing' || stage === 'saving') return 1500
  return 2000
}

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const db = getDatabase()
  const { taskId } = params

  try {
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    const waitForUpdate = parseBooleanQuery(req.nextUrl.searchParams.get('waitForUpdate'))
    const lastUpdatedAt = req.nextUrl.searchParams.get('lastUpdatedAt')
    const timeoutMs = parseTimeoutMs(req.nextUrl.searchParams.get('timeoutMs'))
    const loadTask = async (): Promise<CreativeTaskRow | null> => {
      const rows = await db.query<CreativeTaskRow>(
        'SELECT * FROM creative_tasks WHERE id = ? AND user_id = ?',
        [taskId, userIdNum]
      )
      if (!rows || rows.length === 0) return null
      return rows[0]
    }

    let task = await loadTask()

    if (!task) {
      return NextResponse.json(
        { error: 'Not found', message: '任务不存在或无权访问' },
        { status: 404 }
      )
    }

    if (waitForUpdate && lastUpdatedAt && task.updated_at === lastUpdatedAt && task.status === 'running') {
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        await sleep(600)
        const latestTask = await loadTask()
        if (!latestTask) break
        task = latestTask
        if (task.updated_at !== lastUpdatedAt || task.status !== 'running') {
          break
        }
      }
    }

    const parsedError = task.error !== null && task.error !== undefined
      ? parseJsonField<any>(task.error, task.error)
      : null
    const normalizedError = task.status === 'failed'
      ? normalizeCreativeTaskError(parsedError ?? task.error ?? task.message ?? '任务失败', task.message || '任务失败')
      : null

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      message: task.message,
      result: parseJsonField(task.result, null),
      error: normalizedError?.userMessage || null,
      errorDetails: normalizedError?.details || null,
      ...(normalizedError ? toCreativeTaskErrorResponseFields(normalizedError) : {
        errorCode: null,
        errorCategory: null,
        errorUserMessage: null,
        errorRetryable: null,
        structuredError: null,
      }),
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      startedAt: task.started_at,
      completedAt: task.completed_at,
      recommendedPollIntervalMs: resolveRecommendedPollIntervalMs(task),
      streamSupported: true,
      streamUrl: `/api/creative-tasks/${task.id}/stream`,
      waitApplied: waitForUpdate && Boolean(lastUpdatedAt),
    })
  } catch (error: any) {
    console.error('Query creative task status failed:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '查询失败'
      },
      { status: 500 }
    )
  }
}
