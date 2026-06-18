'use client'

import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UrlSwapUrgentAlert } from '@/lib/url-swap/alerts'

interface UrlSwapUrgentBannerProps {
  alerts: UrlSwapUrgentAlert[]
  total: number
  onDismiss: () => void
}

export function UrlSwapUrgentBanner({ alerts, total, onDismiss }: UrlSwapUrgentBannerProps) {
  if (total <= 0 || alerts.length === 0) return null

  const primary = alerts[0]
  const extraCount = Math.max(0, total - 1)

  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-red-900">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">换链接任务出错（{total} 个启用中广告系列受影响）</p>
          <p className="mt-1 text-sm text-red-800">
            Offer「{primary.offerName}」：{primary.errorSummary}
            {extraCount > 0 ? `，另有 ${extraCount} 个任务待处理。` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/url-swap/${primary.taskId}`}
              className="inline-flex h-8 items-center rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700"
            >
              查看任务详情
            </Link>
            <Link
              href="/url-swap"
              className="inline-flex h-8 items-center rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-900 hover:bg-red-100"
            >
              全部换链接任务
            </Link>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-red-700 hover:bg-red-100 hover:text-red-900"
          onClick={onDismiss}
          aria-label="暂时关闭提醒"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
