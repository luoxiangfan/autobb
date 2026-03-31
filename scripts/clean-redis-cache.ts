/**
 * 清理Redis中的URL解析缓存数据
 *
 * 目的：
 * 1. 清理旧的url-resolve:*缓存（可能包含过期的Final URL Suffix数据）
 * 2. 确保下次URL解析时强制重新获取最新数据
 * 3. 提供详细的清理报告
 */

import { getRedisClient } from '../src/lib/redis'

async function cleanUrlResolveCache() {
  console.log('='.repeat(80))
  console.log('🧹 Redis URL解析缓存清理工具')
  console.log('='.repeat(80))

  let redis

  try {
    // 连接Redis
    console.log('\n📡 连接到Redis...')
    redis = getRedisClient()
    await redis.ping()
    console.log('✅ Redis连接成功')

    // ========== 步骤1: 检查现有缓存 ==========
    console.log('\n' + '='.repeat(80))
    console.log('📊 步骤1: 检查现有缓存数据')
    console.log('='.repeat(80))

    // 获取所有URL解析缓存键
    const pattern = 'url-resolve:*'
    console.log(`\n🔍 搜索缓存键: ${pattern}`)

    const keys = await redis.keys(pattern)
    console.log(`\n📋 找到 ${keys.length} 个缓存键`)

    if (keys.length === 0) {
      console.log('✅ 没有发现旧缓存数据，无需清理')
      return {
        keysFound: 0,
        keysDeleted: 0,
        cacheData: []
      }
    }

    // ========== 步骤2: 分析缓存数据 ==========
    console.log('\n' + '='.repeat(80))
    console.log('🔍 步骤2: 分析缓存数据详情')
    console.log('='.repeat(80))

    const cacheAnalysis = []

    for (let i = 0; i < Math.min(keys.length, 10); i++) {
      const key = keys[i]
      const value = await redis.get(key)
      const ttl = await redis.ttl(key)

      if (value) {
        try {
          const data = JSON.parse(value)
          const analysis = {
            key,
            country: key.split(':')[1],
            affiliateLink: key.split(':').slice(2).join(':'),
            finalUrl: data.finalUrl,
            hasSuffix: data.finalUrlSuffix && data.finalUrlSuffix.length > 0,
            suffixLength: data.finalUrlSuffix?.length || 0,
            ttlSeconds: ttl,
            ttlDays: Math.floor(ttl / 86400),
            cachedAt: data.cachedAt ? new Date(data.cachedAt).toLocaleString() : '未知',
            resolveMethod: data.resolveMethod
          }
          cacheAnalysis.push(analysis)
        } catch (e) {
          console.warn(`⚠️ 解析缓存数据失败: ${key}`)
        }
      }
    }

    // 显示前10个缓存的详细信息
    console.log(`\n📝 前${cacheAnalysis.length}个缓存详情:`)
    cacheAnalysis.forEach((item, idx) => {
      console.log(`\n${idx + 1}. 缓存键: ${item.key.substring(0, 60)}...`)
      console.log(`   国家: ${item.country}`)
      console.log(`   Final URL: ${item.finalUrl.substring(0, 60)}...`)
      console.log(`   有Suffix: ${item.hasSuffix ? '✅' : '❌'} (${item.suffixLength}字符)`)
      console.log(`   TTL: ${item.ttlDays}天 ${item.ttlSeconds % 86400}秒`)
      console.log(`   缓存时间: ${item.cachedAt}`)
      console.log(`   解析方式: ${item.resolveMethod}`)
    })

    // 统计信息
    const withSuffix = cacheAnalysis.filter(c => c.hasSuffix).length
    const withoutSuffix = cacheAnalysis.filter(c => !c.hasSuffix).length

    console.log('\n' + '-'.repeat(80))
    console.log('📊 缓存统计:')
    console.log(`   总缓存数: ${keys.length}`)
    console.log(`   有Final URL Suffix: ${withSuffix}`)
    console.log(`   无Final URL Suffix: ${withoutSuffix}`)
    console.log(`   采样数据: ${cacheAnalysis.length}`)
    console.log('-'.repeat(80))

    // ========== 步骤3: 执行清理 ==========
    console.log('\n' + '='.repeat(80))
    console.log('🗑️  步骤3: 执行缓存清理')
    console.log('='.repeat(80))

    console.log(`\n⚠️  即将删除 ${keys.length} 个缓存键...`)
    console.log('💡 理由: 确保下次URL解析时获取最新的Final URL Suffix数据')

    // 批量删除
    let deletedCount = 0
    const batchSize = 100

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize)
      const result = await redis.del(...batch)
      deletedCount += result

      console.log(`   删除进度: ${Math.min(i + batchSize, keys.length)}/${keys.length} (${Math.floor((i + batchSize) / keys.length * 100)}%)`)
    }

    console.log(`\n✅ 成功删除 ${deletedCount} 个缓存键`)

    // ========== 步骤4: 验证清理结果 ==========
    console.log('\n' + '='.repeat(80))
    console.log('✔️  步骤4: 验证清理结果')
    console.log('='.repeat(80))

    const remainingKeys = await redis.keys(pattern)
    console.log(`\n🔍 验证: 剩余缓存键数量 = ${remainingKeys.length}`)

    if (remainingKeys.length === 0) {
      console.log('✅ 缓存清理完成，所有旧数据已删除')
    } else {
      console.log(`⚠️ 仍有 ${remainingKeys.length} 个缓存键未删除`)
      console.log('   这可能是在清理过程中新创建的缓存')
    }

    // ========== 总结 ==========
    console.log('\n' + '='.repeat(80))
    console.log('📋 清理总结')
    console.log('='.repeat(80))
    console.log(`✅ 找到旧缓存: ${keys.length} 个`)
    console.log(`✅ 成功删除: ${deletedCount} 个`)
    console.log(`✅ 剩余缓存: ${remainingKeys.length} 个`)
    console.log(`✅ 清理率: ${((deletedCount / keys.length) * 100).toFixed(1)}%`)

    console.log('\n💡 下一步建议:')
    console.log('   1. 测试创建新Offer，验证skipCache=true生效')
    console.log('   2. 检查新创建的Offer是否有完整的Final URL Suffix')
    console.log('   3. 监控URL解析耗时（预期15-20秒）')

    return {
      keysFound: keys.length,
      keysDeleted: deletedCount,
      keysRemaining: remainingKeys.length,
      cacheAnalysis: cacheAnalysis,
      cleanupRate: ((deletedCount / keys.length) * 100).toFixed(1)
    }

  } catch (error: any) {
    console.error('\n❌ 清理过程中发生错误:', error.message)
    console.error(error.stack)
    throw error
  } finally {
    // 关闭Redis连接
    if (redis) {
      await redis.quit()
      console.log('\n📡 Redis连接已关闭')
    }
  }
}

// ========== 主函数 ==========
async function main() {
  try {
    const result = await cleanUrlResolveCache()

    console.log('\n' + '='.repeat(80))
    console.log('🎉 清理任务完成')
    console.log('='.repeat(80))
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
  } catch (error) {
    console.error('\n❌ 清理任务失败')
    process.exit(1)
  }
}

// 运行清理
main()
