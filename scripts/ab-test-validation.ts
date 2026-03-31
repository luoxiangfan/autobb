/**
 * A/B测试验证脚本
 *
 * 用途：
 * 1. 对比Pro vs Flash的输出质量
 * 2. 验证模型降级是否满足质量标准
 * 3. 测试Prompt优化的效果
 *
 * 使用方法：
 * ```bash
 * npm run test:ab-validation
 * ```
 *
 * 或在代码中导入：
 * ```typescript
 * import { validateFlashQuality } from './scripts/ab-test-validation'
 * await validateFlashQuality('ad_headline_extraction_single', testData)
 * ```
 */

import { generateContent } from '../src/lib/gemini'
import { estimateTokenCost } from '../src/lib/ai-token-tracker'

/**
 * A/B测试结果接口
 */
export interface ABTestResult {
  operationType: string
  testCases: number
  successfulTests: number
  qualityMetrics: {
    proOutputs: string[]
    flashOutputs: string[]
    parseSuccessRate: {
      pro: number
      flash: number
    }
    outputSimilarity: number // 0-1, 相似度
    averageTokens: {
      pro: { input: number; output: number }
      flash: { input: number; output: number }
    }
    costComparison: {
      proTotalCost: number
      flashTotalCost: number
      savings: number
      savingsPercentage: number
    }
  }
  recommendation: 'approve_flash' | 'reject_flash' | 'needs_more_testing'
  reasons: string[]
}

/**
 * 计算两个字符串的相似度（简化版Levenshtein距离）
 */
function calculateSimilarity(str1: string, str2: string): number {
  // 移除空白字符和标点，只比较核心内容
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[\s\p{P}]/gu, '')

  const s1 = normalize(str1)
  const s2 = normalize(str2)

  if (s1 === s2) return 1.0

  const len1 = s1.length
  const len2 = s2.length
  const maxLen = Math.max(len1, len2)

  if (maxLen === 0) return 1.0

  // 计算编辑距离
  const matrix: number[][] = []
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // 删除
        matrix[i][j - 1] + 1, // 插入
        matrix[i - 1][j - 1] + cost // 替换
      )
    }
  }

  const distance = matrix[len1][len2]
  return 1 - distance / maxLen
}

/**
 * 验证JSON解析是否成功
 */
function validateJSONParsing(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * 执行A/B测试验证
 *
 * @param operationType - 操作类型
 * @param testData - 测试数据数组
 * @param userId - 用户ID（默认1，测试用户）
 * @param testCount - 测试次数（默认100）
 * @returns A/B测试结果
 */
export async function validateFlashQuality(
  operationType: string,
  testData: Array<{ prompt: string; expectedFormat?: any }>,
  userId: number = 1,
  testCount: number = 100
): Promise<ABTestResult> {
  console.log(`\n🧪 开始A/B测试: ${operationType}`)
  console.log(`测试样本: ${testCount}次`)
  console.log(`测试数据: ${testData.length}个场景\n`)

  const proOutputs: string[] = []
  const flashOutputs: string[] = []
  let proParseSuccess = 0
  let flashParseSuccess = 0
  const similarities: number[] = []

  let proTotalInputTokens = 0
  let proTotalOutputTokens = 0
  let flashTotalInputTokens = 0
  let flashTotalOutputTokens = 0

  // 执行测试
  for (let i = 0; i < testCount; i++) {
    const testCase = testData[i % testData.length]
    console.log(`  测试 ${i + 1}/${testCount}...`)

    try {
      // 并行调用Pro和Flash
      const [proResult, flashResult] = await Promise.all([
        generateContent(
          {
            model: 'gemini-2.5-pro',
            prompt: testCase.prompt,
            temperature: 0.5,
            maxOutputTokens: 4096,
          },
          userId
        ),
        generateContent(
          {
            model: 'gemini-2.5-flash',
            prompt: testCase.prompt,
            temperature: 0.5,
            maxOutputTokens: 4096,
          },
          userId
        ),
      ])

      proOutputs.push(proResult.text)
      flashOutputs.push(flashResult.text)

      // 验证JSON解析
      if (validateJSONParsing(proResult.text)) proParseSuccess++
      if (validateJSONParsing(flashResult.text)) flashParseSuccess++

      // 计算相似度
      const similarity = calculateSimilarity(proResult.text, flashResult.text)
      similarities.push(similarity)

      // 累计Token使用
      if (proResult.usage) {
        proTotalInputTokens += proResult.usage.inputTokens
        proTotalOutputTokens += proResult.usage.outputTokens
      }
      if (flashResult.usage) {
        flashTotalInputTokens += flashResult.usage.inputTokens
        flashTotalOutputTokens += flashResult.usage.outputTokens
      }
    } catch (error: any) {
      console.error(`  ❌ 测试失败: ${error.message}`)
    }
  }

  // 计算平均相似度
  const avgSimilarity =
    similarities.reduce((a, b) => a + b, 0) / similarities.length

  // 计算成本
  const proTotalCost =
    estimateTokenCost(
      'gemini-2.5-pro',
      proTotalInputTokens,
      proTotalOutputTokens
    ) || 0
  const flashTotalCost =
    estimateTokenCost(
      'gemini-2.5-flash',
      flashTotalInputTokens,
      flashTotalOutputTokens
    ) || 0

  // 生成推荐
  const reasons: string[] = []
  let recommendation: 'approve_flash' | 'reject_flash' | 'needs_more_testing'

  const proParseRate = proParseSuccess / testCount
  const flashParseRate = flashParseSuccess / testCount

  // 判断标准
  if (flashParseRate >= 0.99 && avgSimilarity >= 0.85) {
    recommendation = 'approve_flash'
    reasons.push('✅ JSON解析成功率 ≥ 99%')
    reasons.push('✅ 输出相似度 ≥ 85%')
    reasons.push(
      `💰 成本节省 ${(((proTotalCost - flashTotalCost) / proTotalCost) * 100).toFixed(1)}%`
    )
  } else if (flashParseRate < 0.95 || avgSimilarity < 0.75) {
    recommendation = 'reject_flash'
    if (flashParseRate < 0.95) {
      reasons.push(`❌ JSON解析成功率不达标: ${(flashParseRate * 100).toFixed(1)}% < 95%`)
    }
    if (avgSimilarity < 0.75) {
      reasons.push(`❌ 输出相似度不达标: ${(avgSimilarity * 100).toFixed(1)}% < 75%`)
    }
  } else {
    recommendation = 'needs_more_testing'
    reasons.push('⚠️ 质量指标接近边界，需要更多测试')
    reasons.push(
      `解析率: ${(flashParseRate * 100).toFixed(1)}% (目标≥99%)`
    )
    reasons.push(
      `相似度: ${(avgSimilarity * 100).toFixed(1)}% (目标≥85%)`
    )
  }

  const result: ABTestResult = {
    operationType,
    testCases: testCount,
    successfulTests: Math.min(proParseSuccess, flashParseSuccess),
    qualityMetrics: {
      proOutputs,
      flashOutputs,
      parseSuccessRate: {
        pro: proParseRate,
        flash: flashParseRate,
      },
      outputSimilarity: avgSimilarity,
      averageTokens: {
        pro: {
          input: proTotalInputTokens / testCount,
          output: proTotalOutputTokens / testCount,
        },
        flash: {
          input: flashTotalInputTokens / testCount,
          output: flashTotalOutputTokens / testCount,
        },
      },
      costComparison: {
        proTotalCost,
        flashTotalCost,
        savings: proTotalCost - flashTotalCost,
        savingsPercentage:
          ((proTotalCost - flashTotalCost) / proTotalCost) * 100,
      },
    },
    recommendation,
    reasons,
  }

  // 打印结果
  console.log(`\n📊 A/B测试结果汇总:`)
  console.log(`操作类型: ${operationType}`)
  console.log(`\n质量指标:`)
  console.log(
    `  Pro解析成功率: ${(proParseRate * 100).toFixed(1)}%`
  )
  console.log(
    `  Flash解析成功率: ${(flashParseRate * 100).toFixed(1)}%`
  )
  console.log(
    `  输出相似度: ${(avgSimilarity * 100).toFixed(1)}%`
  )
  console.log(`\n成本对比:`)
  console.log(`  Pro总成本: $${proTotalCost.toFixed(4)}`)
  console.log(`  Flash总成本: $${flashTotalCost.toFixed(4)}`)
  console.log(
    `  节省: $${result.qualityMetrics.costComparison.savings.toFixed(4)} (${result.qualityMetrics.costComparison.savingsPercentage.toFixed(1)}%)`
  )
  console.log(`\n推荐: ${recommendation}`)
  reasons.forEach((reason) => console.log(`  ${reason}`))

  return result
}

/**
 * 批量验证多个操作类型
 */
export async function validateMultipleOperations(
  operations: Array<{
    operationType: string
    testData: Array<{ prompt: string; expectedFormat?: any }>
  }>,
  userId: number = 1
): Promise<ABTestResult[]> {
  console.log(`\n🚀 批量A/B测试: ${operations.length}个操作类型\n`)

  const results: ABTestResult[] = []

  for (const op of operations) {
    const result = await validateFlashQuality(
      op.operationType,
      op.testData,
      userId,
      100
    )
    results.push(result)

    // 添加间隔，避免API限流
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  // 生成汇总报告
  console.log(`\n\n📈 批量测试汇总报告:\n`)
  console.log(`总测试操作: ${results.length}`)
  console.log(
    `通过测试: ${results.filter((r) => r.recommendation === 'approve_flash').length}`
  )
  console.log(
    `拒绝Flash: ${results.filter((r) => r.recommendation === 'reject_flash').length}`
  )
  console.log(
    `需更多测试: ${results.filter((r) => r.recommendation === 'needs_more_testing').length}`
  )

  const totalSavings = results.reduce(
    (sum, r) => sum + r.qualityMetrics.costComparison.savings,
    0
  )
  console.log(`\n预期总节省: $${totalSavings.toFixed(2)}`)

  return results
}

/**
 * 示例：运行完整的A/B测试套件
 */
export async function runFullABTestSuite(userId: number = 1) {
  const operations = [
    {
      operationType: 'creative_quality_scoring',
      testData: [
        {
          prompt:
            'Rate the quality of these ad creatives (0-100): Headline: "Buy Now", Description: "Great product"',
        },
      ],
    },
    {
      operationType: 'ad_headline_extraction_single',
      testData: [
        {
          prompt:
            'Generate 15 ad headlines for a smartphone: iPhone 15 Pro, 128GB, $999',
        },
      ],
    },
    {
      operationType: 'ad_description_extraction_single',
      testData: [
        {
          prompt:
            'Generate 4 ad descriptions for a smartphone: iPhone 15 Pro, advanced camera, long battery',
        },
      ],
    },
    {
      operationType: 'negative_keyword_generation',
      testData: [
        {
          prompt:
            'Generate negative keywords for a premium smartphone ad campaign',
        },
      ],
    },
    // 可以添加更多操作类型...
  ]

  return await validateMultipleOperations(operations, userId)
}

// 如果直接运行此脚本
if (require.main === module) {
  runFullABTestSuite(1)
    .then(() => {
      console.log('\n✅ A/B测试完成')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ A/B测试失败:', error)
      process.exit(1)
    })
}
