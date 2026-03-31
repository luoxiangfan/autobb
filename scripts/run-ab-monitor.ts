// Helper script to run A/B test monitoring from bash
import { monitorActiveABTests } from '../src/scheduler/ab-test-monitor'
import { closeDatabase } from '../src/lib/db'

monitorActiveABTests()
  .then(() => {
    // 关闭数据库连接，释放资源
    closeDatabase()
    // 监控任务成功完成，明确退出进程
    process.exit(0)
  })
  .catch((error) => {
    console.error('Monitoring error:', error)
    closeDatabase()
    process.exit(1)
  })
