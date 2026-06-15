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
  needsOfferCompletion: boolean
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
