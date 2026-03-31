/**
 * 生产环境队列堆积诊断
 */

import postgres from 'postgres'

const DATABASE_URL = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'

async function main() {
  console.log('🔍 生产环境队列堆积诊断\n')
  console.log('=' .repeat(60))

  const sql = postgres(DATABASE_URL, {
    max: 2,
    connect_timeout: 10,
  })

  try {
    // 1. Batch Tasks 状态
    console.log('\n1️⃣ Batch Tasks 状态:')
    const batchStats = await sql`
      SELECT status, COUNT(*) as count
      FROM batch_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    batchStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    // 2. Click Farm Tasks 状态
    console.log('\n2️⃣ Click Farm Tasks 状态:')
    const clickStats = await sql`
      SELECT status, COUNT(*) as count
      FROM click_farm_tasks
      WHERE is_deleted = false
      GROUP BY status
      ORDER BY count DESC
    `
    clickStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    // 检查 pending 的 click farm 任务
    const clickPending = await sql`
      SELECT id, user_id, offer_id, status, next_run_at, created_at, updated_at
      FROM click_farm_tasks
      WHERE status = 'pending' AND is_deleted = false
      ORDER BY next_run_at ASC NULLS LAST
      LIMIT 20
    `
    if (clickPending.length > 0) {
      console.log(`\n  ⚠️ 发现 ${clickPending.length} 个 pending 的 click farm 任务:`)
      clickPending.forEach((t) => {
        const nextRun = t.next_run_at ? new Date(t.next_run_at).toISOString() : '未设置'
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 1000 / 60)
        console.log(`    [${t.id.substring(0, 8)}] offer:${t.offer_id} - 下次运行: ${nextRun} (创建 ${age}分钟前)`)
      })
    }

    // 3. URL Swap Tasks 状态
    console.log('\n3️⃣ URL Swap Tasks 状态:')
    const urlStats = await sql`
      SELECT status, COUNT(*) as count
      FROM url_swap_tasks
      WHERE is_deleted = false
      GROUP BY status
      ORDER BY count DESC
    `
    urlStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    // 检查 pending 的 url swap 任务
    const urlPending = await sql`
      SELECT id, user_id, offer_id, status, next_swap_at, created_at, updated_at
      FROM url_swap_tasks
      WHERE status = 'pending' AND is_deleted = false
      ORDER BY next_swap_at ASC NULLS LAST
      LIMIT 20
    `
    if (urlPending.length > 0) {
      console.log(`\n  ⚠️ 发现 ${urlPending.length} 个 pending 的 url swap 任务:`)
      urlPending.forEach((t) => {
        const nextSwap = t.next_swap_at ? new Date(t.next_swap_at).toISOString() : '未设置'
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 1000 / 60)
        console.log(`    [${t.id.substring(0, 8)}] offer:${t.offer_id} - 下次交换: ${nextSwap} (创建 ${age}分钟前)`)
      })
    }

    // 4. 检查最近的活动
    console.log('\n4️⃣ 最近的任务活动:')

    // 最近完成的 click farm 任务
    const recentClickCompleted = await sql`
      SELECT id, offer_id, status, started_at, completed_at, success_clicks, failed_clicks
      FROM click_farm_tasks
      WHERE status = 'completed' AND is_deleted = false
      ORDER BY completed_at DESC
      LIMIT 3
    `
    if (recentClickCompleted.length > 0) {
      console.log('\n  最近完成的 Click Farm 任务:')
      recentClickCompleted.forEach((t) => {
        const duration = t.completed_at && t.started_at
          ? Math.round((new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()) / 1000 / 60)
          : '?'
        console.log(`    [${t.id.substring(0, 8)}] offer:${t.offer_id} - 成功:${t.success_clicks} 失败:${t.failed_clicks} (耗时 ${duration}分钟)`)
      })
    } else {
      console.log('\n  ⚠️ 没有最近完成的 Click Farm 任务')
    }

    // 最近完成的 url swap 任务
    const recentUrlCompleted = await sql`
      SELECT id, offer_id, status, started_at, completed_at, success_swaps, failed_swaps
      FROM url_swap_tasks
      WHERE status = 'completed' AND is_deleted = false
      ORDER BY completed_at DESC
      LIMIT 3
    `
    if (recentUrlCompleted.length > 0) {
      console.log('\n  最近完成的 URL Swap 任务:')
      recentUrlCompleted.forEach((t) => {
        console.log(`    [${t.id.substring(0, 8)}] offer:${t.offer_id} - 成功:${t.success_swaps} 失败:${t.failed_swaps}`)
      })
    } else {
      console.log('\n  ⚠️ 没有最近完成的 URL Swap 任务')
    }

    // 5. 检查 running 状态的任务
    console.log('\n5️⃣ 正在运行的任务:')
    const runningClick = await sql`
      SELECT id, offer_id, status, started_at, progress, total_clicks, success_clicks
      FROM click_farm_tasks
      WHERE status = 'running' AND is_deleted = false
      ORDER BY started_at DESC
      LIMIT 10
    `
    if (runningClick.length > 0) {
      console.log(`\n  Running Click Farm 任务 (${runningClick.length}):`)
      runningClick.forEach((t) => {
        const runningTime = Math.round((Date.now() - new Date(t.started_at).getTime()) / 1000 / 60)
        console.log(`    [${t.id.substring(0, 8)}] offer:${t.offer_id} - 进度:${t.progress}% 成功:${t.success_clicks}/${t.total_clicks} (运行 ${runningTime}分钟)`)
      })
    } else {
      console.log('\n  没有正在运行的 Click Farm 任务')
    }

    const runningUrl = await sql`
      SELECT id, offer_id, status, started_at, progress, total_swaps, success_swaps
      FROM url_swap_tasks
      WHERE status = 'running' AND is_deleted = false
      ORDER BY started_at DESC
      LIMIT 10
    `
    if (runningUrl.length > 0) {
      console.log(`\n  Running URL Swap 任务 (${runningUrl.length}):`)
      runningUrl.forEach((t) => {
        const runningTime = Math.round((Date.now() - new Date(t.started_at).getTime()) / 1000 / 60)
        console.log(`    [${t.id.substring(0, 8)}] offer:${t.offer_id} - 进度:${t.progress}% 成功:${t.success_swaps}/${t.total_swaps} (运行 ${runningTime}分钟)`)
      })
    } else {
      console.log('\n  没有正在运行的 URL Swap 任务')
    }

    // 6. 诊断结论
    console.log('\n' + '='.repeat(60))
    console.log('📊 诊断结论:\n')

    const totalPending = clickPending.length + urlPending.length
    const hasRecentActivity = recentClickCompleted.length > 0 || recentUrlCompleted.length > 0
    const hasRunning = runningClick.length > 0 || runningUrl.length > 0

    if (totalPending > 0 && !hasRecentActivity && !hasRunning) {
      console.log('❌ 严重问题: 有 pending 任务但没有任何执行活动!')
      console.log('   可能原因:')
      console.log('   1. Background worker 进程未运行')
      console.log('   2. 队列消费被禁用 (QUEUE_SPLIT_BACKGROUND=1 但 worker 未启动)')
      console.log('   3. Redis 连接问题')
      console.log('\n💡 建议操作:')
      console.log('   1. 检查 background-worker 进程: ps aux | grep background-worker')
      console.log('   2. 检查进程日志: pm2 logs background-worker 或 supervisorctl tail -f background-worker')
      console.log('   3. 检查环境变量: QUEUE_SPLIT_BACKGROUND, QUEUE_BACKGROUND_WORKER')
    } else if (totalPending > 0 && hasRecentActivity) {
      console.log('⚠️ 轻微堆积: 有 pending 任务,但系统正在处理')
      console.log('   这可能是正常的队列积压,系统会逐步处理')
    } else if (totalPending === 0) {
      console.log('✅ 队列正常: 没有 pending 任务堆积')
    }

  } finally {
    await sql.end()
  }
}

main().catch(console.error)
