import { NextRequest, NextResponse } from 'next/server'
import { generateContent } from '@/lib/gemini'
import { recordTokenUsage, estimateTokenCost } from '@/lib/ai-token-tracker'

/**
 * POST /api/admin/performance-analysis
 * 基于Google Ads实际投放数据进行AI分析和优化建议
 */
export async function POST(request: NextRequest) {
  try {
    // 验证管理员权限
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    if (!userId || userRole !== 'admin') {
      return NextResponse.json({ error: '无权访问' }, { status: 403 })
    }

    const body = await request.json()
    const {
      performanceData,
      creativesData,
      analysisType = 'comprehensive' // comprehensive | ab_test | trend
    } = body

    // 构建AI分析Prompt
    let analysisPrompt = `你是AutoAds系统的数据分析专家，专门负责分析Google Ads投放数据并提供优化建议。

## 分析任务
基于实际的Google Ads投放数据，深入分析创意表现，识别成功模式和失败模式，提供具体的优化建议。

## 投放数据概览`

    if (performanceData && performanceData.length > 0) {
      analysisPrompt += `\n\n### 广告创意投放表现\n`

      performanceData.forEach((ad: any, index: number) => {
        analysisPrompt += `
**创意 ${index + 1}**
- 标题: ${ad.headline1} | ${ad.headline2} | ${ad.headline3}
- 描述: ${ad.description1} | ${ad.description2}
- 创意导向: ${ad.orientation === 'brand' ? '品牌导向' : ad.orientation === 'product' ? '产品导向' : '促销导向'}
- 性能指标:
  * 展示次数: ${ad.impressions?.toLocaleString() || 'N/A'}
  * 点击次数: ${ad.clicks?.toLocaleString() || 'N/A'}
  * CTR (点击率): ${ad.ctr ? (ad.ctr * 100).toFixed(2) + '%' : 'N/A'}
  * 转化次数: ${ad.conversions || 'N/A'}
  * 转化率: ${ad.conversionRate ? (ad.conversionRate * 100).toFixed(2) + '%' : 'N/A'}
  * 质量得分: ${ad.qualityScore || 'N/A'}/10
  * 平均CPC: $${ad.avgCpc?.toFixed(2) || 'N/A'}
  * 单次转化成本: $${ad.costPerConversion?.toFixed(2) || 'N/A'}
  * 平均排名: ${ad.avgPosition?.toFixed(1) || 'N/A'}
`
      })
    }

    analysisPrompt += `

## 分析维度

### 1. 表现对比分析
- 识别表现最好和最差的创意
- 对比CTR、转化率、质量得分等关键指标
- 分析不同创意导向的表现差异

### 2. 成功模式识别
- 高CTR创意的共同特征（标题结构、用词、长度等）
- 高转化率创意的特点（描述风格、行动号召等）
- 高质量得分创意的要素

### 3. 失败模式识别
- 低表现创意的共同问题
- 需要避免的用词和结构
- 不适合目标受众的创意特征

### 4. 具体优化建议
根据数据分析结果，提供以下优化建议：

#### A. Prompt优化建议
- 调整创意导向权重（brand/product/promo）
- 优化标题生成策略
- 改进描述生成逻辑
- 增强关键词使用

#### B. 创意要素优化
- 标题模板优化（基于高CTR创意）
- 描述模板优化（基于高转化创意）
- 行动号召优化
- 独特卖点突出方式

#### C. A/B测试建议
- 推荐下一轮测试的变量
- 测试假设和预期结果
- 建议的测试创意方向

## 输出格式
请以结构化的Markdown格式输出分析报告，包括：
1. **执行摘要** - 3-5个关键发现
2. **详细分析** - 每个维度的深入分析
3. **优化建议** - 至少5个具体的、可执行的优化措施
4. **Prompt调整建议** - 提供具体的Prompt修改示例
5. **下一步行动** - 优先级排序的行动清单

保持专业、数据驱动、可执行。`

    // 调用AI生成分析报告（使用用户级AI配置）
    const analysis = await generateContent({
      operationType: 'admin_performance_analysis',
      prompt: analysisPrompt,
      temperature: 0.7,
      maxOutputTokens: 8192,  // 🔴 Pro模型统一使用8192
    }, parseInt(userId, 10))

    // 记录token使用
    if (analysis.usage) {
      const cost = estimateTokenCost(
        analysis.model,
        analysis.usage.inputTokens,
        analysis.usage.outputTokens
      )
      await recordTokenUsage({
        userId: parseInt(userId, 10),
        model: analysis.model,
        operationType: 'admin_performance_analysis',
        inputTokens: analysis.usage.inputTokens,
        outputTokens: analysis.usage.outputTokens,
        totalTokens: analysis.usage.totalTokens,
        cost,
        apiType: analysis.apiType
      })
    }

    // 如果有足够的数据，生成具体的Prompt优化建议
    let promptOptimization = null

    if (performanceData && performanceData.length >= 3) {
      // 识别最佳表现的创意
      const sortedByPerformance = [...performanceData].sort((a, b) => {
        // 综合评分：CTR权重40%，转化率权重40%，质量得分权重20%
        const scoreA = (a.ctr || 0) * 0.4 + (a.conversionRate || 0) * 0.4 + ((a.qualityScore || 0) / 10) * 0.2
        const scoreB = (b.ctr || 0) * 0.4 + (b.conversionRate || 0) * 0.4 + ((b.qualityScore || 0) / 10) * 0.2
        return scoreB - scoreA
      })

      const topPerformers = sortedByPerformance.slice(0, Math.ceil(performanceData.length / 3))
      const lowPerformers = sortedByPerformance.slice(-Math.ceil(performanceData.length / 3))

      const optimizationPrompt = `基于以下投放数据，生成具体的Prompt优化建议：

## 高表现创意特征
${topPerformers.map((ad: any, i: number) => `
${i + 1}. ${ad.headline1}
   - CTR: ${(ad.ctr * 100).toFixed(2)}%
   - 转化率: ${(ad.conversionRate * 100).toFixed(2)}%
   - 导向: ${ad.orientation}
`).join('\n')}

## 低表现创意特征
${lowPerformers.map((ad: any, i: number) => `
${i + 1}. ${ad.headline1}
   - CTR: ${(ad.ctr * 100).toFixed(2)}%
   - 转化率: ${(ad.conversionRate * 100).toFixed(2)}%
   - 导向: ${ad.orientation}
`).join('\n')}

请提供具体的Prompt调整建议，包括：
1. 应该增强的要素（从高表现创意中提取）
2. 应该避免的要素（从低表现创意中识别）
3. 具体的Prompt修改示例（before/after对比）

只返回具体建议，不要解释。`

      promptOptimization = await generateContent({
        operationType: 'admin_prompt_optimization',
        prompt: optimizationPrompt,
        temperature: 0.5,
        maxOutputTokens: 4096,
      }, parseInt(userId, 10))

      // 记录token使用
      if (promptOptimization.usage) {
        const cost = estimateTokenCost(
          promptOptimization.model,
          promptOptimization.usage.inputTokens,
          promptOptimization.usage.outputTokens
        )
        await recordTokenUsage({
          userId: parseInt(userId, 10),
          model: promptOptimization.model,
          operationType: 'admin_prompt_optimization',
          inputTokens: promptOptimization.usage.inputTokens,
          outputTokens: promptOptimization.usage.outputTokens,
          totalTokens: promptOptimization.usage.totalTokens,
          cost,
          apiType: promptOptimization.apiType
        })
      }
    }

    return NextResponse.json({
      success: true,
      analysis,
      promptOptimization,
      insights: {
        totalCreatives: performanceData?.length || 0,
        avgCtr: performanceData?.reduce((sum: number, ad: any) => sum + (ad.ctr || 0), 0) / (performanceData?.length || 1),
        avgConversionRate: performanceData?.reduce((sum: number, ad: any) => sum + (ad.conversionRate || 0), 0) / (performanceData?.length || 1),
        avgQualityScore: performanceData?.reduce((sum: number, ad: any) => sum + (ad.qualityScore || 0), 0) / (performanceData?.length || 1),
      },
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('投放数据分析失败:', error)
    return NextResponse.json(
      { error: error.message || '投放数据分析失败' },
      { status: 500 }
    )
  }
}
