/**
 * POST /api/offers/extract/stream
 *
 * 合并API：创建Offer提取任务并订阅SSE进度流
 *
 * 流程：
 * 1. 创建offer_tasks记录
 * 2. 将任务加入UnifiedQueueManager
 * 3. 建立SSE流，轮询任务进度并实时推送
 *
 * 请求体：
 * - affiliate_link: 推广链接
 * - target_country: 目标国家
 * - commission_type + commission_value (+ commission_currency): 结构化佣金（推荐）
 * - commission_payout: 佣金（兼容旧字段）
 *
 * SSE消息格式：
 * - { type: 'progress', data: { stage, status, message, timestamp, duration, details } }
 * - { type: 'complete', data: { success, finalUrl, brand, ... } }
 * - { type: 'error', data: { message, stage, details } }
 */

import { verifyAuth } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'
import { createOfferExtractionTaskForNewOffer } from '@/lib/offers'
import { parseJsonField } from '@/lib/db'
import {
  OfferExtractRequestError,
  offerExtractApiErrorBody,
  parseNewOfferExtractRequest,
} from '@/lib/offers'

export const dynamic = 'force-dynamic'
export const maxDuration = 900 // 15分钟（店铺深度抓取+竞品分析可能需要10-15分钟）

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

export async function POST(req: NextRequest) {
  const db = getDatabase()
  const parentRequestId = req.headers.get('x-request-id') || undefined

  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(req)
    if (!authResult.authenticated || !authResult.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', message: '请先登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const userIdNum = authResult.user.userId

    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid request', message: '请求体必须是有效的 JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    let parsed
    try {
      parsed = parseNewOfferExtractRequest(rawBody)
    } catch (error: unknown) {
      if (error instanceof OfferExtractRequestError) {
        return new Response(JSON.stringify({ error: 'Invalid request', message: error.message }), {
          status: error.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw error
    }

    const taskId = await createOfferExtractionTaskForNewOffer({
      userId: userIdNum,
      affiliateLink: parsed.affiliateLink,
      targetCountry: parsed.targetCountry,
      productPrice: parsed.productPrice,
      commissionPayout: parsed.commissionPayout,
      commissionType: parsed.commissionType,
      commissionValue: parsed.commissionValue,
      commissionCurrency: parsed.commissionCurrency,
      brandName: parsed.brandName,
      pageType: parsed.pageType,
      storeProductLinks: parsed.storeProductLinks,
      skipCache: parsed.skipCache,
      skipWarmup: parsed.skipWarmup,
      extractionMode: parsed.extractionMode,
      parentRequestId,
      priority: 'normal',
      maxRetries: 2,
    })

    console.log(`🚀 Enqueued offer-extraction task: ${taskId}`)

    // 5. 创建SSE流
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
            // 优化3: 只查询必要字段,减少数据传输量
            const rows = await db.query<OfferTask>(
              'SELECT status, stage, progress, message, result, error, updated_at FROM offer_tasks WHERE id = ?',
              [taskId]
            )

            if (!rows || rows.length === 0) {
              sendSSE({
                type: 'error',
                data: {
                  message: 'Task not found',
                  stage: 'error',
                  details: {},
                },
              })
              clearInterval(pollInterval)
              controller.close()
              isClosed = true
              return
            }

            const task = rows[0]

            // 优化1: 智能轮询 - 任务完成/失败时立即停止轮询
            if (task.status === 'completed' || task.status === 'failed') {
              console.log(`🛑 任务${task.status}, 停止轮询: ${taskId}`)

              if (task.status === 'completed') {
                const result = parseJsonField<Record<string, any>>(task.result, {})
                sendSSE({
                  type: 'complete',
                  data: result,
                })
              } else {
                const parsedError = parseJsonField<any>(task.error, null)
                const error =
                  parsedError && typeof parsedError === 'object'
                    ? parsedError
                    : { message: task.message || '任务失败' }
                sendSSE({
                  type: 'error',
                  data: {
                    message: error.message || '任务失败',
                    stage: 'error',
                    details: error,
                  },
                })
              }

              clearInterval(pollInterval)
              controller.close()
              isClosed = true
              return
            }

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
                  details: {},
                },
              })
            }
          } catch (error: any) {
            console.error('SSE polling error:', error)
            sendSSE({
              type: 'error',
              data: {
                message: error.message,
                stage: 'error',
                details: { stack: error.stack },
              },
            })
            clearInterval(pollInterval)
            controller.close()
            isClosed = true
          }
        }, 2000) // 每2秒轮询一次 (降低数据库查询压力)

        // 清理逻辑：客户端断开连接时
        req.signal.addEventListener('abort', () => {
          console.log(`🔌 Client disconnected from SSE: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            controller.close()
            isClosed = true
          }
        })

        // 超时保护：15分钟后自动关闭（店铺深度抓取+竞品分析可能需要10-15分钟）
        setTimeout(() => {
          console.log(`⏱️ SSE timeout for task: ${taskId}`)
          clearInterval(pollInterval)
          if (!isClosed) {
            sendSSE({
              type: 'error',
              data: {
                message: 'SSE timeout - task may still be running',
                stage: 'error',
                details: {},
              },
            })
            controller.close()
            isClosed = true
          }
        }, 900000) // 15分钟 = 900000ms
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
    console.error('SSE initialization error:', error)

    const apiError = offerExtractApiErrorBody(error, 'Invalid request')
    if (apiError) {
      return new Response(JSON.stringify({ error: apiError.error, message: apiError.message }), {
        status: apiError.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const message = error instanceof Error ? error.message : '创建提取任务失败'
    if (message.includes('队列已满')) {
      return new Response(JSON.stringify({ error: '系统繁忙', message: '系统繁忙，请稍后重试' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Internal server error', message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
