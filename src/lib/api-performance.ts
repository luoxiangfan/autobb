/**
 * API 与前端性能监控工具
 * - API: 记录接口响应耗时
 * - Web Vitals: 记录前端核心体验指标
 */

import { NextRequest, NextResponse } from 'next/server'

interface PerformanceMetric {
  path: string
  method: string
  duration: number
  timestamp: number
  statusCode: number
  userId?: number
}

interface WebVitalMetric {
  name: string
  value: number
  delta?: number
  rating?: 'good' | 'needs-improvement' | 'poor'
  navigationType?: string
  id?: string
  path: string
  buildId?: string
  flagSnapshot?: string
  timestamp: number
  userId?: number
  userAgent?: string
}

interface FrontendErrorMetric {
  type: 'error' | 'unhandledrejection'
  name?: string
  message: string
  stack?: string
  path: string
  buildId?: string
  flagSnapshot?: string
  timestamp: number
  userId?: number
  userAgent?: string
}

type WebVitalSeriesStats = {
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

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private maxMetrics: number = 1000 // 最多保留1000条记录

  /**
   * 记录性能指标
   */
  record(metric: PerformanceMetric): void {
    this.metrics.push(metric)

    // 超过最大记录数，删除最旧的
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift()
    }

    // 记录慢查询警告（>1秒）
    if (metric.duration > 1000) {
      console.warn(
        `[Performance Warning] Slow API: ${metric.method} ${metric.path} took ${metric.duration}ms`
      )
    }
  }

  /**
   * 获取最近的性能指标
   */
  getRecentMetrics(limit: number = 100): PerformanceMetric[] {
    return this.metrics.slice(-limit)
  }

  /**
   * 获取性能统计
   */
  getStats(path?: string): {
    avgDuration: number
    minDuration: number
    maxDuration: number
    p95Duration: number
    p99Duration: number
    totalRequests: number
    slowRequests: number
  } {
    let filteredMetrics = this.metrics
    if (path) {
      filteredMetrics = this.metrics.filter((m) => m.path === path)
    }

    if (filteredMetrics.length === 0) {
      return {
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        p95Duration: 0,
        p99Duration: 0,
        totalRequests: 0,
        slowRequests: 0,
      }
    }

    const durations = filteredMetrics.map((m) => m.duration)
    const sum = durations.reduce((a, b) => a + b, 0)
    const slowRequests = filteredMetrics.filter((m) => m.duration > 1000).length

    return {
      avgDuration: sum / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      p95Duration: computePercentile(durations, 95),
      p99Duration: computePercentile(durations, 99),
      totalRequests: filteredMetrics.length,
      slowRequests,
    }
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics = []
  }
}

// 导出单例实例
export const performanceMonitor = new PerformanceMonitor()

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  if (values.length === 1) return values[0]

  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((percentile / 100) * sorted.length) - 1
  const index = Math.min(sorted.length - 1, Math.max(0, rank))
  return sorted[index]
}

class WebVitalsMonitor {
  private metrics: WebVitalMetric[] = []
  private maxMetrics: number = 3000

  record(metric: WebVitalMetric): void {
    this.metrics.push(metric)

    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift()
    }
  }

  getRecentMetrics(limit: number = 100): WebVitalMetric[] {
    return this.metrics.slice(-limit)
  }

  getSummary(): {
    total: number
    byMetric: Record<string, WebVitalSeriesStats>
  } {
    const byMetric: Record<string, WebVitalSeriesStats> = {}
    const groups = new Map<string, WebVitalMetric[]>()

    for (const metric of this.metrics) {
      const group = groups.get(metric.name)
      if (group) {
        group.push(metric)
      } else {
        groups.set(metric.name, [metric])
      }
    }

    for (const [name, items] of groups.entries()) {
      const values = items.map((item) => item.value)
      const sum = values.reduce((acc, current) => acc + current, 0)
      const ratingStats = {
        good: items.filter((item) => item.rating === 'good').length,
        needsImprovement: items.filter((item) => item.rating === 'needs-improvement').length,
        poor: items.filter((item) => item.rating === 'poor').length,
      }

      byMetric[name] = {
        count: items.length,
        avg: values.length > 0 ? sum / values.length : 0,
        min: values.length > 0 ? Math.min(...values) : 0,
        max: values.length > 0 ? Math.max(...values) : 0,
        p75: computePercentile(values, 75),
        p95: computePercentile(values, 95),
        ...ratingStats,
      }
    }

    return {
      total: this.metrics.length,
      byMetric,
    }
  }

  clear(): void {
    this.metrics = []
  }
}

export const webVitalsMonitor = new WebVitalsMonitor()

class FrontendErrorMonitor {
  private metrics: FrontendErrorMetric[] = []
  private maxMetrics: number = 2000

  record(metric: FrontendErrorMetric): void {
    this.metrics.push(metric)
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift()
    }
  }

  getRecentMetrics(limit: number = 100): FrontendErrorMetric[] {
    return this.metrics.slice(-limit)
  }

  getSummary(): {
    total: number
    byType: Record<FrontendErrorMetric['type'], number>
    byPath: Record<string, number>
  } {
    const byType: Record<FrontendErrorMetric['type'], number> = {
      error: 0,
      unhandledrejection: 0,
    }
    const byPath: Record<string, number> = {}

    for (const metric of this.metrics) {
      byType[metric.type] += 1
      byPath[metric.path] = (byPath[metric.path] || 0) + 1
    }

    return {
      total: this.metrics.length,
      byType,
      byPath,
    }
  }

  clear(): void {
    this.metrics = []
  }
}

export const frontendErrorMonitor = new FrontendErrorMonitor()

/**
 * API性能监控中间件
 */
export function withPerformanceMonitoring<T>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>,
  options?: {
    path?: string
    logToConsole?: boolean
  }
): (request: NextRequest) => Promise<NextResponse<T>> {
  return async (request: NextRequest) => {
    const startTime = Date.now()
    const path = options?.path || request.nextUrl.pathname
    const method = request.method

    try {
      const response = await handler(request)
      const duration = Date.now() - startTime

      // 记录性能指标
      performanceMonitor.record({
        path,
        method,
        duration,
        timestamp: Date.now(),
        statusCode: response.status,
      })

      // 可选：控制台日志
      if (options?.logToConsole) {
        console.log(`[API] ${method} ${path} - ${duration}ms - ${response.status}`)
      }

      // 添加性能头部
      response.headers.set('X-Response-Time', `${duration}ms`)

      return response
    } catch (error) {
      const duration = Date.now() - startTime

      // 记录错误的性能指标
      performanceMonitor.record({
        path,
        method,
        duration,
        timestamp: Date.now(),
        statusCode: 500,
      })

      throw error
    }
  }
}
