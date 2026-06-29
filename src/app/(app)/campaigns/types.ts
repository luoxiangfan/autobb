export interface Campaign {
  id: number
  offerId: number
  googleAdsAccountId: number | null
  adsAccountCustomerId?: string | null
  adsAccountName?: string | null
  googleCampaignId?: string | null
  campaignId: string | null
  campaignName: string
  customName: string | null
  budgetAmount: number
  budgetType: string
  status: string
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  servingStartDate?: string | null
  adsAccountAvailable?: boolean
  adsAccountCurrency?: string | null
  performanceCurrency?: string | null
  configuredMaxCpc?: number | null
  createdAt: string
  isDeleted?: boolean | number
  deletedAt?: string | null
  offerIsDeleted?: boolean | number
  offerSyncSource: string
  clickFarmTaskStatus: string | null
  urlSwapTaskStatus: string | null
  statusCategory: string
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    commission?: number
    commissionBase?: number
    costLocal?: number
    costUsd: number
    costBase?: number
    ctr: number
    cpcLocal?: number
    cpcUsd: number
    cpcBase?: number
    conversionRate: number
    commissionPerClick?: number
    dateRange: {
      start: string
      end: string
      days: number
    }
  }
}

export type BatchOfflineFailure = {
  campaignName: string
  message: string
}

export type BatchOfflineAccountIssue = {
  campaign: Campaign
  message: string
  accountStatus?: string
}

export type BatchOfflinePendingState = {
  totalCount: number
  successCount: number
  failures: BatchOfflineFailure[]
  accountIssues: BatchOfflineAccountIssue[]
}

export type CampaignRoasRankItem = {
  id: number
  campaignName: string
  spend: number
  commission: number
  impressions: number
  clicks: number
  roas: number | null
  actualCpc: number | null
}

export type OverallRoasStatistics = {
  generatedAt: string
  timeRangeLabel: string
  currency: string
  campaignCount: number
  totalSpend: number
  totalCommission: number
  totalRoas: number | null
  avgActualCpc: number | null
  highestActualCpc: CampaignRoasRankItem | null
  lowestActualCpc: CampaignRoasRankItem | null
  totalImpressions: number
  totalClicks: number
  averageCtr: number | null
  campaigns: CampaignRoasRankItem[]
  bestTop3: CampaignRoasRankItem[]
  worstBottom3: CampaignRoasRankItem[]
}

export type CampaignSortField =
  | 'campaignName'
  | 'budgetAmount'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'cpc'
  | 'configuredMaxCpc'
  | 'conversions'
  | 'cost'
  | 'roas'
  | 'status'
  | 'servingStartDate'

export type CampaignSortDirection = 'asc' | 'desc' | null
