// GET  /api/url-swap/tasks/[id]/sync-sitelink-targets - 查询 Sitelink 同步状态
// POST /api/url-swap/tasks/[id]/sync-sitelink-targets - 异步触发 Sitelink 子目标映射同步

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapTaskById } from '@/lib/url-swap'
import { executeUrlSwapSitelinkTargetsSyncJob } from '@/lib/url-swap/run-sitelink-targets-sync'
import {
  getUrlSwapSitelinkSyncState,
  tryStartUrlSwapSitelinkSync,
} from '@/lib/url-swap/sitelink-sync-async-state'

export const dynamic = 'force-dynamic'

const POLL_INTERVAL_MS = 2500

function buildPollResponsePath(taskId: string): string {
  return `/api/url-swap/tasks/${taskId}/sync-sitelink-targets`
}

function buildAcceptedResponse(taskId: string, status: 'running' | 'completed' | 'failed') {
  return NextResponse.json(
    {
      success: status === 'completed',
      status,
      async: true,
      poll_url: buildPollResponsePath(taskId),
      poll_interval_ms: POLL_INTERVAL_MS,
      message:
        status === 'running'
          ? 'Sitelink 同步已在后台执行，请稍候…'
          : status === 'completed'
            ? 'Sitelink 同步已完成'
            : 'Sitelink 同步失败',
    },
    { status: status === 'completed' ? 200 : 202 }
  )
}

export const GET = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getUrlSwapTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  const state = await getUrlSwapSitelinkSyncState(id, user.userId)
  if (!state) {
    return NextResponse.json({
      success: false,
      status: 'idle',
      async: true,
      poll_interval_ms: POLL_INTERVAL_MS,
      message: '暂无进行中的 Sitelink 同步',
    })
  }

  if (state.status === 'running') {
    return buildAcceptedResponse(id, 'running')
  }

  if (state.status === 'failed') {
    return NextResponse.json(
      {
        success: false,
        status: 'failed',
        async: true,
        message: state.errorMessage || 'Sitelink 同步失败',
      },
      { status: 500 }
    )
  }

  const result = state.result
  if (!result) {
    return buildAcceptedResponse(id, 'running')
  }

  return NextResponse.json({
    success: result.success,
    status: 'completed',
    async: true,
    data: {
      sitelink_targets: result.sitelink_targets,
      sitelink_sync: result.sitelink_sync,
    },
    sitelink_targets: result.sitelink_targets,
    sitelink_sync: result.sitelink_sync,
    message: result.message,
  })
})

export const POST = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getUrlSwapTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  const startResult = await tryStartUrlSwapSitelinkSync(id, user.userId)
  if (!startResult.started) {
    return buildAcceptedResponse(id, 'running')
  }

  void executeUrlSwapSitelinkTargetsSyncJob({
    taskId: id,
    offerId: task.offer_id,
    userId: user.userId,
  })

  return buildAcceptedResponse(id, 'running')
})
