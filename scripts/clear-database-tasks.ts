#!/usr/bin/env tsx
/**
 * 清空数据库中的未完成任务
 *
 * 清理 offer_tasks 表中状态为 pending 或 running 的任务
 * 这些任务可能会在系统启动时被恢复到队列中
 *
 * 用法：
 * npx tsx scripts/clear-database-tasks.ts [--all]
 *
 * 参数：
 * --all  同时清理 completed 和 failed 状态的任务
 */

import { getDatabase } from '../src/lib/db'

async function clearDatabaseTasks() {
  const db = getDatabase()
  const clearAll = process.argv.includes('--all')

  try {
    console.log('📊 数据库任务统计（清理前）：')

    // 1. 统计各状态任务数量
    const stats = await db.query<{ status: string; count: number }>(`
      SELECT status, COUNT(*) as count
      FROM offer_tasks
      GROUP BY status
    `)

    const statusMap: Record<string, number> = {}
    for (const row of stats) {
      statusMap[row.status] = row.count
      console.log(`  ${row.status}: ${row.count}`)
    }

    const pendingCount = statusMap['pending'] || 0
    const runningCount = statusMap['running'] || 0
    const completedCount = statusMap['completed'] || 0
    const failedCount = statusMap['failed'] || 0

    console.log('')

    // 2. 清理未完成的任务
    if (pendingCount > 0 || runningCount > 0) {
      console.log('🗑️  清理未完成的任务（pending & running）...')

      const result = await db.exec(`
        DELETE FROM offer_tasks
        WHERE status IN ('pending', 'running')
      `)

      console.log(`  ✅ 删除了 ${result.changes} 个未完成任务`)
    } else {
      console.log('✅ 没有未完成的任务需要清理')
    }

    // 3. 可选：清理历史任务
    if (clearAll && (completedCount > 0 || failedCount > 0)) {
      console.log('')
      console.log('🗑️  清理历史任务（completed & failed）...')

      const result = await db.exec(`
        DELETE FROM offer_tasks
        WHERE status IN ('completed', 'failed')
      `)

      console.log(`  ✅ 删除了 ${result.changes} 个历史任务`)
    }

    // 4. 显示清理后统计
    console.log('')
    console.log('📊 数据库任务统计（清理后）：')

    const afterStats = await db.query<{ status: string; count: number }>(`
      SELECT status, COUNT(*) as count
      FROM offer_tasks
      GROUP BY status
    `)

    if (afterStats.length === 0) {
      console.log('  （空）')
    } else {
      for (const row of afterStats) {
        console.log(`  ${row.status}: ${row.count}`)
      }
    }

    console.log('')
    console.log('✅ 数据库任务清理完成！')

  } catch (error: any) {
    console.error('❌ 清理失败:', error.message)
    throw error
  }
}

// 执行清理
clearDatabaseTasks().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
