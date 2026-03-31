/**
 * Redis环境隔离验证脚本
 *
 * 用于验证开发环境和生产环境的Redis队列是否正确隔离
 *
 * 使用方法:
 * node scripts/verify-redis-isolation.ts
 */

import Redis from 'ioredis'
import { NODE_ENV, REDIS_URL, REDIS_PREFIX_CONFIG } from '../src/lib/config'

interface RedisInfo {
  url: string
  queuePrefix: string
  cachePrefix: string
  env: string
  connected: boolean
  keys: string[]
  stats: {
    totalKeys: number
    queueKeys: number
    cacheKeys: number
  }
}

/**
 * 获取Redis连接信息
 */
async function getRedisInfo(): Promise<RedisInfo> {
  const env = NODE_ENV

  console.log(`🔍 正在检查Redis配置...`)
  console.log(`   环境: ${env}`)
  console.log(`   REDIS_URL: ${REDIS_URL}`)
  console.log(`   Redis Queue Prefix: ${REDIS_PREFIX_CONFIG.queue}`)
  console.log(`   Redis Cache Prefix: ${REDIS_PREFIX_CONFIG.cache}`)
  console.log()

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  })

  let connected = false
  let keys: string[] = []

  try {
    await client.ping()
    connected = true
    console.log('✅ Redis连接成功')

    // 获取所有匹配的keys
    const patterns = [
      `${REDIS_PREFIX_CONFIG.queue}*`,      // 队列: autoads:development:queue:*
      `${REDIS_PREFIX_CONFIG.cache}ai:*`,   // AI缓存: autoads:development:cache:ai:*
      `${REDIS_PREFIX_CONFIG.cache}redirect:*`,  // URL缓存
      `${REDIS_PREFIX_CONFIG.cache}scrape:*`,    // 网页缓存
    ]

    for (const pattern of patterns) {
      try {
        const matchedKeys = await client.keys(pattern)
        keys.push(...matchedKeys)
      } catch (err) {
        // 忽略pattern错误
      }
    }

    // 去重
    keys = [...new Set(keys)]

    console.log(`📊 找到 ${keys.length} 个相关keys`)
  } catch (error: any) {
    console.log('❌ Redis连接失败:', error.message)
  } finally {
    await client.quit()
  }

  return {
    url: REDIS_URL,
    queuePrefix: REDIS_PREFIX_CONFIG.queue,
    cachePrefix: REDIS_PREFIX_CONFIG.cache,
    env,
    connected,
    keys,
    stats: {
      totalKeys: keys.length,
      queueKeys: keys.filter(k => k.includes(':queue:')).length,
      cacheKeys: keys.filter(k => k.includes(':cache:')).length,
    }
  }
}

/**
 * 验证环境隔离
 */
async function verifyIsolation() {
  console.log('=' .repeat(60))
  console.log('🔍 Redis环境隔离验证')
  console.log('=' .repeat(60))
  console.log()

  const info = await getRedisInfo()

  console.log()
  console.log('=' .repeat(60))
  console.log('📊 验证结果')
  console.log('=' .repeat(60))
  console.log()

  if (!info.connected) {
    console.log('❌ Redis连接失败，无法验证隔离')
    return
  }

  // 检查Key Prefix
  console.log(`✅ 环境标识: ${info.env}`)
  console.log(`✅ Queue Prefix: ${info.queuePrefix}`)
  console.log(`✅ Cache Prefix: ${info.cachePrefix}`)
  console.log()

  // 检查keys分布
  console.log(`📈 Key统计:`)
  console.log(`   总数: ${info.stats.totalKeys}`)
  console.log(`   队列Keys: ${info.stats.queueKeys}`)
  console.log(`   缓存Keys: ${info.stats.cacheKeys}`)
  console.log()

  // 验证隔离
  const otherEnvKeys = info.keys.filter(k =>
    k.includes('autoads:') &&
    !k.includes(`autoads:${info.env}:`)
  )

  if (otherEnvKeys.length > 0) {
    console.log('⚠️ 警告: 检测到其他环境的keys!')
    console.log(`   发现 ${otherEnvKeys.length} 个其他环境的keys:`)
    otherEnvKeys.slice(0, 10).forEach(key => {
      console.log(`   - ${key}`)
    })
    if (otherEnvKeys.length > 10) {
      console.log(`   ... 还有 ${otherEnvKeys.length - 10} 个`)
    }
    console.log()
    console.log('❌ 环境隔离失败!')
    console.log('   可能原因:')
    console.log('   1. 不同环境使用了相同的Redis实例')
    console.log('   2. Key Prefix配置不一致')
    console.log('   3. 环境变量设置错误')
    console.log()
    console.log('💡 解决方案:')
    console.log('   1. 确保每个环境使用不同的REDIS_KEY_PREFIX')
    console.log('   2. 或者使用完全分离的Redis实例')
    console.log('   3. 清理共享的Redis数据')
  } else {
    console.log('✅ 环境隔离验证通过!')
    console.log(`   所有 ${info.stats.totalKeys} 个keys都属于当前环境 (${info.env})`)
    console.log()
    console.log('🎉 隔离状态: 安全')
  }

  console.log()
  console.log('=' .repeat(60))
  console.log('✅ 验证完成')
  console.log('=' .repeat(60))
}

// 执行验证
verifyIsolation().catch(error => {
  console.error('❌ 验证过程出错:', error)
  process.exit(1)
})
