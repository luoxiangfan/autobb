#!/usr/bin/env node
/**
 * 内存监控脚本
 * 用于监控Node.js进程的内存使用情况
 *
 * 运行方式:
 * node scripts/monitor_memory.js
 */

const { getHeapStatistics } = require('v8')

const EXECUTOR_THRESHOLD = parseFloat(process.env.CLICK_FARM_EXECUTOR_HEAP_PRESSURE_PCT || '80')
const BATCH_THRESHOLD = parseFloat(process.env.CLICK_FARM_BATCH_HEAP_PRESSURE_PCT || '82')

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function checkMemoryPressure() {
  const mem = process.memoryUsage()
  const heap = getHeapStatistics()
  const pct = (mem.heapUsed / heap.heap_size_limit) * 100

  const status = {
    timestamp: new Date().toISOString(),
    heapUsed: formatBytes(mem.heapUsed),
    heapTotal: formatBytes(mem.heapTotal),
    heapLimit: formatBytes(heap.heap_size_limit),
    percentage: `${pct.toFixed(2)}%`,
    rss: formatBytes(mem.rss),
    external: formatBytes(mem.external),
    arrayBuffers: formatBytes(mem.arrayBuffers),
    executorThreshold: `${EXECUTOR_THRESHOLD}%`,
    batchThreshold: `${BATCH_THRESHOLD}%`,
    isExecutorPressure: pct >= EXECUTOR_THRESHOLD,
    isBatchPressure: pct >= BATCH_THRESHOLD
  }

  // 根据压力级别使用不同的日志级别
  if (status.isExecutorPressure) {
    console.error('🔴 [MemoryMonitor] 执行器内存压力过高!', status)
  } else if (status.isBatchPressure) {
    console.warn('🟡 [MemoryMonitor] 批次分发器内存压力过高!', status)
  } else if (pct >= 70) {
    console.warn('🟠 [MemoryMonitor] 内存使用较高', status)
  } else {
    console.log('🟢 [MemoryMonitor] 内存使用正常', status)
  }
}

// 每5秒检查一次
console.log('[MemoryMonitor] 开始监控内存使用情况...')
console.log(`[MemoryMonitor] 执行器阈值: ${EXECUTOR_THRESHOLD}%`)
console.log(`[MemoryMonitor] 批次分发器阈值: ${BATCH_THRESHOLD}%`)
console.log('---')

checkMemoryPressure()
setInterval(checkMemoryPressure, 5000)

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[MemoryMonitor] 停止监控')
  process.exit(0)
})
