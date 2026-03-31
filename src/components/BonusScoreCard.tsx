'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Info, TrendingUp, MousePointer, Target, DollarSign, ShoppingCart } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

interface BonusScoreBreakdown {
  clicks: { score: number; value: number; benchmark: number; comparison: string }
  ctr: { score: number; value: number; benchmark: number; comparison: string }
  cpc: { score: number; value: number; benchmark: number; comparison: string }
  conversions: { score: number; value: number; benchmark: number; comparison: string }
}

interface BonusScoreData {
  hasData: boolean
  bonusScore: number
  breakdown: BonusScoreBreakdown | null
  minClicksReached: boolean
  industryLabel: string
  currency?: string
  performance?: {
    clicks: number
    ctr: number
    cpc: number
    conversions: number
    conversionRate: number
  }
  syncDate?: string
}

interface BonusScoreCardProps {
  adCreativeId: number
  baseScore: number // 原有评分（如93分）
  onConversionClick?: () => void
}

export function BonusScoreCard({ adCreativeId, baseScore, onConversionClick }: BonusScoreCardProps) {
  const [data, setData] = useState<BonusScoreData | null>(null)
  const [loading, setLoading] = useState(true)

  const currency = data?.currency || 'USD'

  useEffect(() => {
    async function fetchBonusScore() {
      try {
        const response = await fetch(`/api/ad-creatives/${adCreativeId}/bonus-score`)
        if (response.ok) {
          const result = await response.json()
          setData(result)
        }
      } catch (error) {
        console.error('Failed to fetch bonus score:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchBonusScore()
  }, [adCreativeId])

  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Performance Bonus</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 bg-gray-200 rounded"></div>
        </CardContent>
      </Card>
    )
  }

  const totalScore = baseScore + (data?.bonusScore || 0)
  const maxTotal = 100 + 20

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Performance Score
          </CardTitle>
          {data?.industryLabel && (
            <Badge variant="outline" className="text-xs">
              {data.industryLabel}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* 主分数显示 */}
        <div className="text-center mb-4">
          <div className="text-3xl font-bold">
            <span className="text-primary">{baseScore}</span>
            <span className="text-muted-foreground">/100</span>
            {data?.hasData && data.minClicksReached && (
              <>
                <span className="text-green-500 ml-1">+{data.bonusScore}</span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Total: {totalScore}/{maxTotal}
          </p>
        </div>

        {/* 加分明细 */}
        {data?.hasData && data.minClicksReached && data.breakdown ? (
          <div className="space-y-3">
            <MetricRow
              icon={<MousePointer className="h-3 w-3" />}
              label="Clicks"
              score={data.breakdown.clicks?.score ?? 0}
              value={`${(data.breakdown.clicks?.value ?? 0).toLocaleString()}`}
              benchmark={`${(data.breakdown.clicks?.benchmark ?? 0).toLocaleString()}`}
              comparison={data.breakdown.clicks?.comparison ?? 'equal'}
            />
            <MetricRow
              icon={<Target className="h-3 w-3" />}
              label="CTR"
              score={data.breakdown.ctr?.score ?? 0}
              value={`${(data.breakdown.ctr?.value ?? 0).toFixed(2)}%`}
              benchmark={`${(data.breakdown.ctr?.benchmark ?? 0).toFixed(2)}%`}
              comparison={data.breakdown.ctr?.comparison ?? 'equal'}
            />
            <MetricRow
              icon={<DollarSign className="h-3 w-3" />}
              label="CPC"
              score={data.breakdown.cpc?.score ?? 0}
              value={formatCurrency(data.breakdown.cpc?.value ?? 0, currency)}
              benchmark={formatCurrency(data.breakdown.cpc?.benchmark ?? 0, currency)}
              comparison={data.breakdown.cpc?.comparison ?? 'equal'}
              invertColors // CPC越低越好
            />
            <MetricRow
              icon={<ShoppingCart className="h-3 w-3" />}
              label="Conv."
              score={data.breakdown.conversions?.score ?? 0}
              value={`${(data.breakdown.conversions?.value ?? 0).toFixed(2)}%`}
              benchmark={`${(data.breakdown.conversions?.benchmark ?? 0).toFixed(2)}%`}
              comparison={data.breakdown.conversions?.comparison ?? 'equal'}
              onAddClick={onConversionClick}
            />
          </div>
        ) : (
          <div className="text-center py-4">
            <Info className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {data?.hasData
                ? 'Need 100+ clicks to calculate bonus'
                : 'No performance data yet'}
            </p>
            {data?.performance && (
              <p className="text-xs text-muted-foreground mt-1">
                Current: {data.performance.clicks} clicks
              </p>
            )}
          </div>
        )}

        {data?.syncDate && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Updated: {new Date(data.syncDate).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

interface MetricRowProps {
  icon: React.ReactNode
  label: string
  score: number
  value: string
  benchmark: string
  comparison: string
  invertColors?: boolean
  onAddClick?: () => void
}

function MetricRow({
  icon,
  label,
  score,
  value,
  benchmark,
  comparison,
  invertColors = false,
  onAddClick
}: MetricRowProps) {
  const getComparisonColor = (comp: string) => {
    if (invertColors) {
      // CPC: low is good
      switch (comp) {
        case 'excellent': return 'text-green-600'
        case 'good': return 'text-green-500'
        case 'average': return 'text-yellow-600'
        case 'below_average': return 'text-orange-500'
        case 'high':
        case 'low': return 'text-red-500'
        default: return 'text-muted-foreground'
      }
    }
    // Normal metrics: high is good
    switch (comp) {
      case 'excellent': return 'text-green-600'
      case 'good': return 'text-green-500'
      case 'average': return 'text-yellow-600'
      case 'below_average': return 'text-orange-500'
      case 'low': return 'text-red-500'
      default: return 'text-muted-foreground'
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-between text-xs cursor-help">
            <div className="flex items-center gap-1.5">
              {icon}
              <span>{label}</span>
              {onAddClick && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddClick()
                  }}
                  className="text-blue-500 hover:text-blue-700 text-[10px] ml-1"
                >
                  [Add]
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={getComparisonColor(comparison)}>{value}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                +{score}
              </Badge>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Industry benchmark: {benchmark}</p>
          <p>Your performance: {value}</p>
          <p>Score: {score}/5</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
