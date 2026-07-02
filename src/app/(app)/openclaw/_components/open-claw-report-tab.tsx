'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { TrendChartDynamic } from '@/components/charts/dynamic'
import { KpiCard } from './form-controls'
import {
  REPORT_TREND_RANGE_OPTIONS,
} from '../constants'
import {
  formatMoneyWithUnit,
  parseLocalDate,
  shiftOpenclawLocalIsoDate,
} from '../utils'

import { useOpenClawPageContext } from '../openclaw-page-context'

export function OpenClawReportTab() {
  const {
  reportDate,
  setReportDate,
  reportStartDate,
  setReportStartDate,
  loading,
  handleSelectReportTrendRange,
  reportSummary,
  reportKpis,
  roiRevenueAvailable,
  usingAffiliateCommissionRevenue,
  affiliateRevenueBreakdown,
  reportRevenueCurrency,
  revenueTitle,
  reportRevenueValue,
  reportCostValue,
  reportRoasValue,
  reportRoiValue,
  reportProfitValue,
  roiUnavailableHint,
  topOfferRows,
  normalizedReportStartDateForTrend,
  normalizedReportDateForTrend,
  reportDateRangeDays,
  trendData,
  trendDescription,
  budgetOverall,
  budgetTotalValue,
  budgetSpentValue,
  budgetRemainingValue,
  reportRoiCostValue,
  topCampaigns,
  reportActions,
  reportActionCurrentPage,
  reportActionPageSize,
  setReportActionPage,
  setReportActionPageSize,
  reportActionPageSizeOptions,
  reportActionTotalPages,
  pagedReportActions,
  } = useOpenClawPageContext()

  return (
    <>
          <Card>
            <CardHeader>
              <CardTitle>每日报表</CardTitle>
              <CardDescription>统计数据 + 操作记录</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="space-y-2">
                  <label className="text-sm font-medium">报表日期范围</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={normalizedReportStartDateForTrend}
                      max={normalizedReportDateForTrend}
                      onChange={(e) => {
                        const nextStart = e.target.value
                        if (!nextStart) return
                        setReportStartDate(nextStart)
                        if (nextStart > reportDate) {
                          setReportDate(nextStart)
                        }
                      }}
                      className="w-[170px]"
                    />
                    <span className="text-xs text-slate-500">至</span>
                    <Input
                      type="date"
                      value={normalizedReportDateForTrend}
                      min={normalizedReportStartDateForTrend}
                      onChange={(e) => {
                        const nextEnd = e.target.value
                        if (!nextEnd) return
                        setReportDate(nextEnd)
                        if (nextEnd < reportStartDate) {
                          setReportStartDate(nextEnd)
                        }
                      }}
                      className="w-[170px]"
                    />
                  </div>
                  <div className="text-xs text-slate-500">已选择 {reportDateRangeDays} 天</div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">快捷区间</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {REPORT_TREND_RANGE_OPTIONS.map((option) => (
                      <Button
                        key={`report-range-${option.days}`}
                        type="button"
                        size="sm"
                        variant={
                          normalizedReportDateForTrend === parseLocalDate()
                          && normalizedReportStartDateForTrend === shiftOpenclawLocalIsoDate(parseLocalDate(), -(option.days - 1))
                            ? 'default'
                            : 'outline'
                        }
                        className="whitespace-nowrap"
                        onClick={() => handleSelectReportTrendRange(option.days)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              {loading && <span className="text-sm text-slate-500">加载中...</span>}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:auto-rows-fr md:grid-cols-4">
            <KpiCard title="Offer数" value={reportSummary.totalOffers ?? 0} />
            <KpiCard title="Campaign数" value={reportSummary.totalCampaigns ?? 0} />
            <KpiCard title={revenueTitle} value={reportRevenueValue} />
            <KpiCard title="ROAS" value={reportRoasValue} />
          </div>

          <div className="grid gap-4 md:auto-rows-fr md:grid-cols-4">
            <KpiCard title="曝光" value={reportKpis.current?.impressions ?? 0} />
            <KpiCard title="点击" value={reportKpis.current?.clicks ?? 0} />
            <KpiCard title="转化" value={reportKpis.current?.conversions ?? 0} />
            <KpiCard title="花费" value={reportCostValue} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>预算与消耗</CardTitle>
              <CardDescription>预算口径仅统计启用中 Campaign；花费口径覆盖全部有 performance 的 Campaign</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:auto-rows-fr md:grid-cols-5">
              <KpiCard title="总预算" value={budgetTotalValue} />
              <KpiCard title="全量花费" value={budgetSpentValue} />
              <KpiCard title="启用中剩余预算" value={budgetRemainingValue} />
              <KpiCard title="启用中预算使用率" value={`${budgetOverall.utilizationRate ?? 0}%`} />
              <KpiCard title="启用Campaign数" value={budgetOverall.activeCampaigns ?? 0} />
            </CardContent>
          </Card>

          <TrendChartDynamic
            data={trendData}
            metrics={[
              { key: 'impressions', label: '曝光', color: '#2563eb' },
              { key: 'clicks', label: '点击', color: '#16a34a' },
              { key: 'cost', label: '花费', color: '#f97316', yAxisId: 'right' },
              { key: 'commission', label: '佣金', color: '#9333ea', yAxisId: 'right' },
            ]}
            title="广告表现趋势"
            description={trendDescription}
            dualYAxis
            hideTimeRangeSelector
          />

          <Card>
            <CardHeader>
              <CardTitle>ROI / ROAS 分析</CardTitle>
              <CardDescription>
                {usingAffiliateCommissionRevenue
                  ? '收益口径：联盟平台佣金（PartnerBoost / YeahPromos，Campaign/Offer级）'
                  : '收益口径：联盟平台佣金（Campaign/Offer级，严格模式当前不可用）'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {usingAffiliateCommissionRevenue && affiliateRevenueBreakdown.length > 0 && (
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  平台拆分：
                  {affiliateRevenueBreakdown
                    .map((item) => `${item.platform || 'unknown'} ${formatMoneyWithUnit(item.totalCommission || 0, item.currency || reportRevenueCurrency)}（${item.records || 0}条）`)
                    .join(' | ')}
                </div>
              )}
              {!roiRevenueAvailable && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {roiUnavailableHint}
                </div>
              )}
              <div className="grid gap-4 md:auto-rows-fr md:grid-cols-5">
                <KpiCard title="花费" value={reportRoiCostValue} />
                <KpiCard title={revenueTitle} value={reportRevenueValue} />
                <KpiCard title="利润" value={reportProfitValue} />
                <KpiCard title="ROAS" value={reportRoasValue} />
                <KpiCard title="ROI" value={reportRoiValue} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Offer ROI Top 10</CardTitle>
              <CardDescription>收益口径：联盟佣金归因（未归因佣金将以 Unattributed 行展示）</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>Offer</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Campaigns</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>ROI</TableHead>
                    <TableHead>ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topOfferRows.map((offer: any) => {
                    const cost = Number(offer.cost) || 0
                    const revenue = Number(offer.revenue) || 0
                    const roasValue = offer.roas === null || offer.roas === undefined
                      ? (cost > 0 ? revenue / cost : null)
                      : Number(offer.roas)
                    const offerLabel = offer.offerName || `Offer #${offer.offerId}`
                    const roiValue = offer.roi === null || offer.roi === undefined
                      ? '—'
                      : `${Number(offer.roi).toFixed(2)}%`
                    const roasText = roasValue === null || !Number.isFinite(roasValue)
                      ? '—'
                      : `${roasValue.toFixed(2)}x`
                    return (
                      <TableRow key={offer.offerId}>
                        <TableCell>{offerLabel}</TableCell>
                        <TableCell>{offer.brand || '-'}</TableCell>
                        <TableCell>{offer.campaignCount ?? 0}</TableCell>
                        <TableCell>{revenue}</TableCell>
                        <TableCell>{cost}</TableCell>
                        <TableCell>{roiValue}</TableCell>
                        <TableCell>{roasText}</TableCell>
                      </TableRow>
                    )
                  })}
                  {topOfferRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500">
                        暂无Offer数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Campaign Top 5</CardTitle>
              <CardDescription>按佣金收入排序（未归因佣金将单列展示）</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>点击</TableHead>
                    <TableHead>花费</TableHead>
                    <TableHead>佣金</TableHead>
                    <TableHead>ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCampaigns.map((campaign: any) => (
                    <TableRow key={campaign.campaignId}>
                      <TableCell>{campaign.campaignName}</TableCell>
                      <TableCell>{campaign.status}</TableCell>
                      <TableCell>{campaign.clicks ?? 0}</TableCell>
                      <TableCell>{campaign.cost ?? 0}</TableCell>
                      <TableCell>{campaign.revenue ?? 0}</TableCell>
                      <TableCell>
                        {campaign.roas === null || campaign.roas === undefined
                          ? '—'
                          : `${Number(campaign.roas).toFixed(2)}x`}
                      </TableCell>
                    </TableRow>
                  ))}
                  {topCampaigns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500">
                        暂无数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>操作记录</CardTitle>
              <CardDescription>OpenClaw 调用 AutoAds 的操作日志</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedReportActions.map((action: any) => (
                    <TableRow key={action.id}>
                      <TableCell>{action.created_at}</TableCell>
                      <TableCell>{action.action}</TableCell>
                      <TableCell>{action.target_type} {action.target_id}</TableCell>
                      <TableCell>
                        <Badge variant={action.status === 'success' ? 'default' : 'destructive'}>
                          {action.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {reportActions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        暂无操作记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {reportActionTotalPages > 0 && (
                <div className="mt-4 border-t px-1 pt-4">
                  <ResponsivePagination
                    currentPage={reportActionCurrentPage}
                    totalPages={reportActionTotalPages}
                    totalItems={reportActions.length}
                    pageSize={reportActionPageSize}
                    onPageChange={setReportActionPage}
                    onPageSizeChange={setReportActionPageSize}
                    pageSizeOptions={reportActionPageSizeOptions}
                  />
                </div>
              )}
            </CardContent>
          </Card>

    </>
  )
}
