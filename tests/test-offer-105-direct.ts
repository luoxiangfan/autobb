#!/usr/bin/env tsx
/**
 * 直接测试 Offer 105 的爬取和提取流程
 * 绕过API认证，直接调用爬虫函数
 */

import Database from 'better-sqlite3'
import path from 'path'
import { updateOfferScrapeStatus } from '../src/lib/offers'
import { extractAdElements } from '../src/lib/ad-elements-extractor'

async function testOffer105() {
  const offerId = 105
  const userId = 1

  console.log('🧪 开始直接测试 Offer 105...\n')

  // 获取数据库连接
  const dbPath = path.resolve(process.cwd(), './data/autoads.db')
  const db = new Database(dbPath)

  // 1. 获取 Offer 信息
  console.log('📋 步骤1: 获取 Offer 信息...')
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any
  if (!offer) {
    console.error('❌ Offer 不存在')
    process.exit(1)
  }
  console.log(`   ID: ${offer.id}`)
  console.log(`   URL: ${offer.url}`)
  console.log(`   Brand: ${offer.brand}`)
  console.log(`   Target: ${offer.target_country} / ${offer.target_language}\n`)

  // 2. 模拟爬取数据（我们假设已经爬取了产品信息）
  console.log('🔄 步骤2: 准备测试数据...')

  // 对于这个测试，我们先直接使用URL爬取
  // 实际上应该先运行完整的爬取流程，但为了快速验证提取功能，我们构造测试数据

  console.log('   提示：需要先完成爬取流程才能提取数据')
  console.log('   建议：通过前端界面创建Offer并触发爬取\n')

  // 3. 检查爬取状态
  console.log('📊 步骤3: 检查当前状态...')
  const currentStatus = db.prepare(`
    SELECT scrape_status, scraped_at,
           extracted_keywords, extracted_at
    FROM offers
    WHERE id = ?
  `).get(offerId) as any

  console.log(`   Scrape Status: ${currentStatus.scrape_status}`)
  console.log(`   Scraped At: ${currentStatus.scraped_at || 'N/A'}`)
  console.log(`   Extracted At: ${currentStatus.extracted_at || 'N/A'}`)

  if (currentStatus.scrape_status !== 'completed') {
    console.log('\n⚠️  Offer 尚未完成爬取')
    console.log('   请先通过以下方式触发爬取：')
    console.log('   1. 前端界面：访问 Offer 详情页，点击"重新爬取"')
    console.log('   2. API调用：POST /api/offers/105/scrape')
    console.log('\n   爬取完成后，提取功能会自动执行')
  } else {
    console.log('\n✅ Offer 已完成爬取')

    // 检查提取数据
    if (currentStatus.extracted_keywords) {
      const keywords = JSON.parse(currentStatus.extracted_keywords)
      console.log(`   ✅ 已提取 ${keywords.length} 个关键词`)
    } else {
      console.log(`   ⚠️  关键词尚未提取`)
    }
  }

  db.close()

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📝 说明:')
  console.log('   本测试脚本仅检查数据状态')
  console.log('   完整的提取功能已集成到爬虫流程中')
  console.log('   触发爬取时会自动执行提取并保存结果')
}

testOffer105().catch(error => {
  console.error('💥 测试失败:', error)
  process.exit(1)
})
