'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MeasuredResponsiveContainer } from '@/components/ui/chart'
import {
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { showError, showSuccess } from '@/lib/common'
import { formatCurrency as formatCurrencyDashboard } from '@/lib/common'
import { buildOverallRoasStatistics } from './build-overall-roas-statistics'
import { buildOverallRoasImageDataUrl } from './export-overall-roas-image'
import {
  anonymizeCampaignName,
  formatPercentNumber,
  formatRoasNumber,
  roundTo2,
} from './campaign-metrics-utils'
import type { Campaign, CampaignRoasRankItem, OverallRoasStatistics } from './types'

export type CampaignOverallRoasDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedCampaignCount: number
  timeRangeLabel: string
  summaryDisplayCurrency: string
  loadSelectedCampaigns: () => Promise<Campaign[]>
}

const PREVIEW_PANEL_CLASS = 'rounded-2xl border border-[#dbeafe] bg-white shadow-xs'
const CHART_HEIGHT = 260
const PREVIEW_PANEL_BODY_CLASS = 'p-5 lg:p-6'
const PREVIEW_SECTION_TITLE_CLASS = 'text-sm font-semibold text-slate-800'
const PREVIEW_SECTION_HINT_CLASS = 'mt-1 text-xs text-slate-500'
const CHART_PALETTE = ['#2563eb', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6']

export function CampaignOverallRoasDialog({
  open,
  onOpenChange,
  selectedCampaignCount,
  timeRangeLabel,
  summaryDisplayCurrency,
  loadSelectedCampaigns,
}: CampaignOverallRoasDialogProps) {
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<OverallRoasStatistics | null>(null)
  const [hideBrandNames, setHideBrandNames] = useState(false)

  const resetState = useCallback(() => {
    setError(null)
    setLoading(false)
    setStats(null)
  }, [])

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    setStats(null)
    try {
      const selectedCampaigns = await loadSelectedCampaigns()
      if (selectedCampaigns.length < 2) {
        setError('至少选择 2 个广告系列后才能计算整体 ROAS。')
        return
      }
      setStats(
        buildOverallRoasStatistics({
          selectedCampaigns,
          timeRangeLabel,
          summaryDisplayCurrency,
        })
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'UNAUTHORIZED') return
      setError(err instanceof Error ? err.message : '计算整体 ROAS 失败')
    } finally {
      setLoading(false)
    }
  }, [loadSelectedCampaigns, summaryDisplayCurrency, timeRangeLabel])

  useEffect(() => {
    if (!open) return
    void loadStats()
  }, [open, loadStats])

  const getCampaignDisplayName = useCallback(
    (campaign: CampaignRoasRankItem): string => {
      if (!hideBrandNames) return campaign.campaignName
      return anonymizeCampaignName(campaign.campaignName)
    },
    [hideBrandNames]
  )

  const rankTrendData = useMemo(() => {
    if (!stats) return []
    return [...stats.campaigns]
      .filter((item) => item.roas !== null)
      .sort((a, b) => Number(b.roas) - Number(a.roas))
      .slice(0, 8)
      .map((item, index) => ({
        rank: `#${index + 1}`,
        campaignName: getCampaignDisplayName(item),
        roas: Number(item.roas || 0),
        spend: roundTo2(item.spend),
        commission: roundTo2(item.commission),
      }))
  }, [getCampaignDisplayName, stats])

  const spendShareData = useMemo(() => {
    if (!stats) return []
    const sortedBySpend = [...stats.campaigns].sort((a, b) => b.spend - a.spend)
    const top = sortedBySpend.slice(0, 5).map((item) => ({
      name: getCampaignDisplayName(item),
      value: roundTo2(item.spend),
    }))
    const otherTotal = sortedBySpend.slice(5).reduce((sum, item) => sum + item.spend, 0)
    if (otherTotal > 0) {
      top.push({
        name: hideBrandNames ? '其他品牌' : '其他广告系列',
        value: roundTo2(otherTotal),
      })
    }
    return top
  }, [getCampaignDisplayName, hideBrandNames, stats])

  const shareHeadline = useMemo(() => {
    if (!stats) return ''
    const best = stats.bestTop3[0]
    const worst = stats.worstBottom3[0]
    if (best && best.roas !== null) {
      const bestName = getCampaignDisplayName(best)
      const bestRoas = formatRoasNumber(best.roas)
      const totalRoas = formatRoasNumber(stats.totalRoas)
      const ctr = formatPercentNumber(stats.averageCtr)
      if (worst && worst.roas !== null) {
        return `亮点：${bestName} ROAS 达 ${bestRoas}，显著领先尾部系列，拉动整体 ROAS 至 ${totalRoas}（平均点击率 ${ctr}）。`
      }
      return `亮点：${bestName} ROAS 达 ${bestRoas}，整体 ROAS 为 ${totalRoas}（平均点击率 ${ctr}）。`
    }
    return `本周期覆盖 ${stats.campaignCount} 个广告系列，总花费 ${formatCurrencyDashboard(stats.totalSpend, stats.currency)}，建议补齐转化归因后再进行扩量决策。`
  }, [getCampaignDisplayName, stats])

  const metricCards = useMemo(() => {
    if (!stats) return []
    return [
      {
        title: `总花费(${stats.currency})`,
        value: formatCurrencyDashboard(stats.totalSpend, stats.currency),
      },
      {
        title: `总佣金(${stats.currency})`,
        value: formatCurrencyDashboard(stats.totalCommission, stats.currency),
      },
      { title: '总 ROAS', value: formatRoasNumber(stats.totalRoas) },
      {
        title: `平均实际 CPC(${stats.currency})`,
        value:
          stats.avgActualCpc === null
            ? '--'
            : formatCurrencyDashboard(stats.avgActualCpc, stats.currency),
      },
      { title: '总展示', value: stats.totalImpressions.toLocaleString('zh-CN') },
      { title: '总点击', value: stats.totalClicks.toLocaleString('zh-CN') },
      { title: '平均点击率', value: formatPercentNumber(stats.averageCtr) },
      { title: '广告系列数量', value: `${stats.campaignCount}` },
    ]
  }, [stats])

  const spendShareTotal = useMemo(
    () => spendShareData.reduce((sum, entry) => sum + Number(entry.value || 0), 0),
    [spendShareData]
  )

  const handleDownloadImage = () => {
    if (!stats || downloading) return
    setDownloading(true)
    try {
      const dataUrl = buildOverallRoasImageDataUrl(stats, { hideBrandNames })
      const link = document.createElement('a')
      const filenameTs = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      link.href = dataUrl
      link.download = `campaigns-overall-roas-${filenameTs}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      showSuccess('下载成功', '统计图片已保存')
    } catch (err: unknown) {
      showError('下载失败', err instanceof Error ? err.message : '生成图片失败')
    } finally {
      setDownloading(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) resetState()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="wide" className="flex h-[96vh] max-h-[96vh] flex-col overflow-hidden">
        <DialogHeader className="gap-4 border-b border-slate-200 bg-white px-5 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1.5">
              <DialogTitle className="text-xl text-slate-900">
                广告系列整体 ROAS 社交战报
              </DialogTitle>
              <DialogDescription className="space-y-1 text-sm leading-6 text-slate-600">
                <span className="block">
                  分析范围：{timeRangeLabel}，已选广告系列 {selectedCampaignCount} 个
                </span>
                {stats && !loading && !error ? (
                  <span className="block">最近生成：{stats.generatedAt}</span>
                ) : null}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant={hideBrandNames ? 'default' : 'outline'}
              onClick={() => setHideBrandNames((prev) => !prev)}
            >
              {hideBrandNames ? '显示品牌名' : '隐藏品牌名'}
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-gray-600">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              正在汇总选中广告系列数据...
            </div>
          ) : error ? (
            <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 sm:m-6 lg:m-8">
              <p>{error}</p>
              <Button
                variant="outline"
                className="mt-3 border-red-200 bg-white hover:bg-red-100"
                onClick={() => void loadStats()}
              >
                重新计算
              </Button>
            </div>
          ) : stats ? (
            <div className="bg-slate-50 px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5">
              <div className="mx-auto max-w-[960px] overflow-hidden rounded-2xl border border-blue-200 bg-[#eef5ff] shadow-[0_12px_32px_rgba(15,23,42,0.10)]">
                <div className="bg-linear-to-r from-[#0b1220] via-[#1d4ed8] to-[#0369a1] px-4 py-5 text-white sm:px-5 sm:py-6 lg:px-6 lg:py-7">
                  <div className="flex min-h-[112px] flex-col justify-between gap-4 lg:min-h-[120px]">
                    <div className="space-y-2">
                      <h3 className="text-[24px] font-bold leading-tight tracking-tight sm:text-[28px] lg:text-[32px]">
                        广告系列整体 ROAS 社交战报
                      </h3>
                      <div className="space-y-0.5 text-[12px] leading-5 text-blue-100 sm:text-[13px]">
                        <p>
                          {timeRangeLabel} | {stats.generatedAt}
                        </p>
                        <p>统计币种：{stats.currency}</p>
                      </div>
                    </div>
                    <div className="flex items-end justify-end">
                      {hideBrandNames ? (
                        <div className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold tracking-[0.12em] text-blue-50">
                          已隐藏品牌名
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5">
                  <div className={`${PREVIEW_PANEL_CLASS} p-5`}>
                    <p className="text-sm font-semibold text-[#1e3a8a]">一句话结论</p>
                    <p className="mt-2 text-sm font-medium leading-7 text-slate-700 lg:text-base">
                      {shareHeadline}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    {metricCards.map((card) => (
                      <div
                        key={card.title}
                        className={`${PREVIEW_PANEL_CLASS} min-h-[100px] px-4 py-3`}
                      >
                        <p className="text-sm text-slate-500">{card.title}</p>
                        <p className="mt-1.5 text-[24px] font-semibold leading-none tracking-tight text-slate-950">
                          {card.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className={PREVIEW_PANEL_CLASS}>
                    <div className={`${PREVIEW_PANEL_BODY_CLASS} pb-4`}>
                      <p className={PREVIEW_SECTION_TITLE_CLASS}>ROAS 排名趋势（Top 8）</p>
                      <p className={PREVIEW_SECTION_HINT_CLASS}>
                        预览结构与导出图保持一致，突出头部系列 ROAS 排名
                      </p>
                    </div>
                    {open && rankTrendData.length > 0 ? (
                      <MeasuredResponsiveContainer
                        height={CHART_HEIGHT}
                        className="px-2 pb-4 sm:px-4 lg:px-5"
                      >
                        <ComposedChart
                          data={rankTrendData}
                          margin={{ top: 32, right: 24, bottom: 16, left: 8 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                          <XAxis
                            dataKey="rank"
                            stroke="#64748b"
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            stroke="#334155"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value: number) => `${Number(value || 0).toFixed(1)}x`}
                          />
                          <RechartsTooltip
                            contentStyle={{ borderRadius: 12, borderColor: '#dbeafe' }}
                            formatter={(value) => [formatRoasNumber(Number(value ?? 0)), 'ROAS']}
                            labelFormatter={(_label, payload) =>
                              payload?.[0]?.payload?.campaignName || '--'
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="roas"
                            stroke="#1d4ed8"
                            strokeWidth={3}
                            dot={{ r: 4, fill: '#ffffff', strokeWidth: 2 }}
                            activeDot={{ r: 6 }}
                          >
                            <LabelList
                              dataKey="roas"
                              position="top"
                              offset={12}
                              formatter={(value) => `${Number(value ?? 0).toFixed(2)}x`}
                              className="fill-slate-700 text-[11px]"
                            />
                          </Line>
                        </ComposedChart>
                      </MeasuredResponsiveContainer>
                    ) : (
                      <p className="py-20 text-center text-sm text-slate-500">
                        暂无可绘制的 ROAS 趋势数据
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_420px]">
                    <div className={PREVIEW_PANEL_CLASS}>
                      <div className={PREVIEW_PANEL_BODY_CLASS}>
                        <p className={PREVIEW_SECTION_TITLE_CLASS}>花费占比结构（Top 5 + 其他）</p>
                        <p className={PREVIEW_SECTION_HINT_CLASS}>
                          预览与导出图一致，强调主要花费集中度和构成
                        </p>
                      </div>
                      {open && spendShareData.length > 0 ? (
                        <div className="grid gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center lg:px-5">
                          <MeasuredResponsiveContainer height={CHART_HEIGHT}>
                            <PieChart>
                              <Pie
                                data={spendShareData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={100}
                                paddingAngle={2}
                              >
                                {spendShareData.map((_, index) => (
                                  <Cell
                                    key={`share-${index}`}
                                    fill={CHART_PALETTE[index % CHART_PALETTE.length]}
                                  />
                                ))}
                              </Pie>
                              <RechartsTooltip
                                formatter={(value) =>
                                  formatCurrencyDashboard(Number(value ?? 0), stats.currency)
                                }
                              />
                            </PieChart>
                          </MeasuredResponsiveContainer>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                            {spendShareData.map((entry, index) => (
                              <div
                                key={`legend-${entry.name}-${index}`}
                                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 shadow-xs"
                              >
                                <div className="flex items-center gap-2 text-sm text-slate-700">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{
                                      backgroundColor: CHART_PALETTE[index % CHART_PALETTE.length],
                                    }}
                                  />
                                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                                  <span className="text-slate-500">
                                    {spendShareTotal > 0
                                      ? `${((Number(entry.value) / spendShareTotal) * 100).toFixed(1)}%`
                                      : '0%'}
                                  </span>
                                  <span className="font-semibold text-slate-900">
                                    {formatCurrencyDashboard(Number(entry.value), stats.currency)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="py-20 text-center text-sm text-slate-500">
                          暂无可绘制的花费占比数据
                        </p>
                      )}
                    </div>

                    <div
                      className={`${PREVIEW_PANEL_CLASS} min-h-[280px] ${PREVIEW_PANEL_BODY_CLASS}`}
                    >
                      <p className={PREVIEW_SECTION_TITLE_CLASS}>CPC 极值洞察</p>
                      <div className="mt-4 space-y-4">
                        <div>
                          <p className="text-sm text-slate-500">最高实际 CPC</p>
                          {stats.highestActualCpc ? (
                            <>
                              <p className="mt-2 text-base font-semibold text-slate-900">
                                {getCampaignDisplayName(stats.highestActualCpc)}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-indigo-600">
                                {formatCurrencyDashboard(
                                  Number(stats.highestActualCpc.actualCpc || 0),
                                  stats.currency
                                )}
                              </p>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-slate-500">暂无可计算的实际 CPC 数据</p>
                          )}
                        </div>
                        <div>
                          <p className="text-sm text-slate-500">最低实际 CPC</p>
                          {stats.lowestActualCpc ? (
                            <>
                              <p className="mt-2 text-base font-semibold text-slate-900">
                                {getCampaignDisplayName(stats.lowestActualCpc)}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-emerald-600">
                                {formatCurrencyDashboard(
                                  Number(stats.lowestActualCpc.actualCpc || 0),
                                  stats.currency
                                )}
                              </p>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-slate-500">暂无可计算的实际 CPC 数据</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div
                      className={`${PREVIEW_PANEL_CLASS} min-h-[286px] ${PREVIEW_PANEL_BODY_CLASS}`}
                    >
                      <p className={`mb-4 ${PREVIEW_SECTION_TITLE_CLASS}`}>Top 3 优秀广告系列</p>
                      {stats.bestTop3.length > 0 ? (
                        <div className="space-y-3">
                          {stats.bestTop3.map((item, index) => (
                            <div
                              key={`best-${item.id}`}
                              className="rounded-xl bg-slate-50 px-4 py-3"
                            >
                              <p className="text-sm font-semibold text-slate-900">
                                {index + 1}. {getCampaignDisplayName(item)}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                ROAS {formatRoasNumber(item.roas)} | 花费{' '}
                                {formatCurrencyDashboard(item.spend, stats.currency)} | 佣金{' '}
                                {formatCurrencyDashboard(item.commission, stats.currency)}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">暂无可计算 ROAS 的广告系列</p>
                      )}
                    </div>
                    <div
                      className={`${PREVIEW_PANEL_CLASS} min-h-[286px] ${PREVIEW_PANEL_BODY_CLASS}`}
                    >
                      <p className={`mb-4 ${PREVIEW_SECTION_TITLE_CLASS}`}>
                        Bottom 3 待优化广告系列
                      </p>
                      {stats.worstBottom3.length > 0 ? (
                        <div className="space-y-3">
                          {stats.worstBottom3.map((item, index) => (
                            <div
                              key={`worst-${item.id}`}
                              className="rounded-xl bg-slate-50 px-4 py-3"
                            >
                              <p className="text-sm font-semibold text-slate-900">
                                {index + 1}. {getCampaignDisplayName(item)}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                ROAS {formatRoasNumber(item.roas)} | 花费{' '}
                                {formatCurrencyDashboard(item.spend, stats.currency)} | 佣金{' '}
                                {formatCurrencyDashboard(item.commission, stats.currency)}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">暂无可计算 ROAS 的广告系列</p>
                      )}
                    </div>
                  </div>

                  <div className="px-1 text-xs text-slate-500">
                    提示：该战报用于分享决策参考，建议结合归因口径与预算目标复核。
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-gray-500 sm:px-6 lg:px-8">
              请点击“重新计算”生成统计数据。
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:px-6 lg:px-8">
          {stats && !loading && !error && (
            <Button variant="outline" onClick={handleDownloadImage} disabled={downloading}>
              {downloading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {downloading ? '下载中...' : '下载统计图片'}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
