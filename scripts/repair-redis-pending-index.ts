#!/usr/bin/env tsx
/**
 * 修复 Redis 队列的 pending 索引（pending:all / pending:type / user:*:pending）
 *
 * 解决场景：
 * - tasks hash 中存在 status='pending' 的任务，但不在任何 pending zset 中
 * - worker 只能从 pending:all dequeue，导致任务永远无法执行
 *
 * 使用：
 *   REDIS_URL='redis://...' tsx scripts/repair-redis-pending-index.ts --apply
 *
 * 可选：
 *   QUEUE_PREFIX='autoads:production:queue:'   # 指定前缀（默认依次尝试常见前缀）
 *   --dry-run                                 # 只统计，不写入（默认）
 */

import Redis from 'ioredis'

type QueueTask = {
  id: string
  type: string
  userId: number
  priority: 'high' | 'normal' | 'low'
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: number
}

function getPriorityScore(task: QueueTask): number {
  const priorityBase = { high: 0, normal: 1000, low: 2000 } as const
  return priorityBase[task.priority] + (task.createdAt % 1000)
}

async function repairPrefix(redis: Redis, prefix: string, apply: boolean) {
  const tasksKey = `${prefix}tasks`

  const exists = await redis.exists(tasksKey)
  if (!exists) {
    return { prefix, exists: false, scanned: 0, pendingFound: 0, repaired: 0 }
  }

  let cursor = '0'
  let scanned = 0
  let pendingFound = 0
  let repaired = 0

  do {
    const [nextCursor, entries] = await redis.hscan(tasksKey, cursor, 'COUNT', 500)
    cursor = nextCursor

    if (!entries || entries.length === 0) continue

    const pipeline = redis.pipeline()
    let ops = 0

    for (let i = 0; i < entries.length; i += 2) {
      const value = entries[i + 1]
      scanned++

      let task: QueueTask
      try {
        task = JSON.parse(value) as QueueTask
      } catch {
        continue
      }

      if (task.status !== 'pending') continue
      if (!task.userId || task.userId <= 0) continue

      pendingFound++
      const score = getPriorityScore(task)

      // 直接 zadd（幂等）；无需先 zscore 检查
      pipeline.zadd(`${prefix}pending:all`, score, task.id)
      pipeline.zadd(`${prefix}pending:${task.type}`, score, task.id)
      pipeline.zadd(`${prefix}user:${task.userId}:pending`, score, task.id)
      ops += 3
      repaired++
    }

    if (apply && ops > 0) {
      await pipeline.exec()
    }
  } while (cursor !== '0')

  return { prefix, exists: true, scanned, pendingFound, repaired }
}

async function main() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('❌ REDIS_URL 环境变量未设置')
    process.exit(1)
  }

  const apply = process.argv.includes('--apply')
  const dryRun = process.argv.includes('--dry-run') || !apply

  const prefixes = process.env.QUEUE_PREFIX
    ? [process.env.QUEUE_PREFIX]
    : [
        `autoads:${process.env.NODE_ENV || 'production'}:queue:`,
        'autoads:production:queue:',
        'autoads:queue:',
        'autoads:development:queue:',
      ]

  console.log('========================================')
  console.log('🧩 Redis pending 索引修复')
  console.log('========================================')
  console.log(`mode: ${dryRun ? 'dry-run' : 'apply'}`)
  console.log(`prefixes: ${prefixes.join(', ')}`)
  console.log('')

  const redis = new Redis(redisUrl)
  try {
    for (const prefix of prefixes) {
      const result = await repairPrefix(redis, prefix, !dryRun)
      if (!result.exists) {
        console.log(`[${prefix}] tasks key 不存在，跳过`)
        continue
      }
      console.log(
        `[${prefix}] scanned=${result.scanned}, pendingFound=${result.pendingFound}, repaired=${result.repaired}`
      )
    }
  } finally {
    await redis.quit()
  }

  console.log('\n✅ 完成')
  if (dryRun) {
    console.log('如需写入修复，请加参数: --apply')
  }
}

main().catch((err) => {
  console.error('❌ 修复失败:', err)
  process.exit(1)
})

