'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  RefreshCw,
  Lightbulb,
  TrendingUp,
  Target,
  Zap,
  BookOpen,
  BarChart3,
  MessageSquare,
  Star
} from 'lucide-react'
import { toast } from 'sonner'

interface CreativeLearningData {
  hasData: boolean
  message?: string
  totalHighPerformers?: number
  features?: {
    headlines: {
      avgLength: number
      topWords: string[]
      topPhrases: string[]
      characteristics: {
        usesNumbers: string
        usesQuestions: string
        usesAction: string
      }
    }
    descriptions: {
      avgLength: number
      topWords: string[]
      topPhrases: string[]
      characteristics: {
        mentionsBenefit: string
        mentionsUrgency: string
      }
    }
    callToAction: {
      topCtas: string[]
      preferredPosition: number
    }
    style: {
      toneOfVoice: string[]
      emotionalAppeal: string[]
    }
    benchmarks: {
      avgCtr: string
      avgConversionRate: string
      minCtr: string
      minConversionRate: string
    }
    recommendations: string[]
  }
  sampleCreatives?: Array<{
    creativeId: number
    headline1: string
    description1: string
    ctr: number
    conversionRate: number
    performance: {
      clicks: number
      impressions: number
      conversions: number
    }
  }>
}

/**
 * 创意学习页面
 * 分析历史高表现创意，提取成功特征
 */
export default function CreativeLearningPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState<CreativeLearningData | null>(null)

  useEffect(() => {
    fetchLearningData()
  }, [])

  const fetchLearningData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/insights/creative-learning')
      if (response.ok) {
        const result = await response.json()
        setData(result)
      } else {
        toast.error('获取创意学习数据失败')
      }
    } catch (error) {
      console.error('获取创意学习数据失败:', error)
      toast.error('获取创意学习数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchLearningData()
    setRefreshing(false)
    toast.success('数据已刷新')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

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
            <h1 className="text-2xl font-bold text-slate-900">创意学习</h1>
            <p className="text-slate-500 mt-1">从历史高表现创意中学习成功特征</p>
          </div>
        </div>
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

      {!data?.hasData ? (
        /* 无数据状态 */
        <Card>
          <CardContent className="py-16">
            <div className="text-center">
              <BookOpen className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">暂无学习数据</h3>
              <p className="text-slate-500 max-w-md mx-auto">
                {data?.message || '需要积累足够的广告投放数据后，系统才能分析成功创意特征'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 统计概览 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Star className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">高表现创意</p>
                    <p className="text-2xl font-bold text-slate-900">{data.totalHighPerformers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">平均CTR</p>
                    <p className="text-2xl font-bold text-slate-900">{data.features?.benchmarks.avgCtr}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Target className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">平均转化率</p>
                    <p className="text-2xl font-bold text-slate-900">{data.features?.benchmarks.avgConversionRate}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Lightbulb className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">优化建议</p>
                    <p className="text-2xl font-bold text-slate-900">{data.features?.recommendations.length || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* 标题特征分析 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-blue-600" />
                  标题特征分析
                </CardTitle>
                <CardDescription>
                  高表现创意的标题共同特征
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">平均长度</p>
                  <p className="text-lg font-semibold">{data.features?.headlines.avgLength} 字符</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">特征分布</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">使用数字</span>
                      <span className="font-medium">{data.features?.headlines.characteristics.usesNumbers}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">使用疑问句</span>
                      <span className="font-medium">{data.features?.headlines.characteristics.usesQuestions}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">包含行动词汇</span>
                      <span className="font-medium">{data.features?.headlines.characteristics.usesAction}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">高频词汇</p>
                  <div className="flex flex-wrap gap-2">
                    {data.features?.headlines.topWords.map((word, i) => (
                      <Badge key={i} variant="secondary">{word}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 描述特征分析 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  描述特征分析
                </CardTitle>
                <CardDescription>
                  高表现创意的描述共同特征
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">平均长度</p>
                  <p className="text-lg font-semibold">{data.features?.descriptions.avgLength} 字符</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">特征分布</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">强调好处</span>
                      <span className="font-medium">{data.features?.descriptions.characteristics.mentionsBenefit}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">包含紧迫性词汇</span>
                      <span className="font-medium">{data.features?.descriptions.characteristics.mentionsUrgency}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">高频词汇</p>
                  <div className="flex flex-wrap gap-2">
                    {data.features?.descriptions.topWords.map((word, i) => (
                      <Badge key={i} variant="secondary">{word}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 优化建议 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-orange-600" />
                优化建议
              </CardTitle>
              <CardDescription>
                基于成功创意特征的改进建议
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {data.features?.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                    <div className="p-1.5 bg-orange-100 rounded">
                      <Lightbulb className="w-4 h-4 text-orange-600" />
                    </div>
                    <p className="text-sm text-slate-700">{rec}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 样本创意 */}
          {data.sampleCreatives && data.sampleCreatives.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-600" />
                  高表现创意样本
                </CardTitle>
                <CardDescription>
                  表现最佳的创意示例
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {data.sampleCreatives.map((creative, i) => (
                    <div key={i} className="p-4 border rounded-lg">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-medium text-slate-900">{creative.headline1}</p>
                          <p className="text-sm text-slate-600 mt-1">{creative.description1}</p>
                        </div>
                        <Badge variant="secondary" className="bg-green-100 text-green-700">
                          CTR {(creative.ctr * 100).toFixed(2)}%
                        </Badge>
                      </div>
                      <div className="flex gap-4 text-sm text-slate-500">
                        <span>点击: {(creative.performance?.clicks ?? 0).toLocaleString()}</span>
                        <span>展示: {(creative.performance?.impressions ?? 0).toLocaleString()}</span>
                        <span>转化: {creative.performance?.conversions ?? 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
