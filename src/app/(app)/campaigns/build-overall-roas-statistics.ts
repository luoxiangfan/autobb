import type { Campaign, CampaignRoasRankItem, OverallRoasStatistics } from './types'
import { convertAmountForDisplay } from './campaign-metrics-utils'

const normalizeMetricValue = (value: unknown): number => {
  const normalized = Number(value ?? 0)
  return Number.isFinite(normalized) ? normalized : 0
}

export function buildOverallRoasStatistics(params: {
  selectedCampaigns: Campaign[]
  timeRangeLabel: string
  summaryDisplayCurrency: string
}): OverallRoasStatistics {
  const { selectedCampaigns, timeRangeLabel, summaryDisplayCurrency } = params

  const campaignMetrics: CampaignRoasRankItem[] = selectedCampaigns.map((campaign) => {
    const metricCurrency = String(
      campaign.performanceCurrency || campaign.adsAccountCurrency || summaryDisplayCurrency || 'USD'
    ).toUpperCase()
    const rawSpend = normalizeMetricValue(
      campaign.performance?.costLocal ?? campaign.performance?.costUsd
    )
    const rawCommission = normalizeMetricValue(
      campaign.performance?.commission ?? campaign.performance?.conversions
    )
    const impressions = normalizeMetricValue(campaign.performance?.impressions)
    const clicks = normalizeMetricValue(campaign.performance?.clicks)

    const spend = normalizeMetricValue(
      convertAmountForDisplay(rawSpend, metricCurrency, summaryDisplayCurrency)
    )
    const commission = normalizeMetricValue(
      convertAmountForDisplay(rawCommission, metricCurrency, summaryDisplayCurrency)
    )
    const roas = spend > 0 ? commission / spend : null
    const actualCpc = clicks > 0 ? spend / clicks : null

    return {
      id: campaign.id,
      campaignName: campaign.campaignName,
      spend,
      commission,
      impressions,
      clicks,
      roas,
      actualCpc,
    }
  })

  const totalSpend = campaignMetrics.reduce((sum, item) => sum + item.spend, 0)
  const totalCommission = campaignMetrics.reduce((sum, item) => sum + item.commission, 0)
  const totalImpressions = campaignMetrics.reduce((sum, item) => sum + item.impressions, 0)
  const totalClicks = campaignMetrics.reduce((sum, item) => sum + item.clicks, 0)
  const totalRoas = totalSpend > 0 ? totalCommission / totalSpend : null
  const avgActualCpc = totalClicks > 0 ? totalSpend / totalClicks : null
  const averageCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null

  const sortedByActualCpc = campaignMetrics
    .filter((item) => item.actualCpc !== null)
    .sort((a, b) => Number(a.actualCpc) - Number(b.actualCpc))
  const lowestActualCpc = sortedByActualCpc[0] || null
  const highestActualCpc =
    sortedByActualCpc.length > 0 ? sortedByActualCpc[sortedByActualCpc.length - 1] : null

  const sortedByRoasDesc = campaignMetrics
    .filter((item) => item.roas !== null)
    .sort((a, b) => {
      const roasGap = Number(b.roas) - Number(a.roas)
      if (roasGap !== 0) return roasGap
      return b.commission - a.commission
    })
  const sortedByRoasAsc = [...sortedByRoasDesc].reverse()

  return {
    generatedAt: new Date().toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }),
    timeRangeLabel,
    currency: summaryDisplayCurrency,
    campaignCount: selectedCampaigns.length,
    totalSpend,
    totalCommission,
    totalRoas,
    avgActualCpc,
    highestActualCpc,
    lowestActualCpc,
    totalImpressions,
    totalClicks,
    averageCtr,
    campaigns: campaignMetrics,
    bestTop3: sortedByRoasDesc.slice(0, 3),
    worstBottom3: sortedByRoasAsc.slice(0, 3),
  }
}
