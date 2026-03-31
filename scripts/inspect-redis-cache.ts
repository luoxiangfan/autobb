/**
 * 检查Redis中所有缓存键的情况
 */

import { getRedisClient } from '../src/lib/redis'

async function inspectRedisCache() {
  console.log('='.repeat(80))
  console.log('🔍 Redis缓存全面检查')
  console.log('='.repeat(80))

  let redis

  try {
    console.log('\n📡 连接到Redis...')
    redis = getRedisClient()
    await redis.ping()
    console.log('✅ Redis连接成功')

    // 检查所有键
    const allKeys = await redis.keys('*')
    console.log(`\n📊 Redis中共有 ${allKeys.length} 个键`)

    if (allKeys.length === 0) {
      console.log('✅ Redis为空，没有任何缓存数据')
      return
    }

    // 按模式分组
    const keysByPattern: { [key: string]: string[] } = {}

    allKeys.forEach(key => {
      const pattern = key.split(':')[0]
      if (!keysByPattern[pattern]) {
        keysByPattern[pattern] = []
      }
      keysByPattern[pattern].push(key)
    })

    console.log('\n📋 按模式分组:')
    Object.keys(keysByPattern).forEach(pattern => {
      console.log(`   ${pattern}:* → ${keysByPattern[pattern].length} 个键`)
    })

    // 检查url-resolve相关的键
    console.log('\n' + '='.repeat(80))
    console.log('🔍 检查URL解析相关的缓存')
    console.log('='.repeat(80))

    const urlResolveKeys = allKeys.filter(k => k.includes('url') || k.includes('resolve'))
    console.log(`\n找到 ${urlResolveKeys.length} 个与URL解析相关的键:`)

    if (urlResolveKeys.length > 0) {
      urlResolveKeys.slice(0, 10).forEach((key, idx) => {
        console.log(`   ${idx + 1}. ${key}`)
      })
      if (urlResolveKeys.length > 10) {
        console.log(`   ... 还有 ${urlResolveKeys.length - 10} 个键`)
      }
    } else {
      console.log('   ✅ 没有找到URL解析相关的缓存')
    }

    // 检查页面数据缓存
    console.log('\n' + '='.repeat(80))
    console.log('🔍 检查页面数据缓存')
    console.log('='.repeat(80))

    const pageKeys = allKeys.filter(k => k.includes('page:') || k.includes('scrape'))
    console.log(`\n找到 ${pageKeys.length} 个页面数据缓存键:`)

    if (pageKeys.length > 0) {
      pageKeys.slice(0, 10).forEach((key, idx) => {
        console.log(`   ${idx + 1}. ${key}`)
      })
      if (pageKeys.length > 10) {
        console.log(`   ... 还有 ${pageKeys.length - 10} 个键`)
      }

      // 分析第一个页面缓存
      if (pageKeys.length > 0) {
        const sampleKey = pageKeys[0]
        const value = await redis.get(sampleKey)
        const ttl = await redis.ttl(sampleKey)

        console.log(`\n📝 示例缓存详情: ${sampleKey}`)
        console.log(`   TTL: ${Math.floor(ttl / 3600)}小时 ${Math.floor((ttl % 3600) / 60)}分钟`)

        if (value) {
          try {
            const data = JSON.parse(value)
            console.log(`   数据类型: ${typeof data}`)
            console.log(`   数据键: ${Object.keys(data).join(', ')}`)
            if (data.text) {
              console.log(`   文本长度: ${data.text.length} 字符`)
            }
            if (data.seo) {
              console.log(`   SEO数据: ${Object.keys(data.seo).join(', ')}`)
            }
          } catch (e) {
            console.log(`   数据格式: 非JSON`)
          }
        }
      }
    } else {
      console.log('   ✅ 没有找到页面数据缓存')
    }

    // 总结
    console.log('\n' + '='.repeat(80))
    console.log('📊 检查总结')
    console.log('='.repeat(80))
    console.log(`   总键数: ${allKeys.length}`)
    console.log(`   URL解析缓存: ${urlResolveKeys.length}`)
    console.log(`   页面数据缓存: ${pageKeys.length}`)
    console.log(`   其他缓存: ${allKeys.length - urlResolveKeys.length - pageKeys.length}`)

  } catch (error: any) {
    console.error('\n❌ 检查过程中发生错误:', error.message)
    throw error
  } finally {
    if (redis) {
      await redis.quit()
      console.log('\n📡 Redis连接已关闭')
    }
  }
}

inspectRedisCache().catch(console.error)
