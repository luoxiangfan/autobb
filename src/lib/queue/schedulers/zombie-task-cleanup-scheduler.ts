/**
 * 联盟商品同步僵尸任务自动清理调度器
 *
 * 每小时运行一次，自动检测并修复卡住的同步任务
 */

import { detectAndFixZombieSyncTasks } from '@/lib/queue/affiliate-sync-zombie-detector'

let isRunning = false
let lastRunAt: Date | null = null
let lastResult: any = null

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1小时

/**
 * 启动僵尸任务清理调度器
 */
export function startZombieTaskCleanupScheduler() {
  console.log('[zombie-cleanup-scheduler] 启动僵尸任务自动清理调度器（间隔: 1小时）')

  // 立即执行一次
  runCleanup()

  // 定期执行
  setInterval(() => {
    runCleanup()
  }, CLEANUP_INTERVAL_MS)
}

async function runCleanup() {
  if (isRunning) {
    console.log('[zombie-cleanup-scheduler] 上次清理仍在运行中，跳过本次')
    return
  }

  isRunning = true
  const startTime = Date.now()

  try {
    console.log('[zombie-cleanup-scheduler] 开始检测僵尸任务...')

    const result = await detectAndFixZombieSyncTasks({
      autoFix: true,
      dryRun: false,
    })

    lastResult = result
    lastRunAt = new Date()

    const duration = Date.now() - startTime

    if (result.zombieTasks.length > 0) {
      console.warn(
        `[zombie-cleanup-scheduler] 发现 ${result.zombieTasks.length} 个僵尸任务，已修复 ${result.fixedCount} 个（耗时 ${duration}ms）`
      )

      // 记录详细信息
      for (const task of result.zombieTasks) {
        console.warn(
          `[zombie-cleanup-scheduler] 僵尸任务 #${task.id}: ${task.platform} | ${task.status} | ${task.processedItems}/${task.totalItems} | ${task.reason}`
        )
      }

      if (result.errors.length > 0) {
        console.error(
          `[zombie-cleanup-scheduler] 修复过程中出现 ${result.errors.length} 个错误:`,
          result.errors
        )
      }
    } else {
      console.log(`[zombie-cleanup-scheduler] 未发现僵尸任务（耗时 ${duration}ms）`)
    }
  } catch (error: any) {
    console.error('[zombie-cleanup-scheduler] 清理失败:', error)
  } finally {
    isRunning = false
  }
}

/**
 * 获取调度器状态
 */
export function getZombieCleanupSchedulerStatus() {
  return {
    isRunning,
    lastRunAt,
    lastResult,
  }
}
