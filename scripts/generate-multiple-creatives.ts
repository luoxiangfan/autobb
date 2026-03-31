/**
 * 生成多个广告创意用于测试
 */
import { generateAdCreative } from '../src/lib/ad-creative-generator'

async function generateMultipleCreatives() {
  console.log('🚀 开始生成 3 个广告创意...\n')

  try {
    for (let i = 1; i <= 3; i++) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`📍 生成第 ${i} 个创意`)
      console.log(`${'='.repeat(60)}\n`)

      const startTime = Date.now()
      const creative = await generateAdCreative(
        236, // offerId
        1, // userId
        { skipCache: true }
      )
      const duration = Date.now() - startTime

      console.log(`\n✅ 第 ${i} 个创意生成成功! 耗时: ${(duration / 1000).toFixed(1)}s`)
      console.log(`   - Keywords: ${creative.keywords.length} 个`)
      console.log(`   - Score: ${creative.score}`)
      console.log()
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log('✅ 所有创意生成完成!')
    console.log(`${'='.repeat(60)}\n`)

  } catch (error: any) {
    console.log('❌ 创意生成失败!')
    console.log('错误:', error.message)
    console.log(error.stack)
  }
}

generateMultipleCreatives().catch(console.error)
