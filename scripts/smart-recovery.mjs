/**
 * 智能恢复队列任务
 *
 * 策略:
 * 1. 已完成目标的任务 -> 标记为 completed
 * 2. 进行中的任务 -> 重新入队到 Redis (保持 running 状态)
 * 3. Pending 任务 -> 重新入队到 Redis
 */

import postgres from 'postgres'
import Redis from 'ioredis'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
const REDIS_URL = process.env.REDIS_URL || 'redis://default:9xdjb8nf@dbprovider.sg-members-1.clawcloudrun.com:32284'

async function main() {
  console.log('🔧 智能恢复队列任务\n')
  console.log('=' .repeat(60))

  const sql = postgres(DATABASE_URL, { max: 2, connect_timeout: 10 })
  const redis = new Redis(REDIS_URL)
  const dryRun = process.env.DRY_RUN !== '0' && process.env.DRY_RUN !== 'false'

  if (dryRun) {
    console.log('\n🔍 DRY RUN 模式 - 不会实际修改数据\n')
  }

  try {
    // 1. 处理已完成的任务
    console.log('1️⃣ 处理已完成的任务...\n')

    const completedTasks = await sql`
      SELECT id, offer_id, success_clicks, daily_click_count, duration_days
      FROM click_farm_tasks
      WHERE status = 'running'
        AND is_deleted = false
        AND duration_days > 0
        AND success_clicks >= (daily_click_count * duration_days)
    `

    console.log(`   找到 ${completedTasks.length} 个已完成目标的任务`)

    if (completedTasks.length > 0) {
      for (const task of completedTasks) {
        if (!dryRun) {
          await sql`
            UPDATE click_farm_tasks
            SET status = 'completed',
                completed_at = NOW(),
                progress = 100
            WHERE id = ${task.id}
          `
        }
        console.log(`   ✅ [${task.id.substring(0, 8)}] offer:${task.offer_id} - 标记为 completed`)
      }
    }

    // 2. 处理进行中的 running 任务
    console.log('\n2️⃣ 重新入队 running 任务...\n')

    const runningTasks = await sql`
      SELECT id, user_id, offer_id, daily_click_count, start_time, end_time,
             duration_days, hourly_distribution, scheduled_start_date, status,
             timezone, next_run_at, success_clicks, failed_clicks, total_clicks,
             progress, started_at
      FROM click_farm_tasks
      WHERE status = 'running'
        AND is_deleted = false
        AND (duration_days < 0 OR success_clicks < (daily_click_count * duration_days))
      ORDER BY next_run_at ASC NULLS LAST
    `

    console.log(`   找到 ${runningTasks.length} 个需要继续运行的任务`)

    const bgPrefix = process.env.QUEUE_BACKGROUND_REDIS_KEY_PREFIX || 'queue:background:'
    let requeuedCount = 0

    for (const task of runningTasks) {
      try {
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
            // 保留进度信息
            resumeFrom: {
              successClicks: task.success_clicks,
              failedClicks: task.failed_clicks,
              totalClicks: task.total_clicks,
              progress: task.progress,
            }
          },
          createdAt: new Date().toISOString(),
          retries: 0,
          maxRetries: 3,
        }

        if (!dryRun) {
          // 使用 next_run_at 作为 score，如果没有则使用当前时间
          const score = task.next_run_at
            ? new Date(task.next_run_at).getTime()
            : Date.now()

          await redis.zadd(`${bgPrefix}pending`, score, JSON.stringify(queueTask))
        }

        const nextRun = task.next_run_at
          ? new Date(task.next_run_at).toISOString()
          : '立即'
        console.log(`   ✅ [${task.id.substring(0, 8)}] offer:${task.offer_id} - 已入队 (下次: ${nextRun}, 进度: ${task.success_clicks}/${task.total_clicks})`)
        requeuedCount++
      } catch (error) {
        console.error(`   ❌ [${task.id.substring(0, 8)}] 失败:`, error.message)
      }
    }

    // 3. 处理 pending 任务
    console.log('\n3️⃣ 重新入队 pending 任务...\n')

    const pendingTasks = await sql`
      SELECT id, user_id, offer_id, daily_click_count, start_time, end_time,
             duration_days, hourly_distribution, scheduled_start_date, status,
             timezone, next_run_at
      FROM click_farm_tasks
      WHERE status = 'pending'
        AND is_deleted = false
      ORDER BY next_run_at ASC NULLS LAST
    `

    console.log(`   找到 ${pendingTasks.length} 个 pending 任务`)

    let pendingRequeuedCount = 0

    for (const task of pendingTasks) {
      try {
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
          const score = task.next_run_at
            ? new Date(task.next_run_at).getTime()
            : Date.now()

          await redis.zadd(`${bgPrefix}pending`, score, JSON.stringify(queueTask))
        }

        const nextRun = task.next_run_at
          ? new Date(task.next_run_at).toISOString()
          : '立即'
        console.log(`   ✅ [${task.id.substring(0, 8)}] offer:${task.offer_id} - 已入队 (下次: ${nextRun})`)
        pendingRequeuedCount++
      } catch (error) {
        console.error(`   ❌ [${task.id.substring(0, 8)}] 失败:`, error.message)
      }
    }

    // 4. 总结
    console.log('\n' + '='.repeat(60))
    console.log('📊 操作完成:\n')
    console.log(`   已完成任务: ${completedTasks.length} 个 -> 标记为 completed`)
    console.log(`   Running 任务: ${requeuedCount} 个 -> 重新入队`)
    console.log(`   Pending 任务: ${pendingRequeuedCount} 个 -> 重新入队`)
    console.log(`   总计入队: ${requeuedCount + pendingRequeuedCount} 个任务`)

    if (!dryRun) {
      console.log('\n✅ 任务已恢复到 Redis 队列')
      console.log('   下一步: 确保 background-worker 正在运行')
      console.log('   检查: REDIS_URL="..." node scripts/check-redis-queue.mjs')
    } else {
      console.log('\n💡 要实际执行,请运行:')
      console.log('   DRY_RUN=0 DATABASE_URL="..." REDIS_URL="..." node scripts/smart-recovery.mjs')
    }

    // 5. 最终状态检查
    if (!dryRun) {
      console.log('\n5️⃣ 验证 Redis 队列状态...\n')
      const finalPending = await redis.zcard(`${bgPrefix}pending`)
      console.log(`   Redis 后台队列 pending: ${finalPending} 个任务`)
    }

  } finally {
    await sql.end()
    await redis.quit()
  }
}

main().catch(console.error)
