'use client'

import { AlertTriangle, ExternalLink, Copy, CheckCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useState } from 'react'

interface ServiceAccountPermissionErrorProps {
  serviceAccountEmail: string
  mccCustomerId: string
  steps: string[]
  docsUrl?: string
  onDismiss?: () => void
}

export function ServiceAccountPermissionError({
  serviceAccountEmail,
  mccCustomerId,
  steps,
  docsUrl,
  onDismiss
}: ServiceAccountPermissionErrorProps) {
  const [copiedEmail, setCopiedEmail] = useState(false)
  const [copiedMccId, setCopiedMccId] = useState(false)

  const copyToClipboard = async (text: string, type: 'email' | 'mccId') => {
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'email') {
        setCopiedEmail(true)
        setTimeout(() => setCopiedEmail(false), 2000)
      } else {
        setCopiedMccId(true)
        setTimeout(() => setCopiedMccId(false), 2000)
      }
    } catch (err) {
      console.error('复制失败:', err)
    }
  }

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangle className="h-5 w-5" />
      <AlertTitle className="text-lg font-semibold">服务账号权限不足</AlertTitle>
      <AlertDescription className="mt-4 space-y-4">
        <div className="text-sm">
          <p className="font-medium mb-2">问题诊断：</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>服务账号只被添加到子账户，但未添加到MCC账户</li>
            <li>或服务账号在MCC账户中权限不足</li>
          </ul>
        </div>

        <Card className="bg-muted/50 border-muted">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">修复步骤</CardTitle>
            <CardDescription>按照以下步骤将服务账号添加到MCC账户</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 服务账号邮箱 */}
            <div className="flex items-center justify-between p-3 bg-background rounded-md border">
              <div className="flex-1 mr-2">
                <p className="text-xs text-muted-foreground mb-1">服务账号邮箱</p>
                <p className="text-sm font-mono break-all">{serviceAccountEmail}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(serviceAccountEmail, 'email')}
                className="shrink-0"
              >
                {copiedEmail ? (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 mr-1" />
                    复制
                  </>
                )}
              </Button>
            </div>

            {/* MCC账户ID */}
            <div className="flex items-center justify-between p-3 bg-background rounded-md border">
              <div className="flex-1 mr-2">
                <p className="text-xs text-muted-foreground mb-1">MCC账户ID</p>
                <p className="text-sm font-mono">{mccCustomerId}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(mccCustomerId, 'mccId')}
                className="shrink-0"
              >
                {copiedMccId ? (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 mr-1" />
                    复制
                  </>
                )}
              </Button>
            </div>

            {/* 操作步骤 */}
            <div className="space-y-2 pt-2">
              <p className="text-sm font-medium">操作步骤：</p>
              <ol className="space-y-2 text-sm">
                {steps.map((step, index) => (
                  <li key={index} className="flex">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0 mr-2">
                      {index + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* 打开Google Ads UI按钮 */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={() => window.open('https://ads.google.com', '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                打开 Google Ads UI
              </Button>
              {docsUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(docsUrl, '_blank')}
                >
                  查看文档
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-900">
          <div className="text-blue-600 dark:text-blue-400 mt-0.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="flex-1 text-sm text-blue-900 dark:text-blue-100">
            <p className="font-medium mb-1">提示</p>
            <p>保存权限配置后，请等待2-5分钟让Google同步权限，然后刷新此页面。</p>
          </div>
        </div>

        {onDismiss && (
          <div className="flex justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              我已了解
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
