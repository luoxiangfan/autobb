/**
 * IPRocket 代理质量测试脚本
 * 用于诊断代理连接问题
 */

import axios from 'axios'

const IPROCKET_CONFIG = {
  username: process.env.IPROCKET_USERNAME || 'your_username',
  password: process.env.IPROCKET_PASSWORD || 'your_password',
}

async function getProxyCredentials(country: string): Promise<string | null> {
  const url = `https://api.iprocket.io/api?username=${IPROCKET_CONFIG.username}&password=${IPROCKET_CONFIG.password}&cc=${country}&ips=1&type=-res-&proxyType=http&responseType=txt`

  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/plain,*/*',
      },
      validateStatus: () => true,
    })

    if (resp.status !== 200) {
      console.error(`❌ ${country}: HTTP ${resp.status}`)
      return null
    }

    const text = String(resp.data || '').trim()

    // 检查是否是错误响应
    if (text.startsWith('{') && text.includes('"code"')) {
      try {
        const jsonResp = JSON.parse(text)
        console.error(`❌ ${country}: API错误 - ${jsonResp.msg || jsonResp.message}`)
        return null
      } catch (e) {
        // 不是JSON，继续处理
      }
    }

    // 格式: host:port:username:password
    if (!text.includes(':')) {
      console.error(`❌ ${country}: 响应格式错误 - ${text.substring(0, 100)}`)
      return null
    }

    return text
  } catch (error: any) {
    console.error(`❌ ${country}: 请求失败 - ${error.message}`)
    return null
  }
}

async function testProxyConnection(proxyString: string, testUrl: string): Promise<{
  success: boolean
  statusCode?: number
  time?: number
  error?: string
}> {
  const [host, port, username, password] = proxyString.split(':')
  const proxyUrl = `http://${username}:${password}@${host}:${port}`

  const startTime = Date.now()

  try {
    const resp = await axios.get(testUrl, {
      proxy: {
        protocol: 'http',
        host,
        port: parseInt(port),
        auth: {
          username,
          password,
        },
      },
      timeout: 30000,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    const time = Date.now() - startTime

    return {
      success: resp.status >= 200 && resp.status < 400,
      statusCode: resp.status,
      time,
    }
  } catch (error: any) {
    const time = Date.now() - startTime
    return {
      success: false,
      time,
      error: error.code || error.message,
    }
  }
}

async function testCountryProxy(country: string, testUrl: string) {
  console.log(`\n🔍 测试 ${country} 代理...`)

  // 1. 获取代理凭证
  const proxyString = await getProxyCredentials(country)
  if (!proxyString) {
    return
  }

  console.log(`✅ 获取到代理: ${proxyString.split(':')[0]}:${proxyString.split(':')[1]}`)

  // 2. 测试连接（3次）
  const results = []
  for (let i = 1; i <= 3; i++) {
    console.log(`   尝试 ${i}/3...`)
    const result = await testProxyConnection(proxyString, testUrl)
    results.push(result)

    if (result.success) {
      console.log(`   ✅ 成功 - HTTP ${result.statusCode} - ${result.time}ms`)
    } else {
      console.log(`   ❌ 失败 - ${result.error || 'Unknown'} - ${result.time}ms`)
    }

    // 等待1秒再测试下一次
    if (i < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // 3. 统计结果
  const successCount = results.filter(r => r.success).length
  const avgTime = results.reduce((sum, r) => sum + (r.time || 0), 0) / results.length

  console.log(`📊 结果: ${successCount}/3 成功, 平均耗时: ${Math.round(avgTime)}ms`)

  return {
    country,
    proxyString,
    successCount,
    avgTime,
    results,
  }
}

async function main() {
  console.log('🚀 开始测试 IPRocket 代理质量\n')
  console.log('配置:')
  console.log(`  Username: ${IPROCKET_CONFIG.username}`)
  console.log(`  测试URL: https://www.amazon.de/dp/B0CPJ76KXR`)

  const testUrl = 'https://www.amazon.de/dp/B0CPJ76KXR'
  const countries = ['DE', 'US', 'GB', 'FR']

  const allResults = []

  for (const country of countries) {
    const result = await testCountryProxy(country, testUrl)
    if (result) {
      allResults.push(result)
    }
  }

  console.log('\n\n📊 总结:')
  console.log('─'.repeat(80))
  for (const result of allResults) {
    const status = result.successCount === 3 ? '✅' : result.successCount > 0 ? '⚠️' : '❌'
    console.log(`${status} ${result.country}: ${result.successCount}/3 成功, 平均 ${Math.round(result.avgTime)}ms`)
  }

  console.log('\n建议:')
  const failedCountries = allResults.filter(r => r.successCount === 0)
  if (failedCountries.length > 0) {
    console.log(`❌ 以下国家代理完全失败: ${failedCountries.map(r => r.country).join(', ')}`)
    console.log('   可能原因:')
    console.log('   1. IPRocket 账户配额用完或被限制')
    console.log('   2. 代理 IP 被目标网站封禁')
    console.log('   3. 代理服务器不稳定')
  }

  const slowCountries = allResults.filter(r => r.avgTime > 10000)
  if (slowCountries.length > 0) {
    console.log(`⚠️  以下国家代理响应慢 (>10s): ${slowCountries.map(r => r.country).join(', ')}`)
  }

  if (allResults.every(r => r.successCount === 3)) {
    console.log('✅ 所有代理工作正常')
  }
}

main().catch(console.error)
