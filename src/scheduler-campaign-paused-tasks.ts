/**
 * 广告系列暂停任务检测调度器 - 独立启动脚本
 * 
 * 这是一个独立的调度器进程，用于检测已暂停广告系列并自动暂停关联 offer 的任务
 * 
 * 使用方式：
 * 1. 作为独立进程运行：node dist/scheduler-campaign-paused-tasks.js
 * 2. 集成到主 scheduler.ts 中（推荐）
 * 3. 通过 supervisord 管理
 * 
 * 配置项：
 * - QUEUE_CAMPAIGN_PAUSED_CHECK_INTERVAL_MS: 检测间隔（默认 30 分钟）
 * - QUEUE_CAMPAIGN_PAUSED_RUN_ON_START: 启动时是否立即执行一次（默认 true）
 * - QUEUE_CAMPAIGN_PAUSED_STARTUP_DELAY_MS: 启动延迟（默认 15 秒）
 */

import { getCampaignPausedTaskScheduler } from './lib/queue/schedulers/campaign-paused-task-scheduler'

function log(message: string) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}

function logError(message: string, error: any) {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] ${message}`, error instanceof Error ? error.message : String(error))
}

function parseNonNegativeIntEnv(rawValue: string | undefined, defaultValue: number): number {
  if (rawValue === undefined) return defaultValue

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue
  }

  return parsed
}

function parseBooleanEnv(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (rawValue === undefined) return defaultValue

  const normalized = rawValue.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false

  return defaultValue
}

let isShuttingDown = false
const shutdownGraceMs = parseNonNegativeIntEnv(
  process.env.CAMPAIGN_PAUSED_SCHEDULER_SHUTDOWN_GRACE_MS,
  5000
)

/**
 * 启动调度器
 */
function startScheduler() {
  log('🚀 广告系列暂停任务检测调度器启动')
  
  const intervalMs = parseNonNegativeIntEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_CHECK_INTERVAL_MS,
    30 * 60 * 1000  // 默认 30 分钟
  )
  const runOnStart = parseBooleanEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_RUN_ON_START,
    true
  )
  const startupDelayMs = parseNonNegativeIntEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_STARTUP_DELAY_MS,
    15_000  // 默认 15 秒延迟
  )

  log(`📅 配置:`)
  log(`  - 检测间隔：${intervalMs / 1000 / 60} 分钟`)
  log(`  - 启动时立即执行：${runOnStart ? '是' : '否'}`)
  log(`  - 启动延迟：${startupDelayMs / 1000} 秒`)

  // 获取调度器实例
  const scheduler = getCampaignPausedTaskScheduler()

  // 启动调度器（内置启动逻辑）
  scheduler.start()

  log('✅ 调度器已启动，运行中...')
}

/**
 * 优雅退出
 */
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`📴 收到 ${signal} 信号，正在优雅退出...`)

  const scheduler = getCampaignPausedTaskScheduler()
  scheduler.stop()

  const shutdownTimer = setTimeout(() => {
    log('✅ 调度器已停止')
    process.exit(0)
  }, shutdownGraceMs)
  shutdownTimer.unref?.()
}

// 监听退出信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// 全局错误处理
process.on('uncaughtException', (error) => {
  logError('❌ 未捕获的异常:', error)
  // 不退出进程，让 supervisord 管理重启
})

process.on('unhandledRejection', (reason, promise) => {
  logError('❌ 未处理的 Promise 拒绝:', reason)
  // 不退出进程，让 supervisord 管理重启
})

// 启动调度器
startScheduler()

// 保持进程运行
log('💡 调度器进程运行中，按 Ctrl+C 停止')
