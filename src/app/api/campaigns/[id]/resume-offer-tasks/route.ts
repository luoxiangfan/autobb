import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { resumeOfferTasksOnCampaignEnable } from '@/lib/campaign-offer-tasks'

function formatResumeErrors(
  errors: Array<{ type?: string; error?: string }>
): string {
  return errors
    .map((item) => {
      const type = String(item?.type || '').trim()
      const error = String(item?.error || '').trim()
      if (!error) return ''
      const label =
        type === 'clickFarm' ? '补点击' : type === 'urlSwap' ? '换链接' : '关联任务'
      return `${label}: ${error}`
    })
    .filter(Boolean)
    .join('；')
}

/**
 * POST /api/campaigns/:id/resume-offer-tasks
 * 一键按默认配置恢复/新建关联 Offer 的补点击和换链接任务
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { id } = params

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const db = await getDatabase()
    const campaignId = Number(id)

    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: '无效的 campaign id' }, { status: 400 })
    }

    const campaign = await db.queryOne<{
      id: number
      offer_id: number | null
      status: string | null
      is_deleted: boolean | number | null
    }>(`
      SELECT id, offer_id, user_id, status, is_deleted FROM campaigns
      WHERE id = ? AND user_id = ?
    `, [campaignId, userId])

    if (!campaign) {
      return NextResponse.json(
        { error: '广告系列不存在或无权访问' },
        { status: 404 }
      )
    }

    const isDeleted = campaign.is_deleted === true || campaign.is_deleted === 1
    if (isDeleted || String(campaign.status || '').toUpperCase() === 'REMOVED') {
      return NextResponse.json(
        { error: '该广告系列已删除/移除，无法执行关联任务开启' },
        { status: 400 }
      )
    }

    const offerId = campaign.offer_id
    if (!offerId) {
      return NextResponse.json(
        { error: '该广告系列未关联 Offer' },
        { status: 400 }
      )
    }

    if (String(campaign.status || '').trim().toUpperCase() !== 'ENABLED') {
      return NextResponse.json(
        { error: '广告系列未启用，请先启用广告系列后再开启关联任务' },
        { status: 400 }
      )
    }

    const resumeResult = await resumeOfferTasksOnCampaignEnable(offerId, userId)
    const errorMessage = formatResumeErrors(resumeResult.errors)

    const result = {
      success: resumeResult.errors.length === 0,
      partialSuccess: resumeResult.partialSuccess,
      message: errorMessage ? '任务开启部分完成' : '任务开启完成',
      error: errorMessage || undefined,
      details: {
        clickFarmTasksCreated: resumeResult.clickFarmTasksCreated,
        clickFarmTasksUpdated: resumeResult.clickFarmTasksUpdated,
        urlSwapTasksCreated: resumeResult.urlSwapTasksCreated,
        urlSwapTasksUpdated: resumeResult.urlSwapTasksUpdated,
      },
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('开启关联 Offer 任务失败:', error)
    return NextResponse.json(
      { error: error.message || '开启任务失败' },
      { status: 500 }
    )
  }
}
