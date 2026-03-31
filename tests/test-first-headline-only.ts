/**
 * 测试第一个headline强制格式
 */

import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { getSQLiteDatabase } from '../src/lib/db'

async function main() {
  const db = getSQLiteDatabase()

  // 创建测试Offer
  const result = db.prepare(`
    INSERT INTO offers (user_id, url, brand, category, product_name, product_price, target_country, product_highlights, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    1,
    'https://pboost.me/test',
    'TestBrand',
    'Test Category',
    'Test Product',
    '99.99',
    'US',
    'Feature 1, Feature 2',
  )

  const offerId = result.lastInsertRowid as number
  console.log(`创建测试Offer: ID=${offerId}`)

  // 生成创意
  console.log('\n生成广告创意...')
  const creative = await generateAdCreative(offerId, 1, { skipCache: true })

  console.log('\n生成的Headlines:')
  creative.headlines.forEach((h: any, i: number) => {
    console.log(`  ${i + 1}. ${h.text}`)
  })

  console.log('\n验证第一个headline:')
  const firstHeadline = creative.headlines[0].text
  const expected = '{KeyWord:TestBrand} Official'

  if (firstHeadline === expected) {
    console.log(`✅ 第一个headline正确: "${firstHeadline}"`)
  } else {
    console.log(`❌ 第一个headline错误:`)
    console.log(`   期望: "${expected}"`)
    console.log(`   实际: "${firstHeadline}"`)
  }

  // 清理
  db.prepare('DELETE FROM offers WHERE id = ?').run(offerId)
  console.log('\n测试完成，已清理测试数据')
}

main().catch(err => {
  console.error('错误:', err.message)
  process.exit(1)
})
