/**
 * useBatchTask
 *
 * 批量任务Hook（批量创建Offer、批量抓取等）
 *
 * 流程：
 * 1. 上传CSV → 调用 POST /api/offers/batch/create，获取batchId
 *    - CSV必须包含必填列：推广链接、推广国家
 *    - 缺少必填参数的行会被自动跳过
 * 2. 使用 GET /api/offers/batch/stream/[batchId] 订阅SSE进度
 * 3. SSE失败时自动fallback到轮询 GET /api/offers/batch/status/[batchId]
 *
 * 优势：
 * - 批量任务持久化，支持页面刷新后重连
 * - SSE连接与任务执行解耦
 * - 自动fallback机制
 * - 实时显示整体进度（completed/failed/total）
 * - 自动校验CSV必填参数
 */

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface BatchStatus {
  batchId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial'
  total_count: number
  completed_count: number
  failed_count: number
  progress: number
}

interface UseBatchTaskReturn {
  // State
  isProcessing: boolean
  batchId: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial' | null
  totalCount: number
  completedCount: number
  failedCount: number
  progress: number // 0-100
  error: string | null

  // Connection state
  connectionType: 'sse' | 'polling' | null

  // Actions
  createBatchTask: (csvFile: File) => Promise<void>
  reconnect: (batchId: string) => Promise<void>
  reset: () => void
}

export function useBatchTask(): UseBatchTaskReturn {
  const [isProcessing, setIsProcessing] = useState(false)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [status, setStatus] = useState<'pending' | 'running' | 'completed' | 'failed' | 'partial' | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [connectionType, setConnectionType] = useState<'sse' | 'polling' | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const sseReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  // 清理函数
  const cleanup = useCallback(() => {
    // 关闭SSE连接
    if (sseReaderRef.current) {
      sseReaderRef.current.cancel().catch(() => {})
      sseReaderRef.current = null
    }

    // 停止轮询
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }

    // 取消请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setConnectionType(null)
  }, [])

  // 启动轮询fallback
  const startPolling = useCallback(async (bid: string) => {
    console.log('🔄 Falling back to polling for batch:', bid)
    setConnectionType('polling')

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/offers/batch/status/${bid}`)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data: BatchStatus = await response.json()

        // 更新状态
        setStatus(data.status)
        setTotalCount(data.total_count)
        setCompletedCount(data.completed_count)
        setFailedCount(data.failed_count)
        setProgress(data.progress)

        // 批量任务完成
        if (data.status === 'completed' || data.status === 'partial' || data.status === 'failed') {
          setIsProcessing(false)
          cleanup()
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 2000) // 每2秒轮询一次
  }, [cleanup])

  // 启动SSE订阅
  const startSSE = useCallback(async (bid: string) => {
    console.log('📡 Starting SSE subscription for batch:', bid)
    setConnectionType('sse')

    try {
      abortControllerRef.current = new AbortController()

      const response = await fetch(`/api/offers/batch/stream/${bid}`, {
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
          console.log('✅ Batch SSE stream completed')
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

            console.log('📨 Batch SSE Message:', data)

            if (data.type === 'progress') {
              setStatus('running')
              setCompletedCount(data.completed)
              setFailedCount(data.failed)
              setTotalCount(data.total)
              setProgress(data.progress)
            } else if (data.type === 'complete') {
              setStatus(data.status)
              setCompletedCount(data.completed)
              setFailedCount(data.failed)
              setTotalCount(data.total)
              setProgress(100)
              setIsProcessing(false)
              cleanup()
            } else if (data.type === 'error') {
              setError(data.error?.message || '批量任务失败')
              setIsProcessing(false)
              cleanup()
            }
          } catch (parseError) {
            console.error('Failed to parse batch SSE message:', parseError, message)
          }
        }
      }
    } catch (err: any) {
      // SSE失败，fallback到轮询
      if (err.name !== 'AbortError') {
        console.warn('Batch SSE failed, falling back to polling:', err)
        await startPolling(bid)
      }
    }
  }, [cleanup, startPolling])

  // 重置状态
  const reset = useCallback(() => {
    cleanup()
    setIsProcessing(false)
    setBatchId(null)
    setStatus(null)
    setTotalCount(0)
    setCompletedCount(0)
    setFailedCount(0)
    setProgress(0)
    setError(null)
  }, [cleanup])

  // 创建批量任务
  const createBatchTask = useCallback(async (csvFile: File) => {
    reset()
    setIsProcessing(true)
    setError(null)

    try {
      // 1. 上传CSV创建批量任务（target_country必须在CSV中指定）
      const formData = new FormData()
      formData.append('file', csvFile)

      const response = await fetch('/api/offers/batch/create', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const bid = data.batchId

      if (!bid) {
        throw new Error('No batchId returned')
      }

      setBatchId(bid)
      setTotalCount(data.total_count)
      setStatus('pending')
      console.log('✅ Batch task created:', bid, `(${data.total_count} items)`)

      // 2. 订阅进度（SSE优先）
      await startSSE(bid)

    } catch (err: any) {
      console.error('Create batch task failed:', err)
      setError(err.message || '创建批量任务失败')
      setIsProcessing(false)
    }
  }, [reset, startSSE])

  // 重连已有批量任务
  const reconnect = useCallback(async (bid: string) => {
    reset()
    setIsProcessing(true)
    setBatchId(bid)

    try {
      // 先查询一次当前状态
      const response = await fetch(`/api/offers/batch/status/${bid}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data: BatchStatus = await response.json()

      // 如果已经完成，直接显示结果
      if (data.status === 'completed' || data.status === 'partial' || data.status === 'failed') {
        setStatus(data.status)
        setTotalCount(data.total_count)
        setCompletedCount(data.completed_count)
        setFailedCount(data.failed_count)
        setProgress(data.progress)
        setIsProcessing(false)
        return
      }

      // 否则，订阅进度
      setStatus(data.status)
      setTotalCount(data.total_count)
      setCompletedCount(data.completed_count)
      setFailedCount(data.failed_count)
      setProgress(data.progress)

      await startSSE(bid)

    } catch (err: any) {
      console.error('Reconnect batch failed:', err)
      setError(err.message || '重连失败')
      setIsProcessing(false)
    }
  }, [reset, startSSE])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    isProcessing,
    batchId,
    status,
    totalCount,
    completedCount,
    failedCount,
    progress,
    error,
    connectionType,
    createBatchTask,
    reconnect,
    reset,
  }
}
