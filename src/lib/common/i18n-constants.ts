/**
 * i18n 国际化常量文件
 * 统一管理状态标签
 */

/**
 * Offer 抓取状态
 */
export const SCRAPE_STATUS = {
  pending: '等待抓取',
  in_progress: '抓取中',
  completed: '已完成',
  failed: '失败',
} as const

/**
 * 广告系列状态 (Google Ads API)
 */
export const CAMPAIGN_STATUS = {
  ENABLED: '启用',
  PAUSED: '暂停',
  REMOVED: '已移除',
  UNKNOWN: '未知',
} as const

export function getScrapeStatusLabel(status: keyof typeof SCRAPE_STATUS): string {
  return SCRAPE_STATUS[status] || status
}

export function getCampaignStatusLabel(status: keyof typeof CAMPAIGN_STATUS): string {
  return CAMPAIGN_STATUS[status] || status
}

export type ScrapeStatus = keyof typeof SCRAPE_STATUS
export type CampaignStatus = keyof typeof CAMPAIGN_STATUS
