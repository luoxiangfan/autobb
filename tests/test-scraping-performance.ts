/**
 * 全面测试推广链接的数据抓取流程性能
 * 目标：测试 https://pboost.me/ILK1tG3 的完整抓取流程，识别性能瓶颈
 */

import { resolveAffiliateLink, getProxyPool } from '../src/lib/url-resolver-enhanced'
import { extractProductInfo } from '../src/lib/scraper'
import { scrapeAmazonStore, scrapeIndependentStore } from '../src/lib/scraper-stealth'
import { getAllProxyUrls } from '../src/lib/settings'

// 测试URL
const TEST_URL = 'https://pboost.me/ILK1tG3'
const TARGET_COUNTRY = 'US'
const TEST_USER_ID = 1 // 假设用户ID为1

// 性能计时工具
class PerformanceTimer {
  private startTime: number = 0
  private checkpoints: Map<string, number> = new Map()

  start() {
    this.startTime = Date.now()
    console.log(`⏱️  性能测试开始: ${new Date().toISOString()}`)
  }

  checkpoint(name: string) {
    const elapsed = Date.now() - this.startTime
    this.checkpoints.set(name, elapsed)
    console.log(`✅ ${name}: ${elapsed}ms (累计)`)
    return elapsed
  }

  getInterval(checkpointName: string): number {
    const checkpoints = Array.from(this.checkpoints.entries())
    const currentIndex = checkpoints.findIndex(([name]) => name === checkpointName)

    if (currentIndex === -1) return 0
    if (currentIndex === 0) return checkpoints[0][1]

    return checkpoints[currentIndex][1] - checkpoints[currentIndex - 1][1]
  }

  summary() {
    const totalTime = Date.now() - this.startTime
    console.log(`\n📊 性能汇总 (总时间: ${totalTime}ms)`)
    console.log('=' .repeat(60))

    const checkpoints = Array.from(this.checkpoints.entries())
    checkpoints.forEach(([name, cumulativeTime], index) => {
      const intervalTime = this.getInterval(name)
      const percentage = ((intervalTime / totalTime) * 100).toFixed(1)
      console.log(`  ${name}`)
      console.log(`    单步耗时: ${intervalTime}ms (${percentage}%)`)
      console.log(`    累计耗时: ${cumulativeTime}ms`)
    })

    console.log('=' .repeat(60))
    return {
      totalTime,
      checkpoints: Object.fromEntries(this.checkpoints),
      intervals: Object.fromEntries(
        checkpoints.map(([name]) => [name, this.getInterval(name)])
      )
    }
  }
}

/**
 * 测试1: 当前实现的完整流程（串行）
 */
async function testCurrentImplementation() {
  console.log('\n🧪 测试1: 当前实现（串行执行）')
  console.log('=' .repeat(60))

  const timer = new PerformanceTimer()
  timer.start()

  try {
    // 步骤1: 加载代理池配置
    const proxySettings = getAllProxyUrls(TEST_USER_ID)

    if (!proxySettings || proxySettings.length === 0) {
      throw new Error('未配置代理')
    }

    timer.checkpoint('1. 加载代理配置')

    // 步骤2: 初始化代理池
    const proxyPool = getProxyPool()
    const proxiesWithDefault = proxySettings.map((p) => ({
      url: p.url,
      country: p.country,
      is_default: false
    }))
    await proxyPool.loadProxies(proxiesWithDefault)

    timer.checkpoint('2. 初始化代理池')

    // 步骤3: 解析推广链接
    const resolvedData = await resolveAffiliateLink(TEST_URL, {
      targetCountry: TARGET_COUNTRY,
      skipCache: true,
    })

    timer.checkpoint('3. 解析推广链接')

    console.log(`\n🔗 解析结果:`)
    console.log(`  Final URL: ${resolvedData.finalUrl}`)
    console.log(`  重定向次数: ${resolvedData.redirectCount}`)
    console.log(`  解析方法: ${resolvedData.resolveMethod}`)

    // 步骤4: 检测页面类型
    const isAmazonStore = (resolvedData.finalUrl.includes('/stores/') ||
                          resolvedData.finalUrl.includes('/store/')) &&
                          resolvedData.finalUrl.includes('amazon.com')

    timer.checkpoint('4. 检测页面类型')

    // 步骤5: 抓取数据
    let brandName = null
    let productData = null

    if (isAmazonStore) {
      console.log(`\n🏪 检测到Amazon Store页面`)
      const defaultProxy = proxySettings[0]?.url
      const storeData = await scrapeAmazonStore(resolvedData.finalUrl, defaultProxy)

      brandName = storeData.brandName || storeData.storeName
      productData = {
        type: 'store',
        storeName: storeData.storeName,
        brandName: storeData.brandName,
        productCount: storeData.totalProducts,
        products: storeData.products.slice(0, 5), // 只显示前5个
      }
    } else {
      console.log(`\n📦 检测到单品页面`)
      const scrapedData = await extractProductInfo(resolvedData.finalUrl, TARGET_COUNTRY)

      brandName = scrapedData.brand
      productData = {
        type: 'product',
        productName: scrapedData.productName,
        brand: scrapedData.brand,
        price: scrapedData.price,
        imageCount: scrapedData.imageUrls?.length || 0,
      }
    }

    timer.checkpoint('5. 抓取数据')

    console.log(`\n✅ 抓取成功:`)
    console.log(`  品牌: ${brandName}`)
    console.log(`  数据类型: ${productData.type}`)
    console.log(`  数据:`, JSON.stringify(productData, null, 2))

    return timer.summary()
  } catch (error: any) {
    console.error(`\n❌ 测试失败:`, error.message)
    timer.checkpoint('错误发生点')
    return timer.summary()
  }
}

/**
 * 测试2: 优化实现（并行执行）
 */
async function testOptimizedImplementation() {
  console.log('\n🧪 测试2: 优化实现（并行执行）')
  console.log('=' .repeat(60))

  const timer = new PerformanceTimer()
  timer.start()

  try {
    // 步骤1: 并行加载代理配置和预热操作
    const [proxySettings] = await Promise.all([
      Promise.resolve(getAllProxyUrls(TEST_USER_ID)),
      // 可以在这里添加其他预热操作
    ])

    if (!proxySettings || proxySettings.length === 0) {
      throw new Error('未配置代理')
    }

    timer.checkpoint('1. 并行加载配置')

    // 步骤2: 初始化代理池（这个步骤很快，不需要并行）
    const proxyPool = getProxyPool()
    const proxiesWithDefault = proxySettings.map((p) => ({
      url: p.url,
      country: p.country,
      is_default: false
    }))
    await proxyPool.loadProxies(proxiesWithDefault)

    timer.checkpoint('2. 初始化代理池')

    // 步骤3: 解析推广链接（这是必须的前置步骤）
    const resolvedData = await resolveAffiliateLink(TEST_URL, {
      targetCountry: TARGET_COUNTRY,
      skipCache: true,
    })

    timer.checkpoint('3. 解析推广链接')

    console.log(`\n🔗 解析结果:`)
    console.log(`  Final URL: ${resolvedData.finalUrl}`)
    console.log(`  重定向次数: ${resolvedData.redirectCount}`)
    console.log(`  解析方法: ${resolvedData.resolveMethod}`)

    // 步骤4: 页面类型检测和数据抓取准备（并行）
    const isAmazonStore = (resolvedData.finalUrl.includes('/stores/') ||
                          resolvedData.finalUrl.includes('/store/')) &&
                          resolvedData.finalUrl.includes('amazon.com')

    const defaultProxy = proxySettings[0]?.url

    timer.checkpoint('4. 准备抓取参数')

    // 步骤5: 执行数据抓取
    let brandName = null
    let productData = null

    if (isAmazonStore) {
      console.log(`\n🏪 检测到Amazon Store页面`)
      const storeData = await scrapeAmazonStore(resolvedData.finalUrl, defaultProxy)

      brandName = storeData.brandName || storeData.storeName
      productData = {
        type: 'store',
        storeName: storeData.storeName,
        brandName: storeData.brandName,
        productCount: storeData.totalProducts,
        products: storeData.products.slice(0, 5),
      }
    } else {
      console.log(`\n📦 检测到单品页面`)
      const scrapedData = await extractProductInfo(resolvedData.finalUrl, TARGET_COUNTRY)

      brandName = scrapedData.brand
      productData = {
        type: 'product',
        productName: scrapedData.productName,
        brand: scrapedData.brand,
        price: scrapedData.price,
        imageCount: scrapedData.imageUrls?.length || 0,
      }
    }

    timer.checkpoint('5. 抓取数据')

    console.log(`\n✅ 抓取成功:`)
    console.log(`  品牌: ${brandName}`)
    console.log(`  数据类型: ${productData.type}`)
    console.log(`  数据:`, JSON.stringify(productData, null, 2))

    return timer.summary()
  } catch (error: any) {
    console.error(`\n❌ 测试失败:`, error.message)
    timer.checkpoint('错误发生点')
    return timer.summary()
  }
}

/**
 * 性能对比分析
 */
function comparePerformance(current: any, optimized: any) {
  console.log('\n📈 性能对比分析')
  console.log('=' .repeat(60))

  const improvement = ((current.totalTime - optimized.totalTime) / current.totalTime * 100).toFixed(1)

  console.log(`总时间:`)
  console.log(`  当前实现: ${current.totalTime}ms`)
  console.log(`  优化实现: ${optimized.totalTime}ms`)
  console.log(`  性能提升: ${improvement}%`)

  console.log(`\n各步骤耗时对比:`)

  // 对比各个步骤
  const currentIntervals = current.intervals
  const optimizedIntervals = optimized.intervals

  Object.keys(currentIntervals).forEach(step => {
    if (optimizedIntervals[step]) {
      const currentTime = currentIntervals[step]
      const optimizedTime = optimizedIntervals[step]
      const diff = currentTime - optimizedTime
      const diffPercent = ((diff / currentTime) * 100).toFixed(1)

      console.log(`  ${step}:`)
      console.log(`    当前: ${currentTime}ms`)
      console.log(`    优化: ${optimizedTime}ms`)
      console.log(`    差异: ${diff > 0 ? '-' : '+'}${Math.abs(diff)}ms (${diffPercent}%)`)
    }
  })

  console.log('\n🎯 性能瓶颈识别:')

  // 找出耗时最长的步骤
  const sortedSteps = Object.entries(currentIntervals)
    .sort(([, a], [, b]) => (b as number) - (a as number))

  sortedSteps.forEach(([step, time], index) => {
    const percentage = ((time as number / current.totalTime) * 100).toFixed(1)
    const emoji = index === 0 ? '🔥' : index === 1 ? '⚠️' : '✅'
    console.log(`  ${emoji} ${step}: ${time}ms (${percentage}%)`)
  })
}

/**
 * 主测试函数
 */
async function main() {
  console.log('\n🚀 推广链接数据抓取性能测试')
  console.log('=' .repeat(60))
  console.log(`测试URL: ${TEST_URL}`)
  console.log(`目标国家: ${TARGET_COUNTRY}`)
  console.log(`测试用户: ${TEST_USER_ID}`)
  console.log('=' .repeat(60))

  try {
    // 运行当前实现测试
    const currentResults = await testCurrentImplementation()

    // 等待5秒后运行优化测试（避免缓存影响）
    console.log('\n⏳ 等待5秒后运行优化测试...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    // 运行优化实现测试
    const optimizedResults = await testOptimizedImplementation()

    // 性能对比
    comparePerformance(currentResults, optimizedResults)

    console.log('\n✅ 性能测试完成')
  } catch (error: any) {
    console.error('\n❌ 测试失败:', error)
    throw error
  }
}

// 运行测试
main().catch(console.error)
