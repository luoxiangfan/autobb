/**
 * GET /api/offers/extract/stream/[taskId]
 *
 * SSE订阅 - 实时推送Offer提取任务进度
 *
 * 功能：
 * 1. 验证用户身份和任务所有权
 * 2. 轮询offer_tasks表获取最新进度
 * 3. 通过SSE推送进度更新
 * 4. 任务完成或失败后自动关闭连接
 *
 * SSE消息格式：
 * - data: { type: 'progress', stage, progress, message }
 * - data: { type: 'complete', result }
 * - data: { type: 'error', error }
 */

import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface OfferTask {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
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
    const taskRows = await db.query<OfferTask>(
      'SELECT * FROM offer_tasks WHERE id = ? AND user_id = ?',
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
            const rows = await db.query<OfferTask>(
              'SELECT * FROM offer_tasks WHERE id = ?',
              [taskId]
            )

            if (!rows || rows.length === 0) {
              sendSSE({
                type: 'error',
                data: {
                  message: 'Task not found',
                  stage: 'error',
                  details: {}
                }
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

            // 推送进度更新 - 修复格式匹配前端期望
            if (task.status === 'running' || task.status === 'pending') {
              // 将stage转换为ProgressStage类型
              const stage = (task.stage as any) || 'resolving_link'
              // 根据status映射为ProgressStatus
              const status = task.status === 'pending' ? 'pending' : 'in_progress'

              sendSSE({
                type: 'progress',
                data: {
                  stage,
                  status,
                  message: task.message || '处理中...',
                  timestamp: Date.now(),
                  details: {}
                }
              })
            }

            // 任务完成
            if (task.status === 'completed') {
              const result = parseJsonField<Record<string, any>>(task.result, {})
              sendSSE({
                type: 'complete',
                data: result
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
            }

            // 任务失败
            if (task.status === 'failed') {
              const parsedError = parseJsonField<any>(task.error, null)
              const error = parsedError && typeof parsedError === 'object'
                ? parsedError
                : { message: task.message || '任务失败' }
              sendSSE({
                type: 'error',
                data: {
                  message: error.message || '任务失败',
                  stage: 'error',
                  details: error
                }
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
            }
          } catch (error: any) {
            console.error('SSE polling error:', error)
            sendSSE({
              type: 'error',
              data: {
                message: error.message,
                stage: 'error',
                details: { stack: error.stack }
              }
            })
            clearInterval(pollInterval)
            controller.close()
            isClosed = true
          }
        }, 500) // 每500ms轮询一次

        // 清理逻辑：客户端断开连接时
        req.signal.addEventListener('abort', () => {
          console.log(`🔌 Client disconnected from SSE: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            controller.close()
            isClosed = true
          }
        })

        // 超时保护：2分钟后自动关闭
        setTimeout(() => {
          console.log(`⏱️ SSE timeout for task: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            sendSSE({
              type: 'error',
              data: {
                message: 'SSE timeout',
                stage: 'error',
                details: {}
              }
            })
            controller.close()
            isClosed = true
          }
        }, 120000)
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
