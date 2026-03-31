'use client'

/**
 * Score Radar Chart Component
 * 创意评分雷达图组件
 */

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts'

interface ScoreRadarChartProps {
  scoreBreakdown: {
    relevance: number        // 相关性
    quality: number          // 质量
    engagement: number       // 吸引力/完整性
    diversity: number        // 多样性
    clarity: number          // 清晰度/合规性
    brandSearchVolume?: number  // 品牌搜索量（可选，支持旧数据兼容）
    competitivePositioning?: number  // 竞争定位（可选，7维度新增）
  }
  size?: 'sm' | 'md' | 'lg'
  // 新增：支持自定义最大值（用于适配Ad Strength评分体系）
  maxScores?: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
    brandSearchVolume?: number  // 品牌搜索量（可选）
    competitivePositioning?: number  // 竞争定位（可选）
  }
}

export default function ScoreRadarChart({ scoreBreakdown, size = 'md', maxScores }: ScoreRadarChartProps) {
  // 默认最大值（旧系统）
  const defaultMaxScores = {
    relevance: 30,
    quality: 25,
    engagement: 25,
    diversity: 10,
    clarity: 10,
    brandSearchVolume: 20,  // 新Ad Strength系统默认
    competitivePositioning: 10  // 7维度系统默认
  }

  // 使用自定义最大值或默认最大值
  const maxValues = maxScores || defaultMaxScores

  // 检测是否有品牌搜索量数据和竞争定位数据
  const hasBrandVolume = scoreBreakdown.brandSearchVolume !== undefined
  const hasCompetitivePositioning = scoreBreakdown.competitivePositioning !== undefined

  // 转换为百分比以便在雷达图上显示（防御性处理：clamp到100%）
  const data = [
    {
      dimension: '相关性',
      score: Math.min(100, (scoreBreakdown.relevance / maxValues.relevance) * 100),
      fullMark: 100,
      actual: Math.min(maxValues.relevance, scoreBreakdown.relevance), // clamp到最大值
      max: maxValues.relevance
    },
    {
      dimension: '质量',
      score: Math.min(100, (scoreBreakdown.quality / maxValues.quality) * 100),
      fullMark: 100,
      actual: Math.min(maxValues.quality, scoreBreakdown.quality),
      max: maxValues.quality
    },
    {
      dimension: '吸引力',
      score: Math.min(100, (scoreBreakdown.engagement / maxValues.engagement) * 100),
      fullMark: 100,
      actual: Math.min(maxValues.engagement, scoreBreakdown.engagement),
      max: maxValues.engagement
    },
    {
      dimension: '多样性',
      score: Math.min(100, (scoreBreakdown.diversity / maxValues.diversity) * 100),
      fullMark: 100,
      actual: Math.min(maxValues.diversity, scoreBreakdown.diversity),
      max: maxValues.diversity
    },
    {
      dimension: '清晰度',
      score: Math.min(100, (scoreBreakdown.clarity / maxValues.clarity) * 100),
      fullMark: 100,
      actual: Math.min(maxValues.clarity, scoreBreakdown.clarity),
      max: maxValues.clarity
    }
  ]

  // 如果有品牌搜索量数据，添加第6个维度
  if (hasBrandVolume && scoreBreakdown.brandSearchVolume !== undefined) {
    const brandMax = maxValues.brandSearchVolume || 20
    data.push({
      dimension: '品牌影响力',
      score: Math.min(100, (scoreBreakdown.brandSearchVolume / brandMax) * 100),
      fullMark: 100,
      actual: Math.min(brandMax, scoreBreakdown.brandSearchVolume),
      max: brandMax
    })
  }

  // 如果有竞争定位数据，添加第7个维度
  if (hasCompetitivePositioning && scoreBreakdown.competitivePositioning !== undefined) {
    const compMax = maxValues.competitivePositioning || 10
    data.push({
      dimension: '竞争定位',
      score: Math.min(100, (scoreBreakdown.competitivePositioning / compMax) * 100),
      fullMark: 100,
      actual: Math.min(compMax, scoreBreakdown.competitivePositioning),
      max: compMax
    })
  }

  const sizeMap = {
    sm: 180,
    md: 240,
    lg: 320
  }

  const height = sizeMap[size]

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900 mb-1">{data.dimension}</p>
          <p className="text-sm text-gray-600">
            得分: <span className="font-semibold text-blue-600">{data.actual.toFixed(1)}/{data.max}</span>
          </p>
          <p className="text-xs text-gray-500">
            完成度: {data.score.toFixed(1)}%
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data}>
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fill: '#6b7280', fontSize: 12 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: '#9ca3af', fontSize: 10 }}
        />
        <Radar
          name="评分"
          dataKey="score"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.6}
        />
        <Tooltip content={<CustomTooltip />} />
      </RadarChart>
    </ResponsiveContainer>
  )
}
