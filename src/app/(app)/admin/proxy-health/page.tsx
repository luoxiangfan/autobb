'use client'

/**
 * 代理池健康监控页面（管理员专用）
 * 实时显示所有代理的健康状态、成功/失败次数、响应时间
 * 支持手动启用/禁用代理
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RefreshCw, CheckCircle2, XCircle, Activity, AlertCircle } from 'lucide-react'
import { fetchWithRetry } from '@/lib/api-error-handler'

interface ProxyHealth {
  url: string
  country: string
  isHealthy: boolean
  failureCount: number
  successCount: number
}

export default function ProxyHealthPage() {
  const router = useRouter()
  const [proxies, setProxies] = useState<ProxyHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now())

  useEffect(() => {
    fetchProxyHealth()

    // 每30秒自动刷新
    const interval = setInterval(() => {
      fetchProxyHealth(true)
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const fetchProxyHealth = async (silent = false) => {
    if (!silent) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError('')

    try {
      const result = await fetchWithRetry('/api/admin/proxy-health', {
        credentials: 'include',
        cache: 'no-store',
      }, {
        maxRetries: 2,
        retryDelay: 2000,
        retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE']
      })

      if (!result.success) {
        setError(result.userMessage)
        return
      }

      const data = result.data
      setProxies(data.data)
      setLastUpdated(Date.now())
    } catch (err: any) {
      setError('获取代理健康状态时发生未知错误')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleToggleProxy = async (proxyUrl: string, isHealthy: boolean) => {
    try {
      const result = await fetchWithRetry('/api/admin/proxy-health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          action: isHealthy ? 'disable' : 'enable',
          proxyUrl,
        }),
      })

      if (!result.success) {
        setError(result.userMessage)
        return
      }

      // 刷新数据
      await fetchProxyHealth(true)
    } catch (err: any) {
      setError('操作代理状态时发生未知错误')
    }
  }

  const getHealthBadge = (proxy: ProxyHealth) => {
    if (proxy.isHealthy) {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          健康
        </Badge>
      )
    } else {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <XCircle className="w-3 h-3 mr-1" />
          不健康
        </Badge>
      )
    }
  }

  const getSuccessRate = (proxy: ProxyHealth) => {
    const total = proxy.successCount + proxy.failureCount
    if (total === 0) return 'N/A'
    return `${((proxy.successCount / total) * 100).toFixed(1)}%`
  }

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
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
          <div className="flex justify-between items-center py-4 h-16">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/dashboard')}
              >
                ← 返回Dashboard
              </Button>
              <h1 className="page-title flex items-center gap-2">
                <Activity className="w-5 h-5" />
                代理池健康监控
              </h1>
              <Badge variant="outline" className="text-body-sm">
                {proxies.length}个代理
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                最后更新: {formatTimestamp(lastUpdated)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchProxyHealth()}
                disabled={refreshing}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">总代理数</p>
                  <p className="text-2xl font-bold text-gray-900">{proxies.length}</p>
                </div>
                <Activity className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">健康代理</p>
                  <p className="text-2xl font-bold text-green-600">
                    {proxies.filter(p => p.isHealthy).length}
                  </p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">不健康代理</p>
                  <p className="text-2xl font-bold text-red-600">
                    {proxies.filter(p => !p.isHealthy).length}
                  </p>
                </div>
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">平均成功率</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {proxies.length > 0
                      ? (
                          (proxies.reduce((sum, p) => {
                            const total = p.successCount + p.failureCount
                            return sum + (total > 0 ? (p.successCount / total) * 100 : 0)
                          }, 0) / proxies.length)
                        ).toFixed(1)
                      : 'N/A'}%
                  </p>
                </div>
                <Activity className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 代理列表 */}
        <Card>
          <CardHeader>
            <CardTitle>代理详情</CardTitle>
            <CardDescription>
              查看所有代理的实时健康状态、成功/失败次数
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>代理URL</TableHead>
                    <TableHead>国家</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">成功次数</TableHead>
                    <TableHead className="text-right">失败次数</TableHead>
                    <TableHead className="text-right">成功率</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proxies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                        暂无代理数据，请先在设置页面配置代理URL
                      </TableCell>
                    </TableRow>
                  ) : (
                    proxies.map((proxy, index) => (
                      <TableRow key={index} className="hover:bg-gray-50/50">
                        <TableCell className="font-mono text-sm max-w-xs truncate" title={proxy.url}>
                          {proxy.url}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{proxy.country}</Badge>
                        </TableCell>
                        <TableCell>{getHealthBadge(proxy)}</TableCell>
                        <TableCell className="text-right text-green-600 font-semibold">
                          {proxy.successCount}
                        </TableCell>
                        <TableCell className="text-right text-red-600 font-semibold">
                          {proxy.failureCount}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {getSuccessRate(proxy)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={proxy.isHealthy ? 'destructive' : 'default'}
                            onClick={() => handleToggleProxy(proxy.url, proxy.isHealthy)}
                          >
                            {proxy.isHealthy ? '禁用' : '启用'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 说明 */}
        <Card className="mt-6 bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-2">说明：</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>代理失败次数 ≥3 次会被自动标记为"不健康"</li>
                  <li>不健康的代理在1小时后会自动重置失败计数</li>
                  <li>您可以手动禁用/启用代理进行测试</li>
                  <li>数据每30秒自动刷新</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
