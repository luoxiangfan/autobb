// POST /api/click-farm/tasks/[id]/restart - 重启任务

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getClickFarmTaskById, restartClickFarmTask } from '@/lib/click-farm'
import {
  ENABLED_CAMPAIGN_REQUIRED_MESSAGE,
  ENABLED_CAMPAIGN_REQUIRED_SUGGESTION,
  hasEnabledCampaignForOffer,
} from '@/lib/campaign/campaign-health-guard'
import { notifyTaskResumed } from '@/lib/click-farm'
import { getDatabase } from '@/lib/db'
import { getAllProxyUrls, getDateInTimezone } from '@/lib/common/server'

export const POST = withAuth(async (_request: NextRequest, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getClickFarmTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  if (!['stopped', 'paused', 'pending'].includes(task.status)) {
    return NextResponse.json(
      { error: 'invalid_status', message: '只能重启 stopped、paused 或 pending 状态的任务' },
      { status: 400 }
    )
  }

  const enabledCampaignExists = await hasEnabledCampaignForOffer({
    userId: user.userId,
    offerId: task.offer_id,
  })
  if (!enabledCampaignExists) {
    return NextResponse.json(
      {
        error: 'campaign_required',
        message: ENABLED_CAMPAIGN_REQUIRED_MESSAGE,
        suggestion: ENABLED_CAMPAIGN_REQUIRED_SUGGESTION,
      },
      { status: 400 }
    )
  }

  if (task.pause_reason === 'no_proxy') {
    const db = await getDatabase()
    const offer = await db.queryOne<any>(
      `
        SELECT target_country FROM offers WHERE id = ?
      `,
      [task.offer_id]
    )

    if (offer) {
      const proxyUrls = await getAllProxyUrls(user.userId)
      const targetCountry = offer.target_country.toUpperCase()
      const proxyConfig = proxyUrls?.find((p) => p.country.toUpperCase() === targetCountry)

      if (!proxyConfig) {
        return NextResponse.json(
          {
            error: 'proxy_required',
            message: `仍未找到 ${offer.target_country} 国家的代理配置`,
            suggestion: '请先配置代理后再重启任务',
            redirectTo: '/settings/proxy',
          },
          { status: 400 }
        )
      }
    }
  }

  if (!task.started_at) {
    console.log(`[Restart] 任务 ${id} 从未开始，重启后将首次执行`)
  } else if (task.scheduled_start_date) {
    const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone)
    if (task.scheduled_start_date < todayInTaskTimezone) {
      console.log(
        `[Restart] 任务 ${id} 的scheduled_start_date(${task.scheduled_start_date})已过期，状态正常`
      )
    }
  }

  const updatedTask = await restartClickFarmTask(id, user.userId)
  await notifyTaskResumed(user.userId, id)

  return NextResponse.json({
    success: true,
    data: updatedTask,
    message: '任务已重启',
  })
})
