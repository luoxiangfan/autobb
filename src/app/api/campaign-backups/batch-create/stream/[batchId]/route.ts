import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/campaign-backups/batch-create/stream/[batchId]
 * 订阅批量创建任务进度（SSE 流）
 * 
 * 响应格式：
 * data: {"type":"progress","status":"running","completed":5,"failed":1,"total":20,"progress":30}
 * data: {"type":"complete","status":"completed","completed":20,"failed":0,"total":20}
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { batchId } = params

    const db = await getDatabase()

    // 验证任务存在且属于当前用户
    const task = await db.queryOne(`
      SELECT * FROM batch_tasks
      WHERE id = ? AND user_id = ?
    `, [batchId, userId]) as any

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // 创建 SSE 流
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        // 发送初始状态
        const progress = task.total_count
          ? Math.round(((task.completed_count || 0) + (task.failed_count || 0)) / task.total_count * 100)
          : 0

        sendEvent({
          type: 'progress',
          status: task.status,
          completed: task.completed_count || 0,
          failed: task.failed_count || 0,
          total: task.total_count,
          progress,
        })

        // 如果已完成，直接结束
        if (['completed', 'failed', 'partial'].includes(task.status)) {
          sendEvent({
            type: 'complete',
            status: task.status,
            completed: task.completed_count || 0,
            failed: task.failed_count || 0,
            total: task.total_count,
            metadata: task.metadata ? JSON.parse(task.metadata) : null,
          })
          controller.close()
          return
        }

        // 轮询数据库更新
        const pollInterval = setInterval(async () => {
          try {
            const updated = await db.queryOne(`
              SELECT status, completed_count, failed_count, total_count, metadata
              FROM batch_tasks
              WHERE id = ?
            `, [batchId]) as any

            if (!updated) {
              clearInterval(pollInterval)
              sendEvent({ type: 'error', error: { message: '任务不存在' } })
              controller.close()
              return
            }

            const currentProgress = updated.total_count
              ? Math.round(((updated.completed_count || 0) + (updated.failed_count || 0)) / updated.total_count * 100)
              : 0

            sendEvent({
              type: 'progress',
              status: updated.status,
              completed: updated.completed_count || 0,
              failed: updated.failed_count || 0,
              total: updated.total_count,
              progress: currentProgress,
            })

            // 检查是否完成
            if (['completed', 'failed', 'partial'].includes(updated.status)) {
              clearInterval(pollInterval)
              sendEvent({
                type: 'complete',
                status: updated.status,
                completed: updated.completed_count || 0,
                failed: updated.failed_count || 0,
                total: updated.total_count,
                metadata: updated.metadata ? JSON.parse(updated.metadata) : null,
              })
              controller.close()
            }
          } catch (error) {
            console.error('SSE poll error:', error)
          }
        }, 2000) // 每 2 秒轮询一次

        // 超时保护（10 分钟）
        setTimeout(() => {
          clearInterval(pollInterval)
          sendEvent({ 
            type: 'error', 
            error: { message: '任务超时，请刷新页面查看最新状态' } 
          })
          controller.close()
        }, 600000)
      },
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
      },
    })
  } catch (error: any) {
    console.error('SSE 流错误:', error)
    return NextResponse.json(
      { error: error.message || 'SSE 流失败' },
      { status: 500 }
    )
  }
}
