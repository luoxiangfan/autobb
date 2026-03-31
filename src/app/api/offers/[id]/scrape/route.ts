import { NextRequest, NextResponse } from 'next/server'
import { findOfferById, updateOfferScrapeStatus } from '@/lib/offers'
import { getQueueManager } from '@/lib/queue'
import { convertPriorityToEnum, type ScrapeTaskData } from '@/lib/queue/executors'

/**
 * POST /api/offers/:id/scrape
 * 触发产品信息抓取和AI分析
 *
 * 🔥 重构：使用统一队列系统
 * - 支持 Redis 持久化
 * - 支持优先级队列
 * - 支持代理IP池（从用户设置加载）
 * - 支持并发控制（全局/用户/类型）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const parentRequestId = request.headers.get('x-request-id') || undefined
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userIdNum = parseInt(userId, 10)
    const offerIdNum = parseInt(id, 10)

    // 查找 offer
    const offer = await findOfferById(offerIdNum, userIdNum)

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 解析请求体获取优先级（可选）
    let priority: number | undefined
    try {
      const body = await request.json()
      priority = body.priority
    } catch {
      // 没有请求体，使用默认优先级
    }

    // 获取队列管理器
    const queue = getQueueManager()

    // 检查是否已有相同任务在队列中
    const stats = await queue.getStats()
    // TODO: 添加任务去重检查

    // 更新状态为队列中
    await updateOfferScrapeStatus(offerIdNum, userIdNum, 'queued')

    // 构建任务数据
    const taskData: ScrapeTaskData = {
      offerId: offerIdNum,
      url: offer.url,
      brand: offer.brand || undefined,
      target_country: offer.target_country || 'US',
      priority
    }

    // 添加任务到队列
    const taskId = await queue.enqueue(
      'scrape',
      taskData,
      userIdNum,
      {
        parentRequestId,
        priority: convertPriorityToEnum(priority),
        maxRetries: 2,  // 抓取任务最多重试2次
        requireProxy: true  // 抓取任务需要代理
      }
    )

    console.log(`📥 [ScrapeAPI] 任务已入队: ${taskId}, Offer #${offerIdNum}, 用户 #${userIdNum}`)

    return NextResponse.json({
      success: true,
      message: '抓取任务已加入队列，请稍后查看结果',
      taskId,
      queuePosition: stats.pending + 1  // 大致的队列位置
    })
  } catch (error: any) {
    console.error('触发抓取失败:', error)

    // 如果是队列已满等错误，返回特定状态码
    if (error.message?.includes('队列已满')) {
      return NextResponse.json(
        { error: '系统繁忙，请稍后重试' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: error.message || '触发抓取失败' },
      { status: 500 }
    )
  }
}
