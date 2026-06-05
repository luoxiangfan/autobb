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

    // 汇率：无论是否跳过运行时 DB 初始化，都要在当前进程预热一次内存缓存；
    // 否则 docker-entrypoint 场景下会长期停留在静态回退汇率。
    const raw = process.env.EXCHANGE_RATE_CACHE_RELOAD_MS
    const disabled = raw === '0' || raw === 'false'
    const defaultMs = process.env.VERCEL ? 0 : 60 * 60 * 1000
    const intervalMs = disabled ? 0 : Number(raw || defaultMs)
    const tick = () => {
      void import('./lib/exchange-rates-service')
        .then((m) => m.loadUsdRatesFromDatabase())
        .catch((e) => console.warn('[exchange-rates] periodic cache reload failed:', e))
    }
    tick()
    if (intervalMs > 0) {
      setInterval(tick, intervalMs)
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

    // Dev：预热关键 API 路由，避免 Turbopack 懒编译导致首次请求返回 HTML 404
    if (process.env.NODE_ENV === 'development') {
      const port = process.env.PORT || '3000'
      const base = `http://127.0.0.1:${port}`
      const warmup = async () => {
        const paths = ['/api/health', '/api/auth/me']
        for (const path of paths) {
          try {
            await fetch(`${base}${path}`, { signal: AbortSignal.timeout(8000) })
          } catch {
            // 服务尚未就绪时忽略
          }
        }
        try {
          await fetch(`${base}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(8000),
          })
        } catch {
          // 触发路由编译即可，400/401 均正常
        }
      }
      for (const delayMs of [1500, 4000]) {
        setTimeout(() => void warmup(), delayMs)
      }
    }
  }
}
