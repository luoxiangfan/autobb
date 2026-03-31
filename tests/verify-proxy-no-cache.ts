/**
 * 验证代理IP不使用缓存
 */

import { getProxyIp, clearProxyCache } from '../src/lib/proxy/fetch-proxy-ip'

const PROXY_URL = process.env.PROXY_URL || ''

async function main() {
  if (!PROXY_URL) {
    console.log('❌ 未配置PROXY_URL环境变量')
    process.exit(1)
  }

  console.log('清除所有代理缓存...')
  clearProxyCache()

  console.log('\n第1次获取代理IP...')
  console.time('第1次耗时')
  const proxy1 = await getProxyIp(PROXY_URL)
  console.timeEnd('第1次耗时')
  console.log(`  代理: ${proxy1.fullAddress}`)
  console.log(`  用户名: ${proxy1.username.substring(0, 20)}...`)

  console.log('\n等待1秒...')
  await new Promise(resolve => setTimeout(resolve, 1000))

  console.log('\n第2次获取代理IP（应该重新请求，不使用缓存）...')
  console.time('第2次耗时')
  const proxy2 = await getProxyIp(PROXY_URL)
  console.timeEnd('第2次耗时')
  console.log(`  代理: ${proxy2.fullAddress}`)
  console.log(`  用户名: ${proxy2.username.substring(0, 20)}...`)

  console.log('\n验证结果:')

  // 代理的唯一性由四元组(host, port, username, password)决定
  const proxy1Tuple = `${proxy1.host}:${proxy1.port}:${proxy1.username}:${proxy1.password}`
  const proxy2Tuple = `${proxy2.host}:${proxy2.port}:${proxy2.username}:${proxy2.password}`

  if (proxy1Tuple !== proxy2Tuple) {
    console.log(`✅ 两次代理四元组不同，确认没有使用缓存`)
    console.log(`   第1次: ${proxy1.host}:${proxy1.port}:${proxy1.username.substring(0, 30)}...:${proxy1.password.substring(0, 10)}...`)
    console.log(`   第2次: ${proxy2.host}:${proxy2.port}:${proxy2.username.substring(0, 30)}...:${proxy2.password.substring(0, 10)}...`)

    // 详细对比每个字段
    if (proxy1.host !== proxy2.host) {
      console.log(`   → host不同: ${proxy1.host} vs ${proxy2.host}`)
    }
    if (proxy1.port !== proxy2.port) {
      console.log(`   → port不同: ${proxy1.port} vs ${proxy2.port}`)
    }
    if (proxy1.username !== proxy2.username) {
      console.log(`   → username不同（sid不同）`)
    }
    if (proxy1.password !== proxy2.password) {
      console.log(`   → password不同`)
    }
  } else {
    console.log(`❌ 两次代理四元组完全相同，使用了缓存！`)
    console.log(`   ${proxy1Tuple}`)
  }
}

main().catch(err => {
  console.error('错误:', err.message)
  process.exit(1)
})
