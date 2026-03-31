/**
 * useOfferExtractionV2
 *
 * 任务队列架构版本的Offer提取Hook
 *
 * 流程：
 * 1. 调用 POST /api/offers/extract 创建任务，获取taskId
 * 2. 使用 GET /api/offers/extract/stream/[taskId] 订阅SSE进度推送
 * 3. SSE失败时自动fallback到轮询 GET /api/offers/extract/status/[taskId]
 *
 * 优势：
 * - 任务持久化，支持页面刷新后重连
 * - SSE连接与任务执行解耦，避免controller closed错误
 * - 自动fallback机制，提高稳定性
 */

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  ProgressStage,
  ProgressStatus,
  ProgressEvent,
} from '@/types/progress'

interface ExtractionResult {
  finalUrl: string
  finalUrlSuffix: string
  brand: string
  productDescription?: string
  targetLanguage: string
  productCount?: number
  [key: string]: any
}

interface TaskStatus {
  taskId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  result: ExtractionResult | null
  error: any | null
}

interface UseOfferExtractionV2Return {
  // State
  isExtracting: boolean
  taskId: string | null
  currentStage: ProgressStage
  currentStatus: ProgressStatus
  currentMessage: string
  progress: number // 0-100
  result: ExtractionResult | null
  error: string | null
  currentDuration?: number // 当前阶段的耗时（毫秒）
  stageDurations: Map<ProgressStage, number> // 已完成阶段的耗时Map

  // Connection state
  connectionType: 'sse' | 'polling' | null

  // Actions
  startExtraction: (
    affiliateLink: string,
    targetCountry: string,
    productPrice?: string,
    commissionType?: 'percent' | 'amount',
    commissionValue?: string,
    commissionCurrency?: string,
    brandName?: string,
    pageType?: 'store' | 'product',
    storeProductLinks?: string[]
  ) => Promise<void>
  reconnect: (taskId: string) => Promise<void>
  reset: () => void
}

export function useOfferExtractionV2(): UseOfferExtractionV2Return {
  const [isExtracting, setIsExtracting] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<ProgressStage>('resolving_link')
  const [currentStatus, setCurrentStatus] = useState<ProgressStatus>('pending')
  const [currentMessage, setCurrentMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connectionType, setConnectionType] = useState<'sse' | 'polling' | null>(null)
  const [currentDuration, setCurrentDuration] = useState<number | undefined>()
  const [stageDurations, setStageDurations] = useState<Map<ProgressStage, number>>(new Map())

  const abortControllerRef = useRef<AbortController | null>(null)
  const sseReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  // 阶段耗时追踪
  const stageStartTimeRef = useRef<number>(Date.now())
  const lastStageRef = useRef<ProgressStage>('resolving_link')

  // 清理函数
  const cleanup = useCallback(() => {
    // 关闭SSE连接
    if (sseReaderRef.current) {
      sseReaderRef.current.cancel().catch(() => {})
      sseReaderRef.current = null
    }

    // 取消请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setConnectionType(null)
  }, [])

  // 重置状态
  const reset = useCallback(() => {
    cleanup()
    setIsExtracting(false)
    setTaskId(null)
    setCurrentStage('resolving_link')
    setCurrentStatus('pending')
    setCurrentMessage('')
    setProgress(0)
    setResult(null)
    setError(null)
    setCurrentDuration(undefined)
    setStageDurations(new Map()) // 🔥 重置阶段耗时记录
    stageStartTimeRef.current = Date.now()
    lastStageRef.current = 'resolving_link'
  }, [cleanup])

  // 开始提取 - 使用统一的POST /api/offers/extract/stream端点
  const startExtraction = useCallback(async (
    affiliateLink: string,
    targetCountry: string,
    productPrice?: string,
    commissionType?: 'percent' | 'amount',
    commissionValue?: string,
    commissionCurrency?: string,
    brandName?: string,
    pageType?: 'store' | 'product',
    storeProductLinks?: string[]
  ) => {
    reset()
    setIsExtracting(true)
    setCurrentMessage('创建任务中...')

    try {
      console.log('📡 Starting unified SSE extraction for:', affiliateLink)
      setConnectionType('sse')

      abortControllerRef.current = new AbortController()

      // 调用统一端点：POST /api/offers/extract/stream
      // 该端点会创建任务并直接返回SSE流
      const response = await fetch('/api/offers/extract/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          affiliate_link: affiliateLink,
          target_country: targetCountry,
          product_price: productPrice,
          commission_type: commissionType,
          commission_value: commissionValue,
          commission_currency: commissionCurrency,
          brand_name: brandName || undefined,
          page_type: pageType || undefined,
          store_product_links: storeProductLinks && storeProductLinks.length > 0 ? storeProductLinks : undefined,
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      const reader = response.body.getReader()
      sseReaderRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log('✅ SSE stream completed')
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // 处理完整消息（由\n\n分隔）
        const messages = buffer.split('\n\n')
        buffer = messages.pop() || ''

        for (const message of messages) {
          if (!message.trim() || !message.startsWith('data: ')) continue

          try {
            const jsonStr = message.substring(6)
            const data = JSON.parse(jsonStr)

            console.log('📨 SSE Message:', data)

            if (data.type === 'progress') {
              // 后端发送格式: {type: 'progress', data: {stage, status, message, ...}}
              const progressData = data.data || data
              const newStage = progressData.stage as ProgressStage
              const newStatus = progressData.status || 'in_progress'

              // 🔥 阶段耗时计算逻辑（前端计算）
              // 如果是新阶段开始，重置计时器
              if (newStage !== lastStageRef.current && newStatus === 'in_progress') {
                // 保存上一个阶段的完成耗时
                if (lastStageRef.current) {
                  let previousElapsed = Date.now() - stageStartTimeRef.current
                  // 🔥 修复：如果阶段切换太快（<1秒），显示为1秒
                  if (previousElapsed < 1000) previousElapsed = 1000
                  setStageDurations(prev => new Map(prev).set(lastStageRef.current, previousElapsed))
                }

                stageStartTimeRef.current = Date.now()
                setCurrentDuration(0)
                lastStageRef.current = newStage
              }

              // 🔥 修复：如果是新阶段直接完成（没有先经过in_progress），也需要保存上一个阶段的耗时
              if (newStage !== lastStageRef.current && newStatus === 'completed') {
                // 保存上一个阶段的完成耗时（如果还没保存）
                if (lastStageRef.current) {
                  setStageDurations(prev => {
                    const newMap = new Map(prev)
                    // 只有当上一个阶段还没有耗时记录时才保存
                    if (!newMap.has(lastStageRef.current)) {
                      let previousElapsed = Date.now() - stageStartTimeRef.current
                      // 🔥 修复：如果阶段切换太快（<1秒），显示为1秒
                      if (previousElapsed < 1000) previousElapsed = 1000
                      newMap.set(lastStageRef.current, previousElapsed)
                    }
                    return newMap
                  })
                }

                // 重置计时器为当前阶段
                stageStartTimeRef.current = Date.now()
                lastStageRef.current = newStage
              }

              // 如果正在进行中，计算已用时间
              if (newStatus === 'in_progress') {
                const elapsed = Date.now() - stageStartTimeRef.current
                setCurrentDuration(elapsed)
              }

              // 如果阶段完成，保存完成耗时到stageDurations
              if (newStatus === 'completed') {
                let elapsed = Date.now() - stageStartTimeRef.current
                // 🔥 修复：如果阶段切换太快导致计算不准确（<1秒），显示为1秒
                if (elapsed < 1000) {
                  elapsed = 1000
                }
                setCurrentDuration(elapsed)
                // 🔥 保存当前阶段的完成耗时
                setStageDurations(prev => new Map(prev).set(newStage, elapsed))
              }

              setCurrentStage(newStage)
              setCurrentStatus(newStatus)
              setCurrentMessage(progressData.message || '')
              // 根据stage计算进度百分比
              const progressMap: Record<string, number> = {
                proxy_warmup: 5,
                fetching_proxy: 10,
                resolving_link: 20,
                accessing_page: 35,
                extracting_brand: 50,
                scraping_products: 65,
                processing_data: 80,
                ai_analysis: 90,
                completed: 100,
                error: 0,
              }
              setProgress(progressMap[progressData.stage] || 0)
            } else if (data.type === 'complete') {
              // 后端发送格式: {type: 'complete', data: {...result}}
              const resultData = data.data || data.result
              console.log('🎉 Complete message received:', { data, resultData })
              console.log('🔍 Result has finalUrl:', resultData?.finalUrl)

              setCurrentStage('completed')
              setCurrentStatus('completed')
              setCurrentMessage('提取完成！')
              setProgress(100)
              setResult(resultData)
              setIsExtracting(false)
              cleanup()
            } else if (data.type === 'error') {
              // 后端发送格式: {type: 'error', data: {message, stage, details}}
              const errorData = data.data || data.error || {}
              setCurrentStage('error')
              setCurrentStatus('error')
              setError(errorData.message || '任务失败')
              setCurrentMessage(errorData.message || '任务失败')
              setIsExtracting(false)
              cleanup()
            }
          } catch (parseError) {
            console.error('Failed to parse SSE message:', parseError, message)
          }
        }
      }
    } catch (err: any) {
      // SSE失败
      if (err.name !== 'AbortError') {
        console.error('SSE extraction failed:', err)
        setError(err.message || '创建任务失败')
        setCurrentMessage('创建任务失败，请重试')
        setIsExtracting(false)
        cleanup()
      }
    }
  }, [reset, cleanup])

  // 重连已有任务（简化版 - 统一API不支持按taskId重连）
  const reconnect = useCallback(async (tid: string) => {
    console.warn('Reconnect not supported in unified API, please restart extraction')
    setError('当前版本不支持重连，请重新开始提取')
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    isExtracting,
    taskId,
    currentStage,
    currentStatus,
    currentMessage,
    progress,
    result,
    error,
    currentDuration,
    stageDurations, // 🔥 导出已完成阶段的耗时Map
    connectionType,
    startExtraction,
    reconnect,
    reset,
  }
}
