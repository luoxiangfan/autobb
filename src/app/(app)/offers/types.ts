/**
 * Offer列表页相关类型定义
 */

export interface OfferListItem {
  id: number
  url: string
  brand: string
  category: string | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  scrapeStatus: string  // 🔧 修复(2025-12-11): snake_case → camelCase
  scrapeError?: string | null
  isActive: boolean
  createdAt: string
  offerName: string | null
  targetLanguage: string | null
  productPrice?: string | null
  commissionPayout?: string | null
  commissionType?: 'percent' | 'amount' | null
  commissionValue?: string | null
  commissionCurrency?: string | null
  // P1-11: 关联的Google Ads账号信息（只显示非MCC账号）
  // 🔧 修复(2025-12-11): snake_case → camelCase
  linkedAccounts?: Array<{
    accountId: number
    customerId: string
  }>
  // 🔥 黑名单标记
  isBlacklisted?: boolean
}

export type SortField = 'brand' | 'targetCountry' | 'scrapeStatus' | 'createdAt' | ''  // 🔧 修复
export type SortOrder = 'asc' | 'desc'

export interface OfferFilters {
  searchQuery: string
  countryFilter: string
  statusFilter: string
  sortBy: SortField
  sortOrder: SortOrder
}

export interface UnlinkTarget {
  offer: OfferListItem
  accountId: number
  accountName: string
}
