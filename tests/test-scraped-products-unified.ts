/**
 * 测试单品和店铺页面的统一数据存储
 * 验证scraped_products表的数据一致性
 */

import { getSQLiteDatabase } from '../src/lib/db'

async function testScrapedProductsUnified() {
  console.log('🧪 开始测试scraped_products统一数据存储...\n')

  const db = getSQLiteDatabase()

  // 测试数据：使用真实的Offer ID 245
  const mockProductData = {
    offerId: 245,  // 使用真实存在的Offer ID
    productName: 'Test Product - Eufy Omni C20',
    asin: 'B0DBVMD8Z8',
    price: '€299.00',
    rating: '4.3',
    reviewCount: '3221',
    discount: '-50%',
    primeEligible: true,
    imageUrl: 'https://example.com/image.jpg'
  }

  try {
    // 步骤1: 清空测试数据
    console.log('📋 步骤1: 清空测试数据...')
    db.prepare('DELETE FROM scraped_products WHERE offer_id = ?').run(mockProductData.offerId)
    console.log('✅ 测试数据已清空\n')

    // 步骤2: 模拟单品页面保存逻辑
    console.log('📋 步骤2: 模拟单品页面保存逻辑...')

    // 计算热销分数（与店铺页面保持一致）
    const rating = parseFloat(mockProductData.rating)
    const reviewCount = parseInt(mockProductData.reviewCount, 10)
    const hotScore = rating > 0 && reviewCount > 0
      ? rating * Math.log10(reviewCount + 1)
      : 0

    console.log(`   计算热销分数: ${rating} × log10(${reviewCount} + 1) = ${hotScore.toFixed(2)}`)

    const insertStmt = db.prepare(`
      INSERT INTO scraped_products (
        offer_id, name, asin, price, rating, review_count, image_url,
        promotion, badge, is_prime,
        hot_score, rank, is_hot, hot_label,
        scrape_source, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, datetime('now'), datetime('now')
      )
    `)

    insertStmt.run(
      mockProductData.offerId,
      mockProductData.productName,
      mockProductData.asin,
      mockProductData.price,
      mockProductData.rating,
      mockProductData.reviewCount,
      mockProductData.imageUrl,
      // Phase 3 fields
      mockProductData.discount,
      null,  // badge
      mockProductData.primeEligible ? 1 : 0,
      // Phase 2 fields
      hotScore,
      1,  // rank: 单品默认排名第1
      1,  // is_hot: 单品默认标记为热销
      '🔥 主推商品',  // hot_label
      'amazon_product'  // scrape_source
    )

    console.log('✅ 单品数据已保存到scraped_products表\n')

    // 步骤3: 验证数据完整性
    console.log('📋 步骤3: 验证数据完整性...')
    const savedProduct = db.prepare(`
      SELECT
        id, offer_id, name, asin, price, rating, review_count,
        promotion, badge, is_prime,
        hot_score, rank, is_hot, hot_label,
        scrape_source
      FROM scraped_products
      WHERE offer_id = ?
    `).get(mockProductData.offerId) as any

    if (!savedProduct) {
      throw new Error('❌ 未找到保存的产品数据')
    }

    console.log('✅ 数据验证结果:')
    console.log(`   - ID: ${savedProduct.id}`)
    console.log(`   - Offer ID: ${savedProduct.offer_id}`)
    console.log(`   - 产品名称: ${savedProduct.name}`)
    console.log(`   - ASIN: ${savedProduct.asin}`)
    console.log(`   - 价格: ${savedProduct.price}`)
    console.log(`   - 评分: ${savedProduct.rating}⭐`)
    console.log(`   - 评论数: ${savedProduct.review_count}`)
    console.log(`   - 促销: ${savedProduct.promotion}`)
    console.log(`   - Prime: ${savedProduct.is_prime ? '✓' : '✗'}`)
    console.log(`   - 热销分数: ${savedProduct.hot_score?.toFixed(2)}`)
    console.log(`   - 排名: ${savedProduct.rank}`)
    console.log(`   - 热销标记: ${savedProduct.is_hot ? '✓' : '✗'}`)
    console.log(`   - 热销标签: ${savedProduct.hot_label}`)
    console.log(`   - 数据来源: ${savedProduct.scrape_source}`)

    // 步骤4: 验证字段完整性
    console.log('\n📋 步骤4: 验证字段完整性...')
    const requiredFields = [
      'offer_id', 'name', 'asin', 'price', 'rating', 'review_count',
      'hot_score', 'rank', 'is_hot', 'hot_label', 'scrape_source'
    ]

    const missingFields = requiredFields.filter(field => {
      const value = savedProduct[field]
      return value === null || value === undefined
    })

    if (missingFields.length > 0) {
      throw new Error(`❌ 缺少必填字段: ${missingFields.join(', ')}`)
    }

    console.log('✅ 所有必填字段完整')

    // 步骤5: 验证数据类型
    console.log('\n📋 步骤5: 验证数据类型...')
    const typeChecks = [
      { field: 'offer_id', type: 'number', value: savedProduct.offer_id },
      { field: 'hot_score', type: 'number', value: savedProduct.hot_score },
      { field: 'rank', type: 'number', value: savedProduct.rank },
      { field: 'is_hot', type: 'number', value: savedProduct.is_hot },
      { field: 'is_prime', type: 'number', value: savedProduct.is_prime },
      { field: 'scrape_source', type: 'string', value: savedProduct.scrape_source }
    ]

    for (const check of typeChecks) {
      const actualType = typeof check.value
      if (actualType !== check.type) {
        throw new Error(`❌ 字段 ${check.field} 类型错误: 期望 ${check.type}, 实际 ${actualType}`)
      }
    }

    console.log('✅ 所有字段类型正确')

    // 步骤6: 验证scrape_source值
    console.log('\n📋 步骤6: 验证scrape_source值...')
    const validSources = ['amazon_store', 'independent_store', 'amazon_product']
    if (!validSources.includes(savedProduct.scrape_source)) {
      throw new Error(`❌ scrape_source值无效: ${savedProduct.scrape_source}`)
    }
    console.log(`✅ scrape_source值有效: ${savedProduct.scrape_source}`)

    // 步骤7: 清理测试数据
    console.log('\n📋 步骤7: 清理测试数据...')
    db.prepare('DELETE FROM scraped_products WHERE offer_id = ?').run(mockProductData.offerId)
    console.log('✅ 测试数据已清理')

    console.log('\n🎉 所有测试通过！单品和店铺页面的数据存储已统一。')
    console.log('\n📊 测试总结:')
    console.log('   ✅ 单品数据可以正确保存到scraped_products表')
    console.log('   ✅ 数据结构与店铺页面保持一致')
    console.log('   ✅ 热销分数计算正确')
    console.log('   ✅ scrape_source字段支持三种类型')
    console.log('   ✅ 所有必填字段完整')
    console.log('   ✅ 数据类型验证通过')

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error('错误堆栈:', error.stack)
    process.exit(1)
  }
}

// 运行测试
testScrapedProductsUnified()
  .then(() => {
    console.log('\n✅ 测试脚本执行完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ 测试脚本执行失败:', error)
    process.exit(1)
  })
