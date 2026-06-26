import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { pauseOfferTasks } from '@/lib/campaign/server'

/**
 * POST /api/campaigns/:id/pause-offer-tasks
 * 一键暂停关联 Offer 的补点击和换链接任务
 */
export const POST = withAuth(async (_request: NextRequest, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 })
    }
    const userId = user.userId

    const db = await getDatabase()
    const numericUserId = userId
    const campaignId = Number(id)

    if (!Number.isFinite(numericUserId)) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: '无效的 campaign id' }, { status: 400 })
    }

    // 1. 获取广告系列信息（验证权限并获取 offer_id）
    const campaign = await db.queryOne<any>(
      `
      SELECT id, offer_id, user_id, status, is_deleted FROM campaigns
      WHERE id = ? AND user_id = ?
    `,
      [campaignId, numericUserId]
    )

    if (!campaign) {
      return NextResponse.json({ error: '广告系列不存在或无权访问' }, { status: 404 })
    }

    const isDeleted = campaign.is_deleted === true
    if (isDeleted || String(campaign.status || '').toUpperCase() === 'REMOVED') {
      return NextResponse.json(
        { error: '该广告系列已删除/移除，无法执行关联任务暂停' },
        { status: 400 }
      )
    }

    const offerId = campaign.offer_id
    if (!offerId) {
      return NextResponse.json({ error: '该广告系列未关联 Offer' }, { status: 400 })
    }

    // 2. 复用统一逻辑批量暂停/禁用关联任务
    const paused = await pauseOfferTasks(
      offerId,
      numericUserId,
      'manual',
      '用户通过广告系列页面手动暂停'
    )

    // 4. 返回结果
    const result = {
      success: true,
      message: '任务暂停完成',
      details: {
        clickFarmTask: paused.clickFarmTaskPaused ? '已暂停' : '无活跃任务',
        clickFarmTaskCount: paused.clickFarmTaskCount,
        urlSwapTask: paused.urlSwapTaskDisabled ? '已禁用' : '无活跃任务',
        urlSwapTaskCount: paused.urlSwapTaskCount,
      },
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('暂停关联 Offer 任务失败:', error)
    return NextResponse.json({ error: error.message || '暂停任务失败' }, { status: 500 })
  }
})
