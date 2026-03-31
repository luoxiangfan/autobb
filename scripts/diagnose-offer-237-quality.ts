/**
 * Offer 237 质量分诊断脚本
 *
 * 用于分析 Ad Strength 中质量分不高的原因
 * 支持详细的维度分析和对比
 */

import chalk from 'chalk'

// ============================================================================
// 模拟的 Ad Strength 评分数据
// ============================================================================

interface AdStrengthDimension {
  score: number
  maxScore: number
  weight: number
  percentage: number
  details: Record<string, any>
}

interface AdStrengthEvaluation {
  overallScore: number
  rating: 'PENDING' | 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'
  dimensions: {
    diversity: AdStrengthDimension
    relevance: AdStrengthDimension
    completeness: AdStrengthDimension
    quality: AdStrengthDimension
    compliance: AdStrengthDimension
    brandSearchVolume: AdStrengthDimension
  }
}

// Offer 235 的成功案例（参考）
const offer235: AdStrengthEvaluation = {
  overallScore: 86,
  rating: 'EXCELLENT',
  dimensions: {
    diversity: {
      score: 19,
      maxScore: 20,
      weight: 0.2,
      percentage: 95,
      details: {
        typeDistribution: 8,
        lengthDistribution: 8,
        textUniqueness: 3
      }
    },
    relevance: {
      score: 20,
      maxScore: 20,
      weight: 0.2,
      percentage: 100,
      details: {
        keywordCoverage: 12,
        keywordNaturalness: 8
      }
    },
    completeness: {
      score: 15,
      maxScore: 20,
      weight: 0.15,
      percentage: 75,
      details: {
        assetCount: 9,
        characterCompliance: 6
      }
    },
    quality: {
      score: 12,
      maxScore: 20,
      weight: 0.15,
      percentage: 60,
      details: {
        numberUsage: 4,
        ctaPresence: 4,
        urgencyExpression: 2,
        differentiation: 2
      }
    },
    compliance: {
      score: 10,
      maxScore: 20,
      weight: 0.1,
      percentage: 50,
      details: {
        policyAdherence: 6,
        noSpamWords: 4
      }
    },
    brandSearchVolume: {
      score: 10,
      maxScore: 20,
      weight: 0.2,
      percentage: 50,
      details: {
        monthlySearchVolume: 1352.5,
        volumeLevel: 'medium',
        dataSource: 'keyword_planner'
      }
    }
  }
}

// Offer 237 的假设数据（需要实际获取）
const offer237: AdStrengthEvaluation = {
  overallScore: 62,
  rating: 'AVERAGE',
  dimensions: {
    diversity: {
      score: 14,
      maxScore: 20,
      weight: 0.2,
      percentage: 70,
      details: {
        typeDistribution: 5,
        lengthDistribution: 6,
        textUniqueness: 3
      }
    },
    relevance: {
      score: 12,
      maxScore: 20,
      weight: 0.2,
      percentage: 60,
      details: {
        keywordCoverage: 8,
        keywordNaturalness: 4
      }
    },
    completeness: {
      score: 12,
      maxScore: 20,
      weight: 0.15,
      percentage: 60,
      details: {
        assetCount: 7,
        characterCompliance: 5
      }
    },
    quality: {
      score: 8,
      maxScore: 20,
      weight: 0.15,
      percentage: 40,
      details: {
        numberUsage: 2,
        ctaPresence: 2,
        urgencyExpression: 2,
        differentiation: 2
      }
    },
    compliance: {
      score: 8,
      maxScore: 20,
      weight: 0.1,
      percentage: 40,
      details: {
        policyAdherence: 4,
        noSpamWords: 4
      }
    },
    brandSearchVolume: {
      score: 8,
      maxScore: 20,
      weight: 0.2,
      percentage: 40,
      details: {
        monthlySearchVolume: 450,
        volumeLevel: 'small',
        dataSource: 'keyword_planner'
      }
    }
  }
}

// ============================================================================
// 诊断函数
// ============================================================================

function diagnoseQualityScore() {
  console.log(chalk.bold.cyan('\n🔍 Offer 237 质量分诊断\n'))

  // 1. 总体对比
  console.log(chalk.cyan('='.repeat(80)))
  console.log(chalk.cyan('📊 总体评分对比'))
  console.log(chalk.cyan('='.repeat(80)))

  console.log(`\n📈 Offer 235 (参考 - 成功案例):`)
  console.log(`   总分: ${offer235.overallScore}/100`)
  console.log(`   评级: ${offer235.rating}`)
  console.log(`   状态: ✅ EXCELLENT`)

  console.log(`\n📉 Offer 237 (当前 - 问题案例):`)
  console.log(`   总分: ${offer237.overallScore}/100`)
  console.log(`   评级: ${offer237.rating}`)
  console.log(`   状态: ⚠️ AVERAGE`)

  console.log(`\n📊 差异:`)
  console.log(`   总分差: ${offer235.overallScore - offer237.overallScore} 分`)
  console.log(`   评级差: ${offer235.rating} → ${offer237.rating}`)

  // 2. 维度分析
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('🔬 维度详细分析'))
  console.log(chalk.cyan('='.repeat(80)))

  const dimensions = [
    { key: 'diversity', name: '多样性 (Diversity)', weight: '20%' },
    { key: 'relevance', name: '相关性 (Relevance)', weight: '20%' },
    { key: 'completeness', name: '完整性 (Completeness)', weight: '15%' },
    { key: 'quality', name: '质量 (Quality)', weight: '15%' },
    { key: 'compliance', name: '合规性 (Compliance)', weight: '10%' },
    { key: 'brandSearchVolume', name: '品牌搜索量 (Brand Search Volume)', weight: '20%' }
  ]

  const dimensionDifferences: Array<{
    name: string
    key: string
    offer235: number
    offer237: number
    diff: number
    percentage: number
    severity: 'low' | 'medium' | 'high'
  }> = []

  dimensions.forEach(dim => {
    const key = dim.key as keyof typeof offer235.dimensions
    const d235 = offer235.dimensions[key]
    const d237 = offer237.dimensions[key]
    const diff = d235.score - d237.score
    const percentage = (diff / d235.score) * 100

    let severity: 'low' | 'medium' | 'high' = 'low'
    if (percentage >= 30) severity = 'high'
    else if (percentage >= 15) severity = 'medium'

    dimensionDifferences.push({
      name: dim.name,
      key: dim.key,
      offer235: d235.score,
      offer237: d237.score,
      diff,
      percentage,
      severity
    })

    const status = diff > 0 ? '❌' : '✅'
    const severityIcon = severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🟢'

    console.log(`\n${severityIcon} ${dim.name} (权重: ${dim.weight})`)
    console.log(`   Offer 235: ${d235.score}/${d235.maxScore} (${d235.percentage}%)`)
    console.log(`   Offer 237: ${d237.score}/${d237.maxScore} (${d237.percentage}%)`)
    console.log(`   差异: ${status} ${diff > 0 ? '-' : '+'}${Math.abs(diff)} 分 (${percentage.toFixed(1)}%)`)
  })

  // 3. 问题排序
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('🎯 问题严重程度排序'))
  console.log(chalk.cyan('='.repeat(80)))

  const sortedByDiff = [...dimensionDifferences].sort((a, b) => b.diff - a.diff)

  console.log(`\n按差异从大到小排序:\n`)
  sortedByDiff.forEach((dim, index) => {
    const icon = index === 0 ? '🔴' : index === 1 ? '🟡' : '🟢'
    console.log(`${index + 1}. ${icon} ${dim.name}`)
    console.log(`   差异: -${dim.diff} 分 (${dim.percentage.toFixed(1)}%)`)
    console.log(`   影响: ${(dim.diff * (dim.key === 'diversity' || dim.key === 'relevance' || dim.key === 'brandSearchVolume' ? 0.2 : dim.key === 'completeness' || dim.key === 'quality' ? 0.15 : 0.1)).toFixed(2)} 分`)
  })

  // 4. 根本原因分析
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('🔍 根本原因分析'))
  console.log(chalk.cyan('='.repeat(80)))

  const topIssue = sortedByDiff[0]

  console.log(`\n🎯 最严重的问题: ${topIssue.name}`)
  console.log(`   差异: -${topIssue.diff} 分`)
  console.log(`   影响: 占总分差的 ${((topIssue.diff / (offer235.overallScore - offer237.overallScore)) * 100).toFixed(1)}%`)

  // 根据不同的维度提供具体的诊断
  switch (topIssue.key) {
    case 'brandSearchVolume':
      console.log(`\n📌 诊断:`)
      console.log(`   品牌搜索量太低`)
      console.log(`   - Offer 235: ${offer235.dimensions.brandSearchVolume.details.monthlySearchVolume}/月 (${offer235.dimensions.brandSearchVolume.details.volumeLevel})`)
      console.log(`   - Offer 237: ${offer237.dimensions.brandSearchVolume.details.monthlySearchVolume}/月 (${offer237.dimensions.brandSearchVolume.details.volumeLevel})`)
      console.log(`\n💡 建议:`)
      console.log(`   1. 选择搜索量更高的品牌或产品`)
      console.log(`   2. 在目标市场进行品牌推广`)
      console.log(`   3. 使用更通用的产品类别关键词`)
      break

    case 'relevance':
      console.log(`\n📌 诊断:`)
      console.log(`   关键词相关性不足`)
      console.log(`   - Offer 235: 覆盖率 ${offer235.dimensions.relevance.details.keywordCoverage}/12, 自然度 ${offer235.dimensions.relevance.details.keywordNaturalness}/8`)
      console.log(`   - Offer 237: 覆盖率 ${offer237.dimensions.relevance.details.keywordCoverage}/12, 自然度 ${offer237.dimensions.relevance.details.keywordNaturalness}/8`)
      console.log(`\n💡 建议:`)
      console.log(`   1. 在标题和描述中明确包含关键词`)
      console.log(`   2. 使用词形变化 (如 "robot" vs "robots")`)
      console.log(`   3. 避免关键词堆砌 (密度 < 30%)`)
      break

    case 'quality':
      console.log(`\n📌 诊断:`)
      console.log(`   内容质量不足`)
      console.log(`   - Offer 235: 数字 ${offer235.dimensions.quality.details.numberUsage}, CTA ${offer235.dimensions.quality.details.ctaPresence}, 紧迫感 ${offer235.dimensions.quality.details.urgencyExpression}, 差异化 ${offer235.dimensions.quality.details.differentiation}`)
      console.log(`   - Offer 237: 数字 ${offer237.dimensions.quality.details.numberUsage}, CTA ${offer237.dimensions.quality.details.ctaPresence}, 紧迫感 ${offer237.dimensions.quality.details.urgencyExpression}, 差异化 ${offer237.dimensions.quality.details.differentiation}`)
      console.log(`\n💡 建议:`)
      console.log(`   1. 在标题中添加具体数字 (如 "30% Off", "7000Pa")`)
      console.log(`   2. 在描述中添加明确的 CTA (如 "Buy Now", "Shop Today")`)
      console.log(`   3. 添加紧迫感表达 (如 "Limited Time", "Only 5 Left")`)
      console.log(`   4. 强调独特的卖点和差异化`)
      break

    case 'diversity':
      console.log(`\n📌 诊断:`)
      console.log(`   多样性不足`)
      console.log(`   - Offer 235: 类型 ${offer235.dimensions.diversity.details.typeDistribution}, 长度 ${offer235.dimensions.diversity.details.lengthDistribution}, 独特性 ${offer235.dimensions.diversity.details.textUniqueness}`)
      console.log(`   - Offer 237: 类型 ${offer237.dimensions.diversity.details.typeDistribution}, 长度 ${offer237.dimensions.diversity.details.lengthDistribution}, 独特性 ${offer237.dimensions.diversity.details.textUniqueness}`)
      console.log(`\n💡 建议:`)
      console.log(`   1. 确保标题类型分布完整 (品牌、产品、促销、CTA、紧迫性)`)
      console.log(`   2. 平衡长度分布 (短、中、长各 5 个)`)
      console.log(`   3. 减少标题和描述之间的重复内容`)
      break

    case 'completeness':
      console.log(`\n📌 诊断:`)
      console.log(`   资产不完整`)
      console.log(`   - Offer 235: 资产数 ${offer235.dimensions.completeness.details.assetCount}, 字符合规 ${offer235.dimensions.completeness.details.characterCompliance}`)
      console.log(`   - Offer 237: 资产数 ${offer237.dimensions.completeness.details.assetCount}, 字符合规 ${offer237.dimensions.completeness.details.characterCompliance}`)
      console.log(`\n💡 建议:`)
      console.log(`   1. 增加标题数量至 15 个`)
      console.log(`   2. 增加描述数量至 4 个`)
      console.log(`   3. 确保标题长度 10-30 字`)
      console.log(`   4. 确保描述长度 60-90 字`)
      break

    case 'compliance':
      console.log(`\n📌 诊断:`)
      console.log(`   合规性问题`)
      console.log(`   - Offer 235: 政策 ${offer235.dimensions.compliance.details.policyAdherence}, 无垃圾词 ${offer235.dimensions.compliance.details.noSpamWords}`)
      console.log(`   - Offer 237: 政策 ${offer237.dimensions.compliance.details.policyAdherence}, 无垃圾词 ${offer237.dimensions.compliance.details.noSpamWords}`)
      console.log(`\n💡 建议:`)
      console.log(`   1. 检查是否有重复内容 (相似度 > 80%)`)
      console.log(`   2. 移除禁用词汇 (如 "FREE", "GUARANTEED", "BEST")`)
      console.log(`   3. 避免过度承诺`)
      break
  }

  // 5. 改进方案
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('📈 改进方案'))
  console.log(chalk.cyan('='.repeat(80)))

  console.log(`\n🎯 目标: 从 ${offer237.overallScore} 分提升到 80+ 分 (GOOD/EXCELLENT)`)

  console.log(`\n📋 改进步骤:`)
  sortedByDiff.slice(0, 3).forEach((dim, index) => {
    const potentialGain = dim.diff * 0.8 // 假设能改进 80%
    console.log(`\n${index + 1}. 改进 ${dim.name}`)
    console.log(`   当前: ${dim.offer237}/${dim.offer235 + dim.diff} 分`)
    console.log(`   目标: ${Math.round(dim.offer237 + potentialGain)}/${dim.offer235 + dim.diff} 分`)
    console.log(`   预期收益: +${Math.round(potentialGain)} 分`)
  })

  const totalPotentialGain = sortedByDiff
    .slice(0, 3)
    .reduce((sum, dim) => sum + dim.diff * 0.8, 0)

  console.log(`\n📊 预期总分: ${Math.round(offer237.overallScore + totalPotentialGain)}/100`)
  console.log(`   改进幅度: +${Math.round(totalPotentialGain)} 分`)
  console.log(`   新评级: ${Math.round(offer237.overallScore + totalPotentialGain) >= 85 ? 'EXCELLENT' : Math.round(offer237.overallScore + totalPotentialGain) >= 70 ? 'GOOD' : 'AVERAGE'}`)

  // 6. 优先级建议
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('⚡ 优先级建议'))
  console.log(chalk.cyan('='.repeat(80)))

  console.log(`\n🔴 P0 (立即处理):`)
  console.log(`   ${sortedByDiff[0].name} (-${sortedByDiff[0].diff} 分)`)

  console.log(`\n🟡 P1 (本周处理):`)
  console.log(`   ${sortedByDiff[1].name} (-${sortedByDiff[1].diff} 分)`)
  console.log(`   ${sortedByDiff[2].name} (-${sortedByDiff[2].diff} 分)`)

  console.log(`\n🟢 P2 (本月处理):`)
  sortedByDiff.slice(3).forEach(dim => {
    console.log(`   ${dim.name} (-${dim.diff} 分)`)
  })
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  diagnoseQualityScore()

  // 输出总结
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('📝 诊断总结'))
  console.log(chalk.cyan('='.repeat(80)))

  console.log(`\n✅ 诊断完成`)
  console.log(`\n📊 关键发现:`)
  console.log(`   1. Offer 237 的总分比 Offer 235 低 ${offer235.overallScore - offer237.overallScore} 分`)
  console.log(`   2. 最严重的问题是: ${dimensionDifferences.sort((a, b) => b.diff - a.diff)[0].name}`)
  console.log(`   3. 通过改进前 3 个维度，可以提升 ${Math.round(dimensionDifferences.sort((a, b) => b.diff - a.diff).slice(0, 3).reduce((sum, d) => sum + d.diff * 0.8, 0))} 分`)

  console.log(`\n🎯 建议:`)
  console.log(`   1. 立即处理 P0 问题`)
  console.log(`   2. 本周内处理 P1 问题`)
  console.log(`   3. 本月内处理 P2 问题`)

  console.log(chalk.green.bold('\n✨ 诊断报告已生成\n'))
}

// 辅助变量
const dimensionDifferences: Array<{
  name: string
  key: string
  offer235: number
  offer237: number
  diff: number
  percentage: number
  severity: 'low' | 'medium' | 'high'
}> = []

main().catch(error => {
  console.error(chalk.red('错误:'), error)
  process.exit(1)
})
