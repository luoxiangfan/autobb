import { NextRequest, NextResponse } from 'next/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'
import { scheduleProductScoreCalculation } from '@/lib/queue/schedulers/product-score-scheduler'
import { isProductScoreCalculationPausedError } from '@/lib/product-score-control'

/**
 * POST /api/products/calculate-scores
 * 批量计算商品推荐指数(通过队列系统异步执行)
 */
export async function POST(request: NextRequest) {
  try {
    const userIdRaw = request.headers.get('x-user-id')
    if (!userIdRaw) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const userId = Number(userIdRaw)
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    // 解析请求参数
    const body = await request.json()
    const {
      productIds,
      forceRecalculate = false,
      allowWhenPaused = false,
      batchSize = 100,
      includeSeasonalityAnalysis = true
    } = body

    if (allowWhenPaused === true) {
      const hasSelectedProductIds = Array.isArray(productIds) && productIds.length > 0
      if (!hasSelectedProductIds) {
        return NextResponse.json(
          { error: '全局暂停时仅支持选择指定商品计算', code: 'PAUSED_REQUIRES_SELECTED_PRODUCTS' },
          { status: 400 }
        )
      }
    }

    // 调度任务到队列系统
    const taskId = await scheduleProductScoreCalculation(userId, {
      productIds,
      forceRecalculate,
      allowWhenPaused,
      batchSize,
      includeSeasonalityAnalysis,
      trigger: 'manual',
      priority: 'normal'
    })

    return NextResponse.json({
      success: true,
      message: '推荐指数计算任务已提交到队列',
      taskId,
      note: '任务将在后台异步执行,请在队列管理页面(/admin/queue)查看进度'
    })
  } catch (error: any) {
    if (isProductScoreCalculationPausedError(error)) {
      return NextResponse.json(
        {
          error: error.message || '推荐指数计算已暂停',
          code: 'PRODUCT_SCORE_CALCULATION_PAUSED',
        },
        { status: 409 }
      )
    }

    console.error('提交推荐指数计算任务失败:', error)
    return NextResponse.json(
      {
        error: '提交推荐指数计算任务失败',
        details: error.message
      },
      { status: 500 }
    )
  }
}
