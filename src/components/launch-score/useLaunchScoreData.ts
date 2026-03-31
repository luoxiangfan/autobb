'use client'

/**
 * LaunchScore数据加载Hook
 * 统一管理所有LaunchScore相关的数据获取逻辑
 */

import { useState, useEffect, useCallback } from 'react'
import {
  getCachedLaunchScore,
  setCachedLaunchScore,
  clearCachedLaunchScore,
} from '@/lib/launch-score-cache'
import type {
  Creative,
  LaunchScoreData,
  ScoreHistoryItem,
  CompareDataItem,
  PerformanceData,
} from './types'

interface UseLaunchScoreDataOptions {
  offerId: number
  isOpen: boolean
}

interface UseLaunchScoreDataReturn {
  // Creatives
  creatives: Creative[]
  loadingCreatives: boolean
  selectedCreativeId: number | null
  setSelectedCreativeId: (id: number | null) => void

  // Score Data
  scoreData: LaunchScoreData | null
  loading: boolean
  analyzing: boolean
  error: string
  setError: (error: string) => void

  // History
  historyData: ScoreHistoryItem[]
  loadingHistory: boolean

  // Compare
  selectedCompareIds: number[]
  compareData: CompareDataItem[]
  loadingCompare: boolean
  handleCompareSelectionChange: (creativeId: number) => void

  // Performance
  performanceData: PerformanceData | null
  loadingPerformance: boolean
  performanceTimeRange: string
  setPerformanceTimeRange: (range: string) => void
  avgOrderValue: string
  setAvgOrderValue: (value: string) => void

  // Actions
  handleAnalyze: () => Promise<void>
  loadPerformanceData: () => Promise<void>
  loadCompareData: (creativeIds: number[]) => Promise<void>
}

export function useLaunchScoreData({
  offerId,
  isOpen,
}: UseLaunchScoreDataOptions): UseLaunchScoreDataReturn {
  // Creative选择相关状态
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [loadingCreatives, setLoadingCreatives] = useState(false)
  const [selectedCreativeId, setSelectedCreativeId] = useState<number | null>(null)

  // Score相关状态
  const [scoreData, setScoreData] = useState<LaunchScoreData | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')

  // 历史评分相关状态
  const [historyData, setHistoryData] = useState<ScoreHistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // 对比相关状态
  const [selectedCompareIds, setSelectedCompareIds] = useState<number[]>([])
  const [compareData, setCompareData] = useState<CompareDataItem[]>([])
  const [loadingCompare, setLoadingCompare] = useState(false)

  // 性能相关状态
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null)
  const [loadingPerformance, setLoadingPerformance] = useState(false)
  const [performanceTimeRange, setPerformanceTimeRange] = useState<string>('30')
  const [avgOrderValue, setAvgOrderValue] = useState<string>('')

  // 加载Creatives
  const loadCreatives = useCallback(async () => {
    setLoadingCreatives(true)
    try {
      const response = await fetch(`/api/offers/${offerId}/creatives`, {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        setCreatives(data.data.creatives)
        if (data.data.creatives.length > 0) {
          setSelectedCreativeId(data.data.creatives[0].id)
        }
      }
    } catch (err) {
      console.error('加载Creatives失败:', err)
    } finally {
      setLoadingCreatives(false)
    }
  }, [offerId])

  // 加载历史记录
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const response = await fetch(`/api/offers/${offerId}/launch-score/history`, {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        setHistoryData(data.data.history || [])
      }
    } catch (err) {
      console.error('加载历史评分失败:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [offerId])

  // 加载已有评分
  const loadExistingScore = useCallback(async () => {
    if (!selectedCreativeId) return

    // 检查缓存
    const cached = getCachedLaunchScore(offerId, selectedCreativeId)
    if (cached) {
      console.log('✅ 从缓存加载Launch Score')
      setScoreData(cached)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/offers/${offerId}/launch-score`, {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        if (data.launchScore) {
          // v4.0 - 4维度格式
          const parsed: LaunchScoreData = {
            totalScore: data.launchScore.total_score,
            launchViability: JSON.parse(data.launchScore.launch_viability_data || '{}'),
            adQuality: JSON.parse(data.launchScore.ad_quality_data || '{}'),
            keywordStrategy: JSON.parse(data.launchScore.keyword_strategy_data || '{}'),
            basicConfig: JSON.parse(data.launchScore.basic_config_data || '{}'),
            overallRecommendations: JSON.parse(data.launchScore.recommendations || '[]'),
          }
          setScoreData(parsed)
          setCachedLaunchScore(offerId, selectedCreativeId, parsed)
          console.log('✅ Launch Score已缓存')
        }
      }
    } catch (err) {
      console.error('加载评分失败:', err)
    } finally {
      setLoading(false)
    }
  }, [offerId, selectedCreativeId])

  // 加载对比数据
  const loadCompareData = useCallback(async (creativeIds: number[]) => {
    if (creativeIds.length < 2) return

    setLoadingCompare(true)
    try {
      const response = await fetch(`/api/offers/${offerId}/launch-score/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ creativeIds }),
      })

      if (response.ok) {
        const data = await response.json()
        setCompareData(data.data.comparisons || [])
      }
    } catch (err) {
      console.error('加载对比数据失败:', err)
    } finally {
      setLoadingCompare(false)
    }
  }, [offerId])

  // 加载性能数据
  const loadPerformanceData = useCallback(async () => {
    setLoadingPerformance(true)
    try {
      const params = new URLSearchParams({ daysBack: performanceTimeRange })
      if (avgOrderValue && parseFloat(avgOrderValue) > 0) {
        params.append('avgOrderValue', avgOrderValue)
      }

      const response = await fetch(
        `/api/offers/${offerId}/launch-score/performance?${params.toString()}`,
        { credentials: 'include' }
      )

      if (response.ok) {
        const data = await response.json()
        setPerformanceData(data)
      }
    } catch (err) {
      console.error('加载性能对比数据失败:', err)
    } finally {
      setLoadingPerformance(false)
    }
  }, [offerId, performanceTimeRange, avgOrderValue])

  // 执行分析
  const handleAnalyze = useCallback(async () => {
    if (!selectedCreativeId) {
      setError('请先选择一个Creative')
      return
    }

    setAnalyzing(true)
    setError('')
    clearCachedLaunchScore(offerId)

    try {
      const response = await fetch(`/api/offers/${offerId}/launch-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ creativeId: selectedCreativeId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '分析失败')
      }

      setScoreData(data)
      setCachedLaunchScore(offerId, selectedCreativeId, data)
      loadHistory() // 刷新历史
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }, [offerId, selectedCreativeId, loadHistory])

  // 处理对比选择
  const handleCompareSelectionChange = useCallback((creativeId: number) => {
    setSelectedCompareIds((prev) => {
      if (prev.includes(creativeId)) {
        return prev.filter((id) => id !== creativeId)
      }
      if (prev.length >= 3) return prev
      return [...prev, creativeId]
    })
  }, [])

  // Modal打开时加载数据
  useEffect(() => {
    if (isOpen) {
      loadCreatives()
      loadHistory()
    }
  }, [isOpen, loadCreatives, loadHistory])

  // 选中Creative变化时加载评分
  useEffect(() => {
    if (isOpen && selectedCreativeId) {
      loadExistingScore()
    }
  }, [isOpen, selectedCreativeId, loadExistingScore])

  return {
    creatives,
    loadingCreatives,
    selectedCreativeId,
    setSelectedCreativeId,
    scoreData,
    loading,
    analyzing,
    error,
    setError,
    historyData,
    loadingHistory,
    selectedCompareIds,
    compareData,
    loadingCompare,
    handleCompareSelectionChange,
    performanceData,
    loadingPerformance,
    performanceTimeRange,
    setPerformanceTimeRange,
    avgOrderValue,
    setAvgOrderValue,
    handleAnalyze,
    loadPerformanceData,
    loadCompareData,
  }
}
