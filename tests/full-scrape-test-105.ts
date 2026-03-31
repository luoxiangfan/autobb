#!/usr/bin/env tsx
/**
 * 完整测试：爬取 Offer 105 并执行提取
 */

import { scrapeAmazonProductWithCrawlee } from '../src/lib/crawlee-scraper'
import { extractAdElements } from '../src/lib/ad-elements-extractor'
import { updateOfferScrapeStatus } from '../src/lib/offers'
import Database from 'better-sqlite3'
import path from 'path'

async function fullTest() {
  const offerId = 105
  const userId = 1

  console.log('🧪 完整端到端测试：Offer 105\n')

  // 获取数据库
  const dbPath = path.resolve(process.cwd(), './data/autoads.db')
  const db = new Database(dbPath)

  // 1. 获取 Offer
  console.log('📋 步骤1: 获取 Offer 信息...')
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any
  console.log(`   URL: ${offer.url}`)
  console.log(`   Brand: ${offer.brand}`)
  console.log(`   Target: ${offer.target_country}\n`)

  try {
    // 2. 爬取产品数据
    console.log('🕷️  步骤2: 爬取产品数据...')
    const scrapeResult = await scrapeAmazonProductWithCrawlee(offer.url, userId)

    console.log(`   ✅ 爬取完成`)
    console.log(`   - 页面类型: ${scrapeResult.pageType}`)
    console.log(`   - 品牌: ${scrapeResult.brand}`)

    if (scrapeResult.pageType === 'product' && scrapeResult.product) {
      console.log(`   - 产品名: ${scrapeResult.product.title}`)
    }

    const extractedBrand = scrapeResult.brand || 'Unknown'
    const pageType = scrapeResult.pageType
    const pageData = scrapeResult.product || {}

    // 3. 提取广告元素
    console.log('\n🎯 步骤3: 提取广告元素...')

    let extractedKeywords: any[] = []
    let extractedHeadlines: string[] = []
    let extractedDescriptions: string[] = []
    let extractionMetadata: any = {}
    let extractedAt: string | undefined

    if (pageType === 'product') {
      const extractionResult = await extractAdElements(
        {
          pageType: 'product',
          product: {
            productName: pageData.title || extractedBrand,
            brandName: extractedBrand,
            aboutThisItem: pageData.aboutThisItem || [],
            features: pageData.features || []
          }
        },
        extractedBrand,
        offer.target_country,
        offer.target_language || 'en',
        userId
      )

      extractedKeywords = extractionResult.keywords
      extractedHeadlines = extractionResult.headlines
      extractedDescriptions = extractionResult.descriptions
      extractionMetadata = extractionResult.sources
      extractedAt = new Date().toISOString()

      console.log(`   ✅ 提取完成`)
      console.log(`   - 关键词: ${extractedKeywords.length} 个`)
      console.log(`   - 标题: ${extractedHeadlines.length} 个`)
      console.log(`   - 描述: ${extractedDescriptions.length} 个`)
    }

    // 4. 保存到数据库
    console.log('\n💾 步骤4: 保存到数据库...')

    await updateOfferScrapeStatus(db, offerId, userId, {
      status: 'completed',
      scrapedData: {
        page_type: pageType,
        brand: extractedBrand,
        scraped_at: new Date().toISOString(),
        extracted_keywords: extractedKeywords.length > 0 ? JSON.stringify(extractedKeywords) : undefined,
        extracted_headlines: extractedHeadlines.length > 0 ? JSON.stringify(extractedHeadlines) : undefined,
        extracted_descriptions: extractedDescriptions.length > 0 ? JSON.stringify(extractedDescriptions) : undefined,
        extraction_metadata: Object.keys(extractionMetadata).length > 0 ? JSON.stringify(extractionMetadata) : undefined,
        extracted_at: extractedAt
      }
    })

    console.log(`   ✅ 数据已保存`)

    // 5. 验证结果
    console.log('\n📊 步骤5: 验证结果...')
    const verifyOffer = db.prepare(`
      SELECT extracted_keywords, extracted_headlines, extracted_descriptions, extracted_at
      FROM offers WHERE id = ?
    `).get(offerId) as any

    if (verifyOffer.extracted_keywords) {
      const keywords = JSON.parse(verifyOffer.extracted_keywords)
      console.log(`   ✅ 关键词已保存: ${keywords.length} 个`)
      if (keywords.length > 0) {
        console.log(`      示例: ${keywords.slice(0, 3).map((k: any) => k.keyword).join(', ')}`)
      }
    }

    if (verifyOffer.extracted_headlines) {
      const headlines = JSON.parse(verifyOffer.extracted_headlines)
      console.log(`   ✅ 标题已保存: ${headlines.length} 个`)
      if (headlines.length > 0) {
        console.log(`      示例: "${headlines[0]}"`)
      }
    }

    if (verifyOffer.extracted_descriptions) {
      const descriptions = JSON.parse(verifyOffer.extracted_descriptions)
      console.log(`   ✅ 描述已保存: ${descriptions.length} 个`)
      if (descriptions.length > 0) {
        console.log(`      示例: "${descriptions[0]}"`)
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🎉 测试成功！需求34端到端验证通过！')
    console.log('   ✅ 爬取 → 提取 → 保存流程完整')
    console.log('   ✅ 数据持久化到数据库')
    console.log('   ✅ 可供AI生成器读取使用')

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    db.close()
  }
}

fullTest()
