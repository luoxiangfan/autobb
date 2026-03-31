/**
 * URL Swap 调度器诊断脚本
 * 用于排查生产环境调度器不运行的问题
 */

import { getDatabase } from '../src/lib/db'

async function diagnose() {
  console.log('🔍 开始诊断 URL Swap 调度器问题...\n')

  try {
    const db = await getDatabase()

    // 1. 检查待执行的任务
    console.log('1️⃣ 检查待执行的换链接任务：')
    const query = db.type === 'postgres'
      ? `
        SELECT
          id,
          user_id,
          offer_id,
          swap_interval_minutes,
          next_swap_at,
          started_at,
          status,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - next_swap_at)) / 60 as overdue_minutes
        FROM url_swap_tasks
        WHERE status = 'enabled'
          AND next_swap_at <= CURRENT_TIMESTAMP
          AND started_at <= CURRENT_TIMESTAMP
          AND is_deleted = FALSE
        ORDER BY next_swap_at ASC
        LIMIT 10
      `
      : `
        SELECT
          id,
          user_id,
          offer_id,
          swap_interval_minutes,
          next_swap_at,
          started_at,
          status,
          (julianday('now') - julianday(next_swap_at)) * 24 * 60 as overdue_minutes
        FROM url_swap_tasks
        WHERE status = 'enabled'
          AND next_swap_at <= datetime('now')
          AND started_at <= datetime('now')
          AND is_deleted = 0
        ORDER BY next_swap_at ASC
        LIMIT 10
      `

    const overdueTasks = await db.query<any>(query)
    console.log(`   找到 ${overdueTasks.length} 个逾期任务`)

    if (overdueTasks.length > 0) {
      console.log('   前10个逾期任务：')
      for (const task of overdueTasks) {
        console.log(`   - ID: ${task.id}, User: ${task.user_id}, Offer: ${task.offer_id}`)
        console.log(`     Next Swap: ${task.next_swap_at}, Overdue: ${Math.round(task.overdue_minutes)} 分钟`)
      }
    }

    // 2. 检查队列中是否有 url-swap 任务
    console.log('\n2️⃣ 检查队列中的 url-swap 任务：')
    const queueQuery = db.type === 'postgres'
      ? `
        SELECT status, COUNT(*) as count
        FROM queue_tasks
        WHERE type = 'url-swap'
        GROUP BY status
      `
      : `
        SELECT status, COUNT(*) as count
        FROM queue_tasks
        WHERE type = 'url-swap'
        GROUP BY status
      `

    const queueStats = await db.query<{ status: string; count: number }>(queueQuery)
    if (queueStats.length === 0) {
      console.log('   ⚠️  队列中没有任何 url-swap 任务')
    } else {
      for (const stat of queueStats) {
        console.log(`   - ${stat.status}: ${stat.count}`)
      }
    }

    // 3. 检查最近的队列任务执行记录
    console.log('\n3️⃣ 检查最近的 url-swap 队列任务：')
    const recentTasksQuery = db.type === 'postgres'
      ? `
        SELECT id, user_id, status, created_at, started_at, completed_at
        FROM queue_tasks
        WHERE type = 'url-swap'
        ORDER BY created_at DESC
        LIMIT 5
      `
      : `
        SELECT id, user_id, status, created_at, started_at, completed_at
        FROM queue_tasks
        WHERE type = 'url-swap'
        ORDER BY created_at DESC
        LIMIT 5
      `

    const recentTasks = await db.query<any>(recentTasksQuery)
    if (recentTasks.length === 0) {
      console.log('   ⚠️  没有找到任何历史 url-swap 队列任务')
    } else {
      console.log(`   最近 ${recentTasks.length} 个任务：`)
      for (const task of recentTasks) {
        console.log(`   - ID: ${task.id}, User: ${task.user_id}, Status: ${task.status}`)
        console.log(`     Created: ${task.created_at}, Started: ${task.started_at || 'N/A'}, Completed: ${task.completed_at || 'N/A'}`)
      }
    }

    // 4. 检查环境变量
    console.log('\n4️⃣ 检查相关环境变量：')
    console.log(`   QUEUE_URL_SWAP_RUN_ON_START: ${process.env.QUEUE_URL_SWAP_RUN_ON_START || '(未设置，默认 true)'}`)
    console.log(`   QUEUE_URL_SWAP_STARTUP_DELAY_MS: ${process.env.QUEUE_URL_SWAP_STARTUP_DELAY_MS || '(未设置，默认 10000)'}`)
    console.log(`   SKIP_RUNTIME_DB_INIT: ${process.env.SKIP_RUNTIME_DB_INIT || '(未设置，默认 false)'}`)
    console.log(`   NODE_ENV: ${process.env.NODE_ENV}`)

    // 5. 测试手动触发
    console.log('\n5️⃣ 测试手动触发调度器：')
    try {
      const { triggerAllUrlSwapTasks } = await import('../src/lib/url-swap-scheduler')
      console.log('   正在执行手动触发...')
      const result = await triggerAllUrlSwapTasks()
      console.log(`   ✅ 手动触发成功：`)
      console.log(`      - 处理: ${result.processed}`)
      console.log(`      - 执行: ${result.executed}`)
      console.log(`      - 跳过: ${result.skipped}`)
      console.log(`      - 错误: ${result.errors}`)
    } catch (error: any) {
      console.log(`   ❌ 手动触发失败: ${error.message}`)
    }

    console.log('\n✅ 诊断完成')
  } catch (error: any) {
    console.error('❌ 诊断失败:', error)
    process.exit(1)
  }
}

diagnose()
