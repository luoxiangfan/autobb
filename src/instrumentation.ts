/**
 * Next.js Instrumentation API
 *
 * 在服务器启动时运行初始化代码
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 只在 Node.js 运行时执行，不在 Edge Runtime 执行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { patchConsoleToJsonOnce } = await import('./lib/console-json')
    const { initializeDatabase } = await import('./lib/db-init')
    const { recoverBatchTaskStatus } = await import('./lib/queue/batch-recovery')
    const skipRuntimeDbInit = process.env.SKIP_RUNTIME_DB_INIT === 'true'

    // 日志：统一为结构化 JSON，并自动附带 requestId/userId（若可用）
    patchConsoleToJsonOnce()

    if (skipRuntimeDbInit) {
      console.log('⏭️ SKIP_RUNTIME_DB_INIT=true，跳过 Next.js runtime 数据库初始化（由 entrypoint 负责）')
    } else {
      try {
        await initializeDatabase()
        // 注意：initializeDatabase() 内部会调用 initializeQueueSystem()，无需重复调用
      } catch (error) {
        console.error('❌ Database initialization failed during server startup:', error)
      }
    }

    // 🔥 修复（2025-01-02）：移除重复的队列初始化
    // initializeDatabase() 内部已调用 initializeQueueSystem()，此处无需重复调用
    // 原来重复调用会导致日志重复输出

    // 🔥 修复（2025-12-11）：恢复未完成的批量任务状态
    // 解决服务重启后，upload_records状态一直停留在"processing"的问题
    try {
      await recoverBatchTaskStatus()
    } catch (error) {
      console.error('❌ Batch task status recovery failed during server startup:', error)
    }
  }
}
