/**
 * 初始化队列配置脚本
 *
 * 运行方式：npx tsx scripts/init-queue-config.ts
 */

import { initializeDefaultQueueConfig } from '../src/lib/queue-config'

console.log('🚀 开始初始化队列配置...')

try {
  initializeDefaultQueueConfig()
  console.log('✅ 队列配置初始化成功！')
  console.log('')
  console.log('默认配置：')
  console.log('  - 全局并发限制: 8')
  console.log('  - 单用户并发限制: 2')
  console.log('  - 队列最大长度: 1000')
  console.log('  - 任务超时时间: 300000ms (5分钟)')
  console.log('  - 启用优先级队列: true')
  console.log('')
  console.log('💡 提示：可以在 /settings 页面的"系统设置"中修改这些配置')
} catch (error: any) {
  console.error('❌ 初始化失败:', error.message)
  process.exit(1)
}
