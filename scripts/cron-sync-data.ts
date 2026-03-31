#!/usr/bin/env tsx
/**
 * ⚠️ 已弃用 (DEPRECATED)
 *
 * 此脚本已被集成到统一队列系统的内置调度器中，不再需要外部 crontab 执行。
 *
 * 新的调度器位置: src/lib/queue/schedulers/data-sync-scheduler.ts
 * 启动方式: 队列系统启动时自动启动 (src/lib/queue/init-queue.ts)
 *
 * 优势:
 * - ✅ 不需要配置 crontab
 * - ✅ 与队列系统生命周期绑定
 * - ✅ 统一管理和监控
 * - ✅ 支持动态配置
 *
 * ⚠️ 此脚本仅保留用于手动测试或紧急修复
 *
 * ---
 *
 * Cron任务: 定时触发广告数据同步
 *
 * 功能:
 * - 从 settings 表读取用户配置 (data_sync_enabled/data_sync_interval_hours)
 * - 检查距离上次同步是否已超过间隔时间
 * - 将同步任务提交到队列系统 (offer_tasks_queue)
 *
 * 使用方法 (仅用于测试):
 * - 本地测试: tsx scripts/cron-sync-data.ts
 *
 * 环境变量:
 * - DATABASE_URL: PostgreSQL连接字符串 (生产环境)
 * - 本地开发自动使用 data/autoads.db (SQLite)
 */

import { getDatabase } from '../src/lib/db'
import { triggerDataSync } from '../src/lib/queue-triggers'

interface UserSyncConfig {
  user_id: number
  data_sync_enabled: string | boolean
  data_sync_interval_hours: string | number
  last_auto_sync_at: string | null
}

/**
 * 主函数: 检查并触发数据同步
 */
async function main() {
  console.log(`\n[${new Date().toISOString()}] 🔄 开始检查数据同步任务...`)

  try {
    const db = await getDatabase()
    const now = new Date()

    // 1. 查询所有启用了自动同步的用户
    // 注意: system_settings 表中 value 字段统一存储为字符串，布尔值为 'true'/'false'
    const configs = await db.query<UserSyncConfig>(
      `
      SELECT
        u.id AS user_id,
        COALESCE(s_enabled.value, 'true') AS data_sync_enabled,
        COALESCE(s_interval.value, '6') AS data_sync_interval_hours,
        (
          SELECT started_at
          FROM sync_logs
          WHERE user_id = u.id AND sync_type = 'auto'
          ORDER BY started_at DESC
          LIMIT 1
        ) AS last_auto_sync_at
      FROM users u
      LEFT JOIN system_settings s_enabled ON s_enabled.user_id = u.id
        AND s_enabled.category = 'system'
        AND s_enabled.key = 'data_sync_enabled'
      LEFT JOIN system_settings s_interval ON s_interval.user_id = u.id
        AND s_interval.category = 'system'
        AND s_interval.key = 'data_sync_interval_hours'
      WHERE COALESCE(s_enabled.value, 'true') = 'true'
      `
    )

    if (configs.length === 0) {
      console.log('  ℹ️  没有启用自动同步的用户')
      return
    }

    console.log(`  📊 找到 ${configs.length} 个启用自动同步的用户`)

    // 2. 遍历用户，检查是否需要触发同步
    let triggeredCount = 0
    for (const config of configs) {
      const userId = config.user_id
      const intervalHours = parseInt(String(config.data_sync_interval_hours)) || 6
      const lastSyncAt = config.last_auto_sync_at ? new Date(config.last_auto_sync_at) : null

      // 计算距离上次同步的小时数
      const hoursSinceLastSync = lastSyncAt
        ? (now.getTime() - lastSyncAt.getTime()) / (1000 * 60 * 60)
        : Infinity

      // 如果从未同步过，或者距离上次同步已超过间隔时间，触发同步
      if (hoursSinceLastSync >= intervalHours) {
        console.log(
          `  🔄 用户 #${userId}: 距离上次同步 ${lastSyncAt ? `${hoursSinceLastSync.toFixed(1)}小时` : '从未同步'}, 触发同步 (间隔: ${intervalHours}h)`
        )

        try {
          const taskId = await triggerDataSync(userId, {
            syncType: 'auto',
            priority: 'normal',
          })
          console.log(`     ✅ 同步任务已入队: ${taskId}`)
          triggeredCount++
        } catch (error) {
          console.error(`     ❌ 触发同步失败:`, error)
        }
      } else {
        const hoursUntilNext = intervalHours - hoursSinceLastSync
        console.log(
          `  ⏰ 用户 #${userId}: 距离下次同步还有 ${hoursUntilNext.toFixed(1)} 小时`
        )
      }
    }

    console.log(`\n✅ 检查完成: 触发了 ${triggeredCount}/${configs.length} 个同步任务`)
  } catch (error) {
    console.error('❌ 检查数据同步任务失败:', error)
    process.exit(1)
  }
}

// 执行主函数
main()
  .then(() => {
    console.log(`[${new Date().toISOString()}] 🏁 数据同步检查完成\n`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 脚本执行失败:', error)
    process.exit(1)
  })
