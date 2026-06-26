import { pickNonEmptyString, pickTopUniqueLines } from '@/lib/common/server'
import {
  compactCategoryLabel,
  deriveCategoryFromScrapedData,
  normalizeOfferExtractionMode,
  resolveOfferLinkType,
} from '@/lib/offers/server'
import type { Offer } from '@/lib/offers/offers'
import { filterNavigationLabels } from '@/lib/scraping'

export type OfferGetDisplayPayload = {
  id: number
  url: string
  brand: string
  offerName: string | null
  category: string | null
  categoryRaw: string | null
  categorySource: 'scraped_data' | 'category' | null
  targetCountry: string | null
  targetLanguage: string | null
  affiliateLink: string | null
  brandDescription: string | null
  uniqueSellingPoints: string | null
  productHighlights: string | null
  targetAudience: string | null
  finalUrl: string | null
  finalUrlSuffix: string | null
  productPrice: string | null
  commissionPayout: string | null
  commissionType: string | null
  commissionValue: string | null
  commissionCurrency: string | null
  scrapeStatus: string | null
  scrapeError: string | null
  scrapedAt: string | null
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
  reviewAnalysis: string | null
  competitorAnalysis: string | null
  pageType: 'product' | 'store'
  storeProductLinks: string[]
  extractionMode: ReturnType<typeof normalizeOfferExtractionMode>
}

function safeParseJson<T>(input: unknown): T | null {
  if (typeof input !== 'string' || !input.trim()) return null
  try {
    return JSON.parse(input) as T
  } catch {
    return null
  }
}

function pickTopLines(input: unknown, limit: number): string[] {
  return pickTopUniqueLines(input, limit)
}

function normalizeTextCandidate(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  if (!raw) return null

  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const generic = new Set(['home page', 'homepage', 'home', 'index', 'index page'])
  if (generic.has(normalized)) return null

  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (/(^|\s|\|)home\s*page($|\s|\|)/i.test(collapsed) && collapsed.length <= 40) return null

  return raw
}

function normalizeForCompare(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
}

function areNearDuplicate(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length < 80 || nb.length < 80) return false
  return na.includes(nb) || nb.includes(na)
}

function cleanAmazonDescription(input: string): string {
  let text = input.replace(/\s+/g, ' ').trim()
  text = text.replace(/^about\s+this\s+item\s*/i, '')
  text = text.replace(/›\s*see\s+more\s+product\s+details.*$/i, '')
  return text.trim()
}

function dropLeadingFeatureHeading(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const colonIndex = collapsed.indexOf(':')
  if (colonIndex > 0 && colonIndex <= 60) {
    const after = collapsed.slice(colonIndex + 1).trim()
    if (after.length >= 40) return after
  }
  return collapsed
}

function featureHeading(line: string): string {
  const cleaned = line.replace(/\s+/g, ' ').trim()
  const colonIndex = cleaned.indexOf(':')
  if (colonIndex > 0 && colonIndex <= 60) {
    return cleaned.slice(0, colonIndex).trim()
  }
  const sentenceIndex = cleaned.search(/[.!?]\s/)
  if (sentenceIndex > 0 && sentenceIndex <= 80) {
    return cleaned.slice(0, sentenceIndex + 1).trim()
  }
  return cleaned.length > 80 ? `${cleaned.slice(0, 77).trim()}...` : cleaned
}

function featureDetail(line: string): string {
  const cleaned = line.replace(/\s+/g, ' ').trim()
  const colonIndex = cleaned.indexOf(':')
  const detail = colonIndex > 0 && colonIndex <= 60 ? cleaned.slice(colonIndex + 1).trim() : cleaned
  return detail.length > 160 ? `${detail.slice(0, 157).trim()}...` : detail
}

function buildStoreDescriptionFromScrapedData(scrapedData: any): {
  brandDescription: string | null
  uniqueSellingPoints: string | null
  productHighlights: string | null
  targetAudience: string | null
} {
  if (!scrapedData || typeof scrapedData !== 'object') {
    return {
      brandDescription: null,
      uniqueSellingPoints: null,
      productHighlights: null,
      targetAudience: null,
    }
  }

  const storeDescription = pickNonEmptyString(
    normalizeTextCandidate(scrapedData.storeDescription),
    normalizeTextCandidate(scrapedData.productDescription),
    normalizeTextCandidate(scrapedData.metaDescription)
  )

  const deepTopProducts = Array.isArray(scrapedData?.deepScrapeResults?.topProducts)
    ? scrapedData.deepScrapeResults.topProducts
    : []

  const productDescriptions = deepTopProducts
    .map((t: any) => {
      const desc = normalizeTextCandidate(pickNonEmptyString(t?.productData?.productDescription))
      return desc ? normalizeTextCandidate(cleanAmazonDescription(desc)) : null
    })
    .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)

  const featuresRaw = deepTopProducts.flatMap((t: any) =>
    Array.isArray(t?.productData?.features) ? t.productData.features : []
  )
  const features = filterNavigationLabels(featuresRaw)
  const rawFeatureLines = pickTopLines(features, 20)
  const uniqueSellingPointsLines = pickTopLines(rawFeatureLines.map(featureHeading), 4)
  const productHighlightsLines = pickTopLines(rawFeatureLines.map(featureDetail), 3)

  if (productHighlightsLines.length === 0) {
    const catalogCandidatesRaw: unknown[] = []
    const primaryCategories = Array.isArray(scrapedData?.productCategories?.primaryCategories)
      ? scrapedData.productCategories.primaryCategories
      : []
    for (const c of primaryCategories) {
      if (typeof c?.name === 'string') catalogCandidatesRaw.push(c.name)
    }
    const products = Array.isArray(scrapedData?.products) ? scrapedData.products : []
    for (const p of products) {
      if (typeof p?.name === 'string') catalogCandidatesRaw.push(p.name)
    }
    for (const t of deepTopProducts) {
      const name = t?.productData?.productName
      if (typeof name === 'string') catalogCandidatesRaw.push(name)
    }
    const catalogCandidates = filterNavigationLabels(catalogCandidatesRaw)
    const topCatalogLines = pickTopLines(catalogCandidates, 5)
    if (topCatalogLines.length > 0) {
      productHighlightsLines.push(...topCatalogLines.slice(0, 3))
      if (uniqueSellingPointsLines.length === 0) {
        uniqueSellingPointsLines.push(
          `Popular categories: ${topCatalogLines.slice(0, 4).join(', ')}.`
        )
      }
    }
  }

  const brandParts: string[] = []
  if (storeDescription) {
    brandParts.push(storeDescription)
  } else if (productDescriptions.length > 0) {
    brandParts.push(dropLeadingFeatureHeading(productDescriptions[0]))
  }
  const brandDescription =
    brandParts.length > 0 ? brandParts.join('\n\n').slice(0, 1200).trim() : null

  let targetAudience: string | null = null
  const audienceHintText = [
    storeDescription,
    ...productDescriptions.slice(0, 2),
    ...uniqueSellingPointsLines,
    ...productHighlightsLines,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toLowerCase()

  if (audienceHintText) {
    const hasHome =
      /\bhome\b/.test(audienceHintText) ||
      audienceHintText.includes('at home') ||
      audienceHintText.includes('kitchen')
    const hasOffice = /\boffice\b/.test(audienceHintText)
    if (hasHome && hasOffice) targetAudience = 'Home and office users.'
    else if (hasHome) targetAudience = 'Home users.'
    else if (hasOffice) targetAudience = 'Office users.'
  }

  return {
    brandDescription: normalizeTextCandidate(brandDescription),
    uniqueSellingPoints:
      uniqueSellingPointsLines.length > 0 ? uniqueSellingPointsLines.join('\n') : null,
    productHighlights: productHighlightsLines.length > 0 ? productHighlightsLines.join('\n') : null,
    targetAudience,
  }
}

export function mapOfferToGetResponse(offer: Offer): OfferGetDisplayPayload {
  const categoryFromScrape = deriveCategoryFromScrapedData(offer.scraped_data)
  const categoryFromStored = offer.category ? compactCategoryLabel(offer.category) : null
  const categoryForDisplay = categoryFromScrape || categoryFromStored || offer.category
  const categorySource = categoryFromScrape
    ? 'scraped_data'
    : categoryFromStored
      ? 'category'
      : null

  const scrapedData = safeParseJson<any>(offer.scraped_data)
  const scrapedProductDescription = pickNonEmptyString(
    normalizeTextCandidate(scrapedData?.productDescription),
    normalizeTextCandidate(scrapedData?.storeDescription),
    normalizeTextCandidate(scrapedData?.metaDescription)
  )
  const scrapedStoreDescription = pickNonEmptyString(
    normalizeTextCandidate(scrapedData?.storeDescription)
  )
  const storeDerived = buildStoreDescriptionFromScrapedData(scrapedData)

  const pageTypeEffective = resolveOfferLinkType(
    { page_type: offer.page_type, scraped_data: offer.scraped_data },
    { allowProductOverrideByDerivedStore: true }
  )
  const isStorePage = pageTypeEffective === 'store'
  const storeProductLinks = safeParseJson<string[]>(offer.store_product_links) || []

  const storedUniqueSellingPoints = normalizeTextCandidate(offer.unique_selling_points)
  const storedProductHighlights = normalizeTextCandidate(offer.product_highlights)
  const storedBrandDescription = normalizeTextCandidate(offer.brand_description)
  const preferDerivedDescriptions =
    isStorePage && areNearDuplicate(storedUniqueSellingPoints, storedProductHighlights)

  return {
    id: offer.id,
    url: offer.url,
    brand: offer.brand,
    offerName: offer.offer_name,
    category: categoryForDisplay,
    categoryRaw: offer.category,
    categorySource,
    targetCountry: offer.target_country,
    targetLanguage: offer.target_language,
    affiliateLink: offer.affiliate_link,
    brandDescription: pickNonEmptyString(
      preferDerivedDescriptions ? storeDerived.brandDescription : storedBrandDescription,
      storedBrandDescription,
      storeDerived.brandDescription,
      scrapedStoreDescription
    ),
    uniqueSellingPoints: pickNonEmptyString(
      preferDerivedDescriptions ? storeDerived.uniqueSellingPoints : storedUniqueSellingPoints,
      storedUniqueSellingPoints,
      storeDerived.uniqueSellingPoints
    ),
    productHighlights: pickNonEmptyString(
      preferDerivedDescriptions ? storeDerived.productHighlights : storedProductHighlights,
      storedProductHighlights,
      storeDerived.productHighlights,
      scrapedProductDescription
    ),
    targetAudience: pickNonEmptyString(
      normalizeTextCandidate(offer.target_audience),
      storeDerived.targetAudience
    ),
    finalUrl: offer.final_url,
    finalUrlSuffix: offer.final_url_suffix,
    productPrice: offer.product_price,
    commissionPayout: offer.commission_payout,
    commissionType: offer.commission_type,
    commissionValue: offer.commission_value,
    commissionCurrency: offer.commission_currency,
    scrapeStatus: offer.scrape_status,
    scrapeError: offer.scrape_error,
    scrapedAt: offer.scraped_at,
    isActive: offer.is_active === true,
    createdAt: offer.created_at,
    updatedAt: offer.updated_at,
    reviewAnalysis: offer.review_analysis,
    competitorAnalysis: offer.competitor_analysis,
    pageType: pageTypeEffective,
    storeProductLinks,
    extractionMode: normalizeOfferExtractionMode(offer.extraction_mode),
  }
}
