// GET /api/url-swap/tasks/[id] - 获取任务详情
// PUT /api/url-swap/tasks/[id] - 更新任务配置
// DELETE /api/url-swap/tasks/[id] - 删除任务

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  getUrlSwapTaskById,
  getUrlSwapTaskStats,
  updateUrlSwapTask,
  getUrlSwapTaskTargets,
  getUrlSwapSitelinkTargets,
} from '@/lib/url-swap'
import {
  findInvalidAffiliateLinks,
  normalizeAffiliateLinksInput,
} from '@/lib/url-swap/url-swap-link-utils'
import type { UpdateUrlSwapTaskRequest } from '@/lib/url-swap/url-swap-types'
import { getDatabase } from '@/lib/db'
import { triggerUrlSwapScheduling } from '@/lib/url-swap/url-swap-scheduler'
import { removePendingUrlSwapQueueTasksByTaskIds } from '@/lib/url-swap/queue-cleanup'
import { hasEnabledCampaignForOffer } from '@/lib/campaign/campaign-health-guard'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  // 管理员健康告警会链接到任意用户的任务，需跳过 user_id 归属校验
  const lookupUserId = user.role === 'admin' ? 0 : user.userId
  const task = await getUrlSwapTaskById(id, lookupUserId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  const stats = await getUrlSwapTaskStats(id, lookupUserId)
  const targets = await getUrlSwapTaskTargets(id, lookupUserId)
  const sitelink_targets = await getUrlSwapSitelinkTargets(id, lookupUserId)
  const taskWithTargets = { ...task, targets, sitelink_targets }
  const has_enabled_campaign = await hasEnabledCampaignForOffer({
    userId: task.user_id,
    offerId: task.offer_id,
  })
  const taskWithCampaign = { ...taskWithTargets, has_enabled_campaign }

  return NextResponse.json({
    success: true,
    data: taskWithCampaign,
    task: taskWithCampaign,
    stats,
    targets,
    sitelink_targets,
  })
})

export const PUT = withAuth(async (request: NextRequest, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const existingTask = await getUrlSwapTaskById(id, user.userId)
  if (!existingTask) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  const rawBody = await request.text()
  if (!rawBody) {
    return NextResponse.json({ error: 'validation_error', message: '请求体为空' }, { status: 400 })
  }

  let body: UpdateUrlSwapTaskRequest
  try {
    body = JSON.parse(rawBody) as UpdateUrlSwapTaskRequest
  } catch (parseError: any) {
    return NextResponse.json(
      { error: 'validation_error', message: 'JSON格式错误: ' + parseError.message },
      { status: 400 }
    )
  }

  const offerIdFromBody = (body as any)?.offer_id
  if (offerIdFromBody !== undefined && offerIdFromBody !== existingTask.offer_id) {
    return NextResponse.json(
      { error: 'validation_error', message: '不允许修改任务关联的Offer' },
      { status: 400 }
    )
  }

  const swapModeAfter =
    body.swap_mode !== undefined
      ? body.swap_mode === 'manual'
        ? 'manual'
        : 'auto'
      : existingTask.swap_mode

  if (swapModeAfter === 'manual') {
    const rawList = (body as any).manual_affiliate_links ?? existingTask.manual_affiliate_links
    const normalizedList = normalizeAffiliateLinksInput(rawList)
    if (normalizedList.length === 0) {
      return NextResponse.json(
        { error: 'validation_error', message: '方式二需要至少配置 1 个推广链接' },
        { status: 400 }
      )
    }

    const invalidLinks = findInvalidAffiliateLinks(normalizedList)
    if (invalidLinks.length > 0) {
      return NextResponse.json(
        {
          error: 'validation_error',
          message: '推广链接需包含 http/https 协议，请检查方式二列表',
        },
        { status: 400 }
      )
    }

    if (Array.isArray((body as any).manual_affiliate_links)) {
      body.manual_affiliate_links = normalizedList
    }
  }

  const task = await updateUrlSwapTask(id, user.userId, body)

  try {
    await triggerUrlSwapScheduling(task.id)
  } catch (scheduleError) {
    console.warn('[url-swap] 更新后触发调度失败（不影响更新结果）:', scheduleError)
  }

  console.log(`[url-swap] 更新任务成功: ${id}`)

  return NextResponse.json({
    success: true,
    data: task,
    task,
    message: '任务更新成功',
  })
})

export const DELETE = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const existingTask = await getUrlSwapTaskById(id, user.userId)
  if (!existingTask) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.exec(
    `
      UPDATE url_swap_tasks
      SET is_deleted = ?, deleted_at = ?, updated_at = ?
      WHERE id = ?
    `,
    [true, now, now, id]
  )

  try {
    await removePendingUrlSwapQueueTasksByTaskIds([id], user.userId)
  } catch (cleanupError) {
    console.warn(`[url-swap] 删除任务后清理队列失败: ${id}`, cleanupError)
  }

  console.log(`[url-swap] 删除任务成功: ${id}`)

  return NextResponse.json({
    success: true,
    message: '任务删除成功',
  })
})
