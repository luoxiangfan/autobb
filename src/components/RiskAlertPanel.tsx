'use client'

/**
 * 风险提示面板组件 - P1-4优化版
 *
 * 功能：
 * - 显示风险提示列表
 * - 按严重程度分类
 * - 确认/解决提示
 * - 手动触发链接检查
 * - 增强视觉设计和动画效果
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
  Link as LinkIcon,
  CheckCheck,
  XCircle,
  ArrowRight
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { showError, showSuccess } from '@/lib/toast-utils'
import { parseJsonField } from '@/lib/json-field'

interface RiskAlert {
  id: number
  alertType: string
  severity: 'critical' | 'warning' | 'info'
  resourceType: string | null
  resourceId: number | null
  title: string
  message: string
  details: string | null
  status: 'active' | 'acknowledged' | 'resolved'
  createdAt: string
}

interface RiskAlertDetails {
  url?: string
  statusCode?: number
  errorMessage?: string
  finalUrl?: string
  actionUrl?: string
  actionRequired?: string
}

function parseRiskAlertDetails(details: unknown): RiskAlertDetails | null {
  const parsed = parseJsonField<Record<string, unknown> | null>(details, null)
  if (!parsed) return null

  return {
    url: typeof parsed.url === 'string' ? parsed.url : undefined,
    statusCode: typeof parsed.statusCode === 'number' ? parsed.statusCode : undefined,
    errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : undefined,
    finalUrl: typeof parsed.finalUrl === 'string' ? parsed.finalUrl : undefined,
    actionUrl: typeof parsed.actionUrl === 'string' ? parsed.actionUrl : undefined,
    actionRequired: typeof parsed.actionRequired === 'string' ? parsed.actionRequired : undefined,
  }
}

interface Statistics {
  total: number
  active: number
  critical: number
  warning: number
  info: number
  byType: Record<string, number>
}

interface LinkCheckResult {
  totalChecked: number
  accessible: number
  broken: number
  redirected: number
  newAlerts: number
}

export default function RiskAlertPanel() {
  const router = useRouter()
  const [alerts, setAlerts] = useState<RiskAlert[]>([])
  const [statistics, setStatistics] = useState<Statistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [checkResult, setCheckResult] = useState<LinkCheckResult | null>(null)

  // 加载风险提示
  const loadAlerts = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/risk-alerts?status=active', {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to load alerts')

      const data = await response.json()
      setAlerts(data.alerts)
      setStatistics(data.statistics)
    } catch (error) {
      console.error('Load alerts error:', error)
    } finally {
      setLoading(false)
    }
  }

  // 手动检查链接
  const checkLinks = async () => {
    setChecking(true)
    try {
      const response = await fetch('/api/risk-alerts', {
        method: 'POST'
      })

      if (!response.ok) throw new Error('Failed to check links')

      const data = await response.json()
      await loadAlerts()

      // 显示美观的结果弹窗
      setCheckResult(data.result)
      setShowResultDialog(true)
    } catch (error) {
      console.error('Check links error:', error)
      setCheckResult({
        totalChecked: 0,
        accessible: 0,
        broken: 0,
        redirected: 0,
        newAlerts: 0
      })
      setShowResultDialog(true)
    } finally {
      setChecking(false)
    }
  }

  // 更新提示状态
  const updateAlertStatus = async (
    alertId: number,
    status: 'acknowledged' | 'resolved',
    note?: string
  ) => {
    try {
      const response = await fetch(`/api/risk-alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note })
      })

      if (!response.ok) throw new Error('Failed to update alert')

      await loadAlerts()
      setExpandedAlert(null)
      setResolutionNote('')
      showSuccess(
        status === 'resolved' ? '风险已解决' : '风险已确认',
        '提示状态已更新'
      )
    } catch (error) {
      console.error('Update alert error:', error)
      showError('更新失败', '无法更新提示状态，请重试')
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [])

  // 严重程度配置
  const severityConfig = {
    critical: {
      color: 'bg-red-100 text-red-800 border-red-300',
      icon: AlertTriangle,
      label: '严重',
      bgColor: 'bg-red-50'
    },
    warning: {
      color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      icon: AlertCircle,
      label: '警告',
      bgColor: 'bg-yellow-50'
    },
    info: {
      color: 'bg-blue-100 text-blue-800 border-blue-300',
      icon: Info,
      label: '信息',
      bgColor: 'bg-blue-50'
    }
  }

  // 提示类型标签
  const alertTypeLabels: Record<string, string> = {
    link_broken: '链接失效',
    link_redirect: '链接重定向',
    link_timeout: '链接超时',
    account_suspended: '账号暂停',
    campaign_paused: 'Campaign暂停',
    budget_exhausted: '预算耗尽',
    low_quality_score: '质量分过低'
  }

  // 按严重程度分组
  const groupedAlerts = {
    critical: alerts.filter(a => a.severity === 'critical'),
    warning: alerts.filter(a => a.severity === 'warning'),
    info: alerts.filter(a => a.severity === 'info')
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-sm text-gray-500">加载风险提示...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 - P1-4优化版 */}
      {statistics && statistics.active > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="border-red-200 bg-gradient-to-br from-red-50 to-red-100/50 hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-red-600">{statistics.critical}</div>
                    <p className="text-xs text-red-700 font-medium">严重风险</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-gradient-to-br from-yellow-50 to-yellow-100/50 hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-yellow-600">{statistics.warning}</div>
                    <p className="text-xs text-yellow-700 font-medium">警告</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100/50 hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Info className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-blue-600">{statistics.info}</div>
                    <p className="text-xs text-blue-700 font-medium">信息提示</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50 hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-gray-900">{statistics.active}</div>
                    <p className="text-xs text-gray-600 font-medium">活跃提示总数</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 头部操作 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">风险提示</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadAlerts}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button onClick={checkLinks} disabled={checking}>
            {checking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                检查中...
              </>
            ) : (
              '检查所有链接'
            )}
          </Button>
        </div>
      </div>

      {/* 风险提示列表 - P1-4优化版 */}
      {Object.entries(groupedAlerts).map(([severity, severityAlerts]) => {
        if (severityAlerts.length === 0) return null

        const config = severityConfig[severity as 'critical' | 'warning' | 'info']
        const Icon = config.icon

        return (
          <Card key={severity} className={`border-2 ${config.bgColor} hover:shadow-md transition-all`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    severity === 'critical' ? 'bg-red-100' :
                    severity === 'warning' ? 'bg-yellow-100' : 'bg-blue-100'
                  }`}>
                    <Icon className={`h-5 w-5 ${
                      severity === 'critical' ? 'text-red-600' :
                      severity === 'warning' ? 'text-yellow-600' : 'text-blue-600'
                    }`} />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{config.label}</CardTitle>
                    <CardDescription className="text-sm">
                      {severity === 'critical' && '需要立即处理的严重问题'}
                      {severity === 'warning' && '需要关注的潜在风险'}
                      {severity === 'info' && '建议查看的信息'}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="secondary" className="text-lg px-3 py-1">
                  {severityAlerts.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                  {severityAlerts.map((alert) => {
                  const details = parseRiskAlertDetails(alert.details)
                  const actionUrl = details?.actionUrl
                  const isExpanded = expandedAlert === alert.id

                  return (
                    <div
                      key={alert.id}
                      className={`rounded-lg border-2 p-4 transition-all ${config.color} ${
                        isExpanded ? 'shadow-md' : 'hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <span className="font-semibold text-base">{alert.title}</span>
                            <Badge variant="secondary" className="text-xs">
                              {alertTypeLabels[alert.alertType] || alert.alertType}
                            </Badge>
                            {alert.resourceType && (
                              <Badge variant="outline" className="text-xs">
                                {alert.resourceType} #{alert.resourceId}
                              </Badge>
                            )}
                          </div>

                          <p className="text-sm mb-3 leading-relaxed">{alert.message}</p>

                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Info className="h-3 w-3" />
                            <span>{new Date(alert.createdAt).toLocaleString('zh-CN')}</span>
                          </div>

                          {isExpanded && (
                            <div className="mt-4 space-y-3 border-t pt-4 animate-in slide-in-from-top-2">
                              {details && (
                                <Card className="bg-white/50">
                                  <CardContent className="p-3 space-y-2 text-sm">
                                    {details.url && (
                                      <div className="flex items-start gap-2">
                                        <ExternalLink className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs text-muted-foreground mb-1">链接地址</p>
                                          <a
                                            href={details.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline break-all"
                                          >
                                            {details.url}
                                          </a>
                                        </div>
                                      </div>
                                    )}
                                    {details.statusCode && (
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline">{details.statusCode}</Badge>
                                        <span className="text-muted-foreground">HTTP状态码</span>
                                      </div>
                                    )}
                                    {details.errorMessage && (
                                      <Alert className="py-2">
                                        <AlertCircle className="h-3 w-3" />
                                        <AlertDescription className="text-xs">
                                          {details.errorMessage}
                                        </AlertDescription>
                                      </Alert>
                                    )}
                                    {details.finalUrl && details.finalUrl !== details.url && (
                                      <div className="flex items-start gap-2">
                                        <RefreshCw className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs text-muted-foreground mb-1">重定向至</p>
                                          <a
                                            href={details.finalUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline break-all"
                                          >
                                            {details.finalUrl}
                                          </a>
                                        </div>
                                      </div>
                                    )}
                                  </CardContent>
                                </Card>
                              )}

                              {/* 🆕 快捷操作按钮 - OAuth token过期等需要立即处理的警报 */}
                              {actionUrl && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => router.push(actionUrl)}
                                  className="w-full bg-blue-600 hover:bg-blue-700"
                                >
                                  <ArrowRight className="mr-2 h-4 w-4" />
                                  {details.actionRequired || '立即处理'}
                                </Button>
                              )}

                              <div className="space-y-3">
                                <Textarea
                                  placeholder="添加备注（可选）..."
                                  value={resolutionNote}
                                  onChange={(e) => setResolutionNote(e.target.value)}
                                  rows={2}
                                  className="resize-none"
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updateAlertStatus(alert.id, 'acknowledged', resolutionNote)}
                                    className="flex-1"
                                  >
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    已确认
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => updateAlertStatus(alert.id, 'resolved', resolutionNote)}
                                    className="flex-1 bg-green-600 hover:bg-green-700"
                                  >
                                    <X className="mr-2 h-4 w-4" />
                                    已解决
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                          className="flex-shrink-0"
                        >
                          {isExpanded ? '收起' : '详情'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* 空状态 - P1-4优化版 */}
      {alerts.length === 0 && (
        <Card className="border-green-200 bg-gradient-to-br from-green-50 to-green-100/50">
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <div className="flex justify-center">
                <div className="p-3 bg-green-100 rounded-full">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-green-900 mb-1">一切正常</h3>
                <p className="text-sm text-green-700">
                  当前没有活跃的风险提示。系统会每日自动检查链接并监控Campaign状态。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 链接检查结果弹窗 */}
      <AlertDialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-3 bg-blue-100 rounded-full">
                <LinkIcon className="h-6 w-6 text-blue-600" />
              </div>
              <AlertDialogTitle className="text-2xl">链接检查完成</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              已完成所有链接的可访问性检查
            </AlertDialogDescription>
          </AlertDialogHeader>

          {checkResult && (
            <div className="space-y-3 py-4">
              {/* 总计检查 */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <LinkIcon className="h-5 w-5 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">总计检查</span>
                </div>
                <span className="text-2xl font-bold text-gray-900">{checkResult.totalChecked}</span>
              </div>

              {/* 可访问 */}
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-3">
                  <CheckCheck className="h-5 w-5 text-green-600" />
                  <span className="text-sm font-medium text-green-700">可访问</span>
                </div>
                <span className="text-2xl font-bold text-green-600">{checkResult.accessible}</span>
              </div>

              {/* 失效 */}
              {checkResult.broken > 0 && (
                <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-5 w-5 text-red-600" />
                    <span className="text-sm font-medium text-red-700">失效</span>
                  </div>
                  <span className="text-2xl font-bold text-red-600">{checkResult.broken}</span>
                </div>
              )}

              {/* 重定向 */}
              {checkResult.redirected > 0 && (
                <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <div className="flex items-center gap-3">
                    <ArrowRight className="h-5 w-5 text-yellow-600" />
                    <span className="text-sm font-medium text-yellow-700">重定向</span>
                  </div>
                  <span className="text-2xl font-bold text-yellow-600">{checkResult.redirected}</span>
                </div>
              )}

              {/* 新提示 */}
              {checkResult.newAlerts > 0 && (
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">新增提示</span>
                  </div>
                  <span className="text-2xl font-bold text-blue-600">{checkResult.newAlerts}</span>
                </div>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <Button
              onClick={() => setShowResultDialog(false)}
              className="w-full"
            >
              确定
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
