/**
 * 测试Offer 245重新抓取
 * 验证重构后的统一抓取流程是否正确存储增强模块数据
 */

import { performScrapeAndAnalysis } from '../src/lib/offer-scraping-core'
import { getSQLiteDatabase } from '../src/lib/db'

async function testOffer245Rescrape() {
  console.log('🧪 开始测试Offer 245重新抓取...\n')

  const offerId = 245
  const userId = 1
  const url = 'https://www.amazon.it/dp/B0DBVMD8Z8'
  const brand = 'Eufy'

  try {
    // 1. 清空之前的scraped_products数据
    console.log('📋 步骤1: 清空之前的scraped_products数据...')
    const db = getSQLiteDatabase()
    const deleteStmt = db.prepare('DELETE FROM scraped_products WHERE offer_id = ?')
    deleteStmt.run(offerId)
    console.log('✅ 已清空\n')

    // 2. 执行重新抓取
    console.log('📋 步骤2: 执行重新抓取（调用统一核心函数）...')
    console.log(`   Offer ID: ${offerId}`)
    console.log(`   User ID: ${userId}`)
    console.log(`   URL: ${url}`)
    console.log(`   Brand: ${brand}\n`)

    await performScrapeAndAnalysis(offerId, userId, url, brand)

    console.log('✅ 抓取完成\n')

    // 3. 验证scraped_products数据
    console.log('📋 步骤3: 验证scraped_products数据...')
    const products = db.prepare(`
      SELECT id, name, price, rating, review_count, hot_score, rank, is_hot,
             promotion, badge, is_prime, scrape_source
      FROM scraped_products
      WHERE offer_id = ?
      ORDER BY hot_score DESC
      LIMIT 10
    `).all(offerId)

    if (products.length === 0) {
      console.log('❌ 失败：scraped_products表中没有数据')
      return false
    }

    console.log(`✅ 成功：找到${products.length}个产品`)
    console.log('\n📊 产品数据示例（Top 5）:')
    products.slice(0, 5).forEach((p: any, i: number) => {
      console.log(`\n${i + 1}. ${p.name}`)
      console.log(`   价格: ${p.price || 'N/A'}`)
      console.log(`   评分: ${p.rating || 'N/A'}⭐`)
      console.log(`   评论数: ${p.review_count || 'N/A'}`)
      console.log(`   热销分数: ${p.hot_score || 'N/A'}`)
      console.log(`   排名: ${p.rank || 'N/A'}`)
      console.log(`   热销标签: ${p.is_hot ? '🔥 热销' : '✅ 畅销'}`)
      if (p.promotion) console.log(`   促销: ${p.promotion}`)
      if (p.badge) console.log(`   徽章: ${p.badge}`)
      if (p.is_prime) console.log(`   Prime: ✓`)
      console.log(`   数据源: ${p.scrape_source}`)
    })

    // 4. 验证offers表的增强数据
    console.log('\n📋 步骤4: 验证offers表的增强数据...')
    const offer = db.prepare(`
      SELECT scraped_data, extracted_keywords, extracted_headlines, extracted_descriptions,
             review_analysis, competitor_analysis
      FROM offers
      WHERE id = ?
    `).get(offerId) as any

    const checks = [
      { name: 'scraped_data', value: offer?.scraped_data },
      { name: 'extracted_keywords', value: offer?.extracted_keywords },
      { name: 'extracted_headlines', value: offer?.extracted_headlines },
      { name: 'extracted_descriptions', value: offer?.extracted_descriptions },
      { name: 'review_analysis', value: offer?.review_analysis },
      { name: 'competitor_analysis', value: offer?.competitor_analysis },
    ]

    console.log('\n增强数据字段检查:')
    checks.forEach(check => {
      const hasData = check.value && check.value !== 'null' && check.value.length > 10
      console.log(`   ${hasData ? '✅' : '❌'} ${check.name}: ${hasData ? '有数据' : '无数据'}`)
    })

    console.log('\n🎉 测试完成！')
    return true

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error('错误堆栈:', error.stack)
    return false
  }
}

// 运行测试
testOffer245Rescrape()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
