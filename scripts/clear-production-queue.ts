#!/usr/bin/env tsx
/**
 * 清理生产环境队列任务
 *
 * 用途：
 * 1. 清空Redis中的所有未完成任务（pending + running）
 * 2. 清空PostgreSQL数据库中的未完成任务
 *
 * 使用方法：
 * DATABASE_URL=postgresql://... REDIS_URL=redis://... tsx scripts/clear-production-queue.ts
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
  console.log('🧹 生产环境队列清理工具')
  console.log('========================================\n')

  // 1. 清理 Redis
  console.log('📦 连接到 Redis...')
  const redis = new Redis(REDIS_URL)

  try {
    const redisKeyPrefix = 'queue:'
    let totalCleared = 0

    console.log('🔍 扫描 Redis 队列任务...\n')

    // 获取所有 pending 任务
    const pendingTaskIds = await redis.zrange(`${redisKeyPrefix}pending:all`, 0, -1)
    console.log(`  📋 Pending 任务: ${pendingTaskIds.length} 个`)

    // 获取所有 running 任务
    const runningTaskIds = await redis.smembers(`${redisKeyPrefix}running`)
    console.log(`  🔄 Running 任务: ${runningTaskIds.length} 个`)

    const allTaskIds = [...pendingTaskIds, ...runningTaskIds]

    // 删除所有队列和集合
    const pipeline = redis.pipeline()

    // 删除所有 pending 队列
    const taskTypes = [
      'scrape',
      'offer-extraction',
      'batch-offer-creation',
      'offer-creation',
      'offer-scrape',
      'offer-enhance',
      'sync',
      'ai-analysis',
      'backup',
      'export',
      'email',
      'link-check',
      'cleanup'
    ]

    for (const taskType of taskTypes) {
      pipeline.del(`${redisKeyPrefix}pending:${taskType}`)
    }
    pipeline.del(`${redisKeyPrefix}pending:all`)

    // 删除 running 集合
    pipeline.del(`${redisKeyPrefix}running`)

    // 删除 completed 和 failed 集合
    pipeline.del(`${redisKeyPrefix}completed`)
    pipeline.del(`${redisKeyPrefix}failed`)

    // 删除所有用户 pending 队列
    const userKeys = await redis.keys(`${redisKeyPrefix}user:*:pending`)
    if (userKeys.length > 0) {
      pipeline.del(...userKeys)
    }

    // 删除整个 tasks hash（清空所有任务）
    pipeline.del(`${redisKeyPrefix}tasks`)

    await pipeline.exec()
    totalCleared = allTaskIds.length

    if (allTaskIds.length > 0) {
      console.log(`\n✅ Redis 清理完成: 删除 ${totalCleared} 个未完成任务`)
    } else {
      console.log('\n✅ Redis 队列已清空（包括历史completed/failed任务）')
    }
  } catch (error) {
    console.error('❌ Redis 清理失败:', error)
  } finally {
    await redis.quit()
  }

  // 2. 清理 PostgreSQL
  console.log('\n📦 连接到 PostgreSQL...')
  const sql = postgres(DATABASE_URL)

  try {
    // 检查 offer_tasks 表是否存在
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'offer_tasks'
      )
    `

    if (tableExists[0].exists) {
      console.log('🔍 检查数据库未完成任务...\n')

      // 统计未完成任务
      const stats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
          COUNT(*) FILTER (WHERE status = 'running') as running_count,
          COUNT(*) as total_count
        FROM offer_tasks
        WHERE status IN ('pending', 'running')
      `

      const { pending_count, running_count, total_count } = stats[0]
      console.log(`  📋 Pending 任务: ${pending_count}`)
      console.log(`  🔄 Running 任务: ${running_count}`)
      console.log(`  📊 总计: ${total_count}`)

      if (parseInt(total_count) > 0) {
        // 删除未完成任务
        const result = await sql`
          DELETE FROM offer_tasks
          WHERE status IN ('pending', 'running')
        `

        console.log(`\n✅ PostgreSQL 清理完成: 删除 ${result.count} 个未完成任务`)
      } else {
        console.log('\n✅ PostgreSQL 无未完成任务')
      }
    } else {
      console.log('⚠️  offer_tasks 表不存在（数据库可能未初始化）')
    }
  } catch (error) {
    console.error('❌ PostgreSQL 清理失败:', error)
  } finally {
    await sql.end()
  }

  console.log('\n========================================')
  console.log('✅ 清理完成')
  console.log('========================================')
}

main().catch(console.error)
