/**
 * 清理旧格式的Redis缓存键
 *
 * 此脚本会删除旧格式的缓存键，但保留队列键（队列格式未变）
 *
 * 旧格式：
 * - autoads:development:ai_cache:*
 * - autoads:development:redirect:*
 * - autoads:development:scrape:*
 *
 * 新格式：
 * - autoads:development:cache:ai:*
 * - autoads:development:cache:redirect:*
 * - autoads:development:cache:scrape:*
 *
 * 使用方法：
 * NODE_ENV=development npx tsx scripts/cleanup-old-redis-keys.ts
 * NODE_ENV=production npx tsx scripts/cleanup-old-redis-keys.ts
 */

import Redis from 'ioredis'
import { NODE_ENV, REDIS_URL } from '../src/lib/config'

async function cleanupOldKeys() {
  console.log('=' .repeat(60))
  console.log('🧹 清理旧格式Redis缓存键')
  console.log('=' .repeat(60))
  console.log()
  console.log(`环境: ${NODE_ENV}`)
  console.log(`Redis URL: ${REDIS_URL}`)
  console.log()

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  })

  try {
    await client.ping()
    console.log('✅ Redis连接成功')
    console.log()

    // 旧格式的缓存键模式
    const oldPatterns = [
      `autoads:${NODE_ENV}:ai_cache:*`,
      `autoads:${NODE_ENV}:redirect:*`,
      `autoads:${NODE_ENV}:scrape:*`,
    ]

    let totalDeleted = 0

    for (const pattern of oldPatterns) {
      console.log(`🔍 扫描模式: ${pattern}`)

      const keys = await client.keys(pattern)

      if (keys.length === 0) {
        console.log(`   未找到匹配的键`)
        continue
      }

      console.log(`   找到 ${keys.length} 个键`)

      // 显示前5个键作为示例
      if (keys.length > 0) {
        console.log(`   示例键:`)
        keys.slice(0, 5).forEach(key => {
          console.log(`     - ${key}`)
        })
        if (keys.length > 5) {
          console.log(`     ... 还有 ${keys.length - 5} 个`)
        }
      }

      // 批量删除
      if (keys.length > 0) {
        const deleted = await client.del(...keys)
        totalDeleted += deleted
        console.log(`   ✅ 已删除 ${deleted} 个键`)
      }
      console.log()
    }

    console.log('=' .repeat(60))
    console.log(`✅ 清理完成: 共删除 ${totalDeleted} 个旧格式的键`)
    console.log('=' .repeat(60))
    console.log()
    console.log('📝 注意事项:')
    console.log('   1. 队列键未被删除（格式未改变）')
    console.log('   2. 新格式的缓存键在应用运行时会自动生成')
    console.log('   3. 第一次访问时会重新获取数据并缓存')
    console.log()

  } catch (error: any) {
    console.error('❌ 清理失败:', error.message)
    process.exit(1)
  } finally {
    await client.quit()
  }
}

// 执行清理
cleanupOldKeys().catch(error => {
  console.error('❌ 执行出错:', error)
  process.exit(1)
})
