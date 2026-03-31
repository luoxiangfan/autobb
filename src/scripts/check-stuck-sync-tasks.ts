#!/usr/bin/env tsx
/**
 * 检测并修复卡死的商品同步任务
 *
 * 运行方式：
 * - 手动: npx tsx src/scripts/check-stuck-sync-tasks.ts
 * - 定时: 配置cron每10分钟运行一次
 *
 * 检测规则：
 * 1. status = 'running'
 * 2. last_heartbeat_at 超过30分钟无更新
 * 3. 自动标记为 failed
 */

import { getDatabase } from '@/lib/db'

const HEARTBEAT_TIMEOUT_MS = 30 * 60 * 1000 // 30分钟

async function checkStuckSyncTasks() {
  const db = await getDatabase()

  console.log('[check-stuck-sync-tasks] 开始检查卡死的同步任务...')

  const timeoutThreshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString()

  // 查找卡死的任务
  const stuckTasks = await db.query<{
    id: number
    user_id: number
    platform: string
    mode: string
    started_at: string
    last_heartbeat_at: string
    cursor_page: number
    total_items: number
  }>(
    `
      SELECT
        id, user_id, platform, mode, started_at, last_heartbeat_at,
        cursor_page, total_items
      FROM affiliate_product_sync_runs
      WHERE status = 'running'
        AND last_heartbeat_at < ?
      ORDER BY id
    `,
    [timeoutThreshold]
  )

  if (stuckTasks.length === 0) {
    console.log('[check-stuck-sync-tasks] ✅ 没有发现卡死的任务')
    return
  }

  console.log(`[check-stuck-sync-tasks] ⚠️ 发现 ${stuckTasks.length} 个卡死的任务`)

  for (const task of stuckTasks) {
    const lastHeartbeatMs = new Date(task.last_heartbeat_at).getTime()
    const stuckDurationMinutes = Math.floor((Date.now() - lastHeartbeatMs) / 60000)

    console.log(
      `[check-stuck-sync-tasks] 修复任务 #${task.id}: ` +
      `platform=${task.platform}, mode=${task.mode}, ` +
      `page=${task.cursor_page}, items=${task.total_items}, ` +
      `stuck_duration=${stuckDurationMinutes}分钟`
    )

    const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    await db.exec(
      `
        UPDATE affiliate_product_sync_runs
        SET
          status = 'failed',
          error_message = ?,
          completed_at = ${nowExpr}
        WHERE id = ?
      `,
      [
        `任务超时终止（心跳超时 ${stuckDurationMinutes} 分钟）- 可能原因：Worker进程崩溃、登录态过期、网络问题或代理失效`,
        task.id
      ]
    )
  }

  console.log(`[check-stuck-sync-tasks] ✅ 已修复 ${stuckTasks.length} 个卡死的任务`)
}

async function main() {
  try {
    await checkStuckSyncTasks()
    process.exit(0)
  } catch (error: any) {
    console.error('[check-stuck-sync-tasks] ❌ 执行失败:', error?.message || error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

export { checkStuckSyncTasks }
