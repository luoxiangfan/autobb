#!/usr/bin/env npx tsx

import { createClient } from 'redis'

async function clearCache() {
  console.log('🧹 清理YeahPromos URL的Redis缓存')
  
  const redis = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  })
  
  await redis.connect()
  
  const url = 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url='
  const keys = [
    `page_data:${url}:en`,
    `page_data:${url}:*`
  ]
  
  for (const key of keys) {
    const deleted = await redis.del(key)
    console.log(`  ${deleted > 0 ? '✅' : '⏭️'} ${key}`)
  }
  
  // 搜索所有可能的缓存键
  const allKeys = await redis.keys('page_data:*yeahpromos*')
  console.log(`\n🔍 找到 ${allKeys.length} 个相关缓存键`)
  
  for (const key of allKeys) {
    await redis.del(key)
    console.log(`  ✅ 删除: ${key}`)
  }
  
  await redis.quit()
  console.log('\n✅ 缓存清理完成')
}

clearCache()
