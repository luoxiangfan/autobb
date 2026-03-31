/**
 * 测试店铺抓取功能
 * 验证独立站和Amazon店铺的数据抓取完整性
 */

import { scrapeIndependentStoreDeep, scrapeAmazonStoreDeep } from '../src/lib/stealth-scraper'

async function testIndependentStore() {
  console.log('\n' + '='.repeat(80))
  console.log('🏪 测试独立站店铺抓取: https://itehil.com/')
  console.log('='.repeat(80))

  const startTime = Date.now()

  try {
    const storeData = await scrapeIndependentStoreDeep(
      'https://itehil.com/',
      5,  // 抓取前5个热销商品
      undefined,  // 不使用代理
      'US',  // 目标国家
      3   // 并发数
    )

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log('\n📊 抓取结果:')
    console.log('-'.repeat(40))
    console.log(`店铺名称: ${storeData.storeName}`)
    console.log(`店铺描述: ${storeData.storeDescription?.substring(0, 100)}...`)
    console.log(`Logo URL: ${storeData.logoUrl}`)
    console.log(`平台: ${storeData.platform}`)
    console.log(`店铺URL: ${storeData.storeUrl}`)
    console.log(`产品总数: ${storeData.totalProducts}`)

    console.log('\n🔥 热销洞察 (hotInsights):')
    if (storeData.hotInsights) {
      console.log(`  平均评分: ${storeData.hotInsights.avgRating.toFixed(1)}⭐`)
      console.log(`  平均评论数: ${storeData.hotInsights.avgReviews}`)
      console.log(`  热销商品数: ${storeData.hotInsights.topProductsCount}`)
    } else {
      console.log('  ⚠️ 无热销洞察数据')
    }

    console.log('\n📦 产品列表 (前10个):')
    storeData.products.slice(0, 10).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`)
      console.log(`     价格: ${p.price || 'N/A'}`)
      console.log(`     评分: ${p.rating || 'N/A'}⭐ | 评论: ${p.reviewCount || 'N/A'}`)
      console.log(`     热销评分: ${p.hotScore?.toFixed(2) || 'N/A'} | 排名: ${p.rank || 'N/A'}`)
      console.log(`     热销标签: ${p.hotLabel || 'N/A'}`)
      console.log(`     产品URL: ${p.productUrl || 'N/A'}`)
      console.log(`     图片URL: ${p.imageUrl?.substring(0, 60) || 'N/A'}...`)
    })

    console.log('\n🔍 深度抓取结果 (deepScrapeResults):')
    if (storeData.deepScrapeResults) {
      const dr = storeData.deepScrapeResults
      console.log(`  总计抓取: ${dr.totalScraped}`)
      console.log(`  成功: ${dr.successCount}`)
      console.log(`  失败: ${dr.failedCount}`)

      dr.topProducts.forEach((tp, i) => {
        console.log(`\n  [${i + 1}] ${tp.productUrl}`)
        console.log(`      状态: ${tp.scrapeStatus}`)
        if (tp.error) console.log(`      错误: ${tp.error}`)
        if (tp.productData) {
          console.log(`      产品名: ${tp.productData.productName}`)
          console.log(`      价格: ${tp.productData.productPrice}`)
          console.log(`      评分: ${tp.productData.rating}⭐ | 评论: ${tp.productData.reviewCount}`)
          console.log(`      评论数量: ${tp.reviews.length}`)
          console.log(`      竞品URL数: ${tp.competitorUrls.length}`)
        }
      })
    } else {
      console.log('  ⚠️ 无深度抓取数据')
    }

    console.log(`\n⏱️ 总耗时: ${elapsed}秒`)
    console.log('✅ 独立站抓取测试完成')

    return storeData
  } catch (error: any) {
    console.error('❌ 独立站抓取失败:', error.message)
    throw error
  }
}

async function testAmazonStore() {
  console.log('\n' + '='.repeat(80))
  console.log('🛒 测试Amazon店铺抓取')
  console.log('='.repeat(80))

  const amazonUrl = 'https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA?maas=maas_adg_api_588289795052186734_static_12_201&ref_=aa_maas&tag=maas&aa_campaignid=9323c24e59a532dc86f430bf18a14950&aa_adgroupid=e3eegM3TlnCdnz9ttQlYjqnGH_aSkswFQ075aQEwrAT2T5ZuMsCqgxsXBYurndhdJrFInJvC_aVcAe4e4_c&aa_creativeid=f8a92EklDkRmaEDmFMFL_bUxEBitimPUW1yNXUc_bVy3PsxvI_c'

  console.log(`URL: ${amazonUrl.substring(0, 80)}...`)

  const startTime = Date.now()

  try {
    const storeData = await scrapeAmazonStoreDeep(
      amazonUrl,
      5,  // 抓取前5个热销商品
      undefined,  // 不使用代理
      'US',  // 目标国家
      3   // 并发数
    )

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log('\n📊 抓取结果:')
    console.log('-'.repeat(40))
    console.log(`店铺名称: ${storeData.storeName}`)
    console.log(`店铺描述: ${storeData.storeDescription?.substring(0, 100)}...`)
    console.log(`Logo URL: ${storeData.logoUrl}`)
    console.log(`店铺URL: ${storeData.storeUrl}`)
    console.log(`产品总数: ${storeData.totalProducts}`)

    console.log('\n🔥 热销洞察 (hotInsights):')
    if (storeData.hotInsights) {
      console.log(`  平均评分: ${storeData.hotInsights.avgRating.toFixed(1)}⭐`)
      console.log(`  平均评论数: ${storeData.hotInsights.avgReviews}`)
      console.log(`  热销商品数: ${storeData.hotInsights.topProductsCount}`)
    } else {
      console.log('  ⚠️ 无热销洞察数据')
    }

    console.log('\n📦 产品列表 (前10个):')
    storeData.products.slice(0, 10).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`)
      console.log(`     ASIN: ${p.asin || 'N/A'}`)
      console.log(`     价格: ${p.price || 'N/A'}`)
      console.log(`     评分: ${p.rating || 'N/A'}⭐ | 评论: ${p.reviewCount || 'N/A'}`)
      console.log(`     热销评分: ${p.hotScore?.toFixed(2) || 'N/A'} | 排名: ${p.rank || 'N/A'}`)
      console.log(`     热销标签: ${p.hotLabel || 'N/A'}`)
      console.log(`     Prime: ${p.isPrime ? '是' : '否'}`)
      console.log(`     图片URL: ${p.imageUrl?.substring(0, 60) || 'N/A'}...`)
    })

    console.log('\n🔍 深度抓取结果 (deepScrapeResults):')
    if (storeData.deepScrapeResults) {
      const dr = storeData.deepScrapeResults
      console.log(`  总计抓取: ${dr.totalScraped}`)
      console.log(`  成功: ${dr.successCount}`)
      console.log(`  失败: ${dr.failedCount}`)

      dr.topProducts.forEach((tp, i) => {
        console.log(`\n  [${i + 1}] ASIN: ${tp.asin}`)
        console.log(`      状态: ${tp.scrapeStatus}`)
        if (tp.error) console.log(`      错误: ${tp.error}`)
        if (tp.productData) {
          console.log(`      产品名: ${tp.productData.productName}`)
          console.log(`      价格: ${tp.productData.productPrice}`)
          console.log(`      评分: ${tp.productData.rating}⭐ | 评论: ${tp.productData.reviewCount}`)
          console.log(`      评论数量: ${tp.reviews.length}`)
          console.log(`      竞品ASIN数: ${tp.competitorAsins.length}`)
        }
      })
    } else {
      console.log('  ⚠️ 无深度抓取数据')
    }

    console.log(`\n⏱️ 总耗时: ${elapsed}秒`)
    console.log('✅ Amazon店铺抓取测试完成')

    return storeData
  } catch (error: any) {
    console.error('❌ Amazon店铺抓取失败:', error.message)
    throw error
  }
}

async function main() {
  console.log('🚀 开始测试店铺抓取功能...\n')

  // 测试独立站
  try {
    await testIndependentStore()
  } catch (e) {
    console.error('独立站测试失败')
  }

  console.log('\n' + '━'.repeat(80) + '\n')

  // 测试Amazon店铺
  try {
    await testAmazonStore()
  } catch (e) {
    console.error('Amazon测试失败')
  }

  console.log('\n🎉 所有测试完成!')
  process.exit(0)
}

main().catch(console.error)
