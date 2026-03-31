/**
 * GET /api/offers/batch/stream/[batchId]
 *
 * SSE订阅 - 实时推送批量任务进度
 *
 * 功能：
 * 1. 验证用户身份和任务所有权
 * 2. 轮询batch_tasks表获取最新进度
 * 3. 通过SSE推送批量进度更新
 * 4. 可选：推送单个子任务的完成通知
 * 5. 批量任务完成后自动关闭连接
 *
 * SSE消息格式：
 * - data: { type: 'progress', completed: 45, failed: 2, total: 100, progress: 47 }
 * - data: { type: 'item_completed', taskId: 'xxx', offerId: 123 }
 * - data: { type: 'item_failed', taskId: 'xxx', error: '...' }
 * - data: { type: 'complete', status: 'completed' | 'partial', completed: 98, failed: 2 }
 */

import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 批量任务可能需要更长时间

interface BatchTask {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial'
  total_count: number
  completed_count: number
  failed_count: number
  updated_at: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: { batchId: string } }
) {
  const db = getDatabase()
  const { batchId } = params

  // 验证用户身份
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }
  const userIdNum = parseInt(userId, 10)

  try {
    // 验证批量任务存在且属于当前用户
    const batchRows = await db.query<BatchTask>(
      'SELECT * FROM batch_tasks WHERE id = ? AND user_id = ?',
      [batchId, userIdNum]
    )

    if (!batchRows || batchRows.length === 0) {
      return new Response('Batch task not found', { status: 404 })
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

        // 轮询数据库获取批量进度
        const pollInterval = setInterval(async () => {
          try {
            const rows = await db.query<BatchTask>(
              'SELECT * FROM batch_tasks WHERE id = ?',
              [batchId]
            )

            if (!rows || rows.length === 0) {
              sendSSE({ type: 'error', error: 'Batch task not found' })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
              return
            }

            const batch = rows[0]

            // 只在updated_at变化时才推送
            if (batch.updated_at === lastUpdatedAt) {
              return
            }

            lastUpdatedAt = batch.updated_at

            // 计算进度
            const progress = batch.total_count > 0
              ? Math.round(((batch.completed_count + batch.failed_count) / batch.total_count) * 100)
              : 0

            // 推送进度更新
            if (batch.status === 'running' || batch.status === 'pending') {
              sendSSE({
                type: 'progress',
                completed: batch.completed_count,
                failed: batch.failed_count,
                total: batch.total_count,
                progress
              })
            }

            // 批量任务完成
            if (batch.status === 'completed' || batch.status === 'partial' || batch.status === 'failed') {
              sendSSE({
                type: 'complete',
                status: batch.status,
                completed: batch.completed_count,
                failed: batch.failed_count,
                total: batch.total_count
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
            }
          } catch (error: any) {
            console.error('SSE polling error:', error)
            sendSSE({ type: 'error', error: { message: error.message } })
            clearInterval(pollInterval)
            controller.close()
            isClosed = true
          }
        }, 1000) // 每1秒轮询一次（批量任务更新频率较低）

        // 清理逻辑：客户端断开连接时
        req.signal.addEventListener('abort', () => {
          console.log(`🔌 Client disconnected from batch SSE: ${batchId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            controller.close()
            isClosed = true
          }
        })

        // 超时保护：5分钟后自动关闭
        setTimeout(() => {
          console.log(`⏱️ Batch SSE timeout: ${batchId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            sendSSE({ type: 'error', error: { message: 'SSE timeout' } })
            controller.close()
            isClosed = true
          }
        }, 300000)
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
    console.error('Batch SSE initialization error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
