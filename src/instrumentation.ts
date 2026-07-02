/**
 * Next.js Instrumentation API
 *
 * 在服务器启动时运行初始化代码
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 只在 Node.js 运行时执行，不在 Edge Runtime 执行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { patchConsoleToJsonOnce } = await import('./lib/common/console-json')
    const { initializeDatabase } = await import('./lib/db/db-init')
    const { recoverBatchTaskStatus } = await import('./lib/queue/batch-recovery')
    const skipRuntimeDbInit = process.env.SKIP_RUNTIME_DB_INIT === 'true'

    // 日志：统一为结构化 JSON，并自动附带 requestId/userId（若可用）
    patchConsoleToJsonOnce()

    if (skipRuntimeDbInit) {
      console.log(
        '⏭️ SKIP_RUNTIME_DB_INIT=true，跳过 Next.js runtime 数据库初始化（由 entrypoint 负责）'
      )
      // entrypoint 仅做 DB 迁移，核心队列 consumer 仍须在 Web 进程启动（sync 等任务由 autoads-web 消费）
      try {
        const { initializeQueue } = await import('./lib/queue/init-queue')
        await initializeQueue()
      } catch (error) {
        console.error('❌ Queue initialization failed during server startup:', error)
      }
    } else {
      try {
        await initializeDatabase()
        // 注意：initializeDatabase() 内部会调用 initializeQueueSystem()，无需重复调用
      } catch (error) {
        console.error('❌ Database initialization failed during server startup:', error)
      }
    }

    // 汇率：无论是否跳过运行时 DB 初始化，都要在当前进程预热一次内存缓存；
    // 否则 docker-entrypoint 场景下会长期停留在静态回退汇率。
    const raw = process.env.EXCHANGE_RATE_CACHE_RELOAD_MS
    const disabled = raw === '0' || raw === 'false'
    const defaultMs = process.env.VERCEL ? 0 : 60 * 60 * 1000
    const intervalMs = disabled ? 0 : Number(raw || defaultMs)
    const tick = () => {
      void import('./lib/common/exchange-rates-service')
        .then((m) => m.loadUsdRatesFromDatabase())
        .catch((e) => console.warn('[exchange-rates] periodic cache reload failed:', e))
    }
    tick()
    if (intervalMs > 0) {
      setInterval(tick, intervalMs)
    }

    // initializeDatabase() 路径已内含队列初始化；SKIP_RUNTIME_DB_INIT 路径在上方单独 initializeQueue()

    // 恢复未完成的批量任务状态
    // 解决服务重启后，upload_records状态一直停留在"processing"的问题
    try {
      await recoverBatchTaskStatus()
    } catch (error) {
      console.error('❌ Batch task status recovery failed during server startup:', error)
    }
  }
}
