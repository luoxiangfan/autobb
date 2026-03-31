/**
 * 手动修复批量任务状态脚本
 *
 * 用途：
 * - 修复因服务重启导致的upload_records状态不一致问题
 * - 将所有"处理中"或"待处理"的批量任务更新为最终状态
 *
 * 使用场景：
 * 1. 服务重启后发现upload_records一直显示"处理中"
 * 2. 数据库状态与实际情况不符
 * 3. 需要手动清理历史遗留问题
 *
 * 运行命令：
 * ```bash
 * tsx scripts/fix-batch-task-status.ts
 * ```
 */

import { runBatchRecovery } from '../src/lib/queue/batch-recovery'

async function main() {
  console.log('========================================')
  console.log('批量任务状态修复工具')
  console.log('========================================\n')

  try {
    await runBatchRecovery()

    console.log('\n========================================')
    console.log('✅ 修复完成！')
    console.log('========================================')

    process.exit(0)
  } catch (error: any) {
    console.error('\n========================================')
    console.error('❌ 修复失败:', error.message)
    console.error('========================================')

    process.exit(1)
  }
}

// 执行主函数
main()
