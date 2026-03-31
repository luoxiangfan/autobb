/**
 * 快速测试第一个headline格式
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { generateAdCreative } from '../src/lib/ad-creative-generator'

async function main() {
  console.log('快速测试第一个headline格式...\n')

  const db = getSQLiteDatabase()

  // 使用现有的Offer (ID 103 - Reolink)
  const offerId = 103
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any

  if (!offer) {
    console.error('Offer不存在')
    process.exit(1)
  }

  console.log(`使用Offer: ID=${offerId}, Brand=${offer.brand}`)
  console.log(`期望的第一个headline: {KeyWord:${offer.brand}} Official\n`)

  // 生成创意
  console.log('开始生成创意...')
  const creative = await generateAdCreative(offerId, 1, { skipCache: true })

  console.log('\n生成的前5个Headlines:')
  creative.headlines.slice(0, 5).forEach((h: any, i: number) => {
    console.log(`  ${i + 1}. ${h.text}`)
  })

  // 验证第一个headline
  const firstHeadline = creative.headlines[0].text
  const expected = `{KeyWord:${offer.brand}} Official`

  console.log('\n验证结果:')
  console.log(`期望: "${expected}"`)
  console.log(`实际: "${firstHeadline}"`)

  if (firstHeadline === expected) {
    console.log('\n✅ 测试通过！第一个headline格式正确')
    process.exit(0)
  } else {
    console.log('\n❌ 测试失败！第一个headline格式不正确')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\n错误:', err.message)
  console.error(err.stack)
  process.exit(1)
})
