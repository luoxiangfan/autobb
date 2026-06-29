'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Link2 } from 'lucide-react'
import type { UrlSwapSitelinkTarget } from '@/lib/url-swap/url-swap-types'

interface UrlSwapSitelinkTargetsSectionProps {
  sitelinkTargets: UrlSwapSitelinkTarget[]
  formatDateTime: (dateValue: string | null) => string
}

function getSitelinkStatusBadge(status: UrlSwapSitelinkTarget['status']) {
  const configs: Record<
    UrlSwapSitelinkTarget['status'],
    {
      label: string
      variant: 'default' | 'secondary' | 'destructive' | 'outline'
      className: string
    }
  > = {
    active: { label: '启用', variant: 'default', className: 'bg-green-600' },
    invalid: { label: '无效', variant: 'destructive', className: '' },
    removed: { label: '已移除', variant: 'outline', className: 'text-gray-500' },
  }

  const config = configs[status] || { label: status, variant: 'outline' as const, className: '' }

  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  )
}

function truncateLink(link: string, maxLength = 48): string {
  if (link.length <= maxLength) return link
  return `${link.slice(0, maxLength)}…`
}

export default function UrlSwapSitelinkTargetsSection({
  sitelinkTargets,
  formatDateTime,
}: UrlSwapSitelinkTargetsSectionProps) {
  const activeCount = sitelinkTargets.filter((t) => t.status === 'active').length
  const invalidCount = sitelinkTargets.filter((t) => t.status === 'invalid').length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          Sitelink 子目标
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sitelinkTargets.length === 0 ? (
          <div className="text-sm text-gray-500 space-y-1">
            <p>暂无 Sitelink 映射。</p>
            <p className="text-xs">
              Store 类型 Offer 需配置商品推广链接（store_product_links）。Campaign 已发布 Sitelink
              时，创建换链任务后会自动从 Google Ads 同步映射；若仍为空，请确认远端 Campaign 已有
              Sitelink 或重新发布 Sitelink。
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span>子目标数：{sitelinkTargets.length}</span>
              <span className="text-green-700">启用 {activeCount}</span>
              {invalidCount > 0 && <span className="text-red-600">无效 {invalidCount}</span>}
            </div>
            <div className="border rounded-lg divide-y bg-white overflow-x-auto">
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(5,minmax(0,1fr))] gap-3 px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 min-w-[720px]">
                <span>链接文案 / 推广链接</span>
                <span>Asset ID</span>
                <span>当前 Suffix</span>
                <span>状态</span>
                <span>连续失败</span>
                <span>最近成功</span>
              </div>
              {sitelinkTargets.map((target) => (
                <div
                  key={target.id}
                  className="grid grid-cols-[minmax(0,1fr)_repeat(5,minmax(0,1fr))] gap-3 px-4 py-3 text-sm min-w-[720px]"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate" title={target.link_text}>
                      {target.link_text || `#${target.sort_index + 1}`}
                    </p>
                    <p
                      className="text-xs text-gray-500 break-all mt-0.5"
                      title={target.affiliate_link}
                    >
                      {truncateLink(target.affiliate_link, 56)}
                    </p>
                    {target.last_error && (
                      <p className="text-xs text-red-600 break-all mt-1" title={target.last_error}>
                        {truncateLink(target.last_error, 80)}
                      </p>
                    )}
                  </div>
                  <div className="font-mono text-xs break-all">{target.asset_id}</div>
                  <div className="text-xs break-all text-gray-700">
                    {target.current_final_url_suffix || '-'}
                  </div>
                  <div>{getSitelinkStatusBadge(target.status)}</div>
                  <div className="font-medium">{target.consecutive_failures}</div>
                  <div className="text-xs">{formatDateTime(target.last_success_at)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
