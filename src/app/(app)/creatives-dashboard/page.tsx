'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showError } from '@/lib/toast-utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Award, TrendingUp, Target, Clock, Eye, MousePointer, CheckCircle2, DollarSign } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

interface Creative {
  id: number
  offerId: number
  offerBrand: string
  offerCategory: string
  offerUrl: string
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  finalUrl: string
  score: number
  scoreBreakdown: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
  }
  generationRound: number
  theme: string
  isSelected: boolean
  createdAt: string
  adsAccountCurrency?: string
  hasMixedCurrency?: boolean
  performance: {
    impressions: number
    clicks: number
    conversions: number
    costUsd: number
    ctr: number
    avgCpcUsd: number
    conversionRate: number
  }
}

interface Recommendation {
  type: string
  creativeId: number
  reason: string
  metric: number
}

interface Summary {
  totalCreatives: number
  selectedCreatives: number
  totalPerformance: {
    impressions: number
    clicks: number
    conversions: number
    cost: number
  }
  dateRange: {
    start: string
    end: string
    days: number
  }
}

export default function CreativesDashboardPage() {
  const router = useRouter()
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<string>('30')
  const [sortBy, setSortBy] = useState<string>('score')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [currencyInfo, setCurrencyInfo] = useState<{ currency: string; currencies: string[]; hasMixedCurrency: boolean } | null>(null)
  const [reportCurrency, setReportCurrency] = useState<string | null>(null)

  const selectedCurrency = reportCurrency || currencyInfo?.currency || 'USD'
  const availableCurrencies = currencyInfo?.currencies ?? []
  const formatMoney = (value: number, currencyCode: string = selectedCurrency) =>
    formatCurrency(value, currencyCode)

  useEffect(() => {
    fetchCreatives()
  }, [timeRange, sortBy, reportCurrency])

  const fetchCreatives = async () => {
    try {
      setLoading(true)
      const currencyParam = reportCurrency ? `&currency=${encodeURIComponent(reportCurrency)}` : ''
      const response = await fetch(
        `/api/creatives/performance?daysBack=${timeRange}&sortBy=${sortBy}${currencyParam}`,
        {
          credentials: 'include',
        }
      )

      if (!response.ok) {
        throw new Error('获取Creative数据失败')
      }

      const data = await response.json()
      setCreatives(data.creatives)
      setSummary(data.summary)
      setRecommendations(data.recommendations)
      if (data.currency && Array.isArray(data.currencies)) {
        setCurrencyInfo({
          currency: data.currency,
          currencies: data.currencies,
          hasMixedCurrency: Boolean(data.hasMixedCurrency),
        })
        if (!reportCurrency || !data.currencies.includes(reportCurrency)) {
          setReportCurrency(data.currency)
        }
      }
    } catch (err: any) {
      console.error('Fetch creatives error:', err)
      showError('加载失败', err.message)
    } finally {
      setLoading(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-blue-600'
    if (score >= 40) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getScoreBadgeColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 text-green-800'
    if (score >= 60) return 'bg-blue-100 text-blue-800'
    if (score >= 40) return 'bg-yellow-100 text-yellow-800'
    return 'bg-red-100 text-red-800'
  }

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case 'best_score':
        return <Award className="w-4 h-4" />
      case 'best_conversion':
        return <Target className="w-4 h-4" />
      case 'best_engagement':
        return <TrendingUp className="w-4 h-4" />
      default:
        return null
    }
  }

  const formatNumber = (num: number) => {
    return num.toLocaleString()
  }

  const formatPercentage = (num: number) => {
    return `${(num * 100).toFixed(2)}%`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">Creative管理中心</h1>
              {summary && (
                <Badge variant="secondary" className="text-sm">
                  共 {summary.totalCreatives} 个创意
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              {availableCurrencies.length > 1 && (
                <Select value={selectedCurrency} onValueChange={(v) => setReportCurrency(v)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCurrencies.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">近7天</SelectItem>
                  <SelectItem value="30">近30天</SelectItem>
                  <SelectItem value="90">近90天</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="score">按评分排序</SelectItem>
                  <SelectItem value="performance">按表现排序</SelectItem>
                  <SelectItem value="recent">按创建时间</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* 汇总统计卡片 */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">总展示</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatNumber(summary.totalPerformance.impressions)}
                    </p>
                  </div>
                  <Eye className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">总点击</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatNumber(summary.totalPerformance.clicks)}
                    </p>
                  </div>
                  <MousePointer className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">总转化</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatNumber(summary.totalPerformance.conversions)}
                    </p>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">总花费</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatMoney(Number(summary.totalPerformance.cost) || 0)}
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 推荐卡片 */}
        {recommendations.length > 0 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-500" />
                最佳Creative推荐
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {recommendations.map((rec) => (
                  <div
                    key={rec.type}
                    className="p-4 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg border border-indigo-200 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      const element = document.getElementById(`creative-${rec.creativeId}`)
                      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      setExpandedId(rec.creativeId)
                    }}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <div className="p-2 bg-indigo-100 rounded-lg">
                        {getRecommendationIcon(rec.type)}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{rec.reason}</p>
                        <p className="text-xs text-gray-600 mt-1">Creative #{rec.creativeId}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={(e) => {
                        e.stopPropagation()
                        const creative = creatives.find(c => c.id === rec.creativeId)
                        if (creative) {
                          router.push(`/offers/${creative.offerId}`)
                        }
                      }}
                    >
                      查看详情
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Creative列表 */}
        {creatives.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50 text-gray-400" />
              <p className="text-gray-500 mb-4">暂无Creative数据</p>
              <Button
                onClick={() => router.push('/offers')}
                variant="outline"
              >
                前往创建Offer
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table className="[&_thead_th]:bg-white">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Creative ID</TableHead>
                      <TableHead>Offer品牌</TableHead>
                      <TableHead>主题</TableHead>
                      <TableHead className="text-right">评分</TableHead>
                      <TableHead className="text-right">展示</TableHead>
                      <TableHead className="text-right">点击</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">转化</TableHead>
                      <TableHead className="text-right">花费</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creatives.map((creative) => (
                      <>
                        <TableRow
                          key={creative.id}
                          id={`creative-${creative.id}`}
                          className={expandedId === creative.id ? 'bg-blue-50' : ''}
                        >
                          <TableCell className="font-medium">#{creative.id}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-gray-900">{creative.offerBrand}</p>
                              <p className="text-xs text-gray-500">{creative.offerCategory}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-gray-600">{creative.theme}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={getScoreBadgeColor(creative.score)}>
                              {creative.score}分
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatNumber(creative.performance.impressions)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatNumber(creative.performance.clicks)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatPercentage(creative.performance.ctr)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatNumber(creative.performance.conversions)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(Number(creative.performance.costUsd) || 0, creative.adsAccountCurrency || selectedCurrency)}
                          </TableCell>
                          <TableCell>
                            {creative.isSelected ? (
                              <Badge variant="default" className="bg-green-100 text-green-800">
                                已选中
                              </Badge>
                            ) : (
                              <Badge variant="outline">未使用</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setExpandedId(expandedId === creative.id ? null : creative.id)
                                }}
                              >
                                {expandedId === creative.id ? '收起' : '展开'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => router.push(`/offers/${creative.offerId}`)}
                              >
                                查看Offer
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandedId === creative.id && (
                          <TableRow>
                            <TableCell colSpan={11} className="bg-gray-50">
                              <div className="py-4 space-y-4">
                                {/* 评分详情 */}
                                <div>
                                  <h3 className="text-sm font-semibold text-gray-900 mb-2">评分详情</h3>
                                  <div className="grid grid-cols-5 gap-3">
                                    <div className="text-center">
                                      <p className="text-xs text-gray-600">相关性</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        {creative.scoreBreakdown.relevance}
                                      </p>
                                      <p className="text-xs text-gray-500">满分30</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-xs text-gray-600">质量</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        {creative.scoreBreakdown.quality}
                                      </p>
                                      <p className="text-xs text-gray-500">满分25</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-xs text-gray-600">吸引力</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        {creative.scoreBreakdown.engagement}
                                      </p>
                                      <p className="text-xs text-gray-500">满分25</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-xs text-gray-600">多样性</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        {creative.scoreBreakdown.diversity}
                                      </p>
                                      <p className="text-xs text-gray-500">满分10</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-xs text-gray-600">清晰度</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        {creative.scoreBreakdown.clarity}
                                      </p>
                                      <p className="text-xs text-gray-500">满分10</p>
                                    </div>
                                  </div>
                                </div>

                                {/* Creative内容预览 */}
                                <div>
                                  <h3 className="text-sm font-semibold text-gray-900 mb-2">广告预览</h3>
                                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                                    <div className="text-xs text-green-700 mb-1">广告 · {creative.offerUrl}</div>
                                    <div className="text-lg text-blue-600 font-normal leading-snug mb-2">
                                      {creative.headlines.join(' | ')}
                                    </div>
                                    <div className="text-sm text-gray-800 leading-relaxed">
                                      {creative.descriptions.join(' ')}
                                    </div>
                                    {creative.keywords.length > 0 && (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {creative.keywords.slice(0, 10).map((keyword, idx) => (
                                          <Badge key={idx} variant="secondary" className="text-xs">
                                            {keyword}
                                          </Badge>
                                        ))}
                                        {creative.keywords.length > 10 && (
                                          <Badge variant="outline" className="text-xs">
                                            +{creative.keywords.length - 10}个关键词
                                          </Badge>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* 性能指标详情 */}
                                <div>
                                  <h3 className="text-sm font-semibold text-gray-900 mb-2">性能详情</h3>
                                  <div className="grid grid-cols-4 gap-3">
                                    <div className="bg-white p-3 rounded-lg border border-gray-200">
                                      <p className="text-xs text-gray-600">平均CPC</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        {formatMoney(Number(creative.performance.avgCpcUsd) || 0, creative.adsAccountCurrency || selectedCurrency)}
                                      </p>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-gray-200">
                                      <p className="text-xs text-gray-600">转化率</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        {formatPercentage(creative.performance.conversionRate)}
                                      </p>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-gray-200">
                                      <p className="text-xs text-gray-600">生成轮次</p>
                                      <p className="text-lg font-bold text-gray-900">
                                        第 {creative.generationRound} 轮
                                      </p>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-gray-200">
                                      <p className="text-xs text-gray-600">创建时间</p>
                                      <p className="text-sm font-medium text-gray-900">
                                        {new Date(creative.createdAt).toLocaleDateString('zh-CN')}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
