#!/usr/bin/env npx tsx

import { getCachedPageData, clearPageCache } from '../src/lib/redis'

async function clearCache() {
  console.log('🧹 清除YeahPromos URL的Redis缓存')
  console.log('='.repeat(80))
  
  const url = 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url='
  const language = 'en'
  
  console.log(`URL: ${url}`)
  console.log(`Language: ${language}`)
  console.log('')
  
  // 检查缓存是否存在
  console.log('🔍 检查现有缓存...')
  const cached = await getCachedPageData(url, language)
  
  if (cached) {
    console.log(`✅ 找到缓存数据`)
    console.log(`   缓存时间: ${cached.cachedAt}`)
    console.log(`   内容长度: ${cached.text.length} 字符`)
    console.log(`   标题: ${cached.title || '(空)'}`)
    console.log(`   描述: ${cached.description || '(空)'}`)
    console.log('')
  } else {
    console.log('⏭️  没有找到缓存数据')
    console.log('')
    return
  }
  
  // 删除缓存
  console.log('🗑️  删除缓存...')
  await clearPageCache(url, language)
  console.log('✅ 缓存已删除')
  console.log('')
  
  // 验证删除
  console.log('🔍 验证缓存是否已删除...')
  const checkDeleted = await getCachedPageData(url, language)
  
  if (checkDeleted) {
    console.log('❌ 缓存删除失败，仍然存在')
  } else {
    console.log('✅ 确认缓存已清除')
  }
  
  console.log('='.repeat(80))
}

clearCache()
  .then(() => {
    console.log('✅ 任务完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 错误:', error)
    process.exit(1)
  })
