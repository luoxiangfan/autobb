import { readSitelinkUrl } from '@/lib/creatives/sitelink-utils'
import { detectPageType } from '@/lib/offers/offer-utils'
import { normalizeStoreProductLinkList } from '@/lib/offers/store-product-links'
import type { GoogleAdsCampaign } from './types'

function isProductPageUrl(url: string): boolean {
  const detected = detectPageType(url)
  return detected.isAmazonProductPage || detected.pageType === 'independent_product'
}

/** 从 Google Ads 同步的 campaign_config.sitelinks 提取店铺模式单品推广链接 */
export function extractStoreProductLinksFromCampaignConfig(
  campaignConfig?: GoogleAdsCampaign['campaign_config']
): string[] {
  const sitelinks = campaignConfig?.sitelinks
  if (!Array.isArray(sitelinks)) return []

  const urls: string[] = []
  for (const sitelink of sitelinks) {
    const rawUrl = readSitelinkUrl(sitelink).trim()
    if (!rawUrl || rawUrl === '/') continue

    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
    try {
      new URL(url)
    } catch {
      continue
    }

    if (isProductPageUrl(url)) {
      urls.push(url)
    }
  }

  return normalizeStoreProductLinkList(urls)
}

export function parseOfferStoreProductLinksColumn(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeStoreProductLinkList(parsed) : []
  } catch {
    return []
  }
}

export function serializeStoreProductLinks(links: string[]): string | null {
  const normalized = normalizeStoreProductLinkList(links)
  return normalized.length > 0 ? JSON.stringify(normalized) : null
}

export function storeProductLinksEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((url, index) => url === b[index])
}
