/**
 * GET /api/creative-tasks/[taskId]/stream
 *
 * SSE订阅 - 实时推送创意生成任务进度
 */

import { verifyAuth } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'
import {
  buildCreativeTaskStreamEvents,
  isCreativeTaskStreamTerminal,
  shouldPushCreativeTaskUpdate,
  type CreativeTaskStreamRow,
} from '@/lib/creative-task-stream'
import {
  normalizeCreativeTaskError,
  toCreativeTaskErrorResponseFields,
} from '@/lib/creative-task-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 1200 // 20分钟

export async function GET(req: NextRequest, props: { params: Promise<{ taskId: string }> }) {
  const params = await props.params
  const db = getDatabase()
  const { taskId } = params

  const authResult = await verifyAuth(req)
  if (!authResult.authenticated || !authResult.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized', message: '请先登录' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const userIdNum = authResult.user.userId

  try {
    const taskRows = await db.query<CreativeTaskStreamRow>(
      'SELECT * FROM creative_tasks WHERE id = ? AND user_id = ?',
      [taskId, userIdNum]
    )

    if (!taskRows || taskRows.length === 0) {
      return new Response('Task not found', { status: 404 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let lastUpdatedAt: string | null = null
        let isClosed = false
        let pollInFlight = false

        const sendSSE = (data: Record<string, unknown>) => {
          if (isClosed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch (error) {
            console.warn('SSE send failed:', error)
            isClosed = true
          }
        }

        const closeStream = (pollInterval: ReturnType<typeof setInterval>) => {
          clearInterval(pollInterval)
          if (!isClosed) {
            controller.close()
            isClosed = true
          }
        }

        const pollTask = async (pollInterval: ReturnType<typeof setInterval>) => {
          if (pollInFlight || isClosed) return
          pollInFlight = true
          try {
            const rows = await db.query<CreativeTaskStreamRow>(
              'SELECT * FROM creative_tasks WHERE id = ? AND user_id = ?',
              [taskId, userIdNum]
            )

            if (!rows || rows.length === 0) {
              const taskNotFoundError = normalizeCreativeTaskError({
                code: 'CREATIVE_TASK_NOT_FOUND',
                category: 'validation',
                message: 'Task not found',
                userMessage: '任务不存在或已过期',
                retryable: false,
              })
              sendSSE({
                type: 'error',
                error: taskNotFoundError.userMessage,
                message: taskNotFoundError.userMessage,
                details: taskNotFoundError.details || {},
                ...toCreativeTaskErrorResponseFields(taskNotFoundError),
              })
              closeStream(pollInterval)
              return
            }

            const task = rows[0]
            if (!shouldPushCreativeTaskUpdate(task, lastUpdatedAt)) {
              return
            }

            lastUpdatedAt = task.updated_at
            for (const event of buildCreativeTaskStreamEvents(task)) {
              sendSSE(event)
            }

            if (isCreativeTaskStreamTerminal(task)) {
              closeStream(pollInterval)
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'SSE polling error'
            console.error('SSE polling error:', error)
            const normalizedError = normalizeCreativeTaskError({
              code: 'CREATIVE_TASK_STREAM_POLLING_ERROR',
              category: 'system',
              message,
              userMessage: '实时进度读取失败，请刷新后重试。',
              retryable: true,
              details: { stack: error instanceof Error ? error.stack : null },
            })
            sendSSE({
              type: 'error',
              error: normalizedError.userMessage,
              message: normalizedError.userMessage,
              details: normalizedError.details || {},
              ...toCreativeTaskErrorResponseFields(normalizedError),
            })
            closeStream(pollInterval)
          } finally {
            pollInFlight = false
          }
        }

        const pollInterval = setInterval(() => {
          void pollTask(pollInterval)
        }, 1000)

        await pollTask(pollInterval)

        req.signal.addEventListener('abort', () => {
          console.log(`🔌 Client disconnected from SSE: ${taskId}`)
          closeStream(pollInterval)
        })

        setTimeout(
          () => {
            console.log(`⏱️ SSE timeout for task: ${taskId}`)
            if (!isClosed) {
              const timeoutError = normalizeCreativeTaskError({
                code: 'CREATIVE_TASK_STREAM_TIMEOUT',
                category: 'network',
                message: 'SSE timeout',
                userMessage: '实时连接超时，任务可能仍在后台运行。请刷新查看最新状态。',
                retryable: true,
              })
              sendSSE({
                type: 'error',
                error: timeoutError.userMessage,
                message: timeoutError.userMessage,
                details: timeoutError.details || {},
                ...toCreativeTaskErrorResponseFields(timeoutError),
              })
              closeStream(pollInterval)
            }
          },
          20 * 60 * 1000
        )
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'SSE initialization error'
    console.error('SSE initialization error:', error)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
