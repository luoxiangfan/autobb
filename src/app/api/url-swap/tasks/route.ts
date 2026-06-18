// GET /api/url-swap/tasks - 获取换链接任务列表
// POST /api/url-swap/tasks - 创建换链接任务

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { createUrlSwapTask, getUrlSwapTasks, hasUrlSwapTask } from '@/lib/url-swap'
import { triggerUrlSwapScheduling } from '@/lib/url-swap/url-swap-scheduler'
import type { CreateUrlSwapTaskRequest } from '@/lib/url-swap/url-swap-types'
import {
  normalizeAffiliateLinksInput,
  findInvalidAffiliateLinks,
} from '@/lib/url-swap/url-swap-link-utils'

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

/**
 * GET - 获取换链接任务列表
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request: NextRequest, user) => {
  const { searchParams } = new URL(request.url)

  const status = searchParams.get('status') as any
  const includeDeleted = parseBooleanQuery(
    searchParams.get('include_deleted') ?? searchParams.get('includeDeleted')
  )
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')

  const result = await getUrlSwapTasks(user.userId, {
    status: status || undefined,
    include_deleted: includeDeleted,
    page,
    limit,
  })

  const payload = {
    tasks: result.tasks,
    pagination: {
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    },
  }

  return NextResponse.json({ ...payload, data: payload })
})

/**
 * POST - 创建换链接任务
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  const userIdNum = user.userId

  const rawBody = await request.text()
  if (!rawBody) {
    return NextResponse.json({ error: 'validation_error', message: '请求体为空' }, { status: 400 })
  }

  let body: CreateUrlSwapTaskRequest
  try {
    body = JSON.parse(rawBody) as CreateUrlSwapTaskRequest
  } catch (parseError: any) {
    return NextResponse.json(
      { error: 'validation_error', message: 'JSON格式错误: ' + parseError.message },
      { status: 400 }
    )
  }

  // 验证必填字段
  if (!body.offer_id) {
    return NextResponse.json(
      { error: 'validation_error', message: '缺少必填字段: offer_id' },
      { status: 400 }
    )
  }

  // 检查是否已存在任务
  const existing = await hasUrlSwapTask(body.offer_id, userIdNum)
  if (existing) {
    return NextResponse.json(
      {
        error: 'task_exists',
        message: '该Offer已有关联的换链接任务，请先删除现有任务或使用更新功能',
      },
      { status: 409 }
    )
  }

  const swapMode = body.swap_mode === 'manual' ? 'manual' : 'auto'

  // 方式二：推广链接列表必填
  if (swapMode === 'manual') {
    const rawList = (body as any).manual_affiliate_links
    const normalizedList = normalizeAffiliateLinksInput(rawList)
    const hasAtLeastOne = normalizedList.length > 0
    if (!hasAtLeastOne) {
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

    body.manual_affiliate_links = normalizedList
  }

  // 创建任务
  const task = await createUrlSwapTask(userIdNum, body)

  // 异步触发调度：避免把调度耗时算进创建接口RT，Cron会作为兜底
  void triggerUrlSwapScheduling(task.id).catch((schedulingError: any) => {
    console.error(`[url-swap] 异步调度失败: ${task.id}`, schedulingError)
  })

  console.log(`[url-swap] 创建任务成功: ${task.id}`)

  return NextResponse.json({
    success: true,
    data: task,
    task,
    message: '换链接任务创建成功',
  })
})
