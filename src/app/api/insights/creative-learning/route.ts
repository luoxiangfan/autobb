/**
 * GET /api/insights/creative-learning
 * 获取用户的创意学习洞察
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  queryHighPerformingCreatives,
  analyzeSuccessFeatures,
  type SuccessFeatures
} from '@/lib/creative-learning'
import { toNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const minCtr = parseFloat(searchParams.get('min_ctr') || '0.03')
    const minClicks = parseInt(searchParams.get('min_clicks') || '100')
    const limit = parseInt(searchParams.get('limit') || '50')

    // 查询高表现创意
    const highPerformers = await queryHighPerformingCreatives(
      auth.user!.userId,
      minCtr,
      minClicks,
      limit
    )

    if (highPerformers.length === 0) {
      return NextResponse.json({
        hasData: false,
        message: '暂无足够的高表现创意数据（需要至少5个CTR > 3%的创意）',
        features: null,
        sampleCreatives: []
      })
    }

    // 分析成功特征
    const features = analyzeSuccessFeatures(highPerformers)

    // 返回前5个样本创意
    const sampleCreatives = highPerformers.slice(0, 5).map((c: any) => ({
      creativeId: c.creativeId,
      headline1: c.headline1,
      description1: c.description1,
      ctr: c.ctr,
      conversionRate: c.conversionRate,
      performance: {
        clicks: c.clicks,
        impressions: c.impressions,
        conversions: c.conversions
      }
    }))

    return NextResponse.json({
      hasData: true,
      totalHighPerformers: highPerformers.length,
      features: formatFeatures(features),
      sampleCreatives,
      criteria: {
        minCtr,
        minClicks,
        limit
      }
    })

  } catch (error) {
    console.error('Creative learning insights error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * 格式化特征以便前端展示
 */
function formatFeatures(features: SuccessFeatures) {
  return {
    headlines: {
      avgLength: features.headlinePatterns.avgLength,
      topWords: features.headlinePatterns.commonWords.slice(0, 10),
      topPhrases: features.headlinePatterns.commonPhrases.slice(0, 5),
      characteristics: {
        usesNumbers: `${parseFloat((toNumber(features.headlinePatterns.usesNumbers) * 100).toFixed(0))}%的标题使用数字`,
        usesQuestions: `${parseFloat((toNumber(features.headlinePatterns.usesQuestions) * 100).toFixed(0))}%的标题使用疑问句`,
        usesAction: `${parseFloat((toNumber(features.headlinePatterns.usesAction) * 100).toFixed(0))}%的标题包含行动词汇`
      }
    },
    descriptions: {
      avgLength: features.descriptionPatterns.avgLength,
      topWords: features.descriptionPatterns.commonWords.slice(0, 10),
      topPhrases: features.descriptionPatterns.commonPhrases.slice(0, 5),
      characteristics: {
        mentionsBenefit: `${parseFloat((toNumber(features.descriptionPatterns.mentionsBenefit) * 100).toFixed(0))}%的描述强调好处`,
        mentionsUrgency: `${parseFloat((toNumber(features.descriptionPatterns.mentionsUrgency) * 100).toFixed(0))}%的描述包含紧迫性词汇`
      }
    },
    callToAction: {
      topCtas: features.ctaPatterns.commonCtas,
      preferredPosition: features.ctaPatterns.avgPosition
    },
    style: {
      toneOfVoice: features.stylePatterns.toneOfVoice,
      emotionalAppeal: features.stylePatterns.emotionalAppeal
    },
    benchmarks: {
      avgCtr: `${parseFloat((toNumber(features.benchmarks.avgCtr) * 100).toFixed(2))}%`,
      avgConversionRate: `${parseFloat((toNumber(features.benchmarks.avgConversionRate) * 100).toFixed(2))}%`,
      minCtr: `${parseFloat((toNumber(features.benchmarks.minCtr) * 100).toFixed(2))}%`,
      minConversionRate: `${parseFloat((toNumber(features.benchmarks.minConversionRate) * 100).toFixed(2))}%`
    },
    recommendations: generateRecommendations(features)
  }
}

/**
 * 生成可操作的建议
 */
function generateRecommendations(features: SuccessFeatures): string[] {
  const recommendations: string[] = []

  // 标题建议
  if (features.headlinePatterns.usesNumbers > 0.5) {
    recommendations.push('在标题中使用具体数字能显著提升点击率')
  }
  if (features.headlinePatterns.usesQuestions > 0.3) {
    recommendations.push('疑问句式标题更能吸引用户注意力')
  }
  if (features.headlinePatterns.usesAction > 0.6) {
    recommendations.push('行动导向的标题效果最佳')
  }

  // 描述建议
  if (features.descriptionPatterns.mentionsBenefit > 0.6) {
    recommendations.push('明确告诉用户产品好处比单纯描述功能更有效')
  }
  if (features.descriptionPatterns.mentionsUrgency > 0.3) {
    recommendations.push('适度使用紧迫性词汇可以提升转化率')
  }

  // 长度建议
  if (features.headlinePatterns.avgLength < 25) {
    recommendations.push('标题可以适当增加长度以提供更多信息')
  }
  if (features.descriptionPatterns.avgLength < 70) {
    recommendations.push('描述可以更充分地利用90字符限制')
  }

  // CTA建议
  if (features.ctaPatterns.commonCtas.length > 0) {
    recommendations.push(
      `最有效的CTA词汇：${features.ctaPatterns.commonCtas.slice(0, 3).join('、')}`
    )
  }

  return recommendations
}
