// POST /api/url-swap/tasks/[id]/sync-sitelink-targets - 手动同步 Sitelink 子目标映射

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import {
  getUrlSwapTaskById,
  getUrlSwapSitelinkTargets,
  syncStoreSitelinkTargetsForOffer,
  reconcileUrlSwapSitelinkAffiliateLinks,
} from '@/lib/url-swap'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getUrlSwapTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  const syncResult = await syncStoreSitelinkTargetsForOffer(task.offer_id, user.userId, {
    force: true,
  })
  let sitelink_targets = await getUrlSwapSitelinkTargets(id, user.userId)

  if (sitelink_targets.length > 0) {
    const reconciled = await reconcileUrlSwapSitelinkAffiliateLinks({
      taskId: id,
      offerId: task.offer_id,
      userId: user.userId,
    })
    sitelink_targets = reconciled.targets
  }

  return NextResponse.json({
    success: sitelink_targets.length > 0 || syncResult.upserted > 0,
    data: {
      sitelink_targets,
      sitelink_sync: syncResult,
    },
    sitelink_targets,
    sitelink_sync: syncResult,
    message:
      sitelink_targets.length > 0
        ? `已同步 ${sitelink_targets.length} 条 Sitelink 映射`
        : syncResult.errors[0] || '未能同步 Sitelink 映射，请确认远端 Campaign 已有 Sitelink',
  })
})
