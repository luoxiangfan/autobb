'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SwitchWithLabel } from './form-controls'
import {
  STRATEGY_CRON_OPTIONS,
} from '../constants'
import type { StrategyBatchScope, StrategyRecommendationStatusFilter } from '../types'
import {
  formatMoney,
  formatNumber,
  formatTimestamp,
  isStrategyRecommendationQueued,
  isTruthy,
  normalizeCurrencyCode,
  resolveImpactConfidenceText,
  resolveImpactEstimationSourceText,
  resolvePostReviewStatusText,
  resolveStrategyRecommendationStatusBadge,
  resolveStrategyRecommendationTypeLabel,
  resolveStrategyRecommendationTypeTone,
  shiftOpenclawLocalIsoDate,
  STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS,
} from '../utils'
import { Switch } from '@/components/ui/switch'

import { useOpenClawPageContext } from '../openclaw-page-context'

export function OpenClawStrategyTab() {
  const {
  userValues,
  reportDate,
  savingUser,
  strategyRecommendationsLoading,
  strategyManualTriggering,
  strategyAnalyzeSendFeishu,
  setStrategyAnalyzeSendFeishu,
  strategyRecommendationsDisplayMode,
  setStrategyRecommendationsDisplayMode,
  strategyRecommendationStatusFilter,
  setStrategyRecommendationStatusFilter,
  strategyBatchScope,
  setStrategyBatchScope,
  strategyBatchExecuting,
  strategyBatchDismissing,
  strategyBatchFailures,
  strategyRecommendationExecutingId,
  strategyRecommendationDismissingId,
  strategyRecommendationDetailItem,
  setStrategyRecommendationDetailItem,
  strategyConfirmDialog,
  strategyConfirmAcknowledge,
  setStrategyConfirmAcknowledge,
  strategyCronPreset,
  strategyConfirmToneClasses,
  closeStrategyConfirmDialog,
  strategySaveKeys,
  setUserValue,
  saveSettings,
  handleStrategyCronPresetChange,
  handleTriggerStrategyRecommendations,
  handleExecuteStrategyRecommendation,
  handleDismissStrategyRecommendation,
  strategyRecommendationActionBusy,
  strategyDisplayDate,
  strategyServerDateDisplay,
  strategyDateNormalized,
  strategyHistoricalReadOnly,
  isStrategyRecommendationExecutableInCurrentWindow,
  strategyRecommendationsView,
  strategyRecommendationsDisplay,
  strategyRecommendationSummary,
  selectedStrategyRecommendationSet,
  selectableStrategyRecommendations,
  selectedSelectableCount,
  selectedHiddenCount,
  selectedExecutableCount,
  selectedDismissibleCount,
  strategyRecommendationsAllSelected,
  strategyRecommendationsPartiallySelected,
  hasQueuedStrategyRecommendations,
  unknownQueueTaskCount,
  toggleStrategyRecommendationSelected,
  handleSelectAllStrategyRecommendations,
  handleBatchExecuteStrategyRecommendations,
  handleBatchDismissStrategyRecommendations,
  handleRetryFailedStrategyRecommendations,
  strategyDirty,
  } = useOpenClawPageContext()

  return (
    <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                自动分析设置
                {strategyDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="自动分析设置未保存" />}
              </CardTitle>
              <CardDescription>自动分析运行中 Campaign 表现并生成优化建议，执行环节始终由人工触发</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-700">
                建议流程：①启用自动分析 → ②设置分析频率 → ③在下方“优化建议”中人工选择执行
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <SwitchWithLabel
                  label="启用自动分析"
                  required
                  checked={isTruthy(userValues.openclaw_strategy_enabled, false)}
                  onChange={(val) => setUserValue('openclaw_strategy_enabled', val ? 'true' : 'false')}
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    分析频率
                    <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                  </label>
                  <Select value={strategyCronPreset} onValueChange={handleStrategyCronPresetChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择分析频率" />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGY_CRON_OPTIONS.map(option => (
                        <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                自动分析只负责生成报告与优化建议，不会自动执行对广告投放的变更。
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => saveSettings({ scope: 'user', keys: strategySaveKeys, successMessage: '自动分析设置已保存' })}
                  disabled={savingUser}
                >
                  {savingUser ? '保存中...' : strategyDirty ? '保存自动分析设置 *' : '保存自动分析设置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200">
            <CardHeader className="gap-4 border-b border-slate-100 bg-linear-to-r from-slate-50 via-white to-sky-50/40">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-xl">优化建议（按优先级分排序）</CardTitle>
                  <CardDescription>每日自动生成，确认后可直接执行，执行结果直接落地 AutoAds / Google Ads</CardDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                      建议日期：{strategyDisplayDate}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                      服务端日期：{strategyServerDateDisplay}
                    </span>
                    {strategyDateNormalized && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                        已从 {reportDate} 归一到服务端日期
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-3 rounded-xl border border-slate-200 bg-white/90 p-3 xl:w-auto xl:min-w-[280px]">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>分析后发送 Feishu</span>
                    <Switch
                      checked={strategyAnalyzeSendFeishu}
                      onCheckedChange={(checked) => setStrategyAnalyzeSendFeishu(Boolean(checked))}
                      disabled={strategyManualTriggering || strategyRecommendationsLoading || strategyRecommendationActionBusy}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleTriggerStrategyRecommendations}
                    disabled={
                      strategyManualTriggering
                      || strategyRecommendationsLoading
                      || strategyRecommendationActionBusy
                    }
                  >
                    {strategyManualTriggering ? '分析中...' : '重新分析'}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">总建议</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">{strategyRecommendationSummary.total}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">待处理（待执行/执行失败/待重算）</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">{strategyRecommendationSummary.actionable}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">排队执行中</div>
                  <div className="mt-1 text-2xl font-semibold text-amber-700">{strategyRecommendationSummary.queued}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">当前可执行</div>
                  <div className="mt-1 text-2xl font-semibold text-emerald-700">{strategyRecommendationSummary.executable}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4 md:p-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
                <div className="grid gap-2 md:grid-cols-2">
                  <div>操作流程：重新分析 → 选择建议 → 执行（需二次确认），支持批量执行与批量暂不执行。</div>
                  <div>下线建议默认执行：删除 Google Ads Campaign + 暂停补点击任务 + 暂停换链接任务。</div>
                  <div>重新分析会重算建议；开启“分析后发送 Feishu”时，会同时入队发送最新报告。</div>
                  <div>佣金口径：仅按 Offer/Campaign 级联盟佣金统计，不做关键词级佣金归因。</div>
                  <div>优先级口径：优先级分用于排序；净影响为估算值，含低/中/高置信度。</div>
                </div>
                <div className="mt-2 text-slate-500">刷新建议会重新计算规则，旧建议可能被标记为“待重算”。</div>
                {strategyHistoricalReadOnly && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                    历史日期默认仅支持查看与复盘；执行仅开放 T-1（{shiftOpenclawLocalIsoDate(strategyServerDateDisplay, -1)}）且限：{STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS}。
                  </div>
                )}
                {hasQueuedStrategyRecommendations && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                    检测到执行队列任务，建议列表每 15 秒自动刷新一次。
                  </div>
                )}
                {unknownQueueTaskCount > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                    {unknownQueueTaskCount} 条建议的队列状态未知（任务可能已过期），可重新执行。
                  </div>
                )}
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={strategyRecommendationsDisplayMode === 'final' ? 'default' : 'outline'}
                        onClick={() => setStrategyRecommendationsDisplayMode('final')}
                        disabled={strategyRecommendationActionBusy}
                      >
                        每 Campaign 仅显示最高优先级
                      </Button>
                      <Button
                        size="sm"
                        variant={strategyRecommendationsDisplayMode === 'all' ? 'default' : 'outline'}
                        onClick={() => setStrategyRecommendationsDisplayMode('all')}
                        disabled={strategyRecommendationActionBusy}
                      >
                        显示全部建议
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Select
                        value={strategyRecommendationStatusFilter}
                        onValueChange={(value) => setStrategyRecommendationStatusFilter(value as StrategyRecommendationStatusFilter)}
                      >
                        <SelectTrigger className="h-8 w-[176px]">
                          <SelectValue placeholder="状态筛选" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="actionable">待处理（待执行+执行失败+待重算）</SelectItem>
                          <SelectItem value="all">全部状态</SelectItem>
                          <SelectItem value="queued">排队执行中</SelectItem>
                          <SelectItem value="pending">待执行</SelectItem>
                          <SelectItem value="stale">待重算</SelectItem>
                          <SelectItem value="failed">执行失败</SelectItem>
                          <SelectItem value="executed">已执行</SelectItem>
                          <SelectItem value="dismissed">暂不执行</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={strategyBatchScope}
                        onValueChange={(value) => setStrategyBatchScope(value as StrategyBatchScope)}
                      >
                        <SelectTrigger className="h-8 w-[196px]">
                          <SelectValue placeholder="批量作用范围" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="filtered">批量范围：当前筛选全部</SelectItem>
                          <SelectItem value="display">批量范围：当前展示</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    当前 {strategyRecommendationsDisplayMode === 'final' ? '每个 Campaign 仅显示优先级最高建议' : '显示全部建议'}
                    {' · '}
                    展示 {strategyRecommendationsDisplay.length} / {strategyRecommendationsView.length} 条
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 xl:min-w-[360px]">
                  <div className="text-xs text-slate-600">
                    已选 {selectedSelectableCount} 条
                    {selectedHiddenCount > 0 ? `（含当前未展示 ${selectedHiddenCount} 条）` : ''}
                    {' · '}
                    可执行 {selectedExecutableCount} / 可暂不执行 {selectedDismissibleCount}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={handleBatchExecuteStrategyRecommendations}
                      disabled={strategyRecommendationActionBusy || selectedExecutableCount === 0}
                    >
                      {strategyBatchExecuting ? '批量执行中...' : '批量执行'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBatchDismissStrategyRecommendations}
                      disabled={strategyRecommendationActionBusy || selectedDismissibleCount === 0}
                    >
                      {strategyBatchDismissing ? '批量处理中...' : '批量暂不执行'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRetryFailedStrategyRecommendations}
                      disabled={strategyRecommendationActionBusy || strategyBatchFailures.length === 0}
                    >
                      重试失败项{strategyBatchFailures.length > 0 ? ` (${strategyBatchFailures.length})` : ''}
                    </Button>
                  </div>
                </div>
              </div>

              {strategyBatchFailures.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  最近失败（Top3）：
                  {strategyBatchFailures.slice(0, 3).map((item, idx) => (
                    <span key={`${item.id}:${idx}`} className="ml-1">
                      [{item.id}] {item.message}
                    </span>
                  ))}
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <Table className="min-w-[1320px] [&_thead_th]:bg-white">
                  <TableHeader className="bg-slate-50/80">
                    <TableRow className="hover:bg-slate-50/80">
                      <TableHead className="w-[44px] text-xs font-semibold text-slate-600">
                        <Checkbox
                          checked={
                            strategyRecommendationsAllSelected
                              ? true
                              : strategyRecommendationsPartiallySelected
                                ? 'indeterminate'
                                : false
                          }
                          onCheckedChange={(checked) => handleSelectAllStrategyRecommendations(Boolean(checked))}
                          aria-label="全选策略建议"
                          disabled={strategyRecommendationActionBusy || selectableStrategyRecommendations.length === 0}
                        />
                      </TableHead>
                      <TableHead className="w-[52px] text-xs font-semibold text-slate-600">#</TableHead>
                      <TableHead className="min-w-[200px] text-xs font-semibold text-slate-600">类型 / ID</TableHead>
                      <TableHead className="min-w-[240px] text-xs font-semibold text-slate-600">建议</TableHead>
                      <TableHead className="min-w-[260px] text-xs font-semibold text-slate-600">Campaign</TableHead>
                      <TableHead className="min-w-[240px] text-xs font-semibold text-slate-600">成本/盈亏平衡</TableHead>
                      <TableHead className="min-w-[220px] text-xs font-semibold text-slate-600">优先级分</TableHead>
                      <TableHead className="min-w-[140px] text-xs font-semibold text-slate-600">状态</TableHead>
                      <TableHead className="min-w-[340px] text-right text-xs font-semibold text-slate-600">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strategyRecommendationsDisplay.map((item, index) => {
                      const statusBadge = resolveStrategyRecommendationStatusBadge(item.status)
                      const isExecuting = strategyRecommendationExecutingId === item.id
                      const isDismissing = strategyRecommendationDismissingId === item.id
                      const isSelectable = item.status !== 'executed'
                      const isChecked = selectedStrategyRecommendationSet.has(item.id)
                      const analysisNote = item.data?.analysisNote || item.reason || item.summary || '-'
                      const isQueued = isStrategyRecommendationQueued(item)
                      const postReviewText = resolvePostReviewStatusText(
                        item.data?.postReviewStatus || item.executionResult?.postReview?.status || null
                      )
                      const recommendationCurrency = normalizeCurrencyCode(
                        item.data?.currency || item.data?.searchTermFeedback?.dominantCurrency || null
                      )
                      const costText = `花费 ${formatMoney(item.data?.cost, recommendationCurrency, 2)} / 点击 ${formatNumber(item.data?.clicks, 0)} / CTR ${formatNumber(item.data?.ctrPct, 2)}%`
                      const roasText = item.data?.roas !== null && item.data?.roas !== undefined
                        ? `ROAS ${formatNumber(item.data?.roas, 2)}`
                        : 'ROAS --'
                      const breakEvenText = item.data?.breakEvenConversionRatePct !== null && item.data?.breakEvenConversionRatePct !== undefined
                        ? `盈亏平衡转化率 ${formatNumber(item.data?.breakEvenConversionRatePct, 2)}%`
                        : '盈亏平衡转化率 --'
                      const impactWindowDays = Number(item.data?.impactWindowDays || 0)
                      const estimatedCostSaving = Number(item.data?.estimatedCostSaving || 0)
                      const estimatedRevenueUplift = Number(item.data?.estimatedRevenueUplift || 0)
                      const estimatedNetImpact = Number(item.data?.estimatedNetImpact || (estimatedCostSaving + estimatedRevenueUplift))
                      const hasImpact = Number.isFinite(estimatedNetImpact) && impactWindowDays > 0
                      const impactConfidenceText = resolveImpactConfidenceText(item.data?.impactConfidence)
                      const impactEstimationSourceText = resolveImpactEstimationSourceText(item.data?.impactEstimationSource)
                      const cpcAdjustText = item.recommendationType === 'adjust_cpc'
                        ? `CPC ${formatMoney(item.data?.currentCpc, recommendationCurrency, 2)} → ${formatMoney(item.data?.recommendedCpc, recommendationCurrency, 2)}`
                        : ''
                      const budgetAdjustText = item.recommendationType === 'adjust_budget'
                        ? `预算 ${formatMoney(item.data?.currentBudget, recommendationCurrency, 2)} → ${formatMoney(item.data?.recommendedBudget, recommendationCurrency, 2)} (${item.data?.budgetType || 'DAILY'})`
                        : ''
                      const keywordPlan = Array.isArray(item.data?.keywordPlan) ? item.data.keywordPlan : []
                      const negativeKeywordPlan = Array.isArray(item.data?.negativeKeywordPlan) ? item.data.negativeKeywordPlan : []
                      const matchTypePlan = Array.isArray(item.data?.matchTypePlan) ? item.data.matchTypePlan : []
                      const hardFeedbackTerms = Array.isArray(item.data?.searchTermFeedback?.hardNegativeTerms)
                        ? item.data?.searchTermFeedback?.hardNegativeTerms || []
                        : []
                      const softFeedbackTerms = Array.isArray(item.data?.searchTermFeedback?.softSuppressTerms)
                        ? item.data?.searchTermFeedback?.softSuppressTerms || []
                        : []
                      const keywordPlanText = item.recommendationType === 'expand_keywords'
                        ? `新增词 ${keywordPlan.length} 个（自动匹配类型）`
                        : ''
                      const negativeKeywordPlanText = item.recommendationType === 'add_negative_keywords'
                        ? `否词 ${negativeKeywordPlan.length} 个（建议默认EXACT）`
                        : ''
                      const matchTypePlanText = item.recommendationType === 'optimize_match_type'
                        ? `匹配类型优化 ${matchTypePlan.length} 个（新增并暂停旧匹配类型）`
                        : ''
                      const hasRecommendationDetail = keywordPlan.length > 0 || negativeKeywordPlan.length > 0 || matchTypePlan.length > 0
                      const creativeQualityText = item.data?.creativeQuality
                        ? `创意 H${item.data.creativeQuality.headlineCount}/D${item.data.creativeQuality.descriptionCount}/K${item.data.creativeQuality.keywordCount} · ${item.data.creativeQuality.level.toUpperCase()}`
                        : ''
                      const queueRetryCount = Number(item.executionResult?.queueRetryCount)
                      const hasQueueRetryCount = Number.isFinite(queueRetryCount) && queueRetryCount >= 0
                      const recommendationTypeLabel = resolveStrategyRecommendationTypeLabel(item.recommendationType)
                      const recommendationTypeTone = resolveStrategyRecommendationTypeTone(item.recommendationType)

                      return (
                        <TableRow key={item.id} className="align-top hover:bg-slate-50/70">
                          <TableCell>
                            {isSelectable ? (
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => toggleStrategyRecommendationSelected(item.id, Boolean(checked))}
                                aria-label={`选择建议 ${item.id}`}
                                disabled={strategyRecommendationActionBusy}
                              />
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="pt-3 text-sm font-medium text-slate-500">{index + 1}</TableCell>
                          <TableCell className="space-y-2 pt-3">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${recommendationTypeTone}`}>
                              {recommendationTypeLabel}
                            </span>
                            <div className="text-xs text-slate-400">ID: {item.id}</div>
                          </TableCell>
                          <TableCell className="space-y-2 pt-3">
                            <div className="text-sm font-medium leading-5 text-slate-900">{item.title}</div>
                            <div className="text-xs leading-5 text-slate-600">{analysisNote}</div>
                            {item.data?.commissionLagProtected && (
                              <div className="text-xs text-amber-600">佣金滞后保护：投放≤3天无佣金按正常处理</div>
                            )}
                          </TableCell>
                          <TableCell className="space-y-1 pt-3">
                            <div className="text-sm font-medium text-slate-900">{item.data?.campaignName || `Campaign #${item.campaignId}`}</div>
                            <div className="text-xs text-slate-500">运行 {item.data?.runDays ?? '--'} 天</div>
                            {creativeQualityText && (
                              <div className="text-xs text-slate-500">{creativeQualityText}</div>
                            )}
                            {item.recommendationType === 'expand_keywords' && (
                              <div className="text-xs text-slate-500">现有关键词 {item.data?.keywordCoverageCount ?? 0} 个</div>
                            )}
                            {item.recommendationType === 'add_negative_keywords' && (
                              <div className="text-xs text-slate-500">
                                建议否词 {negativeKeywordPlan.length} 个
                                {hardFeedbackTerms.length > 0 ? ` · hard反馈 ${hardFeedbackTerms.length} 个` : ''}
                              </div>
                            )}
                            {item.recommendationType === 'optimize_match_type' && (
                              <div className="text-xs text-slate-500">
                                建议优化 {matchTypePlan.length} 个
                                {softFeedbackTerms.length > 0 ? ` · soft反馈 ${softFeedbackTerms.length} 个` : ''}
                              </div>
                            )}
                            {isQueued && (
                              <div className="text-xs text-amber-600">执行队列中（Task: {item.executionResult?.queueTaskId || '-'})</div>
                            )}
                            {isQueued && (
                              <div className="text-xs text-slate-500">
                                队列状态 {String(item.executionResult?.queueTaskStatus || 'pending')}
                                {item.executionResult?.queuedAt ? ` · 入队 ${formatTimestamp(item.executionResult.queuedAt)}` : ''}
                                {item.executionResult?.queueTaskCreatedAt ? ` · 创建 ${formatTimestamp(item.executionResult.queueTaskCreatedAt)}` : ''}
                                {item.executionResult?.queueTaskStartedAt ? ` · 开始 ${formatTimestamp(item.executionResult.queueTaskStartedAt)}` : ''}
                                {hasQueueRetryCount ? ` · 重试 ${queueRetryCount}` : ''}
                              </div>
                            )}
                            {item.executionResult?.queueTaskError && (
                              <div className="text-xs text-red-600" title={String(item.executionResult.queueTaskError)}>
                                队列错误：{String(item.executionResult.queueTaskError)}
                              </div>
                            )}
                            {item.executionResult?.postReviewTaskId && (
                              <div className="text-xs text-slate-500">
                                复盘任务 {String(item.executionResult.postReviewTaskId)}
                                {item.executionResult?.postReviewScheduledAt
                                  ? ` · 计划 ${formatTimestamp(item.executionResult.postReviewScheduledAt)}`
                                  : ''}
                              </div>
                            )}
                            {postReviewText && (
                              <div className="text-xs text-slate-500">{postReviewText}</div>
                            )}
                          </TableCell>
                          <TableCell className="space-y-1 pt-3 text-xs leading-5 text-slate-700">
                            <div>{costText}</div>
                            <div>{roasText}</div>
                            <div>{breakEvenText}</div>
                            {cpcAdjustText && <div>{cpcAdjustText}</div>}
                            {budgetAdjustText && <div>{budgetAdjustText}</div>}
                            {keywordPlanText && <div>{keywordPlanText}</div>}
                            {negativeKeywordPlanText && <div>{negativeKeywordPlanText}</div>}
                            {matchTypePlanText && <div>{matchTypePlanText}</div>}
                          </TableCell>
                          <TableCell className="space-y-1 pt-3">
                            <div className="text-lg font-semibold text-slate-900">{formatNumber(item.priorityScore, 1)}</div>
                            {hasImpact ? (
                              <div className="text-xs text-slate-500">
                                净影响(估) {formatMoney(estimatedNetImpact, recommendationCurrency, 2)} / {impactWindowDays}天 · 置信度 {impactConfidenceText}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500">净影响 --</div>
                            )}
                            <div className="text-xs text-slate-500">
                              节省 {formatMoney(estimatedCostSaving, recommendationCurrency, 2)} / 增益 {formatMoney(estimatedRevenueUplift, recommendationCurrency, 2)}
                            </div>
                            {item.data?.impactConfidenceReason && (
                              <div className="text-xs text-slate-500">{item.data.impactConfidenceReason}</div>
                            )}
                            {impactEstimationSourceText && (
                              <div className="text-xs text-slate-500">{impactEstimationSourceText}</div>
                            )}
                          </TableCell>
                          <TableCell className="w-[140px] max-w-[140px] space-y-1 pt-3">
                            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                            {item.status === 'stale' && (
                              <div className="text-xs text-amber-600">建议内容已变化，请重新分析后再执行</div>
                            )}
                            {isQueued && (
                              <div className="text-xs text-amber-600">排队执行中</div>
                            )}
                            {item.status === 'failed' && item.executionResult?.error && (
                              <div className="text-xs text-red-600" title={String(item.executionResult.error)}>
                                失败原因：{String(item.executionResult.error)}
                              </div>
                            )}
                            {item.executedAt && (
                              <div className="text-xs text-slate-500">{formatTimestamp(item.executedAt)}</div>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[340px] pt-3 text-right">
                            <div className="flex flex-nowrap items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-3"
                                disabled={!hasRecommendationDetail}
                                onClick={() => setStrategyRecommendationDetailItem(item)}
                              >
                                明细
                              </Button>
                              <Button
                                size="sm"
                                className="h-8 px-3"
                                disabled={
                                  strategyRecommendationActionBusy
                                  || isExecuting
                                  || isDismissing
                                  || !isStrategyRecommendationExecutableInCurrentWindow(item)
                                }
                                onClick={() => handleExecuteStrategyRecommendation(item)}
                              >
                                {isExecuting ? '执行中...' : '执行'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-3"
                                disabled={
                                  strategyRecommendationActionBusy
                                  || isExecuting
                                  || isDismissing
                                  || item.status === 'executed'
                                  || item.status === 'dismissed'
                                }
                                onClick={() => handleDismissStrategyRecommendation(item)}
                              >
                                {isDismissing ? '处理中...' : '暂不执行'}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {strategyRecommendationsDisplay.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-slate-500">
                          {strategyRecommendationsLoading ? '策略建议生成中...' : '暂无策略建议'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <Dialog
                open={Boolean(strategyRecommendationDetailItem)}
                onOpenChange={(open) => {
                  if (!open) setStrategyRecommendationDetailItem(null)
                }}
              >
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>建议执行明细</DialogTitle>
                    <DialogDescription>
                      {strategyRecommendationDetailItem
                        ? `${resolveStrategyRecommendationTypeLabel(strategyRecommendationDetailItem.recommendationType)} · ${strategyRecommendationDetailItem.data?.campaignName || `Campaign #${strategyRecommendationDetailItem.campaignId}`}`
                        : ''}
                    </DialogDescription>
                  </DialogHeader>
                  {strategyRecommendationDetailItem && (
                    <div className="max-h-[65vh] space-y-4 overflow-y-auto text-sm">
                      {Array.isArray(strategyRecommendationDetailItem.data?.keywordPlan) && strategyRecommendationDetailItem.data.keywordPlan.length > 0 && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            补充Search Terms关键词（{strategyRecommendationDetailItem.data.keywordPlan.length}）
                          </div>
                          <div className="space-y-1 text-xs text-slate-600">
                            {strategyRecommendationDetailItem.data.keywordPlan.slice(0, 30).map((kw, idx) => (
                              <div key={`kw:${kw.text}:${idx}`}>
                                {idx + 1}. {kw.text} [{kw.matchType}]
                              </div>
                            ))}
                            {strategyRecommendationDetailItem.data.keywordPlan.length > 30 && (
                              <div>其余 {strategyRecommendationDetailItem.data.keywordPlan.length - 30} 条已省略</div>
                            )}
                          </div>
                        </div>
                      )}
                      {Array.isArray(strategyRecommendationDetailItem.data?.negativeKeywordPlan) && strategyRecommendationDetailItem.data.negativeKeywordPlan.length > 0 && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            否词建议（{strategyRecommendationDetailItem.data.negativeKeywordPlan.length}）
                          </div>
                          <div className="space-y-1 text-xs text-slate-600">
                            {strategyRecommendationDetailItem.data.negativeKeywordPlan.slice(0, 30).map((kw, idx) => (
                              <div key={`neg:${kw.text}:${idx}`}>
                                {idx + 1}. {kw.text} [{kw.matchType}]
                                {kw.reason ? ` · ${kw.reason}` : ''}
                              </div>
                            ))}
                            {strategyRecommendationDetailItem.data.negativeKeywordPlan.length > 30 && (
                              <div>其余 {strategyRecommendationDetailItem.data.negativeKeywordPlan.length - 30} 条已省略</div>
                            )}
                          </div>
                        </div>
                      )}
                      {Array.isArray(strategyRecommendationDetailItem.data?.matchTypePlan) && strategyRecommendationDetailItem.data.matchTypePlan.length > 0 && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            匹配类型优化（{strategyRecommendationDetailItem.data.matchTypePlan.length}）
                          </div>
                          <div className="space-y-1 text-xs text-slate-600">
                            {strategyRecommendationDetailItem.data.matchTypePlan.slice(0, 30).map((kw, idx) => (
                              <div key={`mt:${kw.text}:${idx}`}>
                                {idx + 1}. {kw.text} [{kw.currentMatchType} → {kw.recommendedMatchType}]
                                {Number.isFinite(Number(kw.clicks)) ? ` · 点击 ${formatNumber(kw.clicks, 0)}` : ''}
                                {Number.isFinite(Number(kw.conversions)) ? ` · 转化 ${formatNumber(kw.conversions, 2)}` : ''}
                                {Number.isFinite(Number(kw.cost))
                                  ? ` · 花费 ${formatMoney(kw.cost, strategyRecommendationDetailItem.data?.currency || strategyRecommendationDetailItem.data?.searchTermFeedback?.dominantCurrency, 2)}`
                                  : ''}
                              </div>
                            ))}
                            {strategyRecommendationDetailItem.data.matchTypePlan.length > 30 && (
                              <div>其余 {strategyRecommendationDetailItem.data.matchTypePlan.length - 30} 条已省略</div>
                            )}
                          </div>
                        </div>
                      )}
                      {(
                        (Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.hardNegativeTerms)
                          && strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length > 0)
                        || (Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.softSuppressTerms)
                          && strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length > 0)
                      ) && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            搜索词反馈（近{strategyRecommendationDetailItem.data?.searchTermFeedback?.lookbackDays || 14}天）
                          </div>
                          {Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.hardNegativeTerms)
                            && strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length > 0 && (
                              <div className="space-y-1 text-xs text-slate-600">
                                <div className="font-medium text-amber-700">
                                  hard 词（建议优先否词）{strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length}
                                </div>
                                {strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.slice(0, 30).map((term, idx) => (
                                  <div key={`hard:${term}:${idx}`}>{idx + 1}. {term}</div>
                                ))}
                              </div>
                            )}
                          {Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.softSuppressTerms)
                            && strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length > 0 && (
                              <div className="space-y-1 text-xs text-slate-600">
                                <div className="font-medium text-sky-700">
                                  soft 词（建议弱化/收紧匹配）{strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length}
                                </div>
                                {strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.slice(0, 30).map((term, idx) => (
                                  <div key={`soft:${term}:${idx}`}>{idx + 1}. {term}</div>
                                ))}
                              </div>
                            )}
                        </div>
                      )}
                      {(!Array.isArray(strategyRecommendationDetailItem.data?.keywordPlan) || strategyRecommendationDetailItem.data.keywordPlan.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.negativeKeywordPlan) || strategyRecommendationDetailItem.data.negativeKeywordPlan.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.matchTypePlan) || strategyRecommendationDetailItem.data.matchTypePlan.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.hardNegativeTerms) || strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.softSuppressTerms) || strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length === 0) && (
                          <div className="text-xs text-slate-500">该建议暂无可展示的执行明细。</div>
                        )}
                    </div>
                  )}
                </DialogContent>
              </Dialog>
              <Dialog
                open={Boolean(strategyConfirmDialog)}
                onOpenChange={(open) => {
                  if (!open) closeStrategyConfirmDialog(false)
                }}
              >
                <DialogContent className="max-w-lg">
                  <DialogHeader className="space-y-2">
                    <DialogTitle className="text-lg leading-6 sm:text-xl">
                      {strategyConfirmDialog?.title || '确认操作'}
                    </DialogTitle>
                    <DialogDescription className="text-sm leading-6 text-slate-600">
                      {strategyConfirmDialog?.description || ''}
                    </DialogDescription>
                  </DialogHeader>
                  {strategyConfirmDialog && (
                    <div className="space-y-4">
                      {Array.isArray(strategyConfirmDialog.details) && strategyConfirmDialog.details.length > 0 && (
                        <div className={`space-y-1.5 rounded-md border px-3 py-2.5 text-sm leading-6 ${strategyConfirmToneClasses.panel}`}>
                          {strategyConfirmDialog.details.map((item, idx) => (
                            <div key={`confirm-detail-${idx}`}>{item}</div>
                          ))}
                        </div>
                      )}
                      {strategyConfirmDialog.acknowledgeLabel && (
                        <label className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${strategyConfirmToneClasses.panel}`}>
                          <Checkbox
                            className="mt-1 h-4 w-4 shrink-0"
                            checked={strategyConfirmAcknowledge}
                            onCheckedChange={(checked) => setStrategyConfirmAcknowledge(Boolean(checked))}
                          />
                          <span className={`text-sm font-medium leading-6 ${strategyConfirmToneClasses.detail}`}>
                            {strategyConfirmDialog.acknowledgeLabel}
                          </span>
                        </label>
                      )}
                      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                        <Button
                          className="h-9 px-4"
                          variant="outline"
                          onClick={() => closeStrategyConfirmDialog(false)}
                        >
                          取消
                        </Button>
                        <Button
                          className="h-9 px-4"
                          variant={strategyConfirmToneClasses.confirm}
                          onClick={() => closeStrategyConfirmDialog(true)}
                          disabled={Boolean(strategyConfirmDialog.acknowledgeLabel) && !strategyConfirmAcknowledge}
                        >
                          {strategyConfirmDialog.confirmLabel || '确认'}
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

    </>
  )
}
