/**
 * 验证Final URL Suffix提取流程
 *
 * 测试目标：
 * 1. 验证推广链接重定向后是否保留查询参数
 * 2. 验证Final URL和Final URL Suffix的分离逻辑
 * 3. 确认代理IP访问配置正确
 */

import { resolveAffiliateLink, getProxyPool } from '../src/lib/url-resolver-enhanced'
import Database from 'better-sqlite3'

const DB_PATH = '/Users/jason/Documents/Kiro/autobb/data/autoads.db'

async function testFinalUrlSuffixExtraction() {
  console.log('='.repeat(80))
  console.log('🔍 Final URL Suffix提取验证测试')
  console.log('='.repeat(80))

  // ========== 步骤1: 加载代理池 ==========
  console.log('\n📋 步骤1: 加载代理配置')
  const db = new Database(DB_PATH)

  const proxies = db.prepare(`
    SELECT * FROM system_settings
    WHERE category = 'proxy' AND config_key = 'urls'
    AND (user_id IS NULL OR user_id = ?)
    ORDER BY user_id DESC LIMIT 1
  `).get(1.0) as any

  if (!proxies || !proxies.config_value) {
    console.error('❌ 未找到代理配置')
    process.exit(1)
  }

  const proxyList = JSON.parse(proxies.config_value)
  const proxyPool = getProxyPool()
  await proxyPool.loadProxies(proxyList)

  console.log(`✅ 代理池已加载: ${proxyList.length}个代理`)
  proxyList.forEach((p: any, i: number) => {
    console.log(`   ${i + 1}. ${p.country} - ${p.url} ${p.is_default ? '(默认)' : ''}`)
  })

  // ========== 步骤2: 测试用例配置 ==========
  console.log('\n📋 步骤2: 测试用例配置')

  const testCases = [
    {
      name: '用户提供的示例链接（UKTs4I6）',
      affiliateLink: 'https://pboost.me/UKTs4I6',
      expectedFinalUrl: 'https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA',
      expectedHasSuffix: true,
      expectedSuffixPattern: /maas=.*&ref_=.*&tag=.*&aa_campaignid=/,
      targetCountry: 'US'
    },
    {
      name: '日志中的链接（ILK1tG3）',
      affiliateLink: 'https://pboost.me/ILK1tG3',
      expectedFinalUrl: null, // 未知
      expectedHasSuffix: null, // 需要验证
      expectedSuffixPattern: null,
      targetCountry: 'US'
    }
  ]

  // ========== 步骤3: 逐个测试 ==========
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i]
    console.log(`\n${'='.repeat(80)}`)
    console.log(`📝 测试用例 ${i + 1}: ${testCase.name}`)
    console.log(`${'='.repeat(80)}`)
    console.log(`推广链接: ${testCase.affiliateLink}`)
    console.log(`目标国家: ${testCase.targetCountry}`)

    try {
      const startTime = Date.now()

      // 强制跳过缓存，获取最新数据
      console.log('\n🔄 开始解析（跳过缓存）...')
      const result = await resolveAffiliateLink(testCase.affiliateLink, {
        targetCountry: testCase.targetCountry,
        skipCache: true  // 🔥 关键：跳过缓存
      })

      const duration = Date.now() - startTime

      // ========== 步骤4: 结果分析 ==========
      console.log(`\n✅ 解析完成 (耗时: ${duration}ms)`)
      console.log(`\n📊 解析结果:`)
      console.log(`   Final URL: ${result.finalUrl}`)
      console.log(`   Final URL Suffix: ${result.finalUrlSuffix || '(无查询参数)'}`)
      console.log(`   Suffix长度: ${result.finalUrlSuffix.length} 字符`)
      console.log(`   重定向次数: ${result.redirectCount}`)
      console.log(`   解析方式: ${result.resolveMethod}`)
      console.log(`   使用代理: ${result.proxyUsed}`)
      console.log(`   页面标题: ${result.pageTitle || '(未获取)'}`)

      // 显示重定向链
      console.log(`\n🔗 重定向链 (${result.redirectChain.length}步):`)
      result.redirectChain.forEach((url, idx) => {
        const urlObj = new URL(url)
        const hasParams = urlObj.search.length > 1
        console.log(`   ${idx + 1}. ${url.substring(0, 80)}${url.length > 80 ? '...' : ''}`)
        console.log(`      ${hasParams ? '✅ 有查询参数' : '❌ 无查询参数'}`)
      })

      // ========== 步骤5: 验证结果 ==========
      console.log(`\n🔍 验证结果:`)

      // 验证Final URL
      if (testCase.expectedFinalUrl) {
        const finalUrlMatch = result.finalUrl === testCase.expectedFinalUrl
        console.log(`   Final URL匹配: ${finalUrlMatch ? '✅' : '❌'}`)
        if (!finalUrlMatch) {
          console.log(`      期望: ${testCase.expectedFinalUrl}`)
          console.log(`      实际: ${result.finalUrl}`)
        }
      }

      // 验证Final URL Suffix
      if (testCase.expectedHasSuffix !== null) {
        const hasSuffix = result.finalUrlSuffix.length > 0
        const suffixMatch = hasSuffix === testCase.expectedHasSuffix
        console.log(`   有Final URL Suffix: ${suffixMatch ? '✅' : '❌'} (${hasSuffix ? '是' : '否'})`)

        if (hasSuffix && testCase.expectedSuffixPattern) {
          const patternMatch = testCase.expectedSuffixPattern.test(result.finalUrlSuffix)
          console.log(`   Suffix格式匹配: ${patternMatch ? '✅' : '❌'}`)
          if (!patternMatch) {
            console.log(`      期望模式: ${testCase.expectedSuffixPattern}`)
            console.log(`      实际Suffix: ${result.finalUrlSuffix.substring(0, 200)}...`)
          }
        }
      }

      // 验证URL分离逻辑
      const reconstructedUrl = result.finalUrlSuffix
        ? `${result.finalUrl}?${result.finalUrlSuffix}`
        : result.finalUrl
      console.log(`\n🔧 URL重组验证:`)
      console.log(`   Final URL: ${result.finalUrl}`)
      console.log(`   + Suffix: ${result.finalUrlSuffix ? '?' + result.finalUrlSuffix.substring(0, 50) + '...' : '(无)'}`)
      console.log(`   = 完整URL长度: ${reconstructedUrl.length} 字符`)

      // ========== 步骤6: Google Ads配置预览 ==========
      console.log(`\n📢 Google Ads配置预览:`)
      console.log(`   Campaign层级 - Final URL Suffix:`)
      console.log(`      ${result.finalUrlSuffix || '(空字符串)'}`)
      console.log(`   Ad层级 - Final URL:`)
      console.log(`      ${result.finalUrl}`)

    } catch (error: any) {
      console.error(`\n❌ 测试失败: ${error.message}`)
      console.error(error.stack)
    }
  }

  // ========== 总结 ==========
  console.log(`\n${'='.repeat(80)}`)
  console.log(`📋 测试总结`)
  console.log(`${'='.repeat(80)}`)
  console.log(`1. 代理IP配置: ✅ 正常`)
  console.log(`2. URL解析功能: ${testCases.length}个测试用例`)
  console.log(`3. Final URL Suffix提取: 见上述各测试用例结果`)
  console.log(`\n💡 建议:`)
  console.log(`   - 如果Suffix为空，检查推广链接配置`)
  console.log(`   - 如果重定向链中丢失参数，可能是Amazon清理机制`)
  console.log(`   - 使用skipCache=true确保获取最新数据`)

  db.close()
}

// 运行测试
testFinalUrlSuffixExtraction().catch(console.error)
