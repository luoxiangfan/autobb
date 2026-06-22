'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Gauge, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchWithRetry } from '@/lib/common'
import { showError, showSuccess } from '@/lib/common'

type OverallStats = {
  avgDuration: number
  minDuration: number
  maxDuration: number
  p95Duration?: number
  p99Duration?: number
  totalRequests: number
  slowRequests: number
}

type CacheStats = {
  totalKeys: number
  validKeys: number
  expiredKeys: number
}

type PathStats = {
  avgDuration: number
  minDuration: number
  maxDuration: number
  p95Duration?: number
  p99Duration?: number
  totalRequests: number
  slowRequests: number
}

type ApiRequestMetric = {
  path: string
  method: string
  duration: number
  timestamp: number
  statusCode: number
}

type PerformanceData = {
  overall: OverallStats
  cache: CacheStats
  byPath: Record<string, PathStats>
  recentRequests: ApiRequestMetric[]
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  if (value < 1000) return `${value.toFixed(0)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function formatTime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return value.toLocaleString('zh-CN')
}

export default function AdminPerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const inFlightRef = useRef(false)

  const loadData = useCallback(async (showSuccessToast = false) => {
    if (inFlightRef.current) return
    inFlightRef.current = true

    if (!showSuccessToast) setLoading(true)
    setRefreshing(true)
    setError(null)

    try {
      const result = await fetchWithRetry(
        '/api/admin/performance',
        {
          credentials: 'include',
          cache: 'no-store',
        },
        {
          maxRetries: 1,
          retryDelay: 1000,
          retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE'],
        }
      )

      if (!result.success) {
        setError(result.userMessage || '获取性能数据失败')
        return
      }

      const payload = result.data as any
      if (!payload?.success || !payload?.data) {
        setError(payload?.error || '获取性能数据失败')
        return
      }

      setData(payload.data as PerformanceData)
      setLastUpdatedAt(Date.now())

      if (showSuccessToast) {
        showSuccess('性能数据已刷新')
      }
    } catch (err: any) {
      setError(err?.message || '获取性能数据失败')
    } finally {
      inFlightRef.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const clearMetrics = useCallback(async () => {
    const confirmed = window.confirm('确认清空当前性能监控数据吗？此操作不可撤销。')
    if (!confirmed) return

    setClearing(true)
    try {
      const result = await fetchWithRetry(
        '/api/admin/performance',
        {
          method: 'DELETE',
          credentials: 'include',
        },
        {
          maxRetries: 0,
        }
      )

      if (!result.success) {
        showError('清空失败', result.userMessage || '请稍后重试')
        return
      }

      const payload = result.data as any
      if (!payload?.success) {
        showError('清空失败', payload?.error || '请稍后重试')
        return
      }

      showSuccess('性能数据已清空')
      await loadData()
    } catch (err: any) {
      showError('清空失败', err?.message || '请稍后重试')
    } finally {
      setClearing(false)
    }
  }, [loadData])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadData()
    }, 30_000)
    return () => clearInterval(timer)
  }, [loadData])

  const sortedPathStats = useMemo(() => {
    if (!data) return []
    return Object.entries(data.byPath)
      .map(([path, stats]) => ({ path, ...stats }))
      .sort((a, b) => b.maxDuration - a.maxDuration)
      .slice(0, 10)
  }, [data])

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="h-6 w-6 text-blue-600" />
            性能监控面板
          </h1>
          <p className="text-sm text-gray-500 mt-1">最后更新：{formatTime(lastUpdatedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void loadData(true)}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button variant="destructive" onClick={() => void clearMetrics()} disabled={clearing}>
            <Trash2 className="h-4 w-4 mr-2" />
            清空数据
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-500">
          正在加载性能数据...
        </div>
      ) : null}

      {!loading && data ? (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-lg border bg-white p-4">
              <p className="text-sm text-gray-500">API 总请求</p>
              <p className="text-2xl font-semibold">{formatNumber(data.overall.totalRequests)}</p>
            </div>
            <div className="rounded-lg border bg-white p-4">
              <p className="text-sm text-gray-500">平均响应耗时</p>
              <p className="text-2xl font-semibold">{formatMs(data.overall.avgDuration)}</p>
            </div>
            <div className="rounded-lg border bg-white p-4">
              <p className="text-sm text-gray-500">慢请求（&gt;1s）</p>
              <p className="text-2xl font-semibold text-orange-600">
                {formatNumber(data.overall.slowRequests)}
              </p>
            </div>
            <div className="rounded-lg border bg-white p-4">
              <p className="text-sm text-gray-500">缓存有效条目</p>
              <p className="text-2xl font-semibold">{formatNumber(data.cache.validKeys)}</p>
            </div>
            <div className="rounded-lg border bg-white p-4">
              <p className="text-sm text-gray-500">整体 P95</p>
              <p className="text-2xl font-semibold">{formatMs(data.overall.p95Duration)}</p>
            </div>
            <div className="rounded-lg border bg-white p-4">
              <p className="text-sm text-gray-500">整体 P99</p>
              <p className="text-2xl font-semibold">{formatMs(data.overall.p99Duration)}</p>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-lg border bg-white p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-600" />
                慢接口 Top10（按 max 耗时）
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">接口</th>
                      <th className="py-2 pr-3">请求数</th>
                      <th className="py-2 pr-3">平均</th>
                      <th className="py-2 pr-3">P95</th>
                      <th className="py-2 pr-3">P99</th>
                      <th className="py-2 pr-3">最大</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPathStats.length === 0 ? (
                      <tr>
                        <td className="py-4 text-gray-400" colSpan={6}>
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      sortedPathStats.map((row) => (
                        <tr key={row.path} className="border-b last:border-b-0">
                          <td className="py-2 pr-3 font-mono text-xs">{row.path}</td>
                          <td className="py-2 pr-3">{formatNumber(row.totalRequests)}</td>
                          <td className="py-2 pr-3">{formatMs(row.avgDuration)}</td>
                          <td className="py-2 pr-3">{formatMs(row.p95Duration)}</td>
                          <td className="py-2 pr-3">{formatMs(row.p99Duration)}</td>
                          <td className="py-2 pr-3">{formatMs(row.maxDuration)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border bg-white p-4">
              <h2 className="font-semibold mb-3">最近 API 请求</h2>
              <div className="max-h-[360px] overflow-auto space-y-2">
                {data.recentRequests.length === 0 ? (
                  <p className="text-sm text-gray-400">暂无请求数据</p>
                ) : (
                  data.recentRequests.map((item, index) => (
                    <div
                      key={`${item.path}-${item.timestamp}-${index}`}
                      className="rounded border p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{item.path}</span>
                        <span className="text-xs text-gray-500">{formatTime(item.timestamp)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-gray-100">{item.method}</span>
                        <span
                          className={`px-2 py-0.5 rounded ${item.statusCode >= 400 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}
                        >
                          {item.statusCode}
                        </span>
                        <span>{formatMs(item.duration)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
