'use client'

import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type ProductPlatform = 'yeahpromos' | 'partnerboost'

type SyncRunItem = {
  id: number
  platform: ProductPlatform
  mode: 'platform' | 'single' | 'delta' | string
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

type SyncHistoryRow = {
  key: string
  label: string
  runs: SyncRunItem[]
  emptyText: string
}

type SyncHourlyStatItem = {
  hourBucket: string
  fetchedCount: number
  cumulativeFetched: number
  sampleCount: number
}

type YeahPromosSyncMonitorItem = {
  runId: number | null
  runStatus: string | null
  targetItems: number | null
  fetchedItems: number
  remainingItems: number | null
  avgItemsPerHour: number | null
  etaAt: string | null
  statsUpdatedAt: string | null
  hourlyStats: SyncHourlyStatItem[]
}

interface ProductsSyncInsightsSectionProps {
  syncHistoryRows: SyncHistoryRow[]
  ypSyncMonitor: YeahPromosSyncMonitorItem
  platformShortLabels: Record<ProductPlatform, string>
  getSyncRunStatusIcon: (status: string) => LucideIcon
  getSyncRunBadgeVariant: (status: string) => React.ComponentProps<typeof Badge>['variant']
  getSyncRunProgressText: (run: SyncRunItem) => string
  getSyncRunMetricsText: (run: SyncRunItem) => string
  getSyncRunStartedAtText: (run: SyncRunItem) => string
  formatIntegerCount: (value: number | null) => string
  formatSyncRunDateTime: (value: string | null) => string
  formatHourBucket: (value: string) => string
}

export default function ProductsSyncInsightsSection({
  syncHistoryRows,
  ypSyncMonitor,
  platformShortLabels,
  getSyncRunStatusIcon,
  getSyncRunBadgeVariant,
  getSyncRunProgressText,
  getSyncRunMetricsText,
  getSyncRunStartedAtText,
  formatIntegerCount,
  formatSyncRunDateTime,
  formatHourBucket,
}: ProductsSyncInsightsSectionProps) {
  const hasRecentRuns = syncHistoryRows.some((row) => row.runs.length > 0)
  const hasYpMonitor = ypSyncMonitor.runId !== null || ypSyncMonitor.targetItems !== null

  return (
    <>
      {hasRecentRuns && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">最近同步任务</CardTitle>
            <CardDescription>按同步模式分组展示历史任务（各最多 4 条）</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {syncHistoryRows.map((row) => (
                <div
                  key={row.key}
                  className="rounded-md border px-3 py-2 text-xs [content-visibility:auto] [contain-intrinsic-size:180px]"
                >
                  <div className="mb-2 font-medium">{row.label}</div>
                  {row.runs.length === 0 ? (
                    <div className="text-muted-foreground">{row.emptyText}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {row.runs.map((run) => {
                        const StatusIcon = getSyncRunStatusIcon(run.status)
                        return (
                          <div key={run.id} className="rounded-md border px-2 py-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="font-medium">
                                {platformShortLabels[run.platform]} #{run.id}
                              </span>
                              <Badge variant={getSyncRunBadgeVariant(run.status)}>
                                <StatusIcon className="mr-1 h-3 w-3" />
                                {run.status}
                              </Badge>
                            </div>
                            <div className="text-muted-foreground">{getSyncRunProgressText(run)}</div>
                            <div className="text-muted-foreground">{getSyncRunMetricsText(run)}</div>
                            <div className="text-muted-foreground">开始时间 {getSyncRunStartedAtText(run)}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {hasYpMonitor && (
        <Card>
          <details>
            <summary className="cursor-pointer px-6 py-4">
              <span className="text-base font-semibold">YP 同步 ETA 监控</span>
              <p className="mt-1 text-sm text-muted-foreground">
                基于每小时抓取快照估算完成时间，按跨天连续抓取模型计算。
              </p>
            </summary>
            <CardContent className="space-y-3 pt-0 [content-visibility:auto] [contain-intrinsic-size:360px]">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">运行任务</div>
                  <div className="mt-1 text-sm font-medium">
                    {ypSyncMonitor.runId ? `#${ypSyncMonitor.runId}` : '-'}
                    {ypSyncMonitor.runStatus ? ` · ${ypSyncMonitor.runStatus}` : ''}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">目标商品量</div>
                  <div className="mt-1 text-sm font-medium">
                    {formatIntegerCount(ypSyncMonitor.targetItems)}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">已抓取</div>
                  <div className="mt-1 text-sm font-medium">
                    {formatIntegerCount(ypSyncMonitor.fetchedItems)}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">近小时均速</div>
                  <div className="mt-1 text-sm font-medium">
                    {ypSyncMonitor.avgItemsPerHour !== null
                      ? `${formatIntegerCount(Math.round(ypSyncMonitor.avgItemsPerHour))} /小时`
                      : '-'}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">预计完成时间</div>
                  <div className="mt-1 text-sm font-medium">
                    {formatSyncRunDateTime(ypSyncMonitor.etaAt)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>剩余 {formatIntegerCount(ypSyncMonitor.remainingItems)}</span>
                <span>数据更新时间 {formatSyncRunDateTime(ypSyncMonitor.statsUpdatedAt)}</span>
              </div>

              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-xs font-medium">每小时抓取统计（最近 12 小时）</div>
                {ypSyncMonitor.hourlyStats.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    暂无小时级抓取快照，任务运行后会自动生成。
                  </div>
                ) : (
                  <div className="max-h-64 overflow-auto px-3 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-2 font-medium">小时</th>
                          <th className="py-1 pr-2 font-medium">本小时新增</th>
                          <th className="py-1 pr-2 font-medium">累计抓取</th>
                          <th className="py-1 font-medium">采样点</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ypSyncMonitor.hourlyStats].slice(-12).reverse().map((stat) => (
                          <tr key={stat.hourBucket} className="border-t">
                            <td className="py-1 pr-2">{formatHourBucket(stat.hourBucket)}</td>
                            <td className="py-1 pr-2">{formatIntegerCount(stat.fetchedCount)}</td>
                            <td className="py-1 pr-2">{formatIntegerCount(stat.cumulativeFetched)}</td>
                            <td className="py-1">{formatIntegerCount(stat.sampleCount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </details>
        </Card>
      )}
    </>
  )
}
