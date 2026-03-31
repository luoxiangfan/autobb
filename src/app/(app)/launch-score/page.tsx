'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { showSuccess } from '@/lib/toast-utils'

/**
 * Launch Score v4.0 - 4维度评分系统
 */
interface LaunchScore {
  id: number
  offerId: number
  totalScore: number
  launchViabilityScore: number // 投放可行性 (35分)
  adQualityScore: number // 广告质量 (30分)
  keywordStrategyScore: number // 关键词策略 (20分)
  basicConfigScore: number // 基础配置 (15分)
  calculatedAt: string
}

interface ScoreDimension {
  score: number
  issues?: string[]
  suggestions?: string[]
  [key: string]: any
}

interface Analysis {
  launchViability: ScoreDimension
  adQuality: ScoreDimension
  keywordStrategy: ScoreDimension
  basicConfig: ScoreDimension
  overallRecommendations: string[]
}

interface Offer {
  id: number
  brand: string
}

interface Creative {
  id: number
  version: number
  headline1: string
}

export default function LaunchScorePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const offerId = searchParams?.get('offerId')
  const creativeId = searchParams?.get('creativeId')

  const [offer, setOffer] = useState<Offer | null>(null)
  const [creative, setCreative] = useState<Creative | null>(null)
  const [launchScore, setLaunchScore] = useState<LaunchScore | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (offerId) {
      fetchData()
    } else {
      setError('缺少offerId参数')
      setLoading(false)
    }
  }, [offerId])

  const fetchData = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 获取Offer信息
      const offerRes = await fetch(`/api/offers/${offerId}`, {
        credentials: 'include',
      })

      if (!offerRes.ok) {
        throw new Error('获取Offer失败')
      }

      const offerData = await offerRes.json()
      setOffer(offerData.offer)

      // 如果有creativeId，获取创意信息
      if (creativeId) {
        const creativeRes = await fetch(`/api/creatives/${creativeId}`, {
          credentials: 'include',
        })

        if (creativeRes.ok) {
          const creativeData = await creativeRes.json()
          setCreative(creativeData.creative)
        }
      }

      // 获取最新的Launch Score
      const scoreRes = await fetch(`/api/offers/${offerId}/launch-score`, {
        credentials: 'include',
      })

      if (scoreRes.ok) {
        const scoreData = await scoreRes.json()
        if (scoreData.launchScore) {
          setLaunchScore(scoreData.launchScore)
          // 获取详细分析
          fetchAnalysis(scoreData.launchScore.id)
        }
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchAnalysis = async (scoreId: number) => {
    try {
      const res = await fetch(`/api/launch-scores/${scoreId}`, {
        credentials: 'include',
      })

      if (res.ok) {
        const data = await res.json()
        setAnalysis(data.analysis)
      }
    } catch (err) {
      console.error('获取分析详情失败:', err)
    }
  }

  const handleCalculate = async () => {
    if (!creativeId) {
      setError('请先选择一个创意进行评分')
      return
    }

    setCalculating(true)
    setError('')

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/offers/${offerId}/launch-score`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ creativeId: parseInt(creativeId, 10) }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '计算Launch Score失败')
      }

      setLaunchScore(data.launchScore)
      setAnalysis(data.analysis)
      showSuccess('计算完成', 'Launch Score已计算完成')
    } catch (err: any) {
      setError(err.message || '计算失败')
    } finally {
      setCalculating(false)
    }
  }

  const getScoreColor = (score: number, maxScore: number): string => {
    const percentage = (score / maxScore) * 100
    if (percentage >= 85) return 'bg-green-500'
    if (percentage >= 70) return 'bg-blue-500'
    if (percentage >= 60) return 'bg-yellow-500'
    if (percentage >= 50) return 'bg-orange-500'
    return 'bg-red-500'
  }

  const getGradeInfo = (totalScore: number) => {
    if (totalScore >= 85) {
      return { grade: 'A', color: 'text-green-600', label: '优秀 - 强烈推荐投放' }
    } else if (totalScore >= 70) {
      return { grade: 'B', color: 'text-blue-600', label: '良好 - 可以投放' }
    } else if (totalScore >= 60) {
      return { grade: 'C', color: 'text-yellow-600', label: '及格 - 建议优化后投放' }
    } else if (totalScore >= 50) {
      return { grade: 'D', color: 'text-orange-600', label: '需改进 - 需要大幅优化' }
    } else {
      return { grade: 'F', color: 'text-red-600', label: '不及格 - 不建议投放' }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (error && !offer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-indigo-100 mb-4">
            <svg className="h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-h3 mb-2">Launch Score 投放评分</h3>
          <p className="text-body text-muted-foreground mb-6">
            需要选择一个Offer才能查看或计算Launch Score评分
          </p>
          <button
            onClick={() => router.push('/offers')}
            className="w-full px-4 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
          >
            前往选择 Offer
          </button>
          <p className="mt-4 helper-text">
            在Offer详情页中，您可以为特定创意计算Launch Score
          </p>
        </div>
      </div>
    )
  }

  const gradeInfo = launchScore ? getGradeInfo(launchScore.totalScore) : null

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a
                href={`/offers/${offerId}`}
                className="text-indigo-600 hover:text-indigo-500 mr-4"
              >
                ← 返回Offer
              </a>
              <h1 className="text-h3 font-bold text-gray-900">
                {offer?.brand} - Launch Score投放评分
              </h1>
            </div>
            <div className="flex items-center space-x-3">
              {!launchScore && creativeId && (
                <button
                  onClick={handleCalculate}
                  disabled={calculating}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {calculating ? '计算中...' : '计算Launch Score'}
                </button>
              )}
              {launchScore && (
                <button
                  onClick={handleCalculate}
                  disabled={calculating || !creativeId}
                  className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-md hover:bg-indigo-50 disabled:opacity-50"
                >
                  {calculating ? '重新计算中...' : '重新计算'}
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-6 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {!creativeId && (
            <div className="mb-6 px-4 py-3 bg-yellow-50 border border-yellow-400 text-yellow-700 rounded">
              请从创意页面选择一个创意进行评分
            </div>
          )}

          {creative && (
            <div className="mb-6 bg-white shadow rounded-lg p-4">
              <h3 className="text-body-sm font-medium text-muted-foreground">评分创意</h3>
              <p className="mt-1 text-body-sm text-gray-900">
                版本 {creative.version}: {creative.headline1}
              </p>
            </div>
          )}

          {!launchScore ? (
            <div className="text-center py-12">
              <p className="text-body-lg text-muted-foreground mb-4">暂无Launch Score评分</p>
              {creativeId && (
                <button
                  onClick={handleCalculate}
                  disabled={calculating}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {calculating ? '计算中...' : '开始计算'}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* 总分卡片 */}
              <div className="bg-white shadow rounded-lg p-6">
                <div className="text-center">
                  <div className={`text-6xl font-bold ${gradeInfo?.color} mb-2`}>
                    {launchScore.totalScore}
                  </div>
                  <div className="text-h2 font-semibold text-gray-700 mb-1">
                    评级: {gradeInfo?.grade}
                  </div>
                  <div className="text-body-sm text-muted-foreground">{gradeInfo?.label}</div>
                  <div className="mt-4 helper-text">
                    计算时间: {new Date(launchScore.calculatedAt).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>

              {/* 各维度评分 - v4.0 4维度 */}
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-h4 mb-4">维度评分详情</h2>
                <div className="space-y-4">
                  {/* 投放可行性 */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-body-sm font-medium text-gray-700">
                        投放可行性 (35分满分)
                      </span>
                      <span className="text-body-sm font-semibold text-gray-900">
                        {launchScore.launchViabilityScore}分
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${getScoreColor(
                          launchScore.launchViabilityScore,
                          35
                        )}`}
                        style={{ width: `${(launchScore.launchViabilityScore / 35) * 100}%` }}
                      ></div>
                    </div>
                    {analysis?.launchViability?.issues &&
                      analysis.launchViability.issues.length > 0 && (
                        <ul className="mt-2 text-caption text-red-600 list-disc list-inside">
                          {analysis.launchViability.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      )}
                  </div>

                  {/* 广告质量 */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-body-sm font-medium text-gray-700">
                        广告质量 (30分满分)
                      </span>
                      <span className="text-body-sm font-semibold text-gray-900">
                        {launchScore.adQualityScore}分
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${getScoreColor(
                          launchScore.adQualityScore,
                          30
                        )}`}
                        style={{ width: `${(launchScore.adQualityScore / 30) * 100}%` }}
                      ></div>
                    </div>
                    {analysis?.adQuality?.issues &&
                      analysis.adQuality.issues.length > 0 && (
                        <ul className="mt-2 text-caption text-red-600 list-disc list-inside">
                          {analysis.adQuality.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      )}
                  </div>

                  {/* 关键词策略 */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-body-sm font-medium text-gray-700">
                        关键词策略 (20分满分)
                      </span>
                      <span className="text-body-sm font-semibold text-gray-900">
                        {launchScore.keywordStrategyScore}分
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${getScoreColor(
                          launchScore.keywordStrategyScore,
                          20
                        )}`}
                        style={{ width: `${(launchScore.keywordStrategyScore / 20) * 100}%` }}
                      ></div>
                    </div>
                    {analysis?.keywordStrategy?.issues &&
                      analysis.keywordStrategy.issues.length > 0 && (
                        <ul className="mt-2 text-caption text-red-600 list-disc list-inside">
                          {analysis.keywordStrategy.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      )}
                  </div>

                  {/* 基础配置 */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-body-sm font-medium text-gray-700">
                        基础配置 (15分满分)
                      </span>
                      <span className="text-body-sm font-semibold text-gray-900">
                        {launchScore.basicConfigScore}分
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${getScoreColor(launchScore.basicConfigScore, 15)}`}
                        style={{ width: `${(launchScore.basicConfigScore / 15) * 100}%` }}
                      ></div>
                    </div>
                    {analysis?.basicConfig?.issues &&
                      analysis.basicConfig.issues.length > 0 && (
                        <ul className="mt-2 text-caption text-red-600 list-disc list-inside">
                          {analysis.basicConfig.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      )}
                  </div>
                </div>
              </div>

              {/* 优化建议 */}
              {analysis?.overallRecommendations &&
                analysis.overallRecommendations.length > 0 && (
                  <div className="bg-white shadow rounded-lg p-6">
                    <h2 className="text-h4 mb-4">优化建议</h2>
                    <ul className="space-y-2">
                      {analysis.overallRecommendations.map((rec, index) => (
                        <li key={index} className="flex items-start">
                          <span className="flex-shrink-0 h-5 w-5 text-indigo-600 mr-2">•</span>
                          <span className="text-body-sm text-gray-700">{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
