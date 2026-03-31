#!/usr/bin/env tsx
/**
 * 清空Redis队列中的未完成任务
 *
 * 用法：
 * npx tsx scripts/clear-redis-queue.ts
 */

import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const KEY_PREFIX = 'queue:'

async function clearRedisQueue() {
  console.log('🔄 连接到Redis...')
  const redis = new Redis(REDIS_URL)

  try {
    console.log('✅ Redis连接成功')
    console.log('')

    // 1. 获取统计信息（清理前）
    console.log('📊 清理前统计：')
    const beforeStats = {
      pending: await redis.zcard(`${KEY_PREFIX}pending:all`),
      running: await redis.scard(`${KEY_PREFIX}running`),
      completed: await redis.scard(`${KEY_PREFIX}completed`),
      failed: await redis.scard(`${KEY_PREFIX}failed`),
    }
    console.log(`  Pending: ${beforeStats.pending}`)
    console.log(`  Running: ${beforeStats.running}`)
    console.log(`  Completed: ${beforeStats.completed}`)
    console.log(`  Failed: ${beforeStats.failed}`)
    console.log('')

    // 2. 获取所有pending任务ID
    console.log('📋 获取pending任务ID...')
    const pendingTaskIds = await redis.zrange(`${KEY_PREFIX}pending:all`, 0, -1)
    console.log(`  找到 ${pendingTaskIds.length} 个pending任务`)

    // 3. 获取所有running任务ID
    console.log('📋 获取running任务ID...')
    const runningTaskIds = await redis.smembers(`${KEY_PREFIX}running`)
    console.log(`  找到 ${runningTaskIds.length} 个running任务`)

    // 4. 删除所有pending队列
    console.log('')
    console.log('🗑️  删除pending队列...')
    const pendingKeys = [
      `${KEY_PREFIX}pending:all`,
      `${KEY_PREFIX}pending:offer-extraction`,
      `${KEY_PREFIX}pending:batch-offer-creation`,
      `${KEY_PREFIX}pending:scrape`,
      `${KEY_PREFIX}pending:sync`,
      `${KEY_PREFIX}pending:ai-analysis`,
      `${KEY_PREFIX}pending:backup`,
      `${KEY_PREFIX}pending:export`,
      `${KEY_PREFIX}pending:email`,
      `${KEY_PREFIX}pending:link-check`,
      `${KEY_PREFIX}pending:cleanup`,
    ]
    const deletedPending = await redis.del(...pendingKeys)
    console.log(`  删除了 ${deletedPending} 个pending队列key`)

    // 5. 删除running集合
    console.log('🗑️  删除running集合...')
    const deletedRunning = await redis.del(`${KEY_PREFIX}running`)
    console.log(`  删除了 ${deletedRunning} 个running集合key`)

    // 6. 删除所有用户pending队列
    console.log('🗑️  删除用户pending队列...')
    const userKeys = await redis.keys(`${KEY_PREFIX}user:*:pending`)
    if (userKeys.length > 0) {
      const deletedUserKeys = await redis.del(...userKeys)
      console.log(`  删除了 ${deletedUserKeys} 个用户pending队列`)
    } else {
      console.log('  没有用户pending队列需要删除')
    }

    // 7. 从tasks hash中删除所有pending和running任务
    console.log('🗑️  删除任务详情...')
    const allTaskIds = [...pendingTaskIds, ...runningTaskIds]
    let deletedTasks = 0
    if (allTaskIds.length > 0) {
      const pipeline = redis.pipeline()
      for (const taskId of allTaskIds) {
        pipeline.hdel(`${KEY_PREFIX}tasks`, taskId)
      }
      const results = await pipeline.exec()
      deletedTasks = results?.filter(([err, result]) => !err && result === 1).length || 0
      console.log(`  删除了 ${deletedTasks} 个任务详情`)
    } else {
      console.log('  没有任务详情需要删除')
    }

    // 8. 可选：清理completed和failed任务
    const clearHistory = process.argv.includes('--clear-history')
    if (clearHistory) {
      console.log('')
      console.log('🗑️  清理历史任务（completed & failed）...')

      const completedTaskIds = await redis.smembers(`${KEY_PREFIX}completed`)
      const failedTaskIds = await redis.smembers(`${KEY_PREFIX}failed`)

      // 删除completed和failed集合
      await redis.del(`${KEY_PREFIX}completed`)
      await redis.del(`${KEY_PREFIX}failed`)

      // 从tasks hash中删除
      const historyTaskIds = [...completedTaskIds, ...failedTaskIds]
      if (historyTaskIds.length > 0) {
        const pipeline = redis.pipeline()
        for (const taskId of historyTaskIds) {
          pipeline.hdel(`${KEY_PREFIX}tasks`, taskId)
        }
        await pipeline.exec()
        console.log(`  删除了 ${historyTaskIds.length} 个历史任务`)
      }
    }

    // 9. 获取统计信息（清理后）
    console.log('')
    console.log('📊 清理后统计：')
    const afterStats = {
      pending: await redis.zcard(`${KEY_PREFIX}pending:all`),
      running: await redis.scard(`${KEY_PREFIX}running`),
      completed: await redis.scard(`${KEY_PREFIX}completed`),
      failed: await redis.scard(`${KEY_PREFIX}failed`),
      totalTasks: await redis.hlen(`${KEY_PREFIX}tasks`),
    }
    console.log(`  Pending: ${afterStats.pending}`)
    console.log(`  Running: ${afterStats.running}`)
    console.log(`  Completed: ${afterStats.completed}`)
    console.log(`  Failed: ${afterStats.failed}`)
    console.log(`  Total tasks in hash: ${afterStats.totalTasks}`)

    console.log('')
    console.log('✅ Redis队列清理完成！')

  } catch (error: any) {
    console.error('❌ 清理失败:', error.message)
    throw error
  } finally {
    await redis.quit()
  }
}

// 执行清理
clearRedisQueue().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
