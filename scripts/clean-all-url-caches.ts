/**
 * 全面清理Redis中与URL解析相关的缓存
 *
 * 清理目标：
 * 1. redirect:* - 重定向缓存（旧的URL解析结果）
 * 2. scrape:* - 页面抓取缓存（可能包含过期的Final URL）
 * 3. url-resolve:* - URL解析缓存（如果存在）
 */

import { getRedisClient } from '../src/lib/redis'

async function comprehensiveCleanup() {
  console.log('='.repeat(80))
  console.log('🧹 Redis缓存全面清理工具')
  console.log('='.repeat(80))

  let redis

  try {
    // 连接Redis
    console.log('\n📡 连接到Redis...')
    redis = getRedisClient()
    await redis.ping()
    console.log('✅ Redis连接成功')

    // 定义要清理的缓存模式
    const patterns = [
      'url-resolve:*',   // URL解析缓存
      'redirect:*',      // 重定向缓存
      'scrape:*',        // 页面抓取缓存
    ]

    const cleanupResults: any[] = []

    for (const pattern of patterns) {
      console.log('\n' + '='.repeat(80))
      console.log(`🔍 处理缓存模式: ${pattern}`)
      console.log('='.repeat(80))

      // 查找匹配的键
      const keys = await redis.keys(pattern)
      console.log(`\n📋 找到 ${keys.length} 个键`)

      if (keys.length === 0) {
        console.log(`✅ 没有 ${pattern} 缓存，跳过`)
        cleanupResults.push({
          pattern,
          keysFound: 0,
          keysDeleted: 0,
          samples: []
        })
        continue
      }

      // 分析前几个缓存
      console.log(`\n📊 分析前${Math.min(keys.length, 5)}个缓存:`)
      const samples = []

      for (let i = 0; i < Math.min(keys.length, 5); i++) {
        const key = keys[i]
        const value = await redis.get(key)
        const ttl = await redis.ttl(key)

        console.log(`\n   ${i + 1}. 键: ${key}`)
        console.log(`      TTL: ${Math.floor(ttl / 3600)}小时 ${Math.floor((ttl % 3600) / 60)}分钟`)

        if (value) {
          try {
            const data = JSON.parse(value)
            console.log(`      数据类型: ${typeof data}`)

            // 根据不同的缓存类型显示不同的信息
            if (pattern === 'redirect:*') {
              console.log(`      Final URL: ${data.finalUrl?.substring(0, 60) || '无'}...`)
              console.log(`      Suffix长度: ${data.finalUrlSuffix?.length || 0}`)
              console.log(`      重定向次数: ${data.redirectCount || 0}`)
            } else if (pattern === 'scrape:*') {
              console.log(`      URL: ${data.url?.substring(0, 60) || '无'}...`)
              console.log(`      文本长度: ${data.text?.length || 0}`)
              console.log(`      有SEO数据: ${data.seo ? '✅' : '❌'}`)
            } else if (pattern === 'url-resolve:*') {
              console.log(`      Final URL: ${data.finalUrl?.substring(0, 60) || '无'}...`)
              console.log(`      Suffix长度: ${data.finalUrlSuffix?.length || 0}`)
            }

            samples.push({
              key,
              ttlHours: Math.floor(ttl / 3600),
              dataType: typeof data,
              dataKeys: Object.keys(data)
            })
          } catch (e) {
            console.log(`      数据格式: 非JSON`)
          }
        }
      }

      // 执行删除
      console.log(`\n🗑️  删除 ${keys.length} 个 ${pattern} 缓存...`)

      let deletedCount = 0
      const batchSize = 100

      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize)
        const result = await redis.del(...batch)
        deletedCount += result

        if (keys.length > 100) {
          console.log(`   进度: ${Math.min(i + batchSize, keys.length)}/${keys.length} (${Math.floor((i + batchSize) / keys.length * 100)}%)`)
        }
      }

      console.log(`✅ 成功删除 ${deletedCount} 个键`)

      cleanupResults.push({
        pattern,
        keysFound: keys.length,
        keysDeleted: deletedCount,
        samples
      })
    }

    // 验证清理结果
    console.log('\n' + '='.repeat(80))
    console.log('✔️  验证清理结果')
    console.log('='.repeat(80))

    for (const pattern of patterns) {
      const remaining = await redis.keys(pattern)
      console.log(`\n   ${pattern}: 剩余 ${remaining.length} 个键`)
    }

    // 总结报告
    console.log('\n' + '='.repeat(80))
    console.log('📊 清理总结报告')
    console.log('='.repeat(80))

    let totalFound = 0
    let totalDeleted = 0

    cleanupResults.forEach(result => {
      totalFound += result.keysFound
      totalDeleted += result.keysDeleted
      console.log(`\n   ${result.pattern}:`)
      console.log(`      找到: ${result.keysFound}`)
      console.log(`      删除: ${result.keysDeleted}`)
      console.log(`      清理率: ${result.keysFound > 0 ? ((result.keysDeleted / result.keysFound) * 100).toFixed(1) : 0}%`)
    })

    console.log(`\n${'='.repeat(80)}`)
    console.log(`   总计:`)
    console.log(`      找到: ${totalFound}`)
    console.log(`      删除: ${totalDeleted}`)
    console.log(`      清理率: ${totalFound > 0 ? ((totalDeleted / totalFound) * 100).toFixed(1) : 0}%`)
    console.log('='.repeat(80))

    console.log('\n💡 清理完成后的影响:')
    console.log('   ✅ 下次创建Offer时将重新解析URL（约15秒）')
    console.log('   ✅ 确保获取最新的Final URL Suffix数据')
    console.log('   ✅ 避免使用过期的重定向结果')
    console.log('   ✅ 页面抓取将重新获取最新内容')

    return {
      totalFound,
      totalDeleted,
      cleanupRate: totalFound > 0 ? ((totalDeleted / totalFound) * 100).toFixed(1) : 0,
      details: cleanupResults
    }

  } catch (error: any) {
    console.error('\n❌ 清理过程中发生错误:', error.message)
    console.error(error.stack)
    throw error
  } finally {
    if (redis) {
      await redis.quit()
      console.log('\n📡 Redis连接已关闭')
    }
  }
}

// 运行清理
async function main() {
  try {
    const result = await comprehensiveCleanup()

    console.log('\n' + '='.repeat(80))
    console.log('🎉 清理任务完成')
    console.log('='.repeat(80))
    console.log('\n📄 详细结果:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
  } catch (error) {
    console.error('\n❌ 清理任务失败')
    process.exit(1)
  }
}

main()
