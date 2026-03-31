/**
 * 补充提取脚本：为已存在的 Offers 运行提取逻辑
 *
 * 用途：
 * - 对在代码修改前爬取的 Offers 补充运行提取逻辑
 * - 测试提取功能是否正常工作
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { extractAdElements } from '../src/lib/ad-elements-extractor'

interface OfferData {
  id: number
  user_id: number
  brand: string
  url: string
  product_name: string | null
  brand_description: string | null
  unique_selling_points: string | null
  product_highlights: string | null
  target_country: string
  target_language: string | null
  extracted_keywords: string | null
}

async function backfillExtraction(offerId?: number) {
  console.log('🔧 开始补充提取逻辑...\n')

  const db = getSQLiteDatabase()

  // 查询需要补充提取的 Offers
  const query = offerId
    ? `SELECT * FROM offers WHERE id = ? AND scrape_status = 'completed'`
    : `SELECT * FROM offers WHERE scrape_status = 'completed' AND extracted_keywords IS NULL LIMIT 5`

  const offers = offerId
    ? [db.prepare(query).get(offerId)]
    : db.prepare(query).all()

  const validOffers = offers.filter(o => o !== undefined) as OfferData[]

  console.log(`📋 找到 ${validOffers.length} 个需要补充提取的 Offers\n`)

  if (validOffers.length === 0) {
    console.log('✅ 没有需要处理的 Offers')
    return
  }

  for (let i = 0; i < validOffers.length; i++) {
    const offer = validOffers[i]
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`🎯 处理 Offer ${i + 1}/${validOffers.length}`)
    console.log(`   ID: ${offer.id}`)
    console.log(`   Brand: ${offer.brand}`)
    console.log(`   URL: ${offer.url.substring(0, 60)}...`)

    try {
      // 检查是否为店铺页面（通过检查 scraped_products 表）
      const products = db.prepare(`
        SELECT name, rating, review_count, hot_score
        FROM scraped_products
        WHERE offer_id = ?
        ORDER BY hot_score DESC
        LIMIT 5
      `).all(offer.id) as Array<{
        name: string
        rating: string | null
        review_count: string | null
        hot_score: number | null
      }>

      const pageType: 'product' | 'store' = products.length > 0 ? 'store' : 'product'
      console.log(`   页面类型: ${pageType}`)

      let extractionResult

      if (pageType === 'product') {
        // 单商品场景
        console.log('   📦 单商品提取模式...')

        // 准备产品数据
        const aboutThisItem = offer.product_highlights
          ? offer.product_highlights.split('\n').filter(f => f.trim())
          : []

        const features = offer.unique_selling_points
          ? offer.unique_selling_points.split('\n').filter(f => f.trim())
          : []

        extractionResult = await extractAdElements(
          {
            pageType: 'product',
            product: {
              productName: offer.product_name || offer.brand,
              brandName: offer.brand,
              aboutThisItem,
              features
            }
          },
          offer.brand,
          offer.target_country,
          offer.target_language || 'en',
          offer.user_id
        )
      } else {
        // 店铺场景
        console.log(`   🏪 店铺提取模式（${products.length}个产品）...`)

        extractionResult = await extractAdElements(
          {
            pageType: 'store',
            storeProducts: products.map(p => ({
              name: p.name,
              rating: p.rating,
              reviewCount: p.review_count,
              hotScore: p.hot_score || undefined
            }))
          },
          offer.brand,
          offer.target_country,
          offer.target_language || 'en',
          offer.user_id
        )
      }

      // 保存到数据库
      console.log('   💾 保存提取结果到数据库...')

      db.prepare(`
        UPDATE offers
        SET extracted_keywords = ?,
            extracted_headlines = ?,
            extracted_descriptions = ?,
            extraction_metadata = ?,
            extracted_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        JSON.stringify(extractionResult.keywords),
        JSON.stringify(extractionResult.headlines),
        JSON.stringify(extractionResult.descriptions),
        JSON.stringify(extractionResult.sources),
        new Date().toISOString(),
        offer.id
      )

      console.log('   ✅ 提取完成')
      console.log(`      - 关键词: ${extractionResult.keywords.length}个`)
      console.log(`      - 标题: ${extractionResult.headlines.length}个`)
      console.log(`      - 描述: ${extractionResult.descriptions.length}个`)

      // 显示示例数据
      if (extractionResult.keywords.length > 0) {
        console.log(`      - 示例关键词: "${extractionResult.keywords[0].keyword}" (${extractionResult.keywords[0].searchVolume}/月)`)
      }
      if (extractionResult.headlines.length > 0) {
        console.log(`      - 示例标题: "${extractionResult.headlines[0]}"`)
      }

    } catch (error: any) {
      console.log('   ❌ 提取失败:', error.message)
      if (error.stack) {
        console.log('   错误堆栈:', error.stack.split('\n').slice(0, 3).join('\n'))
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ 补充提取完成！')
  console.log(`   处理 Offers: ${validOffers.length}个\n`)
}

// 从命令行参数获取 Offer ID（可选）
const offerId = process.argv[2] ? parseInt(process.argv[2], 10) : undefined

if (offerId && isNaN(offerId)) {
  console.error('❌ 错误：Offer ID 必须是数字')
  process.exit(1)
}

// 运行补充提取
backfillExtraction(offerId).catch(error => {
  console.error('❌ 补充提取失败:', error)
  process.exit(1)
})
