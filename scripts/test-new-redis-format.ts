/**
 * 测试新的Redis key格式
 *
 * 此脚本会触发各种缓存操作，验证新格式是否正确生成
 *
 * 使用方法：
 * NODE_ENV=development npx tsx scripts/test-new-redis-format.ts
 */

import Redis from 'ioredis'
import { NODE_ENV, REDIS_URL, REDIS_PREFIX_CONFIG } from '../src/lib/config'
import { aiCache } from '../src/lib/ai-cache'

async function testNewFormat() {
  console.log('=' .repeat(60))
  console.log('🧪 测试新Redis Key格式')
  console.log('=' .repeat(60))
  console.log()
  console.log(`环境: ${NODE_ENV}`)
  console.log(`Queue Prefix: ${REDIS_PREFIX_CONFIG.queue}`)
  console.log(`Cache Prefix: ${REDIS_PREFIX_CONFIG.cache}`)
  console.log()

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  })

  try {
    await client.ping()
    console.log('✅ Redis连接成功')
    console.log()

    // 测试1: AI缓存 (review_analysis)
    console.log('📝 测试1: AI缓存 - 评论分析')
    await aiCache.set('review_analysis', 'https://amazon.com/test-product', {
      sentiment: 'positive',
      keywords: ['great', 'quality'],
      rating: 4.5,
    })
    console.log('   ✅ 已写入测试数据')

    // 验证key格式
    const aiKeys = await client.keys(`${REDIS_PREFIX_CONFIG.cache}ai:*`)
    console.log(`   📊 找到 ${aiKeys.length} 个AI缓存键`)
    if (aiKeys.length > 0) {
      console.log(`   🔑 示例键: ${aiKeys[0]}`)
      const expectedFormat = new RegExp(`^${REDIS_PREFIX_CONFIG.cache.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}ai:`)
      if (expectedFormat.test(aiKeys[0])) {
        console.log(`   ✅ Key格式正确: cache:ai:...`)
      } else {
        console.log(`   ❌ Key格式错误`)
      }
    }
    console.log()

    // 测试2: URL重定向缓存
    console.log('📝 测试2: URL重定向缓存')
    const redirectKey = `${REDIS_PREFIX_CONFIG.cache}redirect:US:https://amazon.com/test`
    await client.setex(redirectKey, 300, JSON.stringify({
      finalUrl: 'https://amazon.com/test-final',
      redirectCount: 2,
    }))
    console.log('   ✅ 已写入测试数据')

    const redirectKeys = await client.keys(`${REDIS_PREFIX_CONFIG.cache}redirect:*`)
    console.log(`   📊 找到 ${redirectKeys.length} 个URL缓存键`)
    if (redirectKeys.length > 0) {
      console.log(`   🔑 示例键: ${redirectKeys[0]}`)
      const expectedFormat = new RegExp(`^${REDIS_PREFIX_CONFIG.cache.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}redirect:`)
      if (expectedFormat.test(redirectKeys[0])) {
        console.log(`   ✅ Key格式正确: cache:redirect:...`)
      } else {
        console.log(`   ❌ Key格式错误`)
      }
    }
    console.log()

    // 测试3: 网页抓取缓存
    console.log('📝 测试3: 网页抓取缓存')
    const scrapeKey = `${REDIS_PREFIX_CONFIG.cache}scrape:product:en:${Buffer.from('https://amazon.com/test').toString('base64')}`
    await client.setex(scrapeKey, 300, JSON.stringify({
      title: 'Test Product',
      description: 'Test description',
    }))
    console.log('   ✅ 已写入测试数据')

    const scrapeKeys = await client.keys(`${REDIS_PREFIX_CONFIG.cache}scrape:*`)
    console.log(`   📊 找到 ${scrapeKeys.length} 个网页缓存键`)
    if (scrapeKeys.length > 0) {
      console.log(`   🔑 示例键: ${scrapeKeys[0]}`)
      const expectedFormat = new RegExp(`^${REDIS_PREFIX_CONFIG.cache.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}scrape:`)
      if (expectedFormat.test(scrapeKeys[0])) {
        console.log(`   ✅ Key格式正确: cache:scrape:...`)
      } else {
        console.log(`   ❌ Key格式错误`)
      }
    }
    console.log()

    // 综合验证
    console.log('=' .repeat(60))
    console.log('📊 综合验证结果')
    console.log('=' .repeat(60))
    console.log()

    const allCacheKeys = await client.keys(`${REDIS_PREFIX_CONFIG.cache}*`)
    console.log(`✅ 总计缓存键: ${allCacheKeys.length}`)
    console.log(`   - AI缓存: ${aiKeys.length}`)
    console.log(`   - URL缓存: ${redirectKeys.length}`)
    console.log(`   - 网页缓存: ${scrapeKeys.length}`)
    console.log()

    // 检查是否有旧格式的键
    const oldAiKeys = await client.keys(`autoads:${NODE_ENV}:ai_cache:*`)
    const oldRedirectKeys = await client.keys(`autoads:${NODE_ENV}:redirect:*`)
    const oldScrapeKeys = await client.keys(`autoads:${NODE_ENV}:scrape:*`)
    const totalOldKeys = oldAiKeys.length + oldRedirectKeys.length + oldScrapeKeys.length

    if (totalOldKeys > 0) {
      console.log(`⚠️ 警告: 发现 ${totalOldKeys} 个旧格式的键`)
      console.log(`   请运行清理脚本: npm run tsx scripts/cleanup-old-redis-keys.ts`)
    } else {
      console.log(`✅ 未发现旧格式的键`)
    }
    console.log()

    // 显示所有键
    if (allCacheKeys.length > 0 && allCacheKeys.length <= 10) {
      console.log('🔑 所有缓存键:')
      allCacheKeys.forEach(key => {
        console.log(`   - ${key}`)
      })
      console.log()
    }

    console.log('=' .repeat(60))
    console.log('✅ 测试完成')
    console.log('=' .repeat(60))
    console.log()
    console.log('📝 下一步:')
    console.log('   1. 确认所有key格式都是新格式 (cache:ai/redirect/scrape:)')
    console.log('   2. 启动应用并访问功能页面')
    console.log('   3. 再次运行 verify-redis-isolation.ts 检查实际使用情况')
    console.log()

    // 清理测试数据
    console.log('🧹 清理测试数据...')
    if (allCacheKeys.length > 0) {
      await client.del(...allCacheKeys)
      console.log(`   ✅ 已删除 ${allCacheKeys.length} 个测试键`)
    }

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await client.quit()
  }
}

// 执行测试
testNewFormat().catch(error => {
  console.error('❌ 执行出错:', error)
  process.exit(1)
})
