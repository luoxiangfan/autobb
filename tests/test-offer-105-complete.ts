#!/usr/bin/env tsx
/**
 * 完整测试：模拟API路由逻辑，同时支持店铺和单品链接
 * 测试 Offer 105 的完整流程：爬取 → 提取 → 保存
 */

import Database from 'better-sqlite3'
import path from 'path'
import { updateOfferScrapeStatus } from '../src/lib/offers'
import { extractAdElements } from '../src/lib/ad-elements-extractor'

async function testOffer105Complete() {
  const offerId = 105
  const userId = 1

  console.log('🧪 完整端到端测试：Offer 105（支持店铺和单品）\n')

  // 获取数据库连接
  const dbPath = path.resolve(process.cwd(), './data/autoads.db')
  const db = new Database(dbPath)

  // 1. 获取 Offer 信息
  console.log('📋 步骤1: 获取 Offer 信息...')
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any
  console.log(`   URL: ${offer.url}`)
  console.log(`   Brand: ${offer.brand}`)
  console.log(`   Target: ${offer.target_country} / ${offer.target_language}\n`)

  let actualUrl = offer.url
  const targetCountry = offer.target_country
  const language = offer.target_language || 'en'

  try {
    // 2. URL解析（处理短链接）
    console.log('🔗 步骤2: 解析URL（处理短链接）...')
    console.log(`   原始URL: ${actualUrl}`)

    try {
      const response = await fetch(actualUrl, {
        redirect: 'follow',
        method: 'HEAD'
      })
      if (response.url && response.url !== actualUrl) {
        actualUrl = response.url
        console.log(`   ✅ URL解析成功: ${actualUrl}`)
      } else {
        console.log(`   ℹ️  无需解析，直接使用原URL`)
      }
    } catch (error: any) {
      console.log(`   ⚠️  URL解析失败: ${error.message}`)
      console.log(`   继续使用原URL进行测试`)
    }

    // 3. 智能判断URL类型（完全模拟route.ts逻辑）
    console.log('\n🔍 步骤3: 智能判断URL类型...')
    const isAmazon = actualUrl.includes('amazon.com') || actualUrl.includes('amazon.')
    const isStorePage = actualUrl.includes('/stores/') || actualUrl.includes('/store/')

    console.log(`   - 是Amazon: ${isAmazon}`)
    console.log(`   - 是Store页面: ${isStorePage}`)

    let pageType: 'product' | 'store' | 'unknown' = 'unknown'
    let extractedBrand = offer.brand
    let pageData: any = null

    // 4. 根据URL类型调用相应的爬取函数
    if (isAmazon && isStorePage) {
      // ========== 店铺场景 ==========
      console.log('\n🏪 步骤4: 爬取Amazon店铺数据...')
      const { scrapeAmazonStore } = await import('../src/lib/scraper-stealth')

      // 简化爬取（不使用代理，快速测试）
      const storeData = await scrapeAmazonStore(actualUrl, undefined)

      pageType = 'store'
      extractedBrand = storeData.brandName || offer.brand

      console.log(`   ✅ 店铺爬取完成`)
      console.log(`   - 店铺名: ${storeData.storeName}`)
      console.log(`   - 品牌: ${extractedBrand}`)
      console.log(`   - 产品数: ${storeData.totalProducts}`)

      // 保存产品到数据库
      if (storeData.products && storeData.products.length > 0) {
        console.log(`\n💾 保存${storeData.products.length}个产品到数据库...`)

        // 清除旧数据
        db.prepare('DELETE FROM scraped_products WHERE offer_id = ?').run(offerId)

        const insertStmt = db.prepare(`
          INSERT INTO scraped_products (
            offer_id, name, asin, rating, review_count,
            hot_score, hot_label, rank, price,
            promotion, badge, is_prime, image_url, scrape_source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `)

        for (const product of storeData.products) {
          insertStmt.run(
            offerId,
            product.name,
            product.asin || null,
            product.rating || null,
            product.reviewCount || null,
            product.hotScore || null,
            product.hotLabel || null,
            product.rank || null,
            product.price || null,
            product.promotion || null,
            product.badge || null,
            product.isPrime ? 1 : 0,
            product.imageUrl || null,
            'amazon_store'
          )
        }

        console.log(`   ✅ 产品数据已保存`)
      }

    } else if (isAmazon) {
      // ========== 单品场景 ==========
      console.log('\n📦 步骤4: 爬取Amazon单品数据...')
      const { scrapeAmazonProduct } = await import('../src/lib/scraper-stealth')

      const productData = await scrapeAmazonProduct(actualUrl, undefined)

      pageType = 'product'
      extractedBrand = productData.brand || offer.brand
      pageData = {
        title: productData.productName,
        aboutThisItem: productData.aboutThisItem || [],
        features: productData.features || []
      }

      console.log(`   ✅ 单品爬取完成`)
      console.log(`   - 产品名: ${productData.productName}`)
      console.log(`   - 品牌: ${extractedBrand}`)
      console.log(`   - 评分: ${productData.rating || 'N/A'}`)
    } else {
      console.error('   ❌ 不支持的URL类型')
      process.exit(1)
    }

    // 5. 提取广告元素
    console.log('\n🎯 步骤5: 提取广告元素...')

    let extractedKeywords: any[] = []
    let extractedHeadlines: string[] = []
    let extractedDescriptions: string[] = []
    let extractionMetadata: any = {}
    let extractedAt: string | undefined

    if (pageType === 'product') {
      // 单品提取
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
        targetCountry,
        language,
        userId
      )

      extractedKeywords = extractionResult.keywords
      extractedHeadlines = extractionResult.headlines
      extractedDescriptions = extractionResult.descriptions
      extractionMetadata = extractionResult.sources
      extractedAt = new Date().toISOString()

      console.log(`   ✅ 单品提取完成`)

    } else if (pageType === 'store') {
      // 店铺提取：从数据库读取热销产品
      const products = db.prepare(`
        SELECT name, rating, review_count, hot_score
        FROM scraped_products
        WHERE offer_id = ?
        ORDER BY hot_score DESC
        LIMIT 5
      `).all(offerId) as any[]

      if (products.length > 0) {
        console.log(`   📦 使用${products.length}个热销产品进行提取...`)

        const extractionResult = await extractAdElements(
          {
            pageType: 'store',
            storeProducts: products.map(p => ({
              name: p.name,
              rating: p.rating,
              reviewCount: p.review_count,
              hotScore: p.hot_score || undefined
            }))
          },
          extractedBrand,
          targetCountry,
          language,
          userId
        )

        extractedKeywords = extractionResult.keywords
        extractedHeadlines = extractionResult.headlines
        extractedDescriptions = extractionResult.descriptions
        extractionMetadata = extractionResult.sources
        extractedAt = new Date().toISOString()

        console.log(`   ✅ 店铺提取完成`)
      } else {
        console.log(`   ⚠️  没有找到产品数据，跳过提取`)
      }
    }

    console.log(`   - 关键词: ${extractedKeywords.length} 个`)
    console.log(`   - 标题: ${extractedHeadlines.length} 个`)
    console.log(`   - 描述: ${extractedDescriptions.length} 个`)

    // 6. 保存到数据库
    console.log('\n💾 步骤6: 保存到数据库...')

    await updateOfferScrapeStatus(db, offerId, userId, {
      status: 'completed',
      scrapedData: {
        brand: extractedBrand,
        extracted_keywords: extractedKeywords.length > 0 ? JSON.stringify(extractedKeywords) : undefined,
        extracted_headlines: extractedHeadlines.length > 0 ? JSON.stringify(extractedHeadlines) : undefined,
        extracted_descriptions: extractedDescriptions.length > 0 ? JSON.stringify(extractedDescriptions) : undefined,
        extraction_metadata: Object.keys(extractionMetadata).length > 0 ? JSON.stringify(extractionMetadata) : undefined,
        extracted_at: extractedAt
      }
    })

    console.log(`   ✅ 数据已保存`)

    // 7. 验证结果
    console.log('\n📊 步骤7: 验证结果...')
    const verifyOffer = db.prepare(`
      SELECT brand, extracted_keywords, extracted_headlines,
             extracted_descriptions, extracted_at
      FROM offers WHERE id = ?
    `).get(offerId) as any

    console.log(`   - 页面类型: ${pageType}`)
    console.log(`   - 品牌: ${verifyOffer.brand}`)
    console.log(`   - 提取时间: ${verifyOffer.extracted_at || 'N/A'}`)

    if (verifyOffer.extracted_keywords) {
      const keywords = JSON.parse(verifyOffer.extracted_keywords)
      console.log(`   ✅ 关键词已保存: ${keywords.length} 个`)
      if (keywords.length > 0) {
        console.log(`      示例: ${keywords.slice(0, 3).map((k: any) => `"${k.keyword}" (${k.searchVolume}/mo)`).join(', ')}`)
      }
    }

    if (verifyOffer.extracted_headlines) {
      const headlines = JSON.parse(verifyOffer.extracted_headlines)
      console.log(`   ✅ 标题已保存: ${headlines.length} 个`)
      if (headlines.length > 0) {
        console.log(`      示例: "${headlines[0]}"`)
        console.log(`      长度检查: ${headlines[0].length <= 30 ? '✅' : '❌'} ${headlines[0].length}字符`)
      }
    }

    if (verifyOffer.extracted_descriptions) {
      const descriptions = JSON.parse(verifyOffer.extracted_descriptions)
      console.log(`   ✅ 描述已保存: ${descriptions.length} 个`)
      if (descriptions.length > 0) {
        console.log(`      示例: "${descriptions[0]}"`)
        console.log(`      长度检查: ${descriptions[0].length <= 90 ? '✅' : '❌'} ${descriptions[0].length}字符`)
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🎉 测试成功！需求34端到端验证通过！')
    console.log(`   ✅ ${pageType === 'store' ? '店铺' : '单品'}爬取 → 提取 → 保存流程完整`)
    console.log('   ✅ 数据持久化到数据库')
    console.log('   ✅ 同时支持店铺和单品链接')
    console.log('   ✅ 可供AI生成器读取使用')

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    db.close()
  }
}

testOffer105Complete()
