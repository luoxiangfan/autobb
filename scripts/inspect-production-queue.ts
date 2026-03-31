#!/usr/bin/env tsx
/**
 * 队列诊断工具（Redis + PostgreSQL）
 *
 * 用途：
 * 1) 查看 Redis 中的 pending/running/completed/failed 分布
 * 2) 查看 PostgreSQL 中的未完成任务
 *
 * 使用方法：
 *   DATABASE_URL='postgresql://<user>:<password>@<host>:<port>/<db>' \
 *   REDIS_URL='redis://<user>:<password>@<host>:<port>' \
 *   tsx scripts/inspect-production-queue.ts
 */

import postgres from 'postgres'
import Redis from 'ioredis'

const DATABASE_URL = process.env.DATABASE_URL
const REDIS_URL = process.env.REDIS_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 环境变量未设置')
  process.exit(1)
}

if (!REDIS_URL) {
  console.error('❌ REDIS_URL 环境变量未设置')
  process.exit(1)
}

async function main() {
  console.log('========================================')
  console.log('🔍 队列诊断工具')
  console.log('========================================\n')

  // 1) 检查 Redis
  console.log('📦 连接到 Redis...')
  const redis = new Redis(REDIS_URL)

  try {
    const redisKeyPrefix =
      process.env.QUEUE_PREFIX ||
      `autoads:${process.env.NODE_ENV || 'production'}:queue:`

    console.log('\n🔍 扫描 Redis 队列任务...\n')

    const allKeys = await redis.keys(`${redisKeyPrefix}*`)
    console.log(`  📋 Redis Keys 总数: ${allKeys.length}`)

    const pendingAllCount = await redis.zcard(`${redisKeyPrefix}pending:all`)
    console.log(`  📋 Pending All 任务数: ${pendingAllCount}`)

    const runningTasks = await redis.smembers(`${redisKeyPrefix}running`)
    console.log(`  🔄 Running 任务数: ${runningTasks.length}`)

    if (runningTasks.length > 0) {
      console.log(`  Running Task IDs:`)
      for (const taskId of runningTasks) {
        const taskData = await redis.hget(`${redisKeyPrefix}tasks`, taskId)
        if (taskData) {
          const task = JSON.parse(taskData)
          console.log(`    - ${taskId}: type=${task.type}, user=${task.userId}, status=${task.status}`)
        } else {
          console.log(`    - ${taskId}: [Task data not found]`)
        }
      }
    }

    const completedCount = await redis.scard(`${redisKeyPrefix}completed`)
    console.log(`  ✅ Completed 任务数: ${completedCount}`)

    const failedCount = await redis.scard(`${redisKeyPrefix}failed`)
    console.log(`  ❌ Failed 任务数: ${failedCount}`)

    // 🔥 额外诊断：tasks hash 中的 pending 任务是否真的在 pending 索引中
    const taskIds = await redis.hkeys(`${redisKeyPrefix}tasks`)
    let orphanPending = 0
    for (let i = 0; i < taskIds.length; i += 200) {
      const chunk = taskIds.slice(i, i + 200)
      const values = await redis.hmget(`${redisKeyPrefix}tasks`, ...chunk)
      for (let j = 0; j < values.length; j++) {
        const value = values[j]
        if (!value) continue
        try {
          const task = JSON.parse(value)
          if (task.status !== 'pending') continue
          const inAll = await redis.zscore(`${redisKeyPrefix}pending:all`, task.id)
          if (inAll === null) orphanPending++
        } catch {
          // ignore
        }
      }
    }
    if (orphanPending > 0) {
      console.log(`  ⚠️  发现孤儿 pending 任务（不在 pending:all 中）: ${orphanPending}`)
      console.log('     可运行: tsx scripts/repair-redis-pending-index.ts --apply')
    }

  } catch (error) {
    console.error('❌ Redis 检查失败:', error)
  } finally {
    await redis.quit()
  }

  // 2) 检查 PostgreSQL
  console.log('\n📦 连接到 PostgreSQL...')
  const sql = postgres(DATABASE_URL)

  try {
    const offerStats = await sql`
      SELECT status, COUNT(*) as count
      FROM offer_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    console.log('\n📊 offer_tasks 任务统计:')
    for (const row of offerStats) {
      console.log(`  ${row.status}: ${row.count}`)
    }

    const batchStats = await sql`
      SELECT status, COUNT(*) as count
      FROM batch_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    console.log('\n📊 batch_tasks 任务统计:')
    for (const row of batchStats) {
      console.log(`  ${row.status}: ${row.count}`)
    }

  } catch (error) {
    console.error('❌ PostgreSQL 查询失败:', error)
  } finally {
    await sql.end()
  }
}

main().catch(console.error)
