import type { AffiliatePlatform } from '@/lib/openclaw/affiliate-commission-attribution'

export type AffiliateCommissionLineItem = {
  userId: number
  username: string
  reportDate: string
  platform: AffiliatePlatform
  brandKey: string
  brandName: string
  commission: number
  advertId?: string | null
  asin?: string | null
}

export type AffiliateCommissionBrandSummary = {
  brandKey: string
  brandName: string
  platform: AffiliatePlatform
  totalCommission: number
  userId?: number
  username?: string
}

export type AffiliateCommissionDateSummary = {
  reportDate: string
  totalCommission: number
}

export type AffiliateCommissionBrandDetailRow = {
  reportDate: string
  commission: number
}

export type AffiliateCommissionDateDetailRow = {
  brandKey: string
  brandName: string
  platform: AffiliatePlatform
  commission: number
  userId?: number
  username?: string
}

export type AffiliateCommissionDateBounds = {
  minDate: string | null
  maxDate: string | null
}

export type ActiveNonAdminUser = {
  id: number
  username: string
}

export type AffiliateCommissionReportResult = {
  startDate: string
  endDate: string
  platform: import('@/lib/openclaw/affiliate-commission-platform').AffiliateCommissionReportPlatformFilter
  viewMode: import('@/lib/openclaw/affiliate-commission-platform').AffiliateCommissionReportViewMode
  currency: string
  totalCommission: number
  showUserScope: boolean
  dateBounds: AffiliateCommissionDateBounds
  brandSummaries: AffiliateCommissionBrandSummary[]
  dateSummaries: AffiliateCommissionDateSummary[]
}
