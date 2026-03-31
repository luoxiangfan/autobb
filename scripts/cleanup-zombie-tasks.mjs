/**
 * 清理僵尸 running 任务
 *
 * 这个脚本会:
 * 1. 找出长时间处于 running 状态但 Redis 中没有数据的任务
 * 2. 将它们重置为 pending 状态
 * 3. 清理相关的运行时数据
 */

import postgres from 'postgres'
import Redis from 'ioredis'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
const REDIS_URL = process.env.REDIS_URL || 'redis://default:9xdjb8nf@dbprovider.sg-members-1.clawcloudrun.com:32284'

async function main() {
  console.log('🧹 清理僵尸 Running 任务\n')
  console.log('=' .repeat(60))

  const sql = postgres(DATABASE_URL, { max: 2, connect_timeout: 10 })
  const redis = new Redis(REDIS_URL)

  try {
    // 1. 获取所有 running 任务
    console.log('\n1️⃣ 查询 running 任务...')
    const runningTasks = await sql`
      SELECT id, user_id, offer_id, status, started_at, progress,
             total_clicks, success_clicks, failed_clicks
      FROM click_farm_tasks
      WHERE status = 'running'
        AND is_deleted = false
      ORDER BY started_at
    `

    console.log(`   找到 ${runningTasks.length} 个 running 任务`)

    if (runningTasks.length === 0) {
      console.log('\n✅ 没有 running 任务')
      return
    }

    // 2. 检查 Redis 中是否有对应的任务
    console.log('\n2️⃣ 检查 Redis 队列状态...')
    const bgPrefix = process.env.QUEUE_BACKGROUND_REDIS_KEY_PREFIX || 'queue:background:'
    const redisRunning = await redis.zcard(`${bgPrefix}running`)
    console.log(`   Redis running 队列: ${redisRunning} 个任务`)

    // 3. 分析任务
    console.log('\n3️⃣ 分析任务状态:')
    const zombieTasks = []
    const recentTasks = []

    for (const task of runningTasks) {
      const runningMinutes = task.started_at
        ? Math.round((Date.now() - new Date(task.started_at).getTime()) / 1000 / 60)
        : 0

      // 运行超过 2 小时的任务很可能是僵尸任务
      if (runningMinutes > 120) {
        zombieTasks.push({ ...task, runningMinutes })
      } else {
        recentTasks.push({ ...task, runningMinutes })
      }
    }

    console.log(`   僵尸任务 (运行 >2小时): ${zombieTasks.length}`)
    console.log(`   最近任务 (运行 ≤2小时): ${recentTasks.length}`)

    if (zombieTasks.length > 0) {
      console.log('\n   僵尸任务列表:')
      zombieTasks.forEach((task, index) => {
        const hours = Math.round(task.runningMinutes / 60)
        console.log(`   ${index + 1}. [${task.id.substring(0, 8)}] offer:${task.offer_id} - 运行 ${hours}小时 (进度:${task.progress}%, 成功:${task.success_clicks})`)
      })
    }

    if (recentTasks.length > 0) {
      console.log('\n   最近任务 (可能正常):')
      recentTasks.slice(0, 5).forEach((task, index) => {
        console.log(`   ${index + 1}. [${task.id.substring(0, 8)}] offer:${task.offer_id} - 运行 ${task.runningMinutes}分钟 (进度:${task.progress}%, 成功:${task.success_clicks})`)
      })
      if (recentTasks.length > 5) {
        console.log(`   ... 还有 ${recentTasks.length - 5} 个`)
      }
    }

    // 4. 决定清理策略
    const dryRun = process.env.DRY_RUN !== '0' && process.env.DRY_RUN !== 'false'
    if (dryRun) {
      console.log('\n🔍 DRY RUN 模式 - 不会实际修改数据')
    }

    if (zombieTasks.length === 0) {
      console.log('\n✅ 没有需要清理的僵尸任务')
      return
    }

    console.log('\n⚠️  清理操作:')
    console.log('   - 将僵尸任务状态重置为 pending')
    console.log('   - 清除 started_at 时间')
    console.log('   - 保留已完成的点击数据')

    // 5. 执行清理
    console.log('\n4️⃣ 开始清理...')
    let successCount = 0
    let failCount = 0

    for (const task of zombieTasks) {
      try {
        if (!dryRun) {
          await sql`
            UPDATE click_farm_tasks
            SET status = 'pending',
                started_at = NULL,
                next_run_at = NOW()
            WHERE id = ${task.id}
          `
        }

        console.log(`   ✅ [${task.id.substring(0, 8)}] 已重置为 pending`)
        successCount++
      } catch (error) {
        console.error(`   ❌ [${task.id.substring(0, 8)}] 失败:`, error.message)
        failCount++
      }
    }

    // 6. 总结
    console.log('\n' + '='.repeat(60))
    console.log('📊 清理完成:\n')
    console.log(`   成功: ${successCount}`)
    console.log(`   失败: ${failCount}`)

    if (!dryRun && successCount > 0) {
      console.log('\n✅ 僵尸任务已重置为 pending')
      console.log('   下一步:')
      console.log('   1. 运行 requeue-pending-tasks.mjs 将它们重新入队')
      console.log('   2. 确保 background-worker 正在运行')
    }

    if (dryRun) {
      console.log('\n💡 要实际执行,请运行:')
      console.log('   DRY_RUN=0 node scripts/cleanup-zombie-tasks.mjs')
    }

    // 7. 关于最近任务的建议
    if (recentTasks.length > 0 && redisRunning === 0) {
      console.log('\n⚠️  注意:')
      console.log(`   有 ${recentTasks.length} 个最近的 running 任务`)
      console.log('   但 Redis running 队列为空')
      console.log('   这些任务可能也需要重置,但建议先观察一段时间')
      console.log('   如果它们在 30 分钟内没有进展,也应该清理')
    }

  } finally {
    await sql.end()
    await redis.quit()
  }
}

main().catch(console.error)
