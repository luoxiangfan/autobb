/**
 * GET /api/offers/extract/status/[taskId]
 *
 * 轮询查询 - 获取Offer提取任务状态
 *
 * 功能：
 * 1. 验证用户身份和任务所有权
 * 2. 返回任务当前状态、进度、结果
 * 3. 支持SSE失败后的fallback
 *
 * 返回格式：
 * {
 *   taskId: string
 *   status: 'pending' | 'running' | 'completed' | 'failed'
 *   stage: string | null
 *   progress: number (0-100)
 *   message: string | null
 *   result: object | null (completed时)
 *   error: object | null (failed时)
 *   createdAt: string
 *   updatedAt: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'

interface OfferTask {
  id: string
  user_id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  affiliate_link: string
  target_country: string
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

function resolveRecommendedPollIntervalMs(task: OfferTask): number {
  if (task.status === 'completed' || task.status === 'failed') {
    return 0
  }

  const stage = String(task.stage || '').trim().toLowerCase()
  if (task.status === 'pending') return 3000
  if (stage === 'ai_analysis') return 4000
  if (stage === 'accessing_page' || stage === 'scraping_products' || stage === 'processing_data') return 2000
  return 2500
}

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const db = getDatabase()
  const { taskId } = params

  try {
    // 验证用户身份
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
    const loadTask = async (): Promise<OfferTask | null> => {
      const rows = await db.query<OfferTask>(
        'SELECT * FROM offer_tasks WHERE id = ? AND user_id = ?',
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

    // 构造响应
    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      message: task.message,
      result: parseJsonField(task.result, null),
      error: parseJsonField(task.error, null),
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      startedAt: task.started_at,
      completedAt: task.completed_at,
      recommendedPollIntervalMs: resolveRecommendedPollIntervalMs(task),
      streamSupported: true,
      streamUrl: `/api/offers/extract/stream/${task.id}`,
      waitApplied: waitForUpdate && Boolean(lastUpdatedAt),
    })

  } catch (error: any) {
    console.error('Query task status failed:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '查询失败'
      },
      { status: 500 }
    )
  }
}
