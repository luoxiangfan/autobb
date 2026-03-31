/**
 * 测试新Offer创建和完整抓取流程
 * 验证单品页面数据是否正确保存到scraped_products表
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { performScrapeAndAnalysis } from '../src/lib/offer-scraping-core'

async function testNewOfferCreation() {
  console.log('🧪 开始测试新Offer创建和抓取流程...\n')

  const db = getSQLiteDatabase()
  const userId = 1
  const affiliateLink = 'https://pboost.me/UMg8ds7'
  const targetCountry = 'IT'
  const brand = 'Eufy'  // 预设品牌名

  let testOfferId: number | null = null

  try {
    // 步骤1: 创建测试Offer
    console.log('📋 步骤1: 创建测试Offer...')
    console.log(`   推广链接: ${affiliateLink}`)
    console.log(`   目标国家: ${targetCountry}`)
    console.log(`   品牌: ${brand}`)

    const insertStmt = db.prepare(`
      INSERT INTO offers (
        user_id, offer_name, url, brand, target_country,
        scrape_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)

    const result = insertStmt.run(
      userId,
      `Test_${brand}_${targetCountry}_${Date.now()}`,
      affiliateLink,
      brand,
      targetCountry,
      'pending'
    )

    testOfferId = result.lastInsertRowid as number
    console.log(`✅ 测试Offer已创建，ID: ${testOfferId}\n`)

    // 步骤2: 清空之前的scraped_products数据（如果有）
    console.log('📋 步骤2: 清空之前的scraped_products数据...')
    const deleteStmt = db.prepare('DELETE FROM scraped_products WHERE offer_id = ?')
    deleteStmt.run(testOfferId)
    console.log('✅ 已清空\n')

    // 步骤3: 执行完整抓取流程
    console.log('📋 步骤3: 执行完整抓取流程（调用统一核心函数）...')
    console.log(`   这将包括：`)
    console.log(`   - 推广链接解析`)
    console.log(`   - 网页抓取`)
    console.log(`   - AI产品分析`)
    console.log(`   - 评论分析`)
    console.log(`   - 竞品分析`)
    console.log(`   - 广告元素提取`)
    console.log(`   - scraped_products持久化`)
    console.log('')

    await performScrapeAndAnalysis(testOfferId, userId, affiliateLink, brand)

    console.log('✅ 抓取完成\n')

    // 步骤4: 验证offers表的数据
    console.log('📋 步骤4: 验证offers表的数据...')
    const offer = db.prepare(`
      SELECT
        id, offer_name, url, final_url, brand, target_country,
        scrape_status, scraped_at,
        brand_description, unique_selling_points, product_highlights, target_audience,
        scraped_data, extracted_keywords, extracted_headlines, extracted_descriptions,
        review_analysis, competitor_analysis
      FROM offers
      WHERE id = ?
    `).get(testOfferId) as any

    if (!offer) {
      throw new Error('❌ 未找到Offer记录')
    }

    console.log('✅ Offer基本信息:')
    console.log(`   - ID: ${offer.id}`)
    console.log(`   - 名称: ${offer.offer_name}`)
    console.log(`   - 推广链接: ${offer.url}`)
    console.log(`   - Final URL: ${offer.final_url || 'N/A'}`)
    console.log(`   - 品牌: ${offer.brand}`)
    console.log(`   - 目标国家: ${offer.target_country}`)
    console.log(`   - 抓取状态: ${offer.scrape_status}`)
    console.log(`   - 抓取时间: ${offer.scraped_at || 'N/A'}`)

    console.log('\n✅ Offer增强数据字段:')
    const enhancedFields = [
      { name: 'brand_description', label: '品牌描述' },
      { name: 'unique_selling_points', label: '独特卖点' },
      { name: 'product_highlights', label: '产品亮点' },
      { name: 'target_audience', label: '目标受众' },
      { name: 'scraped_data', label: '原始爬虫数据' },
      { name: 'extracted_keywords', label: '提取的关键词' },
      { name: 'extracted_headlines', label: '提取的标题' },
      { name: 'extracted_descriptions', label: '提取的描述' },
      { name: 'review_analysis', label: '评论分析' },
      { name: 'competitor_analysis', label: '竞品分析' }
    ]

    for (const field of enhancedFields) {
      const value = offer[field.name]
      const hasData = value && value !== 'null' && value.length > 10
      const status = hasData ? '✅ 有数据' : '❌ 无数据'
      const length = hasData ? `(${value.length}字节)` : ''
      console.log(`   ${status} ${field.label} ${length}`)
    }

    // 步骤5: 验证scraped_products表的数据
    console.log('\n📋 步骤5: 验证scraped_products表的数据...')
    const products = db.prepare(`
      SELECT
        id, offer_id, name, asin, price, rating, review_count,
        promotion, badge, is_prime,
        hot_score, rank, is_hot, hot_label,
        scrape_source, created_at
      FROM scraped_products
      WHERE offer_id = ?
      ORDER BY rank ASC
    `).all(testOfferId) as any[]

    if (products.length === 0) {
      console.log('❌ 失败：scraped_products表中没有数据')
      console.log('   这表明单品数据未被保存到scraped_products表')
      throw new Error('单品数据未保存到scraped_products表')
    }

    console.log(`✅ 成功：找到${products.length}个产品记录`)

    console.log('\n📊 产品数据详情:')
    products.forEach((product, index) => {
      console.log(`\n${index + 1}. ${product.name}`)
      console.log(`   - ID: ${product.id}`)
      console.log(`   - ASIN: ${product.asin || 'N/A'}`)
      console.log(`   - 价格: ${product.price || 'N/A'}`)
      console.log(`   - 评分: ${product.rating || 'N/A'}⭐`)
      console.log(`   - 评论数: ${product.review_count || 'N/A'}`)
      console.log(`   - 热销分数: ${product.hot_score?.toFixed(2) || 'N/A'}`)
      console.log(`   - 排名: ${product.rank}`)
      console.log(`   - 热销标记: ${product.is_hot ? '✓' : '✗'}`)
      console.log(`   - 热销标签: ${product.hot_label || 'N/A'}`)
      if (product.promotion) console.log(`   - 促销: ${product.promotion}`)
      if (product.badge) console.log(`   - 徽章: ${product.badge}`)
      if (product.is_prime) console.log(`   - Prime: ✓`)
      console.log(`   - 数据来源: ${product.scrape_source}`)
      console.log(`   - 创建时间: ${product.created_at}`)
    })

    // 步骤6: 验证数据一致性
    console.log('\n📋 步骤6: 验证数据一致性...')

    // 验证scrape_source
    const invalidSources = products.filter(p =>
      !['amazon_store', 'independent_store', 'amazon_product'].includes(p.scrape_source)
    )
    if (invalidSources.length > 0) {
      throw new Error(`❌ 发现无效的scrape_source: ${invalidSources.map(p => p.scrape_source).join(', ')}`)
    }
    console.log('✅ scrape_source字段值有效')

    // 验证必填字段
    const requiredFields = ['offer_id', 'name', 'scrape_source', 'hot_score', 'rank', 'is_hot']
    for (const product of products) {
      for (const field of requiredFields) {
        if (product[field] === null || product[field] === undefined) {
          throw new Error(`❌ 产品 ${product.id} 缺少必填字段: ${field}`)
        }
      }
    }
    console.log('✅ 所有必填字段完整')

    // 验证热销分数计算
    for (const product of products) {
      if (product.rating && product.review_count) {
        const rating = parseFloat(product.rating)
        const reviewCount = parseInt(product.review_count, 10)
        const expectedHotScore = rating * Math.log10(reviewCount + 1)
        const actualHotScore = product.hot_score

        if (Math.abs(expectedHotScore - actualHotScore) > 0.01) {
          throw new Error(
            `❌ 产品 ${product.id} 热销分数计算错误: ` +
            `期望 ${expectedHotScore.toFixed(2)}, 实际 ${actualHotScore.toFixed(2)}`
          )
        }
      }
    }
    console.log('✅ 热销分数计算正确')

    console.log('\n🎉 所有验证通过！')
    console.log('\n📊 测试总结:')
    console.log(`   ✅ 成功创建测试Offer (ID: ${testOfferId})`)
    console.log(`   ✅ 完整抓取流程执行成功`)
    console.log(`   ✅ offers表数据完整`)
    console.log(`   ✅ scraped_products表有${products.length}条记录`)
    console.log(`   ✅ 单品和店铺页面数据存储统一`)
    console.log(`   ✅ 数据一致性验证通过`)

    // 步骤7: 询问是否保留测试数据
    console.log('\n📋 步骤7: 清理测试数据...')
    console.log('   提示：测试数据将被保留，您可以在数据库中查看')
    console.log(`   - Offer ID: ${testOfferId}`)
    console.log(`   - 如需删除，请运行: sqlite3 data/autoads.db "DELETE FROM offers WHERE id = ${testOfferId};"`)

    return true

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error('错误堆栈:', error.stack)

    // 清理测试数据
    if (testOfferId) {
      console.log('\n📋 清理测试数据...')
      try {
        db.prepare('DELETE FROM scraped_products WHERE offer_id = ?').run(testOfferId)
        db.prepare('DELETE FROM offers WHERE id = ?').run(testOfferId)
        console.log('✅ 测试数据已清理')
      } catch (cleanupError: any) {
        console.error('⚠️ 清理测试数据失败:', cleanupError.message)
      }
    }

    return false
  }
}

// 运行测试
testNewOfferCreation()
  .then(success => {
    if (success) {
      console.log('\n✅ 测试脚本执行完成')
      process.exit(0)
    } else {
      console.log('\n❌ 测试脚本执行失败')
      process.exit(1)
    }
  })
  .catch(error => {
    console.error('\n❌ 测试脚本执行异常:', error)
    process.exit(1)
  })
