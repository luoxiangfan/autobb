/**
 * Store Offer：将 store_product_links 绑定到 Sitelink，并在发布前解析联盟 URL。
 */
import { resolveAffiliateLink } from '@/lib/scraping'
import {
  normalizeStoreProductLinkList,
  MAX_STORE_PRODUCT_LINKS,
} from '@/lib/offers/store-product-links'
import {
  splitUrlBaseAndSuffix,
  type PublishSitelinkInput,
  type SitelinkItem,
} from './sitelink-utils'

export function parseOfferStoreProductLinks(offer: {
  page_type?: string | null
  store_product_links?: unknown
}): string[] {
  if (offer.page_type !== 'store') return []
  const raw = offer.store_product_links
  if (Array.isArray(raw)) {
    return normalizeStoreProductLinkList(raw)
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return normalizeStoreProductLinkList(Array.isArray(parsed) ? parsed : [])
    } catch {
      return []
    }
  }
  return []
}

export function resolveOfferFallbackUrlForSitelinks(offer: {
  final_url?: string | null
  url?: string | null
}): string | null {
  const rawFinalUrl = offer.final_url
  const isFinalUrlValid =
    rawFinalUrl && rawFinalUrl !== 'null' && rawFinalUrl !== 'null/' && rawFinalUrl !== 'undefined'
  const candidate = isFinalUrlValid ? rawFinalUrl : offer.url
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

/**
 * 创意生成阶段：按 index 将 store_product_links 绑定到 Sitelink（保留 AI 文案）。
 */
export function applyStoreProductLinksToCreativeSitelinks(
  sitelinks: SitelinkItem[],
  storeProductLinks: string[],
  fallbackUrl: string | null
): SitelinkItem[] {
  if (storeProductLinks.length === 0) return sitelinks

  const pairCount = Math.min(sitelinks.length, storeProductLinks.length, MAX_STORE_PRODUCT_LINKS)

  return sitelinks.map((link, index) => {
    if (index >= pairCount) {
      if (fallbackUrl) {
        return { ...link, url: fallbackUrl }
      }
      return link
    }

    const affiliateLink = storeProductLinks[index]
    return {
      ...link,
      sourceAffiliateLink: affiliateLink,
      url: fallbackUrl || link.url,
    }
  })
}

export async function resolveStoreProductSitelinksForPublish(params: {
  sitelinks: PublishSitelinkInput[]
  storeProductLinks: string[]
  fallbackUrl: string | null
  targetCountry: string
  userId: number
  skipCache?: boolean
}): Promise<PublishSitelinkInput[]> {
  if (params.storeProductLinks.length === 0) {
    return params.sitelinks
  }

  const pairCount = Math.min(
    params.sitelinks.length,
    params.storeProductLinks.length,
    MAX_STORE_PRODUCT_LINKS
  )

  const resolved: PublishSitelinkInput[] = []

  for (let index = 0; index < params.sitelinks.length; index++) {
    const sitelink = params.sitelinks[index]
    if (index >= pairCount) {
      resolved.push({
        ...sitelink,
        url: params.fallbackUrl || sitelink.url,
      })
      continue
    }

    const affiliateLink = params.storeProductLinks[index]
    try {
      const parsed = await resolveAffiliateLink(affiliateLink, {
        targetCountry: params.targetCountry,
        userId: params.userId,
        skipCache: params.skipCache ?? true,
      })
      resolved.push({
        ...sitelink,
        url: parsed.finalUrl,
        finalUrlSuffix: parsed.finalUrlSuffix || undefined,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[sitelink-store] 单品链接解析失败 index=${index}, fallback=主链 URL: ${message}`
      )
      resolved.push({
        ...sitelink,
        url: params.fallbackUrl || sitelink.url,
      })
    }
  }

  return resolved
}

/** 从 Google Ads 拉取的 Sitelink 行 → 发布/映射输入 */
export function mapRemoteSitelinkRowToPublishInput(row: {
  linkText: string
  finalUrl: string
  finalUrlSuffix?: string | null
}): PublishSitelinkInput {
  const explicitSuffix = row.finalUrlSuffix?.trim()
  const split = splitUrlBaseAndSuffix(row.finalUrl)
  return {
    text: row.linkText,
    url: split.base,
    finalUrlSuffix: explicitSuffix || split.suffix || undefined,
  }
}
