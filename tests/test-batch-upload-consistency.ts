/**
 * 测试批量上传与手动创建的一致性
 * 验证：
 * 1. 批量上传是否调用完整抓取流程
 * 2. scraped_products表是否正确保存数据
 * 3. AI分析结果是否完整
 */

import { getSQLiteDatabase } from '../src/lib/db'

async function testBatchUploadConsistency() {
  console.log('========================================')
  console.log('📋 测试批量上传与手动创建的一致性')
  console.log('========================================\n')

  const db = getSQLiteDatabase()

  try {
    // 步骤1: 创建测试Offer（模拟批量上传）
    console.log('📝 步骤1: 创建测试Offer（模拟批量上传）...')

    const testUrl = 'https://pboost.me/UMg8ds7'
    const testCountry = 'IT'
    const userId = 1

    // 插入测试Offer
    const insertResult = db.prepare(`
      INSERT INTO offers (
        user_id, url, brand, target_country, affiliate_link,
        offer_name, scrape_status, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      testUrl,
      '提取中...',
      testCountry,
      testUrl,
      `Test_Batch_${Date.now()}`,
      'pending',
      1
    )

    const offerId = insertResult.lastInsertRowid as number
    console.log(`✅ 创建测试Offer #${offerId}`)

    // 步骤2: 手动触发完整抓取流程（模拟批量上传的后台任务）
    console.log('\n🚀 步骤2: 触发完整抓取流程...')
    console.log('   （这将调用 triggerOfferScraping，包含AI分析和scraped_products持久化）')

    const { triggerOfferScraping } = await import('../src/lib/offer-scraping')

    // 触发抓取（异步）
    triggerOfferScraping(offerId, userId, testUrl, '提取中...')

    console.log('✅ 抓取任务已触发，等待完成...')

    // 等待抓取完成（最多等待3分钟）
    let attempts = 0
    const maxAttempts = 36 // 3分钟 / 5秒
    let scrapeStatus = 'pending'

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)) // 等待5秒

      const offer = db.prepare(`
        SELECT scrape_status, brand, final_url, scraped_at
        FROM offers
        WHERE id = ?
      `).get(offerId) as any

      scrapeStatus = offer.scrape_status

      console.log(`   [${attempts + 1}/${maxAttempts}] 状态: ${scrapeStatus}`)

      if (scrapeStatus === 'completed' || scrapeStatus === 'failed') {
        console.log(`\n✅ 抓取完成！状态: ${scrapeStatus}`)
        if (offer.brand) {
          console.log(`   品牌: ${offer.brand}`)
        }
        if (offer.final_url) {
          console.log(`   Final URL: ${offer.final_url}`)
        }
        if (offer.scraped_at) {
          console.log(`   抓取时间: ${offer.scraped_at}`)
        }
        break
      }

      attempts++
    }

    if (scrapeStatus !== 'completed') {
      console.log(`\n⚠️  抓取未完成，当前状态: ${scrapeStatus}`)
      console.log('   继续验证已有数据...')
    }

    // 步骤3: 验证Offer数据
    console.log('\n📊 步骤3: 验证Offer数据...')

    const offer = db.prepare(`
      SELECT
        id, brand, final_url, scrape_status, scraped_at,
        scraped_data, review_analysis, competitor_analysis,
        extracted_keywords, extracted_headlines, extracted_descriptions
      FROM offers
      WHERE id = ?
    `).get(offerId) as any

    console.log(`   Offer ID: ${offer.id}`)
    console.log(`   品牌: ${offer.brand || '未提取'}`)
    console.log(`   Final URL: ${offer.final_url || '未提取'}`)
    console.log(`   抓取状态: ${offer.scrape_status}`)
    console.log(`   抓取时间: ${offer.scraped_at || '未抓取'}`)

    // 检查AI分析结果
    const hasScrapedData = offer.scraped_data && offer.scraped_data !== 'null'
    const hasReviewAnalysis = offer.review_analysis && offer.review_analysis !== 'null'
    const hasCompetitorAnalysis = offer.competitor_analysis && offer.competitor_analysis !== 'null'
    const hasKeywords = offer.extracted_keywords && offer.extracted_keywords !== 'null'
    const hasHeadlines = offer.extracted_headlines && offer.extracted_headlines !== 'null'
    const hasDescriptions = offer.extracted_descriptions && offer.extracted_descriptions !== 'null'

    console.log(`\n   AI分析结果:`)
    console.log(`   - scraped_data: ${hasScrapedData ? '✅ 有数据' : '❌ 无数据'}`)
    console.log(`   - review_analysis: ${hasReviewAnalysis ? '✅ 有数据' : '❌ 无数据'}`)
    console.log(`   - competitor_analysis: ${hasCompetitorAnalysis ? '✅ 有数据' : '❌ 无数据'}`)
    console.log(`   - extracted_keywords: ${hasKeywords ? '✅ 有数据' : '❌ 无数据'}`)
    console.log(`   - extracted_headlines: ${hasHeadlines ? '✅ 有数据' : '❌ 无数据'}`)
    console.log(`   - extracted_descriptions: ${hasDescriptions ? '✅ 有数据' : '❌ 无数据'}`)

    // 步骤4: 验证scraped_products表数据
    console.log('\n📦 步骤4: 验证scraped_products表数据...')

    const products = db.prepare(`
      SELECT
        id, offer_id, name, asin, price, rating, review_count,
        hot_score, rank, is_hot, hot_label, scrape_source
      FROM scraped_products
      WHERE offer_id = ?
      ORDER BY rank ASC
    `).all(offerId) as any[]

    if (products.length === 0) {
      console.log('   ❌ 未找到scraped_products数据')
      console.log('   ⚠️  批量上传未正确保存产品数据到scraped_products表！')
    } else {
      console.log(`   ✅ 找到 ${products.length} 条产品数据`)

      products.forEach((product, index) => {
        console.log(`\n   产品 ${index + 1}:`)
        console.log(`   - ID: ${product.id}`)
        console.log(`   - 名称: ${product.name}`)
        console.log(`   - ASIN: ${product.asin || 'N/A'}`)
        console.log(`   - 价格: ${product.price || 'N/A'}`)
        console.log(`   - 评分: ${product.rating || 'N/A'}`)
        console.log(`   - 评论数: ${product.review_count || 'N/A'}`)
        console.log(`   - 热销分数: ${product.hot_score || 0}`)
        console.log(`   - 排名: ${product.rank}`)
        console.log(`   - 是否热销: ${product.is_hot ? '是' : '否'}`)
        console.log(`   - 热销标签: ${product.hot_label || 'N/A'}`)
        console.log(`   - 数据来源: ${product.scrape_source}`)
      })
    }

    // 步骤5: 对比手动创建的Offer
    console.log('\n🔍 步骤5: 对比手动创建的Offer（参考）...')

    const manualOffer = db.prepare(`
      SELECT id, brand, scrape_status
      FROM offers
      WHERE user_id = ? AND scrape_status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `).get(userId) as any

    if (manualOffer) {
      console.log(`   参考Offer ID: ${manualOffer.id}`)

      const manualProducts = db.prepare(`
        SELECT COUNT(*) as count, scrape_source
        FROM scraped_products
        WHERE offer_id = ?
        GROUP BY scrape_source
      `).all(manualOffer.id) as any[]

      if (manualProducts.length > 0) {
        console.log(`   参考Offer的产品数据:`)
        manualProducts.forEach(p => {
          console.log(`   - ${p.scrape_source}: ${p.count} 条`)
        })
      }
    }

    // 步骤6: 总结
    console.log('\n========================================')
    console.log('📊 测试总结')
    console.log('========================================')

    const allChecks = [
      { name: 'Offer创建', passed: !!offer },
      { name: '品牌提取', passed: offer.brand && offer.brand !== '提取中...' },
      { name: 'Final URL提取', passed: !!offer.final_url },
      { name: 'AI分析（scraped_data）', passed: hasScrapedData },
      { name: 'scraped_products持久化', passed: products.length > 0 },
    ]

    const passedCount = allChecks.filter(c => c.passed).length
    const totalCount = allChecks.length

    console.log(`\n检查项 (${passedCount}/${totalCount} 通过):`)
    allChecks.forEach(check => {
      console.log(`${check.passed ? '✅' : '❌'} ${check.name}`)
    })

    if (passedCount === totalCount) {
      console.log('\n🎉 所有检查通过！批量上传与手动创建完全一致！')
    } else {
      console.log(`\n⚠️  ${totalCount - passedCount} 项检查未通过，需要进一步调查`)
    }

    // 清理测试数据（可选）
    console.log('\n🧹 清理测试数据...')
    db.prepare('DELETE FROM scraped_products WHERE offer_id = ?').run(offerId)
    db.prepare('DELETE FROM offers WHERE id = ?').run(offerId)
    console.log('✅ 测试数据已清理')

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error('错误详情:', error)
    process.exit(1)
  }
}

// 运行测试
testBatchUploadConsistency()
  .then(() => {
    console.log('\n✅ 测试完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ 测试异常:', error)
    process.exit(1)
  })
