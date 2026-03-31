'use client'

/**
 * Creative合规性检查UI组件
 *
 * 功能：
 * 1. 自动检测创意内容是否符合Google Ads政策
 * 2. 显示违规项列表（按严重程度分类）
 * 3. 提供修正建议
 * 4. 一键自动修复（部分规则）
 */

import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, AlertTriangle, Info, Loader2, Wand2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { ComplianceCheckResult, ComplianceIssue } from '@/lib/compliance-checker'

interface ComplianceCheckerProps {
  creativeId: number
  onAutoFix?: (issues: ComplianceIssue[]) => void
  autoCheck?: boolean // 是否自动检查
}

export default function ComplianceChecker({
  creativeId,
  onAutoFix,
  autoCheck = false
}: ComplianceCheckerProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ComplianceCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 执行合规性检查
  const checkCompliance = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/creatives/${creativeId}/check-compliance`, {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error('Compliance check failed')
      }

      const data = await response.json()
      setResult(data)
    } catch (err) {
      console.error('Compliance check error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // 自动检查（如果启用）
  useEffect(() => {
    if (autoCheck) {
      checkCompliance()
    }
  }, [creativeId, autoCheck])

  // 严重程度配置
  const severityConfig = {
    high: {
      icon: AlertCircle,
      color: 'text-red-500',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      label: '严重'
    },
    medium: {
      icon: AlertTriangle,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      label: '中等'
    },
    low: {
      icon: Info,
      color: 'text-blue-500',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      label: '轻微'
    }
  }

  // 字段名称映射
  const fieldNameMap = {
    headline: '标题',
    description: '描述',
    url: '着陆页URL',
    general: '全局'
  }

  // 按严重程度分组
  const groupedIssues = result ? {
    high: result.issues.filter(i => i.severity === 'high'),
    medium: result.issues.filter(i => i.severity === 'medium'),
    low: result.issues.filter(i => i.severity === 'low')
  } : null

  // 处理一键修复
  const handleAutoFix = () => {
    if (result && onAutoFix) {
      // 筛选可自动修复的问题
      const fixableIssues = result.issues.filter(issue =>
        ['R_EXCESSIVE_CAPS', 'R_REPEATED_PUNCTUATION', 'R_EXCESSIVE_EXCLAMATION'].includes(issue.ruleId)
      )
      onAutoFix(fixableIssues)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">合规性检查</CardTitle>
            <CardDescription>
              检测内容是否符合Google Ads广告政策
            </CardDescription>
          </div>
          <Button
            onClick={checkCompliance}
            disabled={loading}
            size="sm"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? '检查中...' : '重新检查'}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>检查失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-3 text-sm text-gray-500">正在检查合规性...</span>
          </div>
        )}

        {!loading && result && (
          <>
            {/* 总体状态 */}
            <Alert
              variant={result.isCompliant ? 'default' : 'destructive'}
              className="mb-6"
            >
              {result.isCompliant ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle>
                {result.isCompliant ? '通过检查 ✓' : '发现违规问题'}
              </AlertTitle>
              <AlertDescription>
                {result.isCompliant ? (
                  '创意内容符合Google Ads广告政策要求'
                ) : (
                  `共发现 ${result.totalIssues} 个问题：${result.highSeverityCount} 个严重、${result.mediumSeverityCount} 个中等、${result.lowSeverityCount} 个轻微`
                )}
              </AlertDescription>
            </Alert>

            {/* 一键修复按钮 */}
            {!result.isCompliant && onAutoFix && (
              <div className="mb-6">
                <Button
                  onClick={handleAutoFix}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <Wand2 className="mr-2 h-4 w-4" />
                  一键自动修复（部分问题）
                </Button>
                <p className="mt-2 text-xs text-gray-500">
                  * 自动修复：大写格式、重复标点、过多感叹号
                </p>
              </div>
            )}

            {/* 违规项列表 */}
            {!result.isCompliant && groupedIssues && (
              <div className="space-y-4">
                {/* 严重问题 */}
                {groupedIssues.high.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="destructive">严重</Badge>
                      <span className="text-sm text-gray-600">
                        {groupedIssues.high.length} 个问题（必须修复）
                      </span>
                    </div>
                    <div className="space-y-3">
                      {groupedIssues.high.map((issue, idx) => (
                        <IssueCard
                          key={`high-${idx}`}
                          issue={issue}
                          config={severityConfig.high}
                          fieldNameMap={fieldNameMap}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {groupedIssues.high.length > 0 && groupedIssues.medium.length > 0 && (
                  <Separator />
                )}

                {/* 中等问题 */}
                {groupedIssues.medium.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="default" className="bg-yellow-500">中等</Badge>
                      <span className="text-sm text-gray-600">
                        {groupedIssues.medium.length} 个问题（建议修复）
                      </span>
                    </div>
                    <div className="space-y-3">
                      {groupedIssues.medium.map((issue, idx) => (
                        <IssueCard
                          key={`medium-${idx}`}
                          issue={issue}
                          config={severityConfig.medium}
                          fieldNameMap={fieldNameMap}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {groupedIssues.medium.length > 0 && groupedIssues.low.length > 0 && (
                  <Separator />
                )}

                {/* 轻微问题 */}
                {groupedIssues.low.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="border-blue-500 text-blue-500">
                        轻微
                      </Badge>
                      <span className="text-sm text-gray-600">
                        {groupedIssues.low.length} 个问题（可选修复）
                      </span>
                    </div>
                    <div className="space-y-3">
                      {groupedIssues.low.map((issue, idx) => (
                        <IssueCard
                          key={`low-${idx}`}
                          issue={issue}
                          config={severityConfig.low}
                          fieldNameMap={fieldNameMap}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!loading && !result && !error && (
          <div className="py-8 text-center">
            <Info className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              点击"重新检查"按钮开始合规性检查
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * 单个违规项卡片组件
 */
interface IssueCardProps {
  issue: ComplianceIssue
  config: {
    icon: any
    color: string
    bgColor: string
    borderColor: string
    label: string
  }
  fieldNameMap: Record<string, string>
}

function IssueCard({ issue, config, fieldNameMap }: IssueCardProps) {
  const Icon = config.icon

  return (
    <div
      className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${config.color}`} />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{issue.ruleName}</span>
            <Badge variant="outline" className="text-xs">
              {fieldNameMap[issue.field]}
              {issue.fieldIndex !== undefined && ` ${issue.fieldIndex + 1}`}
            </Badge>
          </div>

          <p className="text-sm text-gray-700">{issue.message}</p>

          {issue.violatingText && (
            <div className="rounded bg-white/50 p-2">
              <p className="text-xs text-gray-500">违规内容：</p>
              <p className="mt-1 text-sm font-mono text-gray-900">
                "{issue.violatingText}"
              </p>
            </div>
          )}

          {issue.suggestion && (
            <div className="flex items-start gap-2 rounded bg-white/50 p-2">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
              <div>
                <p className="text-xs text-gray-500">修正建议：</p>
                <p className="mt-1 text-sm text-gray-700">{issue.suggestion}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
