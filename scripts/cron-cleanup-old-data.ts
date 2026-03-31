/**
 * 定时数据清理脚本
 * 清理90天之前的性能数据，释放存储空间
 *
 * 使用方法：
 * 添加到系统crontab（每天凌晨2点执行）：
 * 0 2 * * * cd /path/to/project && npx tsx scripts/cron-cleanup-old-data.ts >> logs/cleanup.log 2>&1
 */

import { dataSyncService } from '../src/lib/data-sync-service'

async function runCleanup() {
  console.log(`[${new Date().toISOString()}] 开始执行数据清理任务...`)

  try {
    // 清理90天之前的数据
    const deletedCount = await dataSyncService.cleanupOldData()

    console.log(`✅ 数据清理完成: 删除了 ${deletedCount} 条过期记录`)
    console.log(`[${new Date().toISOString()}] 数据清理任务完成`)
  } catch (error) {
    console.error('❌ 数据清理失败:', error)
    process.exit(1)
  }
}

// 执行清理
runCleanup()
  .then(() => {
    console.log('✅ 清理任务执行完毕')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 清理任务执行失败:', error)
    process.exit(1)
  })
