import { NextRequest, NextResponse } from 'next/server'
import { findOfferById, updateOffer, deleteOffer } from '@/lib/offers'
import { invalidateOfferCache } from '@/lib/api-cache'
import { z } from 'zod'
import { compactCategoryLabel, deriveCategoryFromScrapedData } from '@/lib/offer-category'
import { filterNavigationLabels } from '@/lib/scrape-text-filters'
import { normalizeOfferCommissionInput } from '@/lib/offer-monetization'

function safeParseJson<T>(input: unknown): T | null {
  if (typeof input !== 'string' || !input.trim()) return null
  try {
    return JSON.parse(input) as T
  } catch {
    return null
  }
}

function pickNonEmptyString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

function pickTopLines(input: unknown, limit: number): string[] {
  if (!Array.isArray(input) || limit <= 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string') continue
    const line = item.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= limit) break
  }
  return out
}

function normalizeTextCandidate(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  if (!raw) return null

  // 过滤明显无意义的“页面占位”文本（生产环境常见：Amazon Store 标题/描述被解析为 Home Page）
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const generic = new Set([
    'home page',
    'homepage',
    'home',
    'index',
    'index page',
  ])
  if (generic.has(normalized)) return null

  // "Home Page | xxx" / "xxx | Home Page" 这类也视为无效
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
    return { brandDescription: null, uniqueSellingPoints: null, productHighlights: null, targetAudience: null }
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

  const featuresRaw = deepTopProducts.flatMap((t: any) => Array.isArray(t?.productData?.features) ? t.productData.features : [])
  const features = filterNavigationLabels(featuresRaw)
  const rawFeatureLines = pickTopLines(features, 20)
  const uniqueSellingPointsLines = pickTopLines(rawFeatureLines.map(featureHeading), 4)
  const productHighlightsLines = pickTopLines(rawFeatureLines.map(featureDetail), 3)

  // 店铺页兜底：若没有可用features，则从“分类/产品名”拼一个可读的亮点列表
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
        uniqueSellingPointsLines.push(`Popular categories: ${topCatalogLines.slice(0, 4).join(', ')}.`)
      }
    }
  }

  const brandParts: string[] = []
  if (storeDescription) {
    brandParts.push(storeDescription)
  } else if (productDescriptions.length > 0) {
    brandParts.push(dropLeadingFeatureHeading(productDescriptions[0]))
  }
  const brandDescription = brandParts.length > 0 ? brandParts.join('\n\n').slice(0, 1200).trim() : null

  let targetAudience: string | null = null
  const audienceHintText = [
    storeDescription,
    ...productDescriptions.slice(0, 2),
    ...uniqueSellingPointsLines,
    ...productHighlightsLines,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0).join(' ').toLowerCase()

  if (audienceHintText) {
    const hasHome = /\bhome\b/.test(audienceHintText) || audienceHintText.includes('at home') || audienceHintText.includes('kitchen')
    const hasOffice = /\boffice\b/.test(audienceHintText)
    if (hasHome && hasOffice) targetAudience = 'Home and office users.'
    else if (hasHome) targetAudience = 'Home users.'
    else if (hasOffice) targetAudience = 'Office users.'
  }

  return {
    brandDescription: normalizeTextCandidate(brandDescription),
    uniqueSellingPoints: uniqueSellingPointsLines.length > 0 ? uniqueSellingPointsLines.join('\n') : null,
    productHighlights: productHighlightsLines.length > 0 ? productHighlightsLines.join('\n') : null,
    targetAudience,
  }
}

/**
 * GET /api/offers/:id
 * 获取单个Offer
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const offer = await findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    const categoryFromScrape = deriveCategoryFromScrapedData(offer.scraped_data)
    const categoryFromStored = offer.category ? compactCategoryLabel(offer.category) : null
    const categoryForDisplay = categoryFromScrape || categoryFromStored || offer.category
    const categorySource = categoryFromScrape ? 'scraped_data' : (categoryFromStored ? 'category' : null)

    // 🔥 修复：部分生产Offer没有写入 brand_description/product_highlights 等字段
    // 但 scraped_data 中已有 storeDescription / deepScrapeResults，可用于详情页展示兜底
    const scrapedData = safeParseJson<any>(offer.scraped_data)
    const scrapedProductDescription = pickNonEmptyString(
      normalizeTextCandidate(scrapedData?.productDescription),
      normalizeTextCandidate(scrapedData?.storeDescription),
      normalizeTextCandidate(scrapedData?.metaDescription)
    )
    const scrapedStoreDescription = pickNonEmptyString(normalizeTextCandidate(scrapedData?.storeDescription))
    const storeDerived = buildStoreDescriptionFromScrapedData(scrapedData)

    // 🔥 修复：历史数据可能错误写入 page_type=product（实际上是店铺）
    // 规则：如果 scraped_data 体现“店铺结构”（storeName/products/deepScrapeResults），则详情页按店铺展示
    const pageTypeFromScrapedData = (() => {
      if (!scrapedData || typeof scrapedData !== 'object') return null
      const productsLen = Array.isArray(scrapedData.products) ? scrapedData.products.length : 0
      const hasStoreName = typeof scrapedData.storeName === 'string' && scrapedData.storeName.trim().length > 0
      const hasDeep = !!scrapedData.deepScrapeResults
      const explicit = typeof scrapedData.pageType === 'string' ? scrapedData.pageType : null
      if (explicit === 'store' || explicit === 'product') return explicit
      if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
      return null
    })()

    const pageTypeEffective = pageTypeFromScrapedData || offer.page_type || 'product'
    const isStorePage = pageTypeEffective === 'store'
    const storeProductLinks = safeParseJson<string[]>(offer.store_product_links) || []

    const storedUniqueSellingPoints = normalizeTextCandidate(offer.unique_selling_points)
    const storedProductHighlights = normalizeTextCandidate(offer.product_highlights)
    const storedBrandDescription = normalizeTextCandidate(offer.brand_description)
    const preferDerivedDescriptions =
      isStorePage &&
      areNearDuplicate(storedUniqueSellingPoints, storedProductHighlights)

    const uniqueSellingPoints = pickNonEmptyString(
      preferDerivedDescriptions ? storeDerived.uniqueSellingPoints : storedUniqueSellingPoints,
      storedUniqueSellingPoints,
      storeDerived.uniqueSellingPoints
    )

    const productHighlights = pickNonEmptyString(
      preferDerivedDescriptions ? storeDerived.productHighlights : storedProductHighlights,
      storedProductHighlights,
      storeDerived.productHighlights,
      scrapedProductDescription
    )

    return NextResponse.json({
      success: true,
      offer: {
        id: offer.id,
        url: offer.url,
        brand: offer.brand,
        offerName: offer.offer_name, // 🔧 添加offer_name字段映射
        category: categoryForDisplay,
        categoryRaw: offer.category,
        categorySource,
        targetCountry: offer.target_country,
        targetLanguage: offer.target_language, // 🔧 修复(2025-12-11): 添加target_language字段
        affiliateLink: offer.affiliate_link,
        brandDescription: pickNonEmptyString(
          preferDerivedDescriptions ? storeDerived.brandDescription : storedBrandDescription,
          storedBrandDescription,
          storeDerived.brandDescription,
          scrapedStoreDescription
        ),
        uniqueSellingPoints,
        productHighlights,
        targetAudience: pickNonEmptyString(
          normalizeTextCandidate(offer.target_audience),
          storeDerived.targetAudience
        ),
        // Final URL字段（从推广链接解析后的最终落地页）
        finalUrl: offer.final_url,
        finalUrlSuffix: offer.final_url_suffix,
        // 🔧 修复(2025-12-11): 添加产品价格和佣金比例字段（需求28：计算建议CPC）
        productPrice: offer.product_price,
        commissionPayout: offer.commission_payout,
        commissionType: offer.commission_type,
        commissionValue: offer.commission_value,
        commissionCurrency: offer.commission_currency,
        scrapeStatus: offer.scrape_status,
        scrapeError: offer.scrape_error,
        scrapedAt: offer.scraped_at,
        // 🔥 修复：兼容PostgreSQL(BOOLEAN)和SQLite(INTEGER)
        isActive: offer.is_active === true || offer.is_active === 1,
        createdAt: offer.created_at,
        updatedAt: offer.updated_at,
        // AI分析结果字段（仅返回评论分析和竞品分析）
        reviewAnalysis: offer.review_analysis,
        competitorAnalysis: offer.competitor_analysis,
        // 链接类型（店铺/单品）
        pageType: pageTypeEffective,
        storeProductLinks,
      },
    })
  } catch (error: any) {
    console.error('获取Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Offer失败',
      },
      { status: 500 }
    )
  }
}

const updateOfferSchema = z.object({
  url: z.string().url('无效的URL格式').optional(),
  brand: z.string().min(1, '品牌名称不能为空').optional(),
  category: z.string().optional(),
  target_country: z.string().min(2, '目标国家代码至少2个字符').optional(),
  affiliate_link: z.string().url('无效的联盟链接格式').optional(),
  brand_description: z.string().optional(),
  unique_selling_points: z.string().optional(),
  product_highlights: z.string().optional(),
  target_audience: z.string().optional(),
  page_type: z.enum(['store', 'product']).optional(),
  store_product_links: z.array(z.string().url('无效的URL格式')).max(3).optional(),
  product_price: z.string().optional(),
  commission_payout: z.string().optional(),
  commission_type: z.enum(['percent', 'amount']).optional(),
  commission_value: z.union([z.string(), z.number()]).optional(),
  commission_currency: z.string().optional(),
  is_active: z.boolean().optional(),
})

/**
 * PUT /api/offers/:id
 * 更新Offer
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()

    // 验证输入
    const validationResult = updateOfferSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const pageType = validationResult.data.page_type || undefined
    const storeProductLinksInput = validationResult.data.store_product_links
    let storeProductLinks: string[] | undefined = undefined
    if (pageType === 'store' && storeProductLinksInput !== undefined) {
      storeProductLinks = storeProductLinksInput
        .map((link) => link.trim())
        .filter((link) => Boolean(link))
      storeProductLinks = Array.from(new Set(storeProductLinks)).slice(0, 3)
    }

    const hasCommissionInput = validationResult.data.commission_payout !== undefined
      || validationResult.data.commission_type !== undefined
      || validationResult.data.commission_value !== undefined
      || validationResult.data.commission_currency !== undefined

    let normalizedCommission: ReturnType<typeof normalizeOfferCommissionInput> | null = null
    if (hasCommissionInput) {
      let commissionTargetCountry = validationResult.data.target_country
      if (!commissionTargetCountry) {
        const existingOffer = await findOfferById(parseInt(id, 10), parseInt(userId, 10))
        if (!existingOffer) {
          return NextResponse.json(
            {
              error: 'Offer不存在或无权访问',
            },
            { status: 404 }
          )
        }
        commissionTargetCountry = existingOffer.target_country
      }

      try {
        normalizedCommission = normalizeOfferCommissionInput({
          targetCountry: commissionTargetCountry,
          commissionPayout: validationResult.data.commission_payout,
          commissionType: validationResult.data.commission_type,
          commissionValue: validationResult.data.commission_value,
          commissionCurrency: validationResult.data.commission_currency,
        })
      } catch (error: any) {
        return NextResponse.json(
          {
            error: error?.message || '佣金参数格式错误',
          },
          { status: 400 }
        )
      }
    }

    const offer = await updateOffer(parseInt(id, 10), parseInt(userId, 10), {
      url: validationResult.data.url,
      brand: validationResult.data.brand,
      category: validationResult.data.category,
      target_country: validationResult.data.target_country,
      affiliate_link: validationResult.data.affiliate_link,
      store_product_links: storeProductLinks !== undefined
        ? (storeProductLinks.length > 0 ? JSON.stringify(storeProductLinks) : null)
        : undefined,
      brand_description: validationResult.data.brand_description,
      unique_selling_points: validationResult.data.unique_selling_points,
      product_highlights: validationResult.data.product_highlights,
      target_audience: validationResult.data.target_audience,
      product_price: validationResult.data.product_price,
      commission_payout: hasCommissionInput ? (normalizedCommission?.commissionPayout || undefined) : undefined,
      commission_type: hasCommissionInput ? (normalizedCommission?.commissionType || undefined) : undefined,
      commission_value: hasCommissionInput ? (normalizedCommission?.commissionValue || undefined) : undefined,
      commission_currency: hasCommissionInput ? (normalizedCommission?.commissionCurrency || undefined) : undefined,
      page_type: pageType,
      is_active: validationResult.data.is_active,
    })

    // 使缓存失效
    invalidateOfferCache(parseInt(userId, 10), parseInt(id, 10))

    return NextResponse.json({
      success: true,
      offer: {
        id: offer.id,
        url: offer.url,
        brand: offer.brand,
        offerName: offer.offer_name, // 🔧 添加offer_name字段映射
        category: offer.category ? compactCategoryLabel(offer.category) : offer.category,
        categoryRaw: offer.category,
        targetCountry: offer.target_country,
        targetLanguage: offer.target_language, // 🔧 修复(2025-12-11): 添加target_language字段
        affiliateLink: offer.affiliate_link,
        brandDescription: offer.brand_description,
        uniqueSellingPoints: offer.unique_selling_points,
        productHighlights: offer.product_highlights,
        targetAudience: offer.target_audience,
        // Final URL字段（从推广链接解析后的最终落地页）
        finalUrl: offer.final_url,
        finalUrlSuffix: offer.final_url_suffix,
        productPrice: offer.product_price,
        commissionPayout: offer.commission_payout,
        commissionType: offer.commission_type,
        commissionValue: offer.commission_value,
        commissionCurrency: offer.commission_currency,
        pageType: offer.page_type,
        storeProductLinks: offer.store_product_links,
        scrapeStatus: offer.scrape_status,
        // 🔥 修复：兼容PostgreSQL(BOOLEAN)和SQLite(INTEGER)
        isActive: offer.is_active === true || offer.is_active === 1,
        createdAt: offer.created_at,
        updatedAt: offer.updated_at,
      },
    })
  } catch (error: any) {
    console.error('更新Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新Offer失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/offers/:id
 * 删除Offer
 *
 * Query参数：
 * - autoUnlink: boolean (可选) - 是否自动解除关联，默认false
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const autoUnlink = searchParams.get('autoUnlink') === 'true'
    const removeGoogleAdsCampaigns = searchParams.get('removeGoogleAdsCampaigns') === 'true'

    // 执行删除操作
    const result = await deleteOffer(
      parseInt(id, 10),
      parseInt(userId, 10),
      autoUnlink,
      removeGoogleAdsCampaigns
    )

    // 使缓存失效
    invalidateOfferCache(parseInt(userId, 10), parseInt(id, 10))

    // 如果有关联账号且未自动解除，返回409状态码和详情
    if (!result.success && result.hasLinkedAccounts) {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
          hasLinkedAccounts: true,
          linkedAccounts: result.linkedAccounts,
          accountCount: result.accountCount,
          campaignCount: result.campaignCount
        },
        { status: 409 } // 409 Conflict: 资源冲突，需要用户确认
      )
    }

    // 删除成功
    return NextResponse.json({
      success: true,
      message: result.message,
    })
  } catch (error: any) {
    console.error('删除Offer失败:', error)

    // 区分不同类型的错误，返回合适的HTTP状态码
    const errorMessage = error.message || '删除Offer失败'

    // 资源不存在或权限错误
    if (errorMessage.includes('Offer不存在或无权访问')) {
      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 404 } // 404 Not Found
      )
    }

    // 其他未知错误，视为服务器内部错误
    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 }
    )
  }
}
