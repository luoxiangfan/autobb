import { resolveAffiliateLink } from '@/lib/url-resolver-enhanced'
import { extractProductInfo } from '@/lib/scraper'
import { detectPageType } from '@/lib/offer-utils'
import { scrapeAmazonProduct } from '@/lib/stealth-scraper'

export type SupplementalProductResult = {
  sourceAffiliateLink: string
  finalUrl: string | null
  finalUrlSuffix?: string | null
  pageType?: string | null
  productName?: string | null
  productPrice?: string | null
  productDescription?: string | null
  brandName?: string | null
  productFeatures?: string[] | null
  rating?: string | null
  reviewCount?: string | null
  reviewHighlights?: string[] | null
  topReviews?: string[] | null
  imageUrls?: string[] | null
  category?: string | null
  error?: string | null
}

type ScrapeOptions = {
  targetCountry: string
  userId: number
  proxyUrl?: string | null
  maxLinks?: number
  concurrency?: number
  onItem?: (payload: {
    index: number
    total: number
    link: string
    result: SupplementalProductResult
  }) => void
}

function normalizeLinks(links: string[], maxLinks = 3): string[] {
  const normalized = links
    .map((link) => (typeof link === 'string' ? link.trim() : ''))
    .filter(Boolean)
  return Array.from(new Set(normalized)).slice(0, maxLinks)
}

async function scrapeSupplementalProductLink(
  link: string,
  options: Pick<ScrapeOptions, 'targetCountry' | 'userId' | 'proxyUrl'>
): Promise<SupplementalProductResult> {
  const { targetCountry, userId, proxyUrl } = options
  const result: SupplementalProductResult = {
    sourceAffiliateLink: link,
    finalUrl: null,
    finalUrlSuffix: null,
    pageType: null,
    error: null,
  }

  try {
    const resolved = await resolveAffiliateLink(link, {
      targetCountry,
      userId,
      skipCache: true,
    })

    result.finalUrl = resolved.finalUrl || null
    result.finalUrlSuffix = resolved.finalUrlSuffix || null

    if (!resolved.finalUrl) {
      result.error = '无法解析最终落地页'
      return result
    }

    const pageType = detectPageType(resolved.finalUrl)
    result.pageType = pageType.pageType

    const fullTargetUrl = resolved.finalUrlSuffix
      ? `${resolved.finalUrl}?${resolved.finalUrlSuffix}`
      : resolved.finalUrl

    if (pageType.isAmazonProductPage) {
      const amazonProductData = await scrapeAmazonProduct(fullTargetUrl, proxyUrl || undefined, targetCountry)
      result.productName = amazonProductData.productName || null
      result.productPrice = amazonProductData.productPrice || null
      result.productDescription = amazonProductData.productDescription || null
      result.brandName = amazonProductData.brandName || null
      result.productFeatures = amazonProductData.features || []
      result.rating = amazonProductData.rating || null
      result.reviewCount = amazonProductData.reviewCount || null
      result.reviewHighlights = amazonProductData.reviewHighlights || []
      result.topReviews = amazonProductData.topReviews || []
      result.imageUrls = amazonProductData.imageUrls || []
      result.category = amazonProductData.category || null
      return result
    }

    if (pageType.isAmazonStore || pageType.isIndependentStore) {
      result.error = '链接为店铺页，无法作为单品补充'
      return result
    }

    let scrapedData: import('./scraper').ScrapedProductData | null = null
    try {
      scrapedData = await extractProductInfo(fullTargetUrl, targetCountry, proxyUrl || undefined, 30000)
    } catch {
      scrapedData = null
    }

    if (!scrapedData || (!scrapedData.brandName && !scrapedData.productName)) {
      try {
        const { scrapeIndependentProduct } = await import('@/lib/stealth-scraper')
        const independentProductData = await scrapeIndependentProduct(
          fullTargetUrl,
          proxyUrl || undefined,
          targetCountry,
          2
        )
        scrapedData = {
          productName: independentProductData.productName,
          productDescription: independentProductData.productDescription,
          productPrice: independentProductData.productPrice,
          productCategory: null,
          productFeatures: [],
          brandName: independentProductData.brandName,
          imageUrls: [],
          metaTitle: null,
          metaDescription: null,
        }
      } catch (playwrightErr: any) {
        result.error = playwrightErr?.message || 'Playwright抓取失败'
        return result
      }
    }

    if (scrapedData) {
      result.productName = scrapedData.productName || null
      result.productPrice = scrapedData.productPrice || null
      result.productDescription = scrapedData.productDescription || null
      result.brandName = scrapedData.brandName || null
      result.productFeatures = scrapedData.productFeatures || []
      result.imageUrls = scrapedData.imageUrls || []
      result.category = scrapedData.productCategory || null
    }

    return result
  } catch (error: any) {
    result.error = error?.message || '抓取失败'
    return result
  }
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let cursor = 0

  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++
      results[index] = await tasks[index]()
    }
  }

  const runners = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(runners)
  return results
}

export async function scrapeSupplementalProducts(
  links: string[],
  options: ScrapeOptions
): Promise<SupplementalProductResult[]> {
  const normalizedLinks = normalizeLinks(links, options.maxLinks ?? 3)
  if (normalizedLinks.length === 0) return []

  const total = normalizedLinks.length
  const concurrency = Math.max(1, options.concurrency ?? 2)
  const tasks = normalizedLinks.map((link, index) => async () => {
    const result = await scrapeSupplementalProductLink(link, options)
    options.onItem?.({
      index,
      total,
      link,
      result,
    })
    return result
  })

  return await runWithConcurrency(tasks, concurrency)
}
