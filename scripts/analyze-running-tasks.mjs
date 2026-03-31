/**
 * 分析 running 任务的实际状态
 * 判断哪些应该保留，哪些应该清理
 */

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'

async function main() {
  console.log('🔍 分析 Running 任务的实际状态\n')
  console.log('=' .repeat(60))

  const sql = postgres(DATABASE_URL, { max: 2, connect_timeout: 10 })

  try {
    // 获取所有 running 任务的详细信息
    const runningTasks = await sql`
      SELECT id, user_id, offer_id, status,
             daily_click_count, duration_days,
             progress, total_clicks, success_clicks, failed_clicks,
             started_at, completed_at, next_run_at,
             created_at, updated_at
      FROM click_farm_tasks
      WHERE status = 'running'
        AND is_deleted = false
      ORDER BY started_at
      LIMIT 10
    `

    console.log('\n1️⃣ 前 10 个 running 任务的详细信息:\n')

    for (const task of runningTasks) {
      const runningHours = task.started_at
        ? Math.round((Date.now() - new Date(task.started_at).getTime()) / 1000 / 3600)
        : 0

      const progressPercent = task.progress || 0
      const clicksCompleted = task.success_clicks || 0
      const clicksTotal = task.total_clicks || 0
      const clicksExpected = task.daily_click_count * task.duration_days

      console.log(`[${task.id.substring(0, 8)}] offer:${task.offer_id}`)
      console.log(`  运行时间: ${runningHours} 小时`)
      console.log(`  进度: ${progressPercent}%`)
      console.log(`  点击: ${clicksCompleted}/${clicksTotal} (预期总计: ${clicksExpected})`)
      console.log(`  计划: 每天 ${task.daily_click_count} 次，持续 ${task.duration_days} 天`)
      console.log(`  开始时间: ${task.started_at}`)
      console.log(`  下次运行: ${task.next_run_at}`)
      console.log(`  最后更新: ${task.updated_at}`)
      console.log()
    }

    // 统计分析
    console.log('\n2️⃣ 统计分析:\n')

    const stats = await sql`
      SELECT
        COUNT(*) as total_count,
        SUM(success_clicks) as total_success_clicks,
        SUM(failed_clicks) as total_failed_clicks,
        AVG(progress) as avg_progress,
        MIN(started_at) as earliest_start,
        MAX(started_at) as latest_start,
        MAX(updated_at) as latest_update
      FROM click_farm_tasks
      WHERE status = 'running'
        AND is_deleted = false
    `

    const stat = stats[0]
    console.log(`总任务数: ${stat.total_count}`)
    console.log(`总成功点击: ${stat.total_success_clicks}`)
    console.log(`总失败点击: ${stat.total_failed_clicks}`)
    console.log(`平均进度: ${Math.round(stat.avg_progress || 0)}%`)
    console.log(`最早开始: ${stat.earliest_start}`)
    console.log(`最晚开始: ${stat.latest_start}`)
    console.log(`最后更新: ${stat.latest_update}`)

    // 分析任务是否已完成
    console.log('\n3️⃣ 任务完成度分析:\n')

    const completionAnalysis = await sql`
      SELECT
        CASE
          WHEN success_clicks >= (daily_click_count * duration_days) THEN 'completed'
          WHEN success_clicks > 0 THEN 'in_progress'
          ELSE 'not_started'
        END as completion_status,
        COUNT(*) as count
      FROM click_farm_tasks
      WHERE status = 'running'
        AND is_deleted = false
      GROUP BY completion_status
    `

    completionAnalysis.forEach(row => {
      console.log(`  ${row.completion_status}: ${row.count} 个任务`)
    })

    // 检查是否应该标记为 completed
    console.log('\n4️⃣ 应该标记为 completed 的任务:\n')

    const shouldBeCompleted = await sql`
      SELECT id, offer_id, success_clicks, daily_click_count, duration_days,
             (daily_click_count * duration_days) as expected_total
      FROM click_farm_tasks
      WHERE status = 'running'
        AND is_deleted = false
        AND success_clicks >= (daily_click_count * duration_days)
      LIMIT 20
    `

    console.log(`找到 ${shouldBeCompleted.length} 个已完成但未标记的任务:`)
    shouldBeCompleted.forEach(task => {
      console.log(`  [${task.id.substring(0, 8)}] offer:${task.offer_id} - 完成 ${task.success_clicks}/${task.expected_total} 次点击`)
    })

    // 建议
    console.log('\n' + '='.repeat(60))
    console.log('💡 建议:\n')

    const totalRunning = stat.total_count
    const completedCount = shouldBeCompleted.length
    const inProgressCount = totalRunning - completedCount

    console.log(`1. 将 ${completedCount} 个已完成的任务标记为 'completed'`)
    console.log(`2. 剩余 ${inProgressCount} 个任务需要判断:`)
    console.log(`   - 如果它们应该继续运行: 重新入队到 Redis`)
    console.log(`   - 如果它们应该停止: 标记为 'stopped' 或 'cancelled'`)
    console.log(`   - 不建议重置为 'pending',因为它们已经有进度数据`)

  } finally {
    await sql.end()
  }
}

main().catch(console.error)
