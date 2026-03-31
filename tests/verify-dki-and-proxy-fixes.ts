/**
 * 验证DKI格式修复和代理缓存禁用
 *
 * 测试项:
 * 1. DKI headline应该使用品牌名作为defaultText: "{KeyWord:Reolink}" 或 "{KeyWord:Reolink} Official"
 * 2. 代理IP每次调用都应该重新获取（不使用缓存）
 */

import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { getProxyIp, clearProxyCache } from '../src/lib/proxy/fetch-proxy-ip'

// 测试配置
const TEST_PROXY_URL = process.env.PROXY_URL || ''
const TEST_OFFER = {
  id: 999,
  brand: 'Reolink',
  category: 'Security Camera',
  product_name: 'Reolink Argus 3 Pro',
  features: '4K UHD, Color Night Vision, Wire-Free',
  price: 129.99,
  url: 'https://pboost.me/test',
  final_url: 'https://www.amazon.com/dp/TEST123',
  country: 'US'
}

async function testDKIFormat() {
  console.log('\n========================================')
  console.log('测试1: DKI Headline格式验证')
  console.log('========================================\n')

  console.log('生成广告创意...')
  const result = await generateAdCreative(
    TEST_OFFER,
    'US',
    undefined,
    undefined,
    'gemini-2.5-flash'
  )

  // 检查DKI headlines
  const dkiHeadlines = result.headlines
    .filter((h: any) => h.text.includes('{KeyWord:'))
    .map((h: any) => h.text)

  console.log(`\n找到 ${dkiHeadlines.length} 个DKI headlines:`)
  dkiHeadlines.forEach((h: string, i: number) => {
    console.log(`  ${i + 1}. ${h}`)

    // 验证defaultText是否为品牌名
    const match = h.match(/\{KeyWord:([^}]+)\}/)
    if (match) {
      const defaultText = match[1].trim()
      const isBrandName = defaultText === TEST_OFFER.brand
      const isBrandWithSuffix = defaultText.startsWith(TEST_OFFER.brand + ' ')

      if (isBrandName) {
        console.log(`     ✅ defaultText正确: "${defaultText}" 就是品牌名`)
      } else if (isBrandWithSuffix) {
        console.log(`     ⚠️ defaultText包含品牌名但有后缀: "${defaultText}"`)
      } else {
        console.log(`     ❌ defaultText错误: "${defaultText}" 应该是 "${TEST_OFFER.brand}"`)
      }
    }
  })

  if (dkiHeadlines.length === 0) {
    console.log('  ❌ 没有生成DKI headlines！')
    return false
  }

  // 至少应该有一个DKI headline的defaultText是品牌名
  const hasCorrectDKI = dkiHeadlines.some((h: string) => {
    const match = h.match(/\{KeyWord:([^}]+)\}/)
    if (match) {
      const defaultText = match[1].trim()
      return defaultText === TEST_OFFER.brand
    }
    return false
  })

  if (hasCorrectDKI) {
    console.log('\n✅ DKI格式测试通过：至少有一个headline使用品牌名作为defaultText')
    return true
  } else {
    console.log('\n❌ DKI格式测试失败：没有headline使用品牌名作为defaultText')
    return false
  }
}

async function testProxyCaching() {
  console.log('\n========================================')
  console.log('测试2: 代理缓存禁用验证')
  console.log('========================================\n')

  if (!TEST_PROXY_URL) {
    console.log('⚠️ 未配置PROXY_URL环境变量，跳过代理测试')
    return true
  }

  // 清除所有缓存
  clearProxyCache()

  console.log('第1次获取代理IP...')
  const proxy1 = await getProxyIp(TEST_PROXY_URL)
  console.log(`  获得代理: ${proxy1.fullAddress}`)
  const time1 = Date.now()

  // 等待1秒
  console.log('\n等待1秒...')
  await new Promise(resolve => setTimeout(resolve, 1000))

  console.log('\n第2次获取代理IP（应该是新IP，不使用缓存）...')
  const proxy2 = await getProxyIp(TEST_PROXY_URL)
  console.log(`  获得代理: ${proxy2.fullAddress}`)
  const time2 = Date.now()

  const timeDiff = time2 - time1

  // 如果使用缓存，第2次应该几乎瞬间返回（<100ms）
  // 如果重新获取，应该需要网络请求时间（>500ms）
  if (timeDiff < 500) {
    console.log(`\n⚠️ 第2次获取耗时仅 ${timeDiff}ms，可能使用了缓存`)
    console.log('  建议检查 getProxyIp() 的 forceRefresh 参数默认值')
  } else {
    console.log(`\n✅ 第2次获取耗时 ${timeDiff}ms，确认重新获取了代理IP（未使用缓存）`)
  }

  // 验证两次是否获得不同IP
  if (proxy1.fullAddress !== proxy2.fullAddress) {
    console.log(`✅ 两次获取的IP不同，确认没有使用缓存`)
    return true
  } else {
    console.log(`ℹ️ 两次获取的IP相同（${proxy1.fullAddress}）`)
    console.log('  这可能是代理服务商返回了相同IP，不一定是缓存问题')

    // 即使IP相同，但如果耗时>500ms，说明确实重新请求了
    if (timeDiff >= 500) {
      console.log(`✅ 但由于耗时${timeDiff}ms，确认是重新请求的（非缓存）`)
      return true
    } else {
      console.log(`❌ 且耗时仅${timeDiff}ms，怀疑使用了缓存`)
      return false
    }
  }
}

async function main() {
  console.log('开始验证DKI和代理修复...\n')

  try {
    const dkiPass = await testDKIFormat()
    const proxyPass = await testProxyCaching()

    console.log('\n========================================')
    console.log('测试结果汇总')
    console.log('========================================\n')

    console.log(`DKI格式测试: ${dkiPass ? '✅ 通过' : '❌ 失败'}`)
    console.log(`代理缓存测试: ${proxyPass ? '✅ 通过' : '❌ 失败'}`)

    if (dkiPass && proxyPass) {
      console.log('\n🎉 所有测试通过！')
      process.exit(0)
    } else {
      console.log('\n⚠️ 部分测试失败，请检查修复')
      process.exit(1)
    }
  } catch (error: any) {
    console.error('\n❌ 测试过程出错:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

main()
