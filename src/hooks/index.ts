/**
 * Hooks 统一导出
 *
 * 使用方式:
 * import { usePagination, useOffers, useMediaQuery } from '@/hooks'
 */

// 分页管理
export { usePagination } from './usePagination'
export type { UsePaginationOptions, UsePaginationReturn } from './usePagination'

// SWR 数据获取
export {
  useOffers,
  useOffer,
  useDashboardKPIs,
  useDashboardSummary,
  useCampaigns,
  useGoogleAdsAccounts,
  useCreatives,
  useABTests,
} from './useAPI'

// 响应式媒体查询
export {
  useMediaQuery,
  useIsMobile,
  useIsTablet,
  useIsDesktop,
} from './useMediaQuery'

// Offer 提取
export { useOfferExtraction } from './useOfferExtraction'
