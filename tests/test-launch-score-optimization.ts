/**
 * 测试Launch Score优化效果
 *
 * 测试目标：
 * 1. 否定关键词数量达到40-50个
 * 2. 关键词搜索量>=1000/月
 * 3. Launch Score>=60分
 */

import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { calculateLaunchScore } from '../src/lib/scoring'
import { getSQLiteDatabase } from '../src/lib/db'

async function testLaunchScoreOptimization() {
  console.log('=' .repeat(60))
  console.log('🧪 Launch Score优化效果测试')
  console.log('=' .repeat(60))

  const offerId = 69  // BAGSMART - 信息完整的Offer
  const userId = 1    // autoads用户

  // 1. 获取Offer信息
  const db = getSQLiteDatabase()
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as any

  if (!offer) {
    console.error('❌ Offer不存在')
    process.exit(1)
  }

  console.log(`\n📦 Offer信息:`)
  console.log(`   ID: ${offer.id}`)
  console.log(`   品牌: ${offer.brand}`)
  console.log(`   类别: ${offer.category}`)
  console.log(`   目标国家: ${offer.target_country}`)
  console.log(`   状态: ${offer.scrape_status}`)

  // 2. 生成广告创意
  console.log('\n' + '-'.repeat(60))
  console.log('📝 生成广告创意...')
  console.log('-'.repeat(60))

  const startTime = Date.now()

  try {
    const creative = await generateAdCreative(offerId, userId, { skipCache: true })

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`\n✅ 创意生成完成 (耗时: ${duration}秒)`)

    // 3. 验证否定关键词数量
    console.log('\n' + '-'.repeat(60))
    console.log('🔍 验证1: 否定关键词数量')
    console.log('-'.repeat(60))

    const negativeKeywords = creative.negativeKeywords || []
    console.log(`   数量: ${negativeKeywords.length}个`)
    console.log(`   目标: 40-50个`)
    console.log(`   结果: ${negativeKeywords.length >= 40 ? '✅ 通过' : '❌ 未达标'}`)

    if (negativeKeywords.length > 0) {
      console.log(`   示例: ${negativeKeywords.slice(0, 10).join(', ')}...`)
    }

    // 4. 验证关键词搜索量
    console.log('\n' + '-'.repeat(60))
    console.log('🔍 验证2: 关键词搜索量')
    console.log('-'.repeat(60))

    const keywordsWithVolume = creative.keywordsWithVolume || []
    const lowVolumeKeywords = keywordsWithVolume.filter((kw: any) => kw.searchVolume > 0 && kw.searchVolume < 1000)
    const validKeywords = keywordsWithVolume.filter((kw: any) => kw.searchVolume >= 1000 || kw.searchVolume === 0)

    console.log(`   总关键词数: ${keywordsWithVolume.length}个`)
    console.log(`   搜索量>=1000: ${validKeywords.length}个`)
    console.log(`   搜索量<1000: ${lowVolumeKeywords.length}个`)
    console.log(`   结果: ${lowVolumeKeywords.length === 0 ? '✅ 通过' : '⚠️ 有低搜索量关键词'}`)

    if (keywordsWithVolume.length > 0) {
      console.log(`   关键词详情:`)
      keywordsWithVolume.slice(0, 5).forEach((kw: any) => {
        console.log(`     - ${kw.keyword}: ${kw.searchVolume.toLocaleString()}/月`)
      })
    }

    // 5. 计算Launch Score
    console.log('\n' + '-'.repeat(60))
    console.log('🔍 验证3: Launch Score')
    console.log('-'.repeat(60))

    // 构建最小必要的AdCreative对象用于calculateLaunchScore
    const creativeForScore = {
      id: 0,
      offer_id: offerId,
      user_id: userId,
      headlines: creative.headlines,
      descriptions: creative.descriptions,
      keywords: creative.keywords || [],
      keywordsWithVolume: creative.keywordsWithVolume || [],
      negativeKeywords: creative.negativeKeywords || [],
      callouts: creative.callouts || [],
      sitelinks: creative.sitelinks || [],
      final_url: offer.final_url || offer.url,
      final_url_suffix: offer.final_url_suffix || undefined,
      score: 0,
      score_breakdown: { relevance: 0, quality: 0, engagement: 0, diversity: 0, clarity: 0 },
      score_explanation: '',
      version: 1,
      generation_round: 1,
      theme: '',
      ai_model: creative.ai_model,
      is_selected: 0,
      is_approved: 0,
      creation_status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as any

    const launchScoreResult = await calculateLaunchScore(offer, creativeForScore, userId)

    // 计算总分（从各维度分数相加）
    const totalScore =
      launchScoreResult.keywordAnalysis.score +
      launchScoreResult.marketFitAnalysis.score +
      launchScoreResult.landingPageAnalysis.score +
      launchScoreResult.budgetAnalysis.score +
      launchScoreResult.contentAnalysis.score

    console.log(`   总分: ${totalScore}分`)
    console.log(`   目标: >=60分`)
    console.log(`   结果: ${totalScore >= 60 ? '✅ 通过' : '❌ 未达标'}`)
    console.log(`\n   5维度详细评分:`)
    console.log(`     - 关键词质量: ${launchScoreResult.keywordAnalysis.score}/30`)
    console.log(`     - 市场契合度: ${launchScoreResult.marketFitAnalysis.score}/25`)
    console.log(`     - 着陆页质量: ${launchScoreResult.landingPageAnalysis.score}/20`)
    console.log(`     - 预算合理性: ${launchScoreResult.budgetAnalysis.score}/15`)
    console.log(`     - 内容创意质量: ${launchScoreResult.contentAnalysis.score}/10`)

    // 6. 总结
    console.log('\n' + '='.repeat(60))
    console.log('📊 测试总结')
    console.log('='.repeat(60))

    const testResults = [
      { name: '否定关键词数量 (>=40)', passed: negativeKeywords.length >= 40, value: `${negativeKeywords.length}个` },
      { name: '关键词搜索量 (>=1000)', passed: lowVolumeKeywords.length === 0, value: `${validKeywords.length}/${keywordsWithVolume.length}合格` },
      { name: 'Launch Score (>=60)', passed: totalScore >= 60, value: `${totalScore}分` }
    ]

    testResults.forEach(result => {
      console.log(`   ${result.passed ? '✅' : '❌'} ${result.name}: ${result.value}`)
    })

    const allPassed = testResults.every(r => r.passed)
    console.log(`\n   🎯 总体结果: ${allPassed ? '✅ 所有测试通过！优化成功！' : '⚠️ 部分测试未通过，请检查'}`)

    // 7. 输出优化建议
    if (launchScoreResult.overallRecommendations && launchScoreResult.overallRecommendations.length > 0) {
      console.log('\n📋 优化建议:')
      launchScoreResult.overallRecommendations.slice(0, 5).forEach((rec: string, i: number) => {
        console.log(`   ${i + 1}. ${rec}`)
      })
    }

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

// 运行测试
testLaunchScoreOptimization()
  .then(() => {
    console.log('\n✅ 测试完成')
    process.exit(0)
  })
  .catch(error => {
    console.error('测试出错:', error)
    process.exit(1)
  })
