import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * POST /api/campaigns/:id/pause-offer-tasks
 * 一键暂停关联 Offer 的补点击和换链接任务
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户 ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = await getDatabase()
    const numericUserId = parseInt(userId, 10)
    const campaignId = parseInt(id, 10)

    // 1. 获取广告系列信息（验证权限并获取 offer_id）
    const campaign = await db.queryOne<any>(`
      SELECT id, offer_id, user_id FROM campaigns
      WHERE id = ? AND user_id = ?
    `, [campaignId, numericUserId])

    if (!campaign) {
      return NextResponse.json(
        { error: '广告系列不存在或无权访问' },
        { status: 404 }
      )
    }

    const offerId = campaign.offer_id
    if (!offerId) {
      return NextResponse.json(
        { error: '该广告系列未关联 Offer' },
        { status: 400 }
      )
    }

    // 2. 暂停补点击任务
    let clickFarmTaskPaused = false
    const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'
    const clickFarmTask = await db.queryOne<any>(`
      SELECT id, status FROM click_farm_tasks
      WHERE offer_id = ? AND user_id = ? AND is_deleted = ${isDeletedFalse}
      ORDER BY created_at DESC
      LIMIT 1
    `, [offerId, numericUserId])

    if (clickFarmTask && ['pending', 'running', 'paused'].includes(clickFarmTask.status)) {
      const isDeletedCondition = db.type === 'postgres' ? 'NOW()' : 'datetime("now")'
      await db.exec(`
        UPDATE click_farm_tasks
        SET status = 'stopped', pause_reason = 'manual', pause_message = '用户通过广告系列页面手动暂停', paused_at = ${isDeletedCondition}
        WHERE id = ? AND user_id = ?
      `, [clickFarmTask.id, numericUserId])
      clickFarmTaskPaused = true
      console.log(`[campaigns] 已暂停补点击任务 (offerId=${offerId}, taskId=${clickFarmTask.id})`)
    }

    // 3. 禁用换链接任务
    let urlSwapTaskDisabled = false
    const urlSwapTask = await db.queryOne<any>(`
      SELECT id, status FROM url_swap_tasks
      WHERE offer_id = ? AND user_id = ? AND is_deleted = ${isDeletedFalse}
      ORDER BY created_at DESC
      LIMIT 1
    `, [offerId, numericUserId])

    if (urlSwapTask && urlSwapTask.status !== 'disabled') {
      const isDeletedCondition = db.type === 'postgres' ? 'NOW()' : 'datetime("now")'
      await db.exec(`
        UPDATE url_swap_tasks
        SET status = 'disabled', disabled_at = ${isDeletedCondition}
        WHERE id = ? AND user_id = ?
      `, [urlSwapTask.id, numericUserId])
      urlSwapTaskDisabled = true
      console.log(`[campaigns] 已禁用换链接任务 (offerId=${offerId}, taskId=${urlSwapTask.id})`)
    }

    // 4. 返回结果
    const result = {
      success: true,
      message: '任务暂停完成',
      details: {
        clickFarmTask: clickFarmTaskPaused ? '已暂停' : '无活跃任务',
        urlSwapTask: urlSwapTaskDisabled ? '已禁用' : '无活跃任务',
      },
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('暂停关联 Offer 任务失败:', error)
    return NextResponse.json(
      { error: error.message || '暂停任务失败' },
      { status: 500 }
    )
  }
}
