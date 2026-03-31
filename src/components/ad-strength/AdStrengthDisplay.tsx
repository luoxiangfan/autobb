import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  TrendingUp,
  Target,
  Star
} from 'lucide-react'

/**
 * Ad Strength评级类型
 */
export type AdStrengthRating = 'PENDING' | 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'

/**
 * Ad Strength评估结果接口
 */
export interface AdStrengthData {
  rating: AdStrengthRating
  score: number // 0-100
  isExcellent: boolean
  dimensions: {
    diversity: { score: number; weight: number; details: any }
    relevance: { score: number; weight: number; details: any }
    completeness: { score: number; weight: number; details: any }
    quality: { score: number; weight: number; details: any }
    compliance: { score: number; weight: number; details: any }
    brandSearchVolume: { score: number; weight: number; details: any }
    competitivePositioning: { score: number; weight: number; details: any }
  }
  suggestions: string[]
}

/**
 * 优化历史记录
 */
export interface OptimizationHistory {
  attempts: number
  targetRating: AdStrengthRating
  achieved: boolean
  history: Array<{
    attempt: number
    rating: AdStrengthRating
    score: number
    suggestions: string[]
  }>
}

interface AdStrengthDisplayProps {
  adStrength: AdStrengthData
  optimization?: OptimizationHistory
  showDetails?: boolean
  className?: string
}

/**
 * Ad Strength主展示组件
 */
export function AdStrengthDisplay({
  adStrength,
  optimization,
  showDetails = true,
  className = ''
}: AdStrengthDisplayProps) {
  const { rating, score, isExcellent, dimensions, suggestions } = adStrength

  // 获取评级配置
  const ratingConfig = getRatingConfig(rating)

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 主评分卡片 */}
      <Card className={`border-2 ${ratingConfig.borderColor}`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {ratingConfig.icon}
              <div>
                <CardTitle className="text-2xl">Ad Strength评估</CardTitle>
                <CardDescription>
                  Google Ads广告质量评级
                </CardDescription>
              </div>
            </div>
            <Badge
              variant={ratingConfig.badgeVariant as any}
              className={`text-lg px-4 py-2 ${ratingConfig.badgeClass}`}
            >
              {ratingConfig.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 总分展示 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                总分
              </span>
              <span className={`text-3xl font-bold ${ratingConfig.textColor}`}>
                {score}/100
              </span>
            </div>
            <Progress
              value={score}
              className="h-3"
              indicatorClassName={ratingConfig.progressColor}
            />
          </div>

          {/* EXCELLENT徽章 */}
          {isExcellent && (
            <Alert className="border-green-500 bg-green-50">
              <Star className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 font-medium">
                🎉 恭喜！已达到Google Ads最高标准（EXCELLENT）
              </AlertDescription>
            </Alert>
          )}

          {/* 优化历史（如果有） */}
          {optimization && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                优化历程
              </h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">尝试次数</span>
                  <span className="font-medium">{optimization.attempts}次</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">目标评级</span>
                  <Badge variant="outline">{optimization.targetRating}</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">达成状态</span>
                  {optimization.achieved ? (
                    <Badge variant="default" className="bg-green-600">
                      ✅ 已达成
                    </Badge>
                  ) : (
                    <Badge variant="secondary">⏳ 进行中</Badge>
                  )}
                </div>
              </div>

              {/* 历史轨迹 */}
              {optimization.history.length > 1 && (
                <div className="mt-3 space-y-1">
                  <span className="text-xs text-muted-foreground">评分轨迹:</span>
                  <div className="flex gap-2 flex-wrap">
                    {optimization.history.map((h) => (
                      <Badge
                        key={h.attempt}
                        variant="outline"
                        className="text-xs"
                      >
                        第{h.attempt}次: {h.score}分
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 详细评分（可选） */}
      {showDetails && (
        <>
          {/* 7维度评分 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                7维度评分详情
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DimensionScore
                name="多样性 (Diversity)"
                score={dimensions.diversity.score}
                maxScore={18}
                weight={dimensions.diversity.weight}
                description="资产类型、长度分布、文本独特性"
                details={dimensions.diversity.details}
              />
              <DimensionScore
                name="相关性 (Relevance)"
                score={dimensions.relevance.score}
                maxScore={22}
                weight={dimensions.relevance.weight}
                description="关键词覆盖率、自然度"
                details={dimensions.relevance.details}
              />
              <DimensionScore
                name="完整性 (Completeness)"
                score={dimensions.completeness.score}
                maxScore={10}
                weight={dimensions.completeness.weight}
                description="资产数量、字符合规性"
                details={dimensions.completeness.details}
              />
              <DimensionScore
                name="质量 (Quality)"
                score={dimensions.quality.score}
                maxScore={14}
                weight={dimensions.quality.weight}
                description="数字使用、CTA、紧迫感、差异化"
                details={dimensions.quality.details}
              />
              <DimensionScore
                name="合规性 (Compliance)"
                score={dimensions.compliance.score}
                maxScore={8}
                weight={dimensions.compliance.weight}
                description="政策遵守、无违规词汇"
                details={dimensions.compliance.details}
              />
              <DimensionScore
                name="品牌影响力 (Brand Search Volume)"
                score={dimensions.brandSearchVolume.score}
                maxScore={18}
                weight={dimensions.brandSearchVolume.weight}
                description="品牌月均搜索量"
                details={dimensions.brandSearchVolume.details}
              />
              <DimensionScore
                name="竞争定位 (Competitive Positioning)"
                score={dimensions.competitivePositioning.score}
                maxScore={10}
                weight={dimensions.competitivePositioning.weight}
                description="价格优势、独特定位、竞品对比、性价比"
                details={dimensions.competitivePositioning.details}
              />
            </CardContent>
          </Card>

          {/* 改进建议 */}
          {suggestions.length > 0 && !isExcellent && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-blue-600" />
                  改进建议
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {suggestions.map((suggestion, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <span className="text-blue-600 mt-0.5">💡</span>
                      <span className="text-muted-foreground">{suggestion}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

/**
 * 单个维度评分展示
 */
function DimensionScore({
  name,
  score,
  maxScore,
  weight,
  description,
  details
}: {
  name: string
  score: number
  maxScore: number
  weight: number
  description: string
  details: any
}) {
  const percentage = (score / maxScore) * 100

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">{name}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-sm">
            {score}/{maxScore}
          </div>
          <div className="text-xs text-muted-foreground">
            权重 {(weight * 100).toFixed(0)}%
          </div>
        </div>
      </div>
      <Progress
        value={percentage}
        className="h-2"
        indicatorClassName={
          percentage >= 80
            ? 'bg-green-600'
            : percentage >= 60
            ? 'bg-blue-600'
            : 'bg-yellow-600'
        }
      />

      {/* 详细子项（可折叠） */}
      {details && (
        <div className="ml-4 mt-1 space-y-1 text-xs text-muted-foreground">
          {Object.entries(details).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span>{formatDetailKey(key)}</span>
              <span className="font-medium">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 获取评级配置
 */
function getRatingConfig(rating: AdStrengthRating) {
  const configs = {
    EXCELLENT: {
      label: 'EXCELLENT',
      textColor: 'text-green-600',
      borderColor: 'border-green-500',
      progressColor: 'bg-green-600',
      badgeVariant: 'default',
      badgeClass: 'bg-green-600',
      icon: <CheckCircle2 className="h-8 w-8 text-green-600" />
    },
    GOOD: {
      label: 'GOOD',
      textColor: 'text-blue-600',
      borderColor: 'border-blue-500',
      progressColor: 'bg-blue-600',
      badgeVariant: 'default',
      badgeClass: 'bg-blue-600',
      icon: <CheckCircle2 className="h-8 w-8 text-blue-600" />
    },
    AVERAGE: {
      label: 'AVERAGE',
      textColor: 'text-yellow-600',
      borderColor: 'border-yellow-500',
      progressColor: 'bg-yellow-600',
      badgeVariant: 'secondary',
      badgeClass: 'bg-yellow-600 text-white',
      icon: <AlertTriangle className="h-8 w-8 text-yellow-600" />
    },
    POOR: {
      label: 'POOR',
      textColor: 'text-red-600',
      borderColor: 'border-red-500',
      progressColor: 'bg-red-600',
      badgeVariant: 'destructive',
      badgeClass: 'bg-red-600',
      icon: <XCircle className="h-8 w-8 text-red-600" />
    },
    PENDING: {
      label: 'PENDING',
      textColor: 'text-gray-600',
      borderColor: 'border-gray-300',
      progressColor: 'bg-gray-600',
      badgeVariant: 'outline',
      badgeClass: '',
      icon: <AlertCircle className="h-8 w-8 text-gray-600" />
    }
  }

  return configs[rating] || configs.PENDING
}

/**
 * 格式化详细键名
 */
function formatDetailKey(key: string): string {
  const keyMap: Record<string, string> = {
    typeDistribution: '类型分布',
    lengthDistribution: '长度梯度',
    textUniqueness: '文本独特性',
    keywordCoverage: '关键词覆盖',
    keywordNaturalness: '关键词自然度',
    assetCount: '资产数量',
    characterCompliance: '字符合规',
    numberUsage: '数字使用',
    ctaPresence: 'CTA存在',
    urgencyExpression: '紧迫感表达',
    policyAdherence: '政策遵守',
    noSpamWords: '无违规词汇'
  }

  return keyMap[key] || key
}

/**
 * 简化版Ad Strength徽章（用于列表显示）
 */
export function AdStrengthBadge({ rating, score }: { rating: AdStrengthRating; score: number }) {
  const config = getRatingConfig(rating)

  return (
    <div className="flex items-center gap-2">
      <Badge variant={config.badgeVariant as any} className={config.badgeClass}>
        {config.label}
      </Badge>
      <span className={`text-sm font-medium ${config.textColor}`}>
        {score}分
      </span>
    </div>
  )
}
