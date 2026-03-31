/**
 * 重新入队 pending 的 click farm 任务
 *
 * 这个脚本会:
 * 1. 从数据库读取 pending 状态的任务
 * 2. 将它们重新加入 Redis 队列
 * 3. 更新 next_run_at 时间
 */

import postgres from 'postgres'
import Redis from 'ioredis'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
const REDIS_URL = process.env.REDIS_URL || 'redis://default:9xdjb8nf@dbprovider.sg-members-1.clawcloudrun.com:32284'

async function main() {
  console.log('🔧 重新入队 Pending 任务\n')
  console.log('=' .repeat(60))

  const sql = postgres(DATABASE_URL, { max: 2, connect_timeout: 10 })
  const redis = new Redis(REDIS_URL)

  try {
    // 1. 获取所有 pending 的 click farm 任务
    console.log('\n1️⃣ 查询 pending 任务...')
    const pendingTasks = await sql`
      SELECT id, user_id, offer_id, daily_click_count, start_time, end_time,
             duration_days, hourly_distribution, scheduled_start_date, status,
             timezone, next_run_at, created_at
      FROM click_farm_tasks
      WHERE status = 'pending'
        AND is_deleted = false
      ORDER BY created_at
    `

    console.log(`   找到 ${pendingTasks.length} 个 pending 任务`)

    if (pendingTasks.length === 0) {
      console.log('\n✅ 没有需要重新入队的任务')
      return
    }

    // 2. 显示任务列表
    console.log('\n2️⃣ 任务列表:')
    pendingTasks.forEach((task, index) => {
      const age = Math.round((Date.now() - new Date(task.created_at).getTime()) / 1000 / 60)
      console.log(`   ${index + 1}. [${task.id.substring(0, 8)}] offer:${task.offer_id} - 创建 ${age}分钟前`)
    })

    // 3. 确认操作
    console.log('\n⚠️  这个操作会:')
    console.log('   - 将这些任务加入 Redis 后台队列')
    console.log('   - 更新 next_run_at 为当前时间 (立即执行)')
    console.log('   - 需要确保 background-worker 正在运行')

    // 在生产环境中,你可能想添加一个确认步骤
    // 这里我们直接执行,但建议先 dry-run

    const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
    if (dryRun) {
      console.log('\n🔍 DRY RUN 模式 - 不会实际修改数据')
    }

    // 4. 重新入队
    console.log('\n3️⃣ 开始重新入队...')
    const bgPrefix = process.env.QUEUE_BACKGROUND_REDIS_KEY_PREFIX || 'queue:background:'
    let successCount = 0
    let failCount = 0

    for (const task of pendingTasks) {
      try {
        // 构造任务对象 (根据你的队列格式)
        const queueTask = {
          id: task.id,
          type: 'click-farm',
          userId: task.user_id,
          priority: 'normal',
          data: {
            taskId: task.id,
            offerId: task.offer_id,
            dailyClickCount: task.daily_click_count,
            startTime: task.start_time,
            endTime: task.end_time,
            durationDays: task.duration_days,
            hourlyDistribution: task.hourly_distribution,
            scheduledStartDate: task.scheduled_start_date,
            timezone: task.timezone,
          },
          createdAt: new Date().toISOString(),
          retries: 0,
          maxRetries: 3,
        }

        if (!dryRun) {
          // 加入 Redis 队列 (使用当前时间作为 score,立即执行)
          const score = Date.now()
          await redis.zadd(`${bgPrefix}pending`, score, JSON.stringify(queueTask))

          // 更新数据库中的 next_run_at
          await sql`
            UPDATE click_farm_tasks
            SET next_run_at = NOW()
            WHERE id = ${task.id}
          `
        }

        console.log(`   ✅ [${task.id.substring(0, 8)}] 已入队`)
        successCount++
      } catch (error) {
        console.error(`   ❌ [${task.id.substring(0, 8)}] 失败:`, error.message)
        failCount++
      }
    }

    // 5. 总结
    console.log('\n' + '='.repeat(60))
    console.log('📊 操作完成:\n')
    console.log(`   成功: ${successCount}`)
    console.log(`   失败: ${failCount}`)

    if (!dryRun && successCount > 0) {
      console.log('\n✅ 任务已重新入队')
      console.log('   请确保 background-worker 正在运行:')
      console.log('   - 检查: ps aux | grep background-worker')
      console.log('   - 或: pm2 list')
      console.log('   - 或: supervisorctl status')
    }

    if (dryRun) {
      console.log('\n💡 要实际执行,请运行:')
      console.log('   DRY_RUN=0 node scripts/requeue-pending-tasks.mjs')
    }

  } finally {
    await sql.end()
    await redis.quit()
  }
}

main().catch(console.error)
