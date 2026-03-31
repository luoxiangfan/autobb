/**
 * 检查 Redis 队列状态
 * 需要设置 REDIS_URL 环境变量
 */

import Redis from 'ioredis'

async function main() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('❌ 请设置 REDIS_URL 环境变量')
    console.error('   例如: REDIS_URL=redis://... node scripts/check-redis-queue.mjs')
    process.exit(1)
  }

  console.log('🔍 连接 Redis...\n')

  const redis = new Redis(redisUrl)

  try {
    // 1. 检查主队列
    console.log('1️⃣ 主队列状态:')
    const mainPrefix = process.env.REDIS_KEY_PREFIX || 'queue:'
    const mainPending = await redis.zcard(`${mainPrefix}pending`)
    const mainRunning = await redis.zcard(`${mainPrefix}running`)
    console.log(`  Prefix: ${mainPrefix}`)
    console.log(`  Pending: ${mainPending}`)
    console.log(`  Running: ${mainRunning}`)

    if (mainPending > 0) {
      console.log('\n  前 10 个 pending 任务:')
      const tasks = await redis.zrange(`${mainPrefix}pending`, 0, 9, 'WITHSCORES')
      for (let i = 0; i < tasks.length; i += 2) {
        const value = tasks[i]
        const score = tasks[i + 1]
        const scoreDate = new Date(parseFloat(score)).toISOString()
        console.log(`    ${value.substring(0, 50)}... (score: ${scoreDate})`)
      }
    }

    // 2. 检查后台队列
    console.log('\n2️⃣ 后台队列状态:')
    const bgPrefix = process.env.QUEUE_BACKGROUND_REDIS_KEY_PREFIX || 'queue:background:'
    const bgPending = await redis.zcard(`${bgPrefix}pending`)
    const bgRunning = await redis.zcard(`${bgPrefix}running`)
    console.log(`  Prefix: ${bgPrefix}`)
    console.log(`  Pending: ${bgPending}`)
    console.log(`  Running: ${bgRunning}`)

    if (bgPending > 0) {
      console.log('\n  前 10 个 pending 任务:')
      const tasks = await redis.zrange(`${bgPrefix}pending`, 0, 9, 'WITHSCORES')
      for (let i = 0; i < tasks.length; i += 2) {
        const value = tasks[i]
        const score = tasks[i + 1]
        const scoreDate = new Date(parseFloat(score)).toISOString()
        try {
          const taskData = JSON.parse(value)
          console.log(`    [${taskData.id?.substring(0, 8)}] ${taskData.type} - score: ${scoreDate}`)
        } catch {
          console.log(`    ${value.substring(0, 50)}... - score: ${scoreDate}`)
        }
      }
    }

    // 3. 检查 background worker 心跳
    console.log('\n3️⃣ Background Worker 心跳:')
    const heartbeatKey = process.env.QUEUE_BACKGROUND_WORKER_HEARTBEAT_KEY || 'queue:background:worker:heartbeat'
    const heartbeat = await redis.get(heartbeatKey)
    if (heartbeat) {
      const data = JSON.parse(heartbeat)
      console.log(`  ✅ Worker 在线`)
      console.log(`     Instance: ${data.instanceId || 'N/A'}`)
      console.log(`     PID: ${data.pid || 'N/A'}`)
      console.log(`     Env: ${data.env || 'N/A'}`)
      console.log(`     Last heartbeat: ${data.ts || 'N/A'}`)

      const lastHeartbeat = new Date(data.ts)
      const ageMinutes = Math.round((Date.now() - lastHeartbeat.getTime()) / 1000 / 60)
      console.log(`     Age: ${ageMinutes} 分钟前`)

      if (ageMinutes > 5) {
        console.log(`  ⚠️ 心跳过期! Worker 可能已停止`)
      }
    } else {
      console.log(`  ❌ 未找到 worker 心跳 - worker 可能未运行`)
    }

    // 4. 检查所有 queue: 开头的 key
    console.log('\n4️⃣ 所有队列相关的 Redis keys:')
    const keys = await redis.keys('queue:*')
    console.log(`  找到 ${keys.length} 个 keys:`)
    for (const key of keys.slice(0, 20)) {
      const type = await redis.type(key)
      let info = ''
      if (type === 'zset') {
        const count = await redis.zcard(key)
        info = `(zset, ${count} items)`
      } else if (type === 'string') {
        info = '(string)'
      } else if (type === 'hash') {
        const count = await redis.hlen(key)
        info = `(hash, ${count} fields)`
      }
      console.log(`    ${key} ${info}`)
    }

    // 5. 诊断结论
    console.log('\n' + '='.repeat(60))
    console.log('📊 诊断结论:\n')

    if (!heartbeat) {
      console.log('❌ 严重问题: Background worker 心跳不存在')
      console.log('   Worker 进程可能未运行或未正确配置')
      console.log('\n💡 建议:')
      console.log('   1. 检查 worker 进程: ps aux | grep background-worker')
      console.log('   2. 启动 worker: QUEUE_BACKGROUND_WORKER=1 node dist/background-worker.js')
      console.log('   3. 检查 supervisord/pm2 配置')
    } else {
      const data = JSON.parse(heartbeat)
      const ageMinutes = Math.round((Date.now() - new Date(data.ts).getTime()) / 1000 / 60)
      if (ageMinutes > 5) {
        console.log('⚠️ Worker 心跳过期,进程可能已崩溃')
        console.log('   需要重启 worker 进程')
      } else {
        console.log('✅ Worker 进程正常运行')
        if (bgPending > 0) {
          console.log(`   但有 ${bgPending} 个任务在后台队列等待处理`)
          console.log('   这可能是正常的队列积压')
        }
      }
    }

  } finally {
    await redis.quit()
  }
}

main().catch(console.error)
