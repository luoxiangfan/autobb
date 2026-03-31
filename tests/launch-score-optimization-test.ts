/**
 * Launch Score优化测试脚本
 *
 * 测试内容：
 * 1. 否定关键词自动生成
 * 2. 竞争度数据收集
 * 3. Launch Score评分优化
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { calculateLaunchScore } from '../src/lib/scoring'
import { findOfferById } from '../src/lib/offers'
import { createAdCreative } from '../src/lib/ad-creative'

async function runTests() {
  console.log('\n=== Launch Score优化测试 ===\n')

  const db = getSQLiteDatabase()

  // 1. 获取测试用Offer（使用第一个已完成抓取的Offer）
  console.log('📋 步骤1: 获取测试Offer...')
  const testOffer = db.prepare(`
    SELECT * FROM offers
    WHERE scrape_status = 'completed'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any

  if (!testOffer) {
    console.error('❌ 未找到已完成抓取的Offer，请先创建并抓取一个Offer')
    return
  }

  console.log(`✅ 找到测试Offer: #${testOffer.id} - ${testOffer.brand}`)
  console.log(`   URL: ${testOffer.url}`)
  console.log(`   目标国家: ${testOffer.target_country}`)

  // 2. 测试广告创意生成（包括否定关键词）
  console.log('\n📋 步骤2: 测试广告创意生成（包括否定关键词）...')
  try {
    const creativeData = await generateAdCreative(
      testOffer.id,
      testOffer.user_id,
      { skipCache: true }
    )

    console.log(`✅ 广告创意生成成功`)
    console.log(`   Headlines: ${creativeData.headlines.length}个`)
    console.log(`   Descriptions: ${creativeData.descriptions.length}个`)
    console.log(`   Keywords: ${creativeData.keywords.length}个`)

    // 🎯 验证否定关键词
    if (creativeData.negativeKeywords && creativeData.negativeKeywords.length > 0) {
      console.log(`   ✅ 否定关键词: ${creativeData.negativeKeywords.length}个`)
      console.log(`      示例: ${creativeData.negativeKeywords.slice(0, 5).join(', ')}`)
    } else {
      console.log(`   ❌ 否定关键词: 未生成`)
    }

    // 🎯 验证关键词竞争度数据
    if (creativeData.keywordsWithVolume && creativeData.keywordsWithVolume.length > 0) {
      console.log(`   ✅ 关键词竞争度数据: ${creativeData.keywordsWithVolume.length}个`)

      const highCompKeywords = creativeData.keywordsWithVolume.filter(
        (kw: any) => (kw.competitionIndex || 0) > 70
      )

      if (highCompKeywords.length > 0) {
        console.log(`      ℹ️ 高竞争度关键词(>70): ${highCompKeywords.length}个（已保留，未过滤）`)
        console.log(`         示例: ${highCompKeywords.slice(0, 3).map((kw: any) =>
          `${kw.keyword} (竞争度${kw.competitionIndex})`
        ).join(', ')}`)
      } else {
        console.log(`      ✅ 所有关键词竞争度 <= 70`)
      }

      // 检查是否有关键词被过滤
      const allKeywords = creativeData.keywordsWithVolume
      console.log(`      📊 竞争度分布:`)
      const lowComp = allKeywords.filter((kw: any) => (kw.competitionIndex || 0) < 30).length
      const medComp = allKeywords.filter((kw: any) => (kw.competitionIndex || 0) >= 30 && (kw.competitionIndex || 0) <= 70).length
      const highComp = allKeywords.filter((kw: any) => (kw.competitionIndex || 0) > 70).length
      console.log(`         低竞争度(<30): ${lowComp}个`)
      console.log(`         中竞争度(30-70): ${medComp}个`)
      console.log(`         高竞争度(>70): ${highComp}个`)
    } else {
      console.log(`   ⚠️ 关键词竞争度数据: 未获取`)
    }

    // 3. 保存创意到数据库
    console.log('\n📋 步骤3: 保存创意到数据库...')
    const creative = createAdCreative(
      testOffer.user_id,
      testOffer.id,
      {
        ...creativeData,
        final_url: testOffer.url,
        ai_model: creativeData.ai_model || 'test'
      }
    )
    console.log(`✅ 创意已保存，ID: ${creative.id}`)

    // 4. 测试Launch Score计算
    console.log('\n📋 步骤4: 测试Launch Score计算...')
    const offer = findOfferById(testOffer.id, testOffer.user_id)

    if (!offer) {
      console.error('❌ Offer查询失败')
      return
    }

    const scoreAnalysis = await calculateLaunchScore(offer, creative, testOffer.user_id)

    console.log(`✅ Launch Score计算完成`)
    console.log(`   总分: ${
      scoreAnalysis.keywordAnalysis.score +
      scoreAnalysis.marketFitAnalysis.score +
      scoreAnalysis.landingPageAnalysis.score +
      scoreAnalysis.budgetAnalysis.score +
      scoreAnalysis.contentAnalysis.score
    }/100`)
    console.log(`   关键词质量: ${scoreAnalysis.keywordAnalysis.score}/30`)
    console.log(`   市场契合度: ${scoreAnalysis.marketFitAnalysis.score}/25`)
    console.log(`   着陆页质量: ${scoreAnalysis.landingPageAnalysis.score}/20`)
    console.log(`   预算合理性: ${scoreAnalysis.budgetAnalysis.score}/15`)
    console.log(`   内容创意质量: ${scoreAnalysis.contentAnalysis.score}/10`)

    // 🎯 验证否定关键词检查
    console.log('\n📋 步骤5: 验证评分逻辑...')
    if (scoreAnalysis.keywordAnalysis.issues && scoreAnalysis.keywordAnalysis.issues.length > 0) {
      console.log(`   ⚠️ 发现的问题:`)
      scoreAnalysis.keywordAnalysis.issues.forEach((issue: string) => {
        console.log(`      - ${issue}`)
      })
    } else {
      console.log(`   ✅ 无关键问题`)
    }

    if (scoreAnalysis.keywordAnalysis.suggestions && scoreAnalysis.keywordAnalysis.suggestions.length > 0) {
      console.log(`   💡 优化建议:`)
      scoreAnalysis.keywordAnalysis.suggestions.forEach((suggestion: string) => {
        console.log(`      - ${suggestion}`)
      })
    }

    // 验证否定关键词是否影响评分（更精确的检测：只检测"未设置"或"缺失"否定关键词的警告）
    const hasMissingNegativeKeywordIssue = scoreAnalysis.keywordAnalysis.issues?.some(
      (issue: string) => issue.includes('未设置') && issue.includes('否定关键词') || issue.includes('缺失') && issue.includes('否定关键词')
    )

    if (creativeData.negativeKeywords && creativeData.negativeKeywords.length > 0) {
      if (hasMissingNegativeKeywordIssue) {
        console.log(`   ❌ 测试失败: 有否定关键词但仍提示缺失`)
      } else {
        console.log(`   ✅ 测试通过: 否定关键词检查正确`)
      }
    } else {
      if (hasMissingNegativeKeywordIssue) {
        console.log(`   ✅ 测试通过: 正确检测到缺失否定关键词`)
      } else {
        console.log(`   ⚠️ 测试警告: 未检测到缺失否定关键词`)
      }
    }

    // 验证竞争度是否影响评分（不应该扣分）
    const hasCompetitionPenalty = scoreAnalysis.keywordAnalysis.issues?.some(
      (issue: string) => issue.includes('竞争度过高') && issue.includes('扣分')
    )

    if (hasCompetitionPenalty) {
      console.log(`   ❌ 测试失败: 高竞争度关键词导致扣分（不应该）`)
    } else {
      console.log(`   ✅ 测试通过: 高竞争度关键词不扣分`)
    }

    console.log('\n=== 测试完成 ===\n')

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message)
    console.error(error.stack)
  }
}

// 运行测试
runTests().catch(console.error)
