/**
 * POST /api/admin/queue/sync
 *
 * 管理员手动同步队列状态
 *
 * 功能：
 * 1. 同步所有 running 状态的 batch 状态
 * 2. 清理数据库中超时的 running 任务
 * 3. 修复状态不一致的任务
 */

import { NextRequest, NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import { withAuth } from '@/lib/auth'

export const maxDuration = 60

export const POST = withAuth(
  async (request: NextRequest, user) => {
    // 只有管理员可以访问
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden', message: '需要管理员权限' },
        { status: 403 }
      )
    }

    try {
      const queue = getQueueManager()
      await queue.initialize()

      const body = await request.json().catch(() => ({}))
      const { action, batchId } = body as { action?: string; batchId?: string }

      let result: any = {}

      switch (action) {
        case 'sync-batch':
          // 同步指定或所有 batch 状态
          result = await queue.syncBatchStatus(batchId)
          break

        case 'cleanup-stale':
          // 清理超时任务
          result = await queue.cleanupStaleDatabaseTasks()
          break

        case 'full-sync':
          // 完整同步：先清理超时任务，再同步 batch 状态
          const cleanup = await queue.cleanupStaleDatabaseTasks()
          const sync = await queue.syncBatchStatus()
          result = {
            cleanup,
            sync,
            message: `清理 ${cleanup.cleanedCount} 个超时任务，同步 ${sync.checked} 个 batch，修复 ${sync.fixed} 个`
          }
          break

        default:
          // 默认执行完整同步
          const defaultCleanup = await queue.cleanupStaleDatabaseTasks()
          const defaultSync = await queue.syncBatchStatus()
          result = {
            cleanup: defaultCleanup,
            sync: defaultSync,
            message: `清理 ${defaultCleanup.cleanedCount} 个超时任务，同步 ${defaultSync.checked} 个 batch，修复 ${defaultSync.fixed} 个`
          }
      }

      return NextResponse.json({
        success: true,
        action,
        ...result
      })
    } catch (error: any) {
      console.error('❌ 队列同步失败:', error)
      return NextResponse.json(
        { error: 'Internal server error', message: error.message || '同步失败' },
        { status: 500 }
      )
    }
  },
  { requireAdmin: true }
)
