'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Gauge, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchWithRetry } from '@/lib/api-error-handler'
import { showError, showSuccess } from '@/lib/toast-utils'

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

type WebVitalStats = {
  count: number
  avg: number
  min: number
  max: number
  p75: number
  p95: number
  good: number
  needsImprovement: number
  poor: number
}

type WebVitalMetric = {
  name: string
  value: number
  delta?: number
  rating?: 'good' | 'needs-improvement' | 'poor'
  path: string
  timestamp: number
}

type FrontendErrorSummary = {
  total: number
  byType: {
    error: number
    unhandledrejection: number
  }
  byPath: Record<string, number>
}

type FrontendErrorMetric = {
  type: 'error' | 'unhandledrejection'
  name?: string
  message: string
  stack?: string
  path: string
  timestamp: number
}

type PerformanceData = {
  overall: OverallStats
  cache: CacheStats
  byPath: Record<string, PathStats>
  recentRequests: ApiRequestMetric[]
  frontendVitals: {
    total: number
    byMetric: Record<string, WebVitalStats>
  }
  recentFrontendVitals: WebVitalMetric[]
  frontendErrors: FrontendErrorSummary
  recentFrontendErrors: FrontendErrorMetric[]
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

function ratingBadgeClass(rating?: string): string {
  if (rating === 'good') return 'bg-green-100 text-green-800'
  if (rating === 'needs-improvement') return 'bg-yellow-100 text-yellow-800'
  if (rating === 'poor') return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
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
      const result = await fetchWithRetry('/api/admin/performance', {
        credentials: 'include',
        cache: 'no-store',
      }, {
        maxRetries: 1,
        retryDelay: 1000,
        retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE'],
      })

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
      const result = await fetchWithRetry('/api/admin/performance', {
        method: 'DELETE',
        credentials: 'include',
      }, {
        maxRetries: 0,
      })

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

  const sortedVitalStats = useMemo(() => {
    if (!data) return []
    return Object.entries(data.frontendVitals.byMetric)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.p95 - a.p95)
  }, [data])

  const topErrorPaths = useMemo(() => {
    if (!data) return []
    return Object.entries(data.frontendErrors.byPath)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [data])

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="h-6 w-6 text-blue-600" />
            性能监控面板
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            最后更新：{formatTime(lastUpdatedAt)}
          </p>
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
          <Button
            variant="destructive"
            onClick={() => void clearMetrics()}
            disabled={clearing}
          >
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
              <p className="text-2xl font-semibold text-orange-600">{formatNumber(data.overall.slowRequests)}</p>
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
                        <td className="py-4 text-gray-400" colSpan={6}>暂无数据</td>
                      </tr>
                    ) : sortedPathStats.map((row) => (
                      <tr key={row.path} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 font-mono text-xs">{row.path}</td>
                        <td className="py-2 pr-3">{formatNumber(row.totalRequests)}</td>
                        <td className="py-2 pr-3">{formatMs(row.avgDuration)}</td>
                        <td className="py-2 pr-3">{formatMs(row.p95Duration)}</td>
                        <td className="py-2 pr-3">{formatMs(row.p99Duration)}</td>
                        <td className="py-2 pr-3">{formatMs(row.maxDuration)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border bg-white p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                前端错误概览
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">错误总数</p>
                  <p className="text-lg font-semibold">{formatNumber(data.frontendErrors.total)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Error</p>
                  <p className="text-lg font-semibold">{formatNumber(data.frontendErrors.byType.error)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Unhandled Rejection</p>
                  <p className="text-lg font-semibold">{formatNumber(data.frontendErrors.byType.unhandledrejection)}</p>
                </div>
              </div>
              <div className="space-y-2">
                {topErrorPaths.length === 0 ? (
                  <p className="text-sm text-gray-400">暂无路径维度错误数据</p>
                ) : topErrorPaths.map((row) => (
                  <div key={row.path} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs">{row.path}</span>
                    <span className="font-medium">{row.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h2 className="font-semibold mb-3">Web Vitals 汇总</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-3">指标</th>
                    <th className="py-2 pr-3">样本</th>
                    <th className="py-2 pr-3">P75</th>
                    <th className="py-2 pr-3">P95</th>
                    <th className="py-2 pr-3">Good</th>
                    <th className="py-2 pr-3">Needs</th>
                    <th className="py-2 pr-3">Poor</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVitalStats.length === 0 ? (
                    <tr>
                      <td className="py-4 text-gray-400" colSpan={7}>暂无 Web Vitals 数据</td>
                    </tr>
                  ) : sortedVitalStats.map((row) => (
                    <tr key={row.name} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-semibold">{row.name}</td>
                      <td className="py-2 pr-3">{formatNumber(row.count)}</td>
                      <td className="py-2 pr-3">{formatMs(row.p75)}</td>
                      <td className="py-2 pr-3">{formatMs(row.p95)}</td>
                      <td className="py-2 pr-3 text-green-700">{formatNumber(row.good)}</td>
                      <td className="py-2 pr-3 text-yellow-700">{formatNumber(row.needsImprovement)}</td>
                      <td className="py-2 pr-3 text-red-700">{formatNumber(row.poor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-lg border bg-white p-4">
              <h2 className="font-semibold mb-3">最近 API 请求</h2>
              <div className="max-h-[360px] overflow-auto space-y-2">
                {data.recentRequests.length === 0 ? (
                  <p className="text-sm text-gray-400">暂无请求数据</p>
                ) : data.recentRequests.map((item, index) => (
                  <div key={`${item.path}-${item.timestamp}-${index}`} className="rounded border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{item.path}</span>
                      <span className="text-xs text-gray-500">{formatTime(item.timestamp)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded bg-gray-100">{item.method}</span>
                      <span className={`px-2 py-0.5 rounded ${item.statusCode >= 400 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {item.statusCode}
                      </span>
                      <span>{formatMs(item.duration)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-white p-4">
              <h2 className="font-semibold mb-3">最近前端指标与错误</h2>
              <div className="space-y-3 max-h-[360px] overflow-auto">
                {data.recentFrontendVitals.map((item, index) => (
                  <div key={`${item.name}-${item.timestamp}-${index}`} className="rounded border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{item.name}</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${ratingBadgeClass(item.rating)}`}>
                          {item.rating || 'unknown'}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">{formatTime(item.timestamp)}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      path: <span className="font-mono">{item.path}</span> | value: {item.value.toFixed(2)}
                    </div>
                  </div>
                ))}

                {data.recentFrontendErrors.map((item, index) => (
                  <div key={`${item.type}-${item.timestamp}-${index}`} className="rounded border p-3 bg-amber-50/30">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                        {item.type}
                      </span>
                      <span className="text-xs text-gray-500">{formatTime(item.timestamp)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium">{item.name || 'Error'}</div>
                    <div className="text-xs text-gray-700 break-all">{item.message}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      path: <span className="font-mono">{item.path}</span>
                    </div>
                  </div>
                ))}

                {data.recentFrontendVitals.length === 0 && data.recentFrontendErrors.length === 0 ? (
                  <p className="text-sm text-gray-400">暂无前端指标与错误数据</p>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
