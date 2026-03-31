#!/usr/bin/env tsx
/**
 * 测试 Offer 105 的完整流程：爬取 → 提取 → 保存
 * 验证需求34的端到端实现
 */

import Database from 'better-sqlite3'
import path from 'path'

// 导入爬取函数
async function triggerScrape() {
  const offerId = 105
  const userId = 1

  console.log('🧪 开始测试 Offer 105 的完整流程...\n')

  // 获取数据库连接
  const dbPath = path.resolve(process.cwd(), './data/autoads.db')
  const db = new Database(dbPath)

  // 1. 检查 Offer 信息
  console.log('📋 步骤1: 检查 Offer 信息...')
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId)
  if (!offer) {
    console.error('❌ Offer 不存在')
    process.exit(1)
  }
  console.log(`   URL: ${offer.url}`)
  console.log(`   Brand: ${offer.brand}`)
  console.log(`   Status: ${offer.scrape_status}`)
  console.log(`   Target: ${offer.target_country} / ${offer.target_language}\n`)

  // 2. 触发爬取（通过动态导入API路由处理函数）
  console.log('🔄 步骤2: 触发爬取和提取...')
  console.log('   这将调用爬虫 API，执行以下步骤：')
  console.log('   - 爬取产品页面数据')
  console.log('   - AI 分析产品信息')
  console.log('   - 提取广告元素（关键词、标题、描述）')
  console.log('   - 保存到数据库\n')

  try {
    // 动态导入并调用爬取函数
    const scrapeModule = await import('../src/app/api/offers/[id]/scrape/route')

    // 构造请求对象
    const mockRequest = {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/json'
      }),
      json: async () => ({ userId })
    } as any

    const mockParams = { params: { id: offerId.toString() } }

    // 调用 POST 处理函数
    const response = await scrapeModule.POST(mockRequest, mockParams)
    const result = await response.json()

    if (response.status === 200) {
      console.log('✅ 爬取和提取成功完成！\n')
    } else {
      console.error('❌ 爬取失败:', result)
      process.exit(1)
    }

  } catch (error: any) {
    console.error('❌ 调用爬取API失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  }

  // 3. 验证提取结果
  console.log('📊 步骤3: 验证提取结果...\n')
  const updatedOffer = db.prepare(`
    SELECT id, brand, scrape_status,
           extracted_keywords, extracted_headlines, extracted_descriptions,
           extraction_metadata, extracted_at
    FROM offers
    WHERE id = ?
  `).get(offerId) as any

  console.log('   提取状态:')
  console.log(`   - Scrape Status: ${updatedOffer.scrape_status}`)
  console.log(`   - Extracted At: ${updatedOffer.extracted_at || 'N/A'}`)

  let hasKeywords = false
  let hasHeadlines = false
  let hasDescriptions = false

  if (updatedOffer.extracted_keywords) {
    try {
      const keywords = JSON.parse(updatedOffer.extracted_keywords)
      hasKeywords = keywords.length > 0
      console.log(`   - Keywords: ${keywords.length} 个`)
      if (keywords.length > 0) {
        console.log(`     示例: ${keywords.slice(0, 3).map((k: any) => k.keyword).join(', ')}`)
      }
    } catch (e) {
      console.log(`   - Keywords: 解析失败`)
    }
  } else {
    console.log(`   - Keywords: 无数据`)
  }

  if (updatedOffer.extracted_headlines) {
    try {
      const headlines = JSON.parse(updatedOffer.extracted_headlines)
      hasHeadlines = headlines.length > 0
      console.log(`   - Headlines: ${headlines.length} 个`)
      if (headlines.length > 0) {
        console.log(`     示例: ${headlines.slice(0, 2).join(', ')}`)
      }
    } catch (e) {
      console.log(`   - Headlines: 解析失败`)
    }
  } else {
    console.log(`   - Headlines: 无数据`)
  }

  if (updatedOffer.extracted_descriptions) {
    try {
      const descriptions = JSON.parse(updatedOffer.extracted_descriptions)
      hasDescriptions = descriptions.length > 0
      console.log(`   - Descriptions: ${descriptions.length} 个`)
      if (descriptions.length > 0) {
        console.log(`     示例: ${descriptions[0]}`)
      }
    } catch (e) {
      console.log(`   - Descriptions: 解析失败`)
    }
  } else {
    console.log(`   - Descriptions: 无数据`)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 测试总结:')
  console.log(`   ✅ 爬取流程: 完成`)
  console.log(`   ${hasKeywords ? '✅' : '⚠️'} 关键词提取: ${hasKeywords ? '成功' : '无数据'}`)
  console.log(`   ${hasHeadlines ? '✅' : '⚠️'} 标题生成: ${hasHeadlines ? '成功' : '无数据'}`)
  console.log(`   ${hasDescriptions ? '✅' : '⚠️'} 描述生成: ${hasDescriptions ? '成功' : '无数据'}`)

  if (hasKeywords && hasHeadlines && hasDescriptions) {
    console.log('\n🎉 需求34端到端测试通过！所有提取数据已保存到数据库。')
  } else {
    console.log('\n⚠️  部分提取数据缺失，但流程正常执行。')
  }

  db.close()
}

// 执行测试
triggerScrape().catch(error => {
  console.error('💥 测试执行失败:', error)
  process.exit(1)
})
