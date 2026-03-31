'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  RefreshCw,
  Users,
  TrendingUp,
  DollarSign,
  Star,
  ShieldCheck,
  AlertCircle,
  Target,
  Zap,
  ExternalLink
} from 'lucide-react'
import { toast } from 'sonner'

interface Offer {
  id: number
  brand: string
  productName: string
  competitorAnalysis: {
    competitors?: Array<{
      name: string
      brand?: string
      price?: number | string
      rating?: number
      reviewCount?: number
      features?: string[]
      // 🔥 新增：商品链接（用于跳转到Amazon商品详情页）
      productUrl?: string | null
    }>
    pricePosition?: {
      ourPrice: number
      avgCompetitorPrice: number
      priceAdvantage: string
    }
    ratingPosition?: {
      ourRating: number
      avgCompetitorRating: number
      ratingAdvantage: string
    }
    uniqueSellingPoints?: string[]
    competitiveAdvantages?: string[]
    marketOpportunities?: string[]
  } | null
}

/**
 * 竞品分析页面
 * 展示与竞品的对比分析
 */
export default function CompetitorsPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offers, setOffers] = useState<Offer[]>([])
  const [selectedOfferId, setSelectedOfferId] = useState<string>('')
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)

  useEffect(() => {
    fetchOffers()
  }, [])

  useEffect(() => {
    if (selectedOfferId && offers.length > 0) {
      const offer = offers.find(o => o.id.toString() === selectedOfferId)
      setSelectedOffer(offer || null)
    }
  }, [selectedOfferId, offers])

  const fetchOffers = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/offers')
      if (response.ok) {
        const result = await response.json()
        const offersWithAnalysis = (result.offers || [])
          .map((offer: any) => ({
            id: offer.id,
            brand: offer.brand,
            productName: offer.offerName || offer.brand,
            competitorAnalysis: offer.competitorAnalysis ?
              (typeof offer.competitorAnalysis === 'string' ?
                JSON.parse(offer.competitorAnalysis) : offer.competitorAnalysis) : null
          }))
          .filter((offer: Offer) => offer.competitorAnalysis)

        setOffers(offersWithAnalysis)
        if (offersWithAnalysis.length > 0) {
          setSelectedOfferId(offersWithAnalysis[0].id.toString())
        }
      } else {
        toast.error('获取Offer列表失败')
      }
    } catch (error) {
      console.error('获取Offer列表失败:', error)
      toast.error('获取Offer列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchOffers()
    setRefreshing(false)
    toast.success('数据已刷新')
  }

  const getPriceAdvantageColor = (advantage?: string) => {
    switch (advantage) {
      case 'lowest':
      case 'below_average':
        return 'bg-green-100 text-green-700'
      case 'average':
        return 'bg-yellow-100 text-yellow-700'
      case 'above_average':
      case 'premium':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-slate-100 text-slate-700'
    }
  }

  const getPriceAdvantageLabel = (advantage?: string) => {
    switch (advantage) {
      case 'lowest': return '最低价'
      case 'below_average': return '低于均价'
      case 'average': return '均价水平'
      case 'above_average': return '高于均价'
      case 'premium': return '高端定价'
      default: return advantage || '未知'
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  const analysis = selectedOffer?.competitorAnalysis

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a
            href="/optimization/overview"
            className="inline-flex items-center justify-center w-10 h-10 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">竞品分析</h1>
            <p className="text-slate-500 mt-1">了解竞争对手，找到差异化优势</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {offers.length > 0 && (
            <Select value={selectedOfferId} onValueChange={setSelectedOfferId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择Offer" />
              </SelectTrigger>
              <SelectContent>
                {offers.map(offer => (
                  <SelectItem key={offer.id} value={offer.id.toString()}>
                    {offer.brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {offers.length === 0 ? (
        /* 无数据状态 */
        <Card>
          <CardContent className="py-16">
            <div className="text-center">
              <Users className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">暂无竞品分析数据</h3>
              <p className="text-slate-500 max-w-md mx-auto">
                请先在Offer管理中进行数据抓取，系统将自动分析竞品信息
              </p>
              <a href="/offers">
                <Button className="mt-4">前往Offer管理</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      ) : analysis ? (
        <>
          {/* 竞争定位概览 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {analysis.pricePosition && (
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <DollarSign className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-slate-500">价格定位</p>
                      <p className="text-lg font-bold text-slate-900">
                        ${analysis.pricePosition.ourPrice}
                      </p>
                      <Badge className={getPriceAdvantageColor(analysis.pricePosition.priceAdvantage)}>
                        {getPriceAdvantageLabel(analysis.pricePosition.priceAdvantage)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    竞品均价: ${analysis.pricePosition.avgCompetitorPrice?.toFixed(2)}
                  </p>
                </CardContent>
              </Card>
            )}

            {analysis.ratingPosition && (
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-yellow-100 rounded-lg">
                      <Star className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-slate-500">评分定位</p>
                      <p className="text-lg font-bold text-slate-900">
                        {analysis.ratingPosition.ourRating?.toFixed(1)} / 5.0
                      </p>
                      <p className="text-xs text-slate-500">
                        {analysis.ratingPosition.ratingAdvantage === 'top_rated' ? '评分最高' :
                         analysis.ratingPosition.ratingAdvantage === 'above_average' ? '高于均分' :
                         analysis.ratingPosition.ratingAdvantage === 'average' ? '均分水平' : '低于均分'}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    竞品均分: {analysis.ratingPosition.avgCompetitorRating?.toFixed(1)}
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Users className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">竞品数量</p>
                    <p className="text-lg font-bold text-slate-900">
                      {analysis.competitors?.length || 0}
                    </p>
                    <p className="text-xs text-slate-500">已识别的竞争对手</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* 竞争优势 */}
            {analysis.competitiveAdvantages && analysis.competitiveAdvantages.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-green-600" />
                    竞争优势
                  </CardTitle>
                  <CardDescription>我们相比竞品的优势点</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {analysis.competitiveAdvantages.map((advantage, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-green-50 rounded">
                        <Zap className="w-4 h-4 text-green-600 mt-0.5" />
                        <span className="text-sm text-slate-700">{advantage}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 独特卖点 */}
            {analysis.uniqueSellingPoints && analysis.uniqueSellingPoints.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-blue-600" />
                    独特卖点 (USP)
                  </CardTitle>
                  <CardDescription>可用于广告创意的差异化特点</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {analysis.uniqueSellingPoints.map((usp, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-blue-50 rounded">
                        <Target className="w-4 h-4 text-blue-600 mt-0.5" />
                        <span className="text-sm text-slate-700">{usp}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* 市场机会 */}
          {analysis.marketOpportunities && analysis.marketOpportunities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-orange-600" />
                  市场机会
                </CardTitle>
                <CardDescription>基于竞品分析发现的潜在机会</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-3">
                  {analysis.marketOpportunities.map((opportunity, i) => (
                    <div key={i} className="flex items-start gap-2 p-3 bg-orange-50 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5" />
                      <span className="text-sm text-slate-700">{opportunity}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 竞品列表 */}
          {analysis.competitors && analysis.competitors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-slate-600" />
                  竞品列表
                </CardTitle>
                <CardDescription>已识别的主要竞争对手</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">产品名称</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">品牌</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">价格</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">评分</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">评论数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.competitors.map((competitor, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="py-3 px-4 text-sm">
                            {competitor.productUrl ? (
                              <a
                                href={competitor.productUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                                title="在新窗口打开Amazon商品页面"
                              >
                                {competitor.name}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-slate-900">{competitor.name}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-600">{competitor.brand || '-'}</td>
                          <td className="py-3 px-4 text-sm text-slate-600 text-right">
                            {competitor.price ? `$${competitor.price}` : '-'}
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-600 text-right">
                            {competitor.rating ? `${competitor.rating}/5` : '-'}
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-600 text-right">
                            {competitor.reviewCount?.toLocaleString() || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-16">
            <div className="text-center">
              <AlertCircle className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">暂无分析数据</h3>
              <p className="text-slate-500 max-w-md mx-auto">
                所选Offer尚未进行竞品分析，请先进行数据抓取
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
