/* eslint-disable react-hooks/exhaustive-deps -- setters from useOpenClawPageState are stable */
'use client'

import { useCallback, useEffect, useMemo } from 'react'
import {
  REPORT_TREND_RANGE_OPTIONS,
  DEFAULT_REPORT_TREND_RANGE_DAYS,
} from '../constants'


import {
  formatMoneyWithUnit,
  normalizeIsoDateText,
  parseLocalDate,
  resolveNormalizedReportDateRange,
  shiftOpenclawLocalIsoDate,
} from '../utils'

import type { OpenClawPageState } from './use-openclaw-page-state'

export function useOpenClawReport(state: OpenClawPageState) {
  const {
    report,
    reportDate,
    reportStartDate,
    setReportDate,
    setReportStartDate,
    reportActionCurrentPage,
    reportActionPageSize,
    reportActionOffset,
    getReportActionTotalPages,
    setReportActionPage,
  } = state

  useEffect(() => {
    setReportActionPage(1)
  }, [report?.date, report?.dateRange?.startDate, setReportActionPage])

  const handleSelectReportTrendRange = useCallback((days: number) => {
    const normalizedDays = REPORT_TREND_RANGE_OPTIONS.some((option) => option.days === days)
      ? days
      : DEFAULT_REPORT_TREND_RANGE_DAYS

    const endDate = parseLocalDate()
    const startDate = shiftOpenclawLocalIsoDate(endDate, -(normalizedDays - 1))
    setReportStartDate(startDate)
    setReportDate(endDate)
  }, [])

  const reportSummary = report?.summary?.kpis || {}
  const reportKpis = report?.kpis?.data || {}
  const reportRoi = report?.roi?.data?.overall || {}
  const reportRoiCurrencyRaw = String(report?.roi?.currency || '').trim().toUpperCase()
  const reportBudgetCurrencyRaw = String(report?.budget?.currency || '').trim().toUpperCase()
  const reportCostCurrency = reportRoiCurrencyRaw || reportBudgetCurrencyRaw || 'USD'
  const totalCost = Number(reportRoi.totalCost) || 0
  const totalRevenueRaw = reportRoi?.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : Number(totalRevenueRaw)
  const roiRevenueAvailable = reportRoi?.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)
  const reportRoas = roiRevenueAvailable
    ? (reportRoi?.roas !== undefined
      ? (Number(reportRoi.roas) || 0)
      : (totalCost > 0 ? (totalRevenue || 0) / totalCost : 0))
    : null
  const roiRevenueSource = String(reportRoi.revenueSource || 'unavailable')
  const usingAffiliateCommissionRevenue = roiRevenueAvailable && roiRevenueSource === 'affiliate_commission'
  const roiUnavailableReason = String(reportRoi.unavailableReason || '')
  const affiliateRevenueBreakdown = Array.isArray(reportRoi.affiliateBreakdown)
    ? reportRoi.affiliateBreakdown as Array<{ platform?: string; totalCommission?: number; records?: number; currency?: string }>
    : []
  const affiliateRevenueCurrencies = Array.from(
    new Set(
      affiliateRevenueBreakdown
        .map((item) => String(item.currency || '').trim().toUpperCase())
        .filter((item) => /^[A-Z]{3}$/.test(item))
    )
  )
  const reportRevenueCurrency =
    affiliateRevenueCurrencies.length > 1
      ? 'MIXED'
      : (affiliateRevenueCurrencies[0] || reportCostCurrency)
  const revenueTitle = '佣金收入'
  const reportRevenueValue: string = roiRevenueAvailable
    ? formatMoneyWithUnit(totalRevenue || 0, reportRevenueCurrency)
    : '—'
  const reportCostValue: string = formatMoneyWithUnit(
    reportKpis.current?.cost ?? totalCost,
    reportCostCurrency
  )
  const reportRoasValue = roiRevenueAvailable && reportRoas !== null ? `${reportRoas.toFixed(2)}x` : '—'
  const reportRoiValue = roiRevenueAvailable && reportRoi.roi !== null && reportRoi.roi !== undefined
    ? `${reportRoi.roi}%`
    : '—'
  const reportProfitValue: string = roiRevenueAvailable && reportRoi.totalProfit !== null && reportRoi.totalProfit !== undefined
    ? formatMoneyWithUnit(reportRoi.totalProfit, reportRevenueCurrency === 'MIXED' ? 'MIXED' : reportCostCurrency)
    : '—'
  const roiUnavailableHint = roiUnavailableReason === 'affiliate_not_configured'
    ? '未配置联盟平台参数，严格模式下不回退 AutoAds 收益。'
    : '联盟平台佣金查询失败或暂无返回，严格模式下不回退 AutoAds 收益。'
  const offerRows = report?.roi?.data?.byOffer || []
  const topOfferRows = [...offerRows]
    .sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0))
    .slice(0, 10)
  const normalizedReportRange = resolveNormalizedReportDateRange(reportStartDate, reportDate)
  const normalizedReportStartDateForTrend = normalizedReportRange.startDate
  const normalizedReportDateForTrend = normalizedReportRange.endDate
  const reportDateRangeDays = normalizedReportRange.days
  const trendData = useMemo(() => {
    const sourceRows = Array.isArray(report?.trends?.data?.trends)
      ? report.trends.data.trends
      : []
    if (sourceRows.length === 0) return []

    return sourceRows.filter((row: any) => {
      const date = normalizeIsoDateText(row?.date)
      if (!date) return false
      return date >= normalizedReportStartDateForTrend && date <= normalizedReportDateForTrend
    })
  }, [
    normalizedReportDateForTrend,
    normalizedReportStartDateForTrend,
    report?.trends?.data?.trends,
  ])
  const trendDescription = reportDateRangeDays <= 1
    ? `单日趋势（${normalizedReportDateForTrend}）`
    : `${normalizedReportStartDateForTrend} ~ ${normalizedReportDateForTrend}（${reportDateRangeDays}天）`
  const budgetOverall = report?.budget?.data?.overall || {}
  const budgetCurrency = reportBudgetCurrencyRaw || reportCostCurrency
  const budgetTotalValue = formatMoneyWithUnit(budgetOverall.totalBudget ?? 0, budgetCurrency)
  const budgetSpentValue = formatMoneyWithUnit(
    budgetOverall.totalSpentAllCampaigns ?? budgetOverall.totalSpent ?? 0,
    budgetCurrency
  )
  const budgetRemainingValue = formatMoneyWithUnit(budgetOverall.remaining ?? 0, budgetCurrency)
  const reportRoiCostValue = formatMoneyWithUnit(totalCost, reportCostCurrency)
  const campaignRows = report?.roi?.data?.byCampaign || []
  const topCampaigns = [...campaignRows]
    .sort((a, b) => {
      const revenueDiff = (Number(b.revenue) || 0) - (Number(a.revenue) || 0)
      if (revenueDiff !== 0) return revenueDiff
      return (Number(b.cost) || 0) - (Number(a.cost) || 0)
    })
    .slice(0, 5)
  const reportActions = useMemo(() => {
    if (!Array.isArray(report?.actions)) return []
    return report.actions
  }, [report?.actions])
  const reportActionTotalPages = getReportActionTotalPages(reportActions.length)
  const pagedReportActions = useMemo(() => {
    return reportActions.slice(reportActionOffset, reportActionOffset + reportActionPageSize)
  }, [reportActions, reportActionOffset, reportActionPageSize])

  useEffect(() => {
    if (reportActionTotalPages <= 0 && reportActionCurrentPage !== 1) {
      setReportActionPage(1)
      return
    }
    if (reportActionTotalPages > 0 && reportActionCurrentPage > reportActionTotalPages) {
      setReportActionPage(reportActionTotalPages)
    }
  }, [reportActionCurrentPage, reportActionTotalPages, setReportActionPage])

  return {
    handleSelectReportTrendRange,
    reportSummary,
    reportKpis,
    reportRoi,
    reportRoiCurrencyRaw,
    reportBudgetCurrencyRaw,
    reportCostCurrency,
    totalCost,
    totalRevenueRaw,
    totalRevenue,
    roiRevenueAvailable,
    reportRoas,
    roiRevenueSource,
    usingAffiliateCommissionRevenue,
    roiUnavailableReason,
    affiliateRevenueBreakdown,
    affiliateRevenueCurrencies,
    reportRevenueCurrency,
    revenueTitle,
    reportRevenueValue,
    reportCostValue,
    reportRoasValue,
    reportRoiValue,
    reportProfitValue,
    roiUnavailableHint,
    offerRows,
    topOfferRows,
    normalizedReportRange,
    normalizedReportStartDateForTrend,
    normalizedReportDateForTrend,
    reportDateRangeDays,
    trendData,
    trendDescription,
    budgetOverall,
    budgetCurrency,
    budgetTotalValue,
    budgetSpentValue,
    budgetRemainingValue,
    reportRoiCostValue,
    campaignRows,
    topCampaigns,
    reportActions,
    reportActionTotalPages,
    pagedReportActions,
  }
}
