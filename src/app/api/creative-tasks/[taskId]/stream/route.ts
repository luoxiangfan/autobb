/**
 * GET /api/creative-tasks/[taskId]/stream
 *
 * SSE订阅 - 实时推送创意生成任务进度
 */

import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'
import { normalizeCreativeTaskError, toCreativeTaskErrorResponseFields } from '@/lib/creative-task-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 1200  // 20分钟

interface CreativeTask {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  current_attempt: number
  max_retries: number | null
  result: unknown
  error: unknown
  updated_at: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const db = getDatabase()
  const { taskId } = params

  // 验证用户身份
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }
  const userIdNum = parseInt(userId, 10)

  try {
    // 验证任务存在且属于当前用户
    const taskRows = await db.query<CreativeTask>(
      'SELECT * FROM creative_tasks WHERE id = ? AND user_id = ?',
      [taskId, userIdNum]
    )

    if (!taskRows || taskRows.length === 0) {
      return new Response('Task not found', { status: 404 })
    }

    // 创建SSE流
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let lastUpdatedAt: string | null = null
        let isClosed = false

        const sendSSE = (data: any) => {
          if (isClosed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch (error) {
            console.warn('SSE send failed:', error)
            isClosed = true
          }
        }

        // 轮询数据库获取进度
        const pollInterval = setInterval(async () => {
          try {
            const rows = await db.query<CreativeTask>(
              'SELECT * FROM creative_tasks WHERE id = ?',
              [taskId]
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
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
              return
            }

            const task = rows[0]

            // 只在updated_at变化时才推送
            if (task.updated_at === lastUpdatedAt) {
              return
            }

            lastUpdatedAt = task.updated_at

            // 推送进度更新
            if (task.status === 'running' || task.status === 'pending') {
              const stage = (task.stage as any) || 'init'
              const status = task.status === 'pending' ? 'pending' : 'in_progress'

              sendSSE({
                type: 'progress',
                step: stage,
                progress: task.progress,
                message: task.message || '处理中...',
                details: {
                  attempt: task.current_attempt,
                  maxRetries: task.max_retries ?? undefined
                }
              })
            }

            // 任务完成
            if (task.status === 'completed') {
              const result = parseJsonField<Record<string, any>>(task.result, {})
              sendSSE({
                type: 'result',
                ...result
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
            }

            // 任务失败
            if (task.status === 'failed') {
              const parsedError = parseJsonField<any>(task.error, task.error)
              const normalizedError = normalizeCreativeTaskError(
                parsedError ?? task.error ?? task.message ?? '任务失败',
                task.message || '任务失败'
              )
              sendSSE({
                type: 'error',
                error: normalizedError.userMessage,
                message: normalizedError.userMessage,
                details: normalizedError.details || {},
                ...toCreativeTaskErrorResponseFields(normalizedError),
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
            }
          } catch (error: any) {
            console.error('SSE polling error:', error)
            const normalizedError = normalizeCreativeTaskError({
              code: 'CREATIVE_TASK_STREAM_POLLING_ERROR',
              category: 'system',
              message: error?.message || 'SSE polling error',
              userMessage: '实时进度读取失败，请刷新后重试。',
              retryable: true,
              details: { stack: error?.stack || null },
            })
            sendSSE({
              type: 'error',
              error: normalizedError.userMessage,
              message: normalizedError.userMessage,
              details: normalizedError.details || {},
              ...toCreativeTaskErrorResponseFields(normalizedError),
            })
            clearInterval(pollInterval)
            controller.close()
            isClosed = true
          }
        }, 1000) // 每1秒轮询一次

        // 清理逻辑：客户端断开连接时
        req.signal.addEventListener('abort', () => {
          console.log(`🔌 Client disconnected from SSE: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            controller.close()
            isClosed = true
          }
        })

        // 超时保护：20分钟后自动关闭
        setTimeout(() => {
          console.log(`⏱️ SSE timeout for task: ${taskId}`)
          clearInterval(pollInterval)
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
            controller.close()
            isClosed = true
          }
        }, 20 * 60 * 1000)
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error: any) {
    console.error('SSE initialization error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
