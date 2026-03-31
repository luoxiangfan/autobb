/**
 * 数据库备份命令行脚本
 * 使用 src/lib/backup.ts 中的核心逻辑
 */

import { backupDatabase } from '../src/lib/backup'

/**
 * 命令行执行
 */
if (require.main === module) {
  const backupType = process.argv[2] === 'manual' ? 'manual' : 'auto'

  backupDatabase(backupType)
    .then((result) => {
      if (result.success) {
        console.log('✅ 备份任务成功完成')
        process.exit(0)
      } else {
        console.error('❌ 备份任务失败:', result.errorMessage)
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error('❌ 备份任务异常:', error)
      process.exit(1)
    })
}
