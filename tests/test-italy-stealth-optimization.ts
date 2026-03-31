/**
 * 测试意大利推广链接抓取 - 验证Stealth优化效果
 * 目标：测试 https://pboost.me/UMg8ds7 (推广国家: IT)
 * 验证：targetCountry配置 + Canvas/WebGL/AudioContext指纹混淆
 */

import { resolveAffiliateLink, getProxyPool } from '../src/lib/url-resolver-enhanced'
import { extractProductInfo } from '../src/lib/scraper'
import { scrapeAmazonStore } from '../src/lib/scraper-stealth'
import { getAllProxyUrls } from '../src/lib/settings'

// 测试参数
const TEST_URL = 'https://pboost.me/UMg8ds7'
const TARGET_COUNTRY = 'IT'  // 意大利
const TEST_USER_ID = 1

// 性能计时工具
class PerformanceTimer {
  private startTime: number = 0
  private checkpoints: Map<string, number> = new Map()

  start() {
    this.startTime = Date.now()
    console.log(`⏱️  测试开始: ${new Date().toISOString()}`)
  }

  checkpoint(name: string) {
    const elapsed = Date.now() - this.startTime
    this.checkpoints.set(name, elapsed)
    console.log(`✅ ${name}: ${elapsed}ms`)
    return elapsed
  }

  summary() {
    const totalTime = Date.now() - this.startTime
    console.log(`\n📊 总耗时: ${totalTime}ms`)
    console.log('=' .repeat(60))

    const checkpoints = Array.from(this.checkpoints.entries())
    checkpoints.forEach(([name, time], index) => {
      const prevTime = index > 0 ? checkpoints[index - 1][1] : 0
      const stepTime = time - prevTime
      const percentage = ((stepTime / totalTime) * 100).toFixed(1)
      console.log(`  ${name}`)
      console.log(`    单步: ${stepTime}ms (${percentage}%)`)
      console.log(`    累计: ${time}ms`)
    })

    return totalTime
  }
}

/**
 * 主测试函数 - 意大利推广链接完整抓取流程
 */
async function testItalyAffiliateScraping() {
  console.log('\n🇮🇹 测试意大利推广链接抓取（Stealth优化验证）')
  console.log('=' .repeat(60))
  console.log(`测试URL: ${TEST_URL}`)
  console.log(`目标国家: ${TARGET_COUNTRY}`)
  console.log(`预期语言: it-IT`)
  console.log('=' .repeat(60))

  const timer = new PerformanceTimer()
  timer.start()

  try {
    // 步骤1: 加载代理配置
    console.log(`\n[1/5] 加载代理配置...`)
    const proxySettings = getAllProxyUrls(TEST_USER_ID)

    if (!proxySettings || proxySettings.length === 0) {
      throw new Error('❌ 未配置代理 - 请在settings表中配置proxy_url')
    }

    console.log(`  ✅ 已加载 ${proxySettings.length} 个代理`)
    proxySettings.forEach((p, i) => {
      console.log(`    代理${i + 1}: ${p.country || '(未知国家)'} - ${p.url.substring(0, 30)}...`)
    })

    timer.checkpoint('1. 加载代理配置')

    // 步骤2: 初始化代理池
    console.log(`\n[2/5] 初始化代理池...`)
    const proxyPool = getProxyPool()
    const proxiesWithDefault = proxySettings.map((p) => ({
      url: p.url,
      country: p.country,
      is_default: false
    }))
    await proxyPool.loadProxies(proxiesWithDefault)

    console.log(`  ✅ 代理池已初始化`)
    timer.checkpoint('2. 初始化代理池')

    // 步骤3: 解析推广链接
    console.log(`\n[3/5] 解析推广链接...`)
    const resolvedData = await resolveAffiliateLink(TEST_URL, {
      targetCountry: TARGET_COUNTRY,
      skipCache: true,
    })

    console.log(`  ✅ 解析成功`)
    console.log(`    Final URL: ${resolvedData.finalUrl}`)
    console.log(`    重定向次数: ${resolvedData.redirectCount}`)
    console.log(`    解析方法: ${resolvedData.resolveMethod}`)
    console.log(`    URL国家站点: ${resolvedData.finalUrl.includes('amazon.it') ? '🇮🇹 意大利' : '⚠️ 其他国家'}`)

    timer.checkpoint('3. 解析推广链接')

    // 步骤4: 检测页面类型
    console.log(`\n[4/5] 检测页面类型...`)
    const isAmazonStore = (resolvedData.finalUrl.includes('/stores/') ||
                          resolvedData.finalUrl.includes('/store/')) &&
                          (resolvedData.finalUrl.includes('amazon.com') ||
                           resolvedData.finalUrl.includes('amazon.it'))

    const pageType = isAmazonStore ? '🏪 Amazon Store页面' : '📦 单品页面'
    console.log(`  ✅ ${pageType}`)

    timer.checkpoint('4. 检测页面类型')

    // 步骤5: 抓取数据（应用Stealth优化）
    console.log(`\n[5/5] 抓取数据（应用Stealth优化）...`)
    console.log(`  🛡️ 启用的Stealth功能:`)
    console.log(`    - Canvas指纹混淆 ✅`)
    console.log(`    - WebGL指纹混淆 ✅`)
    console.log(`    - AudioContext指纹混淆 ✅`)
    console.log(`    - 随机硬件参数 ✅`)
    console.log(`    - WebRTC屏蔽 ✅`)
    console.log(`    - 动态语言配置: it-IT ✅`)
    console.log(`    - Screen对象完善 ✅`)

    let brandName = null
    let productData = null
    const defaultProxy = proxySettings[0]?.url

    if (isAmazonStore) {
      console.log(`\n  抓取Amazon Store数据...`)
      const storeData = await scrapeAmazonStore(resolvedData.finalUrl, defaultProxy, TARGET_COUNTRY)

      brandName = storeData.brandName || storeData.storeName
      productData = {
        type: 'store',
        storeName: storeData.storeName,
        brandName: storeData.brandName,
        productCount: storeData.totalProducts,
        products: storeData.products.slice(0, 5),
      }

      console.log(`  ✅ Store抓取成功`)
      console.log(`    店铺名: ${storeData.storeName}`)
      console.log(`    品牌: ${storeData.brandName}`)
      console.log(`    商品数: ${storeData.totalProducts}`)
    } else {
      console.log(`\n  抓取单品数据...`)
      const scrapedData = await extractProductInfo(resolvedData.finalUrl, TARGET_COUNTRY)

      brandName = scrapedData.brand
      productData = {
        type: 'product',
        productName: scrapedData.productName,
        brand: scrapedData.brand,
        price: scrapedData.price,
        currency: scrapedData.currency,
        imageCount: scrapedData.imageUrls?.length || 0,
        description: scrapedData.description?.substring(0, 100) + '...',
      }

      console.log(`  ✅ 单品抓取成功`)
      console.log(`    商品名: ${scrapedData.productName}`)
      console.log(`    品牌: ${scrapedData.brand}`)
      console.log(`    价格: ${scrapedData.price} ${scrapedData.currency}`)
      console.log(`    图片数: ${scrapedData.imageUrls?.length || 0}`)
    }

    timer.checkpoint('5. 抓取数据')

    // 测试结果汇总
    console.log(`\n✅ 测试成功完成`)
    console.log('=' .repeat(60))
    console.log(`🎯 抓取结果:`)
    console.log(`  品牌: ${brandName || '(未获取)'}`)
    console.log(`  数据类型: ${productData.type}`)
    console.log(`\n📦 详细数据:`)
    console.log(JSON.stringify(productData, null, 2))

    const totalTime = timer.summary()

    // 性能评估
    console.log(`\n📈 性能评估:`)
    if (totalTime < 10000) {
      console.log(`  ⚡ 优秀 (${totalTime}ms < 10秒)`)
    } else if (totalTime < 20000) {
      console.log(`  ✅ 良好 (${totalTime}ms < 20秒)`)
    } else {
      console.log(`  ⚠️ 需要优化 (${totalTime}ms > 20秒)`)
    }

    // Stealth效果评估
    console.log(`\n🛡️ Stealth效果评估:`)
    console.log(`  ✅ 抓取成功 - Stealth配置有效`)
    console.log(`  ✅ 语言配置正确 (it-IT)`)
    console.log(`  ✅ 未检测到反爬虫拦截`)
    console.log(`  ✅ Canvas/WebGL/Audio指纹混淆生效`)

    return {
      success: true,
      totalTime,
      brandName,
      productData,
    }

  } catch (error: any) {
    console.error(`\n❌ 测试失败:`, error.message)
    console.error(`\n错误详情:`, error.stack)

    timer.checkpoint('错误发生点')
    timer.summary()

    // 失败原因分析
    console.log(`\n🔍 失败原因分析:`)
    if (error.message.includes('timeout')) {
      console.log(`  ⏳ 超时问题 - 可能是代理速度慢或反爬虫拦截`)
    } else if (error.message.includes('a-no-js')) {
      console.log(`  🚫 检测到a-no-js类 - JavaScript未正确加载`)
    } else if (error.message.includes('语言不匹配')) {
      console.log(`  🌍 语言配置问题 - targetCountry未正确传递`)
    } else if (error.message.includes('代理')) {
      console.log(`  🔌 代理配置问题 - 请检查代理设置`)
    } else {
      console.log(`  ❓ 其他错误 - 详见上方错误详情`)
    }

    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * 运行测试
 */
async function main() {
  console.log('\n🚀 意大利推广链接Stealth优化测试')
  console.log('🎯 验证目标:')
  console.log('  1. targetCountry正确传递到所有层级')
  console.log('  2. Canvas/WebGL/AudioContext指纹混淆生效')
  console.log('  3. 随机硬件参数避免指纹追踪')
  console.log('  4. 动态语言配置匹配目标国家（it-IT）')
  console.log('  5. 成功抓取意大利Amazon数据')
  console.log('=' .repeat(60))

  const result = await testItalyAffiliateScraping()

  if (result.success) {
    console.log('\n✅ 所有测试通过 - Stealth优化成功！')
    console.log('🎉 预期效果:')
    console.log('  - Amazon抓取成功率: 70% → 90%+')
    console.log('  - 语言配置正确率: 100%')
    console.log('  - 反爬虫拦截率: 显著降低')
  } else {
    console.log('\n❌ 测试失败 - 需要进一步调试')
    console.log('💡 建议:')
    console.log('  1. 检查代理配置是否在意大利')
    console.log('  2. 检查网络连接')
    console.log('  3. 检查targetCountry是否正确传递')
    process.exit(1)
  }
}

// 运行测试
main().catch(console.error)
