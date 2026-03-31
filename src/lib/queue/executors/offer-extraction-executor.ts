/**
 * Offer提取任务执行器
 *
 * 功能：
 * 1. 调用核心extractOffer函数
 * 2. 将进度更新到offer_tasks表
 * 3. 支持SSE实时推送（通过数据库轮询）
 */

import type { Task } from '../types'
import { extractOffer } from '@/lib/offer-extraction-core'
import { getDatabase } from '@/lib/db'
import { executeAIAnalysis } from '@/lib/ai-analysis-service'
import { getTargetLanguage, normalizeBrandName } from '@/lib/offer-utils'
import { createOffer, updateOfferScrapeStatus, updateOffer } from '@/lib/offers'
import type { BrandSearchSupplement, SerpSitelink } from '@/lib/google-brand-search'
import { deriveCategoryFromScrapedData } from '@/lib/offer-category'
import { filterNavigationLabels } from '@/lib/scrape-text-filters'
import { parsePrice } from '@/lib/pricing-utils'
import { toDbJsonObjectField } from '@/lib/json-field'
import { extractScenariosFromReviews } from '@/lib/scenario-extractor'
import { stripTrailingCountryCodeSuffix } from '@/lib/brand-suffix-utils'

function mergeUniqueStrings(primary: string[] | null | undefined, secondary: string[] | null | undefined, limit: number): string[] | null {
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of [primary, secondary]) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (typeof raw !== 'string') continue
      const v = raw.trim()
      if (!v) continue
      const key = v.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(v)
      if (out.length >= limit) return out
    }
  }
  return out.length > 0 ? out : null
}

function mergeUniqueSitelinks(primary: SerpSitelink[] | null | undefined, secondary: SerpSitelink[] | null | undefined, limit: number): SerpSitelink[] | null {
  const out: SerpSitelink[] = []
  const seen = new Set<string>()
  for (const list of [primary, secondary]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const text = item?.text?.trim()
      if (!text) continue
      const description = item?.description?.trim() || undefined
      const key = `${text.toLowerCase()}__${(description || '').toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text, description })
      if (out.length >= limit) return out
    }
  }
  return out.length > 0 ? out : null
}

function pickNonEmptyString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

function pickTopUniqueLines(input: unknown, limit: number): string[] {
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

function computeAveragePriceFromStrings(prices: Array<unknown>): string | undefined {
  const values: number[] = []
  for (const raw of prices) {
    if (typeof raw !== 'string') continue
    const num = parsePrice(raw)
    if (typeof num === 'number' && !Number.isNaN(num)) values.push(num)
  }
  if (values.length === 0) return undefined
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length
  return avg > 0 ? avg.toFixed(2) : undefined
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function normalizePersistedBrand(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const normalized = normalizeBrandName(trimmed)
  const withoutCountryCode = stripTrailingCountryCodeSuffix(normalized)
  return normalizeBrandName(withoutCountryCode)
}

function sanitizeResolvedFinalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const lower = trimmed.toLowerCase()
  if (lower === 'null' || lower === 'null/' || lower === 'undefined' || lower.startsWith('chrome-error://')) {
    return undefined
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (!parsed.hostname || parsed.hostname === 'null') return undefined
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function deriveFallbackProductInfoFromExtractData(extractData: any): {
  brandDescription?: string
  uniqueSellingPoints?: string
  productHighlights?: string
  targetAudience?: string
  category?: string
} {
  if (!extractData || typeof extractData !== 'object') return {}

  const isStorePage = (() => {
    if (extractData.pageType === 'store') return true
    const productsLen = Array.isArray(extractData.products) ? extractData.products.length : 0
    const hasStoreName = typeof extractData.storeName === 'string' && extractData.storeName.trim().length > 0
    const hasDeep = !!extractData.deepScrapeResults
    return hasStoreName || hasDeep || productsLen >= 2
  })()

  const brandDescription = pickNonEmptyString(
    extractData.productDescription,
    extractData.storeDescription,
    extractData.metaDescription
  ) || undefined

  const deepTopProducts = Array.isArray(extractData?.deepScrapeResults?.topProducts)
    ? extractData.deepScrapeResults.topProducts
    : []

  const supplementalProducts = Array.isArray((extractData as any)?.supplementalProducts)
    ? (extractData as any).supplementalProducts
    : []

  const deepFeaturesRaw = [
    ...deepTopProducts.flatMap((t: any) =>
      Array.isArray(t?.productData?.features) ? t.productData.features : []
    ),
    ...supplementalProducts.flatMap((p: any) =>
      Array.isArray(p?.productFeatures) ? p.productFeatures : []
    ),
  ]
  const deepFeatures = filterNavigationLabels(deepFeaturesRaw).filter((line) => line.length <= 200)

  const storeCatalogCandidatesRaw: unknown[] = []
  const primaryCategories = Array.isArray(extractData?.productCategories?.primaryCategories)
    ? extractData.productCategories.primaryCategories
    : []
  for (const c of primaryCategories) {
    if (typeof c?.name === 'string') storeCatalogCandidatesRaw.push(c.name)
  }
  const products = Array.isArray(extractData?.products) ? extractData.products : []
  for (const p of products) {
    if (typeof p?.name === 'string') storeCatalogCandidatesRaw.push(p.name)
  }
  for (const t of deepTopProducts) {
    const name = (t as any)?.productData?.productName
    if (typeof name === 'string') storeCatalogCandidatesRaw.push(name)
    const category = (t as any)?.productData?.category
    if (typeof category === 'string') storeCatalogCandidatesRaw.push(category)
  }
  for (const p of supplementalProducts) {
    const name = (p as any)?.productName
    if (typeof name === 'string') storeCatalogCandidatesRaw.push(name)
    const category = (p as any)?.category
    if (typeof category === 'string') storeCatalogCandidatesRaw.push(category)
  }
  const storeCatalogCandidates = filterNavigationLabels(storeCatalogCandidatesRaw).filter((line) => line.length <= 120)
  const storeCatalogLines = pickTopUniqueLines(storeCatalogCandidates, 8)

  const valueLine = (() => {
    const desc = pickNonEmptyString(extractData.storeDescription, extractData.productDescription, extractData.metaDescription)
    if (!desc) return null
    const lower = desc.toLowerCase()
    if (lower.includes('great value')) return 'Great value across key departments.'
    if (lower.includes('great values')) return 'Great values across key departments.'
    if (lower.includes('discount')) return 'Discount-friendly shopping across popular categories.'
    return null
  })()

  const catalogSummaryLine = (() => {
    if (!isStorePage) return null
    if (storeCatalogLines.length === 0) return null
    const items = storeCatalogLines.slice(0, 5)
    const label = items.length > 3 ? items.slice(0, 4).join(', ') : items.join(', ')
    return `Popular categories: ${label}.`
  })()

  const uniqueSellingPointsLines = [
    ...(valueLine ? [valueLine] : []),
    ...(catalogSummaryLine ? [catalogSummaryLine] : []),
    ...pickTopUniqueLines(deepFeatures, 4),
  ]
  const uniqueSellingPoints = uniqueSellingPointsLines.slice(0, 4).join('\n') || undefined

  const productHighlightsLines = [
    ...pickTopUniqueLines(deepFeatures, 3),
    ...(isStorePage ? storeCatalogLines.slice(0, 5) : []),
  ]
  const productHighlights = productHighlightsLines.slice(0, 5).join('\n') || undefined

  const category = deriveCategoryFromScrapedData(JSON.stringify(extractData)) || undefined

  let targetAudience: string | undefined
  const storeDesc = pickNonEmptyString(extractData.storeDescription)
  if (storeDesc) {
    const s = storeDesc.toLowerCase()
    if (s.includes('hogar') && s.includes('empresa')) {
      targetAudience = 'Usuarios domésticos y empresas que buscan protección de ciberseguridad.'
    } else if (s.includes('hogar') || s.includes('familia')) {
      targetAudience = 'Usuarios domésticos y familias que buscan protección de ciberseguridad.'
    } else if (s.includes('empresa')) {
      targetAudience = 'Empresas que buscan protección de ciberseguridad.'
    } else if (s.includes('entire family') || s.includes('whole family') || s.includes('for the family')) {
      targetAudience = 'Families shopping for everyday essentials.'
    }
  }

  return {
    brandDescription,
    uniqueSellingPoints,
    productHighlights,
    targetAudience,
    category,
  }
}

/**
 * Offer提取任务数据接口
 */
export interface OfferExtractionTaskData {
  affiliateLink: string
  targetCountry: string
  skipCache?: boolean
  skipWarmup?: boolean
  // 🔥 新增：产品价格和佣金比例（用于批量上传创建Offer）
  productPrice?: string
  commissionPayout?: string
  commissionType?: 'percent' | 'amount'
  commissionValue?: string
  commissionCurrency?: string
  // 🔥 新增：用户手动输入的品牌名（独立站Google搜索补充用）
  brandName?: string
  // 🔥 链接类型与店铺补充单品链接
  pageType?: 'store' | 'product'
  storeProductLinks?: string[]
}

/**
 * Offer提取任务执行器
 */
export async function executeOfferExtraction(
  task: Task<OfferExtractionTaskData>
): Promise<any> {
  const {
    affiliateLink,
    targetCountry,
    skipCache = false,
    skipWarmup = false,
    productPrice,
    commissionPayout,
    commissionType,
    commissionValue,
    commissionCurrency,
    brandName,
    pageType,
    storeProductLinks
  } = task.data
  const db = getDatabase()

  // 🔥 2025-12-12调试：记录task.data中的targetCountry
  console.log(`📋 executeOfferExtraction: task.id=${task.id}, targetCountry="${targetCountry}", task.data=${JSON.stringify(task.data)}`)

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const toDbJson = (value: any): any => toDbJsonObjectField(value, db.type, null)

  try {
    // 更新任务状态为运行中
    await db.exec(`
      UPDATE offer_tasks
      SET status = 'running', started_at = ${nowFunc}, message = '开始提取Offer信息'
      WHERE id = ?
    `, [task.id])

    console.log(`🚀 开始执行Offer提取任务: ${task.id}`)

    // 调用核心提取函数
    const extractResult = await extractOffer({
      affiliateLink,
      targetCountry,
      userId: task.userId,
      skipCache,
      skipWarmup,
      brandNameInput: brandName,
      pageTypeOverride: pageType,
      storeProductLinks,
      // 进度回调：更新到数据库
      progressCallback: async (stage, status, message, data, duration) => {
        // 计算进度百分比 - 必须包含所有ProgressStage阶段
        const progressMap: Record<string, number> = {
          proxy_warmup: 5,
          fetching_proxy: 10,
          resolving_link: 20,
          accessing_page: 35,
          extracting_brand: 50,
          scraping_products: 65,
          processing_data: 80,
          ai_analysis: 90,
          completed: 100,
          error: 0,
        }
        const progress = progressMap[stage] || 0

        // 更新数据库
        await db.exec(`
          UPDATE offer_tasks
          SET stage = ?, message = ?, progress = ?, updated_at = ${nowFunc}
          WHERE id = ?
        `, [stage, message, progress, task.id])

        console.log(`  📊 进度更新: ${task.id} - ${stage} (${progress}%) - ${message}`)
      },
    })

    // 检查提取是否成功
    if (!extractResult.success || !extractResult.data) {
      throw new Error(extractResult.error?.message || '提取失败')
    }

    const resolvedFinalUrl = sanitizeResolvedFinalUrl(extractResult.data.finalUrl)
    const resolvedFinalUrlSuffix = resolvedFinalUrl
      ? (typeof extractResult.data.finalUrlSuffix === 'string' ? extractResult.data.finalUrlSuffix : undefined)
      : undefined
    if (!resolvedFinalUrl && typeof extractResult.data.finalUrl === 'string' && extractResult.data.finalUrl.trim()) {
      console.warn(`⚠️ 检测到无效finalUrl，已跳过持久化: ${extractResult.data.finalUrl}`)
    }

    // ========== 🔥 2025-12-16重构：提取完成后立即创建Offer（增量保存第一阶段）==========
    // 问题：之前等到SSE流程完全结束才创建Offer，如果AI分析失败或用户刷新页面，数据全部丢失
    // 修复：提取完成后立即创建Offer，AI分析结果后续增量更新
    let createdOfferId: number | null = null
    const taskRow = await db.queryOne<{ batch_id: string | null; offer_id: number | null }>(`
      SELECT batch_id, offer_id FROM offer_tasks WHERE id = ?
    `, [task.id])

    const extractedPageType = (extractResult.data.pageType === 'store' || extractResult.data.pageType === 'product')
      ? extractResult.data.pageType
      : null
    const pageTypeOverride = (pageType === 'store' || pageType === 'product') ? pageType : null
    const pageTypeAdjusted = extractResult.data.pageTypeAdjusted === true
    if (pageTypeAdjusted && pageTypeOverride && extractedPageType && pageTypeOverride !== extractedPageType) {
      console.warn(`⚠️ page_type已被系统修正: override=${pageTypeOverride} → detected=${extractedPageType}`)
    }
    const pageTypeToPersist = pageTypeAdjusted
      ? (extractedPageType || pageTypeOverride || 'product')
      : (pageTypeOverride || extractedPageType || 'product')
    const supplementalPrices = Array.isArray((extractResult.data as any).supplementalProducts)
      ? (extractResult.data as any).supplementalProducts.map((p: any) => p?.productPrice)
      : []
    const derivedAverageProductPrice = (!productPrice && pageTypeToPersist === 'store')
      ? computeAveragePriceFromStrings(supplementalPrices)
      : undefined
    const extractedBrand = normalizePersistedBrand(extractResult.data.brand)
    const fallbackTaskBrand = normalizePersistedBrand(brandName)
    const brandForPersistence = extractedBrand || fallbackTaskBrand
    const brandForCreation = brandForPersistence || '提取中...'

    if (taskRow?.offer_id) {
      // 幂等保护：任务重试时复用既有offer_id，避免重复创建Offer
      createdOfferId = taskRow.offer_id
      const reuseMessage = taskRow.batch_id
        ? '批量任务重试，复用已有Offer基础记录'
        : '重建任务，更新现有Offer基础数据'
      console.log(`🔄 ${reuseMessage}: taskId=${task.id}, offerId=${taskRow.offer_id}`)
      await updateOfferScrapeStatus(taskRow.offer_id, task.userId, 'in_progress', undefined, {
        brand: brandForPersistence,
        url: resolvedFinalUrl || undefined,
        // 🔥 2025-12-16修复：保存final_url_suffix到数据库
        final_url_suffix: resolvedFinalUrlSuffix,
        // 🔥 2025-12-16修复：保存product_name到数据库
        product_name: extractResult.data.productName || undefined,
        scraped_data: JSON.stringify(extractResult.data),
        page_type: pageTypeToPersist,
      })
    } else if (taskRow?.batch_id) {
      // 批量任务：创建新Offer记录（基础数据）
      console.log(`📦 批量任务，创建Offer基础记录: ${task.id}`)
      const offer = await createOffer(task.userId, {
        url: resolvedFinalUrl || affiliateLink,
        brand: brandForCreation,
        target_country: targetCountry,
        affiliate_link: affiliateLink,
        store_product_links: storeProductLinks && storeProductLinks.length > 0 ? JSON.stringify(storeProductLinks) : undefined,
        final_url: resolvedFinalUrl || undefined,
        // 🔥 2025-12-16修复：保存final_url_suffix到数据库
        final_url_suffix: resolvedFinalUrlSuffix,
        // 🔥 2025-12-16修复：保存product_name到数据库
        product_name: extractResult.data.productName || undefined,
        product_price: productPrice || derivedAverageProductPrice || extractResult.data.productPrice || undefined,
        commission_payout: commissionPayout || undefined,
        commission_type: commissionType || undefined,
        commission_value: commissionValue || undefined,
        commission_currency: commissionCurrency || undefined,
        page_type: pageTypeToPersist,
      })
      createdOfferId = offer.id
      // 保存scraped_data
      await updateOfferScrapeStatus(offer.id, task.userId, 'in_progress', undefined, {
        scraped_data: JSON.stringify(extractResult.data),
      })
      // 更新offer_tasks关联
      await db.exec(`UPDATE offer_tasks SET offer_id = ? WHERE id = ?`, [offer.id, task.id])
      console.log(`✅ 批量任务Offer基础创建成功: offer_id=${offer.id}`)
    } else {
      // 普通SSE任务：创建新Offer记录（基础数据）
      console.log(`🆕 普通SSE任务，创建Offer基础记录: ${task.id}`)
      const offer = await createOffer(task.userId, {
        url: resolvedFinalUrl || affiliateLink,
        brand: brandForCreation,
        target_country: targetCountry,
        affiliate_link: affiliateLink,
        store_product_links: storeProductLinks && storeProductLinks.length > 0 ? JSON.stringify(storeProductLinks) : undefined,
        final_url: resolvedFinalUrl || undefined,
        // 🔥 2025-12-16修复：保存final_url_suffix到数据库
        final_url_suffix: resolvedFinalUrlSuffix,
        // 🔥 2025-12-16修复：保存product_name到数据库
        product_name: extractResult.data.productName || undefined,
        product_price: productPrice || derivedAverageProductPrice || extractResult.data.productPrice || undefined,
        commission_payout: commissionPayout || undefined,
        commission_type: commissionType || undefined,
        commission_value: commissionValue || undefined,
        commission_currency: commissionCurrency || undefined,
        page_type: pageTypeToPersist,
      })
      createdOfferId = offer.id
      // 保存scraped_data
      await updateOfferScrapeStatus(offer.id, task.userId, 'in_progress', undefined, {
        scraped_data: JSON.stringify(extractResult.data),
      })
      // 更新offer_tasks关联
      await db.exec(`UPDATE offer_tasks SET offer_id = ? WHERE id = ?`, [offer.id, task.id])
      console.log(`✅ 普通SSE任务Offer基础创建成功: offer_id=${offer.id}`)
    }

    // ========== 执行AI分析 ==========
    console.log(`🤖 开始AI分析: ${task.id}`)

    // 更新进度到ai_analysis阶段
    await db.exec(`
      UPDATE offer_tasks
      SET stage = 'ai_analysis', message = '正在进行AI分析...', progress = 90, updated_at = ${nowFunc}
      WHERE id = ?
    `, [task.id])

    let aiAnalysisResult = null
    const aiAnalysisTimeoutMs = parsePositiveIntEnv(
      process.env.OFFER_AI_ANALYSIS_TIMEOUT_MS,
      8 * 60 * 1000
    )
    const aiAnalysisHeartbeatMs = parsePositiveIntEnv(
      process.env.OFFER_AI_ANALYSIS_HEARTBEAT_MS,
      15000
    )
    const aiAnalysisStartedAt = Date.now()
    let aiAnalysisHeartbeatTimer: NodeJS.Timeout | null = null

    const updateAiAnalysisHeartbeat = async () => {
      const elapsedSeconds = Math.floor((Date.now() - aiAnalysisStartedAt) / 1000)
      await db.exec(`
        UPDATE offer_tasks
        SET stage = 'ai_analysis',
            message = ?,
            progress = 90,
            updated_at = ${nowFunc}
        WHERE id = ?
      `, [`正在进行AI分析... (${elapsedSeconds}s)`, task.id])
    }

    try {
      await updateAiAnalysisHeartbeat()
      aiAnalysisHeartbeatTimer = setInterval(() => {
        void updateAiAnalysisHeartbeat().catch((heartbeatError: any) => {
          console.warn(`⚠️ AI分析心跳更新失败: ${task.id}:`, heartbeatError?.message || heartbeatError)
        })
      }, aiAnalysisHeartbeatMs)

      const targetLanguage = getTargetLanguage(targetCountry)

      aiAnalysisResult = await withTimeout(
        executeAIAnalysis({
          extractResult: extractResult.data,
          targetCountry,
          targetLanguage,
          userId: task.userId,
          fallbackBrand: brandForPersistence || undefined,
          enableReviewAnalysis: true,
          enableCompetitorAnalysis: true,
          enableAdExtraction: true,
          // 🔥 修复（2025-12-08）：所有offer-extraction任务都启用Playwright深度抓取
          // 不再区分是否为批量任务，确保与手动创建流程(performScrapeAndAnalysis)完全一致
          // 抓取30条真实评论 + 5个真实竞品
          enablePlaywrightDeepScraping: true,
        }),
        aiAnalysisTimeoutMs,
        `AI分析超时（>${Math.floor(aiAnalysisTimeoutMs / 1000)}秒）`
      )

      console.log(`✅ AI分析完成: ${task.id}`)
    } catch (aiError: any) {
      console.warn(`⚠️ AI分析失败（不影响流程）: ${task.id}:`, aiError.message)
      // AI分析失败不中断流程，继续保存基础数据
    } finally {
      if (aiAnalysisHeartbeatTimer) {
        clearInterval(aiAnalysisHeartbeatTimer)
        aiAnalysisHeartbeatTimer = null
      }
    }

    // 🔥 独立站增强：合并Google品牌词搜索补充数据到“已提取广告元素”维度中
    const brandSearchSupplement: BrandSearchSupplement | null =
      (extractResult.data as any)?.brandSearchSupplement || null

    const mergedExtractedHeadlines = mergeUniqueStrings(
      brandSearchSupplement?.extracted?.headlines || null,
      aiAnalysisResult?.extractedHeadlines || null,
      60
    )
    const mergedExtractedDescriptions = mergeUniqueStrings(
      brandSearchSupplement?.extracted?.descriptions || null,
      aiAnalysisResult?.extractedDescriptions || null,
      40
    )
    const mergedCallouts = mergeUniqueStrings(
      brandSearchSupplement?.extracted?.callouts || null,
      null,
      30
    )
    const mergedSitelinks = mergeUniqueSitelinks(
      brandSearchSupplement?.extracted?.sitelinks || null,
      null,
      20
    )

    const mergedExtractionMetadata = {
      ...(aiAnalysisResult?.extractionMetadata || {}),
      ...(brandSearchSupplement ? { brandSearchSupplement } : {}),
      ...(mergedCallouts ? { serpCallouts: mergedCallouts } : {}),
      ...(mergedSitelinks ? { serpSitelinks: mergedSitelinks } : {}),
    }

    // 合并AI分析结果到提取数据（展平结构，与前端期望匹配）
    const aiProductInfo = aiAnalysisResult?.aiProductInfo || {}
    const finalResult = {
      ...extractResult.data,
      // 🔥 展平AI分析结果到顶层（与CreateOfferModalV2.tsx期望的结构匹配）
      brandDescription: aiProductInfo.brandDescription || null,
      uniqueSellingPoints: aiProductInfo.uniqueSellingPoints || null,
      productHighlights: aiProductInfo.productHighlights || null,
      targetAudience: aiProductInfo.targetAudience || null,
      category: aiProductInfo.category || null,
      // P0评论深度分析和竞品分析
      reviewAnalysis: aiAnalysisResult?.reviewAnalysis || null,
      competitorAnalysis: aiAnalysisResult?.competitorAnalysis || null,
      // 广告元素提取
      extractedKeywords: aiAnalysisResult?.extractedKeywords || null,
      extractedHeadlines: mergedExtractedHeadlines,
      extractedDescriptions: mergedExtractedDescriptions,
      extractionMetadata: Object.keys(mergedExtractionMetadata).length > 0 ? mergedExtractionMetadata : null,
    }

    // ========== 🔥 2025-12-16重构：AI分析完成后更新Offer（增量保存第二阶段）==========
    // Offer已在提取完成后创建，这里只更新AI分析结果
    if (createdOfferId) {
      try {
        const fallbackProductInfo = deriveFallbackProductInfoFromExtractData(extractResult.data)

        // 🔥 2026-01-04修复：将AI生成的关键词持久化到offers.ai_keywords
        // 关键词池生成依赖 ai_keywords / extracted_keywords；若不保存，独立站等场景可能出现“无可用关键词”
        const aiKeywordSeeds: string[] | null =
          Array.isArray((aiProductInfo as any)?.keywords) && (aiProductInfo as any).keywords.length > 0
            ? (aiProductInfo as any).keywords
            : (Array.isArray(aiAnalysisResult?.extractedKeywords) && aiAnalysisResult.extractedKeywords.length > 0
                ? aiAnalysisResult.extractedKeywords
                : null)

        await updateOfferScrapeStatus(createdOfferId, task.userId, 'completed', undefined, {
          brand: brandForPersistence,
          url: resolvedFinalUrl || undefined,
          // 🔥 2025-12-16修复：保存final_url_suffix到数据库
          final_url_suffix: resolvedFinalUrlSuffix,
          // 🔥 2025-12-16修复：保存product_name到数据库
          product_name: extractResult.data.productName || undefined,
          brand_description: aiProductInfo.brandDescription || fallbackProductInfo.brandDescription || undefined,
          unique_selling_points: aiProductInfo.uniqueSellingPoints ?
            (Array.isArray(aiProductInfo.uniqueSellingPoints)
              ? aiProductInfo.uniqueSellingPoints.join('\n')
              : String(aiProductInfo.uniqueSellingPoints)) : undefined,
          product_highlights: aiProductInfo.productHighlights ?
            (Array.isArray(aiProductInfo.productHighlights)
              ? aiProductInfo.productHighlights.join('\n')
              : String(aiProductInfo.productHighlights)) : undefined,
          ...(aiProductInfo.uniqueSellingPoints ? {} : { unique_selling_points: fallbackProductInfo.uniqueSellingPoints }),
          ...(aiProductInfo.productHighlights ? {} : { product_highlights: fallbackProductInfo.productHighlights }),
          target_audience: aiProductInfo.targetAudience || fallbackProductInfo.targetAudience || undefined,
          category: aiProductInfo.category || fallbackProductInfo.category || undefined,
          review_analysis: aiAnalysisResult?.reviewAnalysis ?
            JSON.stringify(aiAnalysisResult.reviewAnalysis) : undefined,
          competitor_analysis: aiAnalysisResult?.competitorAnalysis ?
            JSON.stringify(aiAnalysisResult.competitorAnalysis) : undefined,
          extracted_keywords: aiAnalysisResult?.extractedKeywords ?
            JSON.stringify(aiAnalysisResult.extractedKeywords) : undefined,
          extracted_headlines: mergedExtractedHeadlines ?
            JSON.stringify(mergedExtractedHeadlines) : undefined,
          extracted_descriptions: mergedExtractedDescriptions ?
            JSON.stringify(mergedExtractedDescriptions) : undefined,
          extraction_metadata: Object.keys(mergedExtractionMetadata).length > 0 ?
            JSON.stringify(mergedExtractionMetadata) : undefined,
          extracted_at: new Date().toISOString(),
          ai_keywords: aiKeywordSeeds || undefined,
          scraped_data: JSON.stringify(extractResult.data),
          page_type: pageTypeToPersist,
        })

        // 🎯 Intent-driven optimization: Auto-extract scenarios from review_analysis
        // Graceful degradation: If no review data, these fields remain null
        if (aiAnalysisResult?.reviewAnalysis) {
          try {
            const reviewAnalysisJson = JSON.stringify(aiAnalysisResult.reviewAnalysis)
            const extractedScenarios = extractScenariosFromReviews(reviewAnalysisJson)

            // Only update if we extracted meaningful data
            if (extractedScenarios.scenarios.length > 0 ||
                extractedScenarios.painPoints.length > 0 ||
                extractedScenarios.userQuestions.length > 0) {
              await updateOffer(createdOfferId, task.userId, {
                user_scenarios: JSON.stringify(extractedScenarios.scenarios),
                pain_points: JSON.stringify(extractedScenarios.painPoints),
                user_questions: JSON.stringify(extractedScenarios.userQuestions),
                scenario_analyzed_at: new Date().toISOString()
              })
              console.log(`✅ 场景数据已提取: offer_id=${createdOfferId}, scenarios=${extractedScenarios.scenarios.length}, questions=${extractedScenarios.userQuestions.length}`)
            }
          } catch (scenarioError: any) {
            console.error(`⚠️ 场景提取失败（非致命）: ${scenarioError.message}`)
            // Non-fatal: continue without scenario data (graceful degradation)
          }
        }

        console.log(`✅ AI分析结果已更新到Offer: offer_id=${createdOfferId}`)
      } catch (offerError: any) {
        console.error(`❌ 更新Offer AI分析结果失败: ${task.id}:`, offerError.message)
        // 更新失败不中断流程
      }
    }

    // 🔥 2025-12-16修复：保存到数据库的result必须包含offerId，否则前端无法获取
    const resultWithOfferId = {
      ...finalResult,
      offerId: createdOfferId,
    }

    // 更新任务为完成状态（包含创建的offer_id）
    await db.exec(`
      UPDATE offer_tasks
      SET
        status = 'completed',
        progress = 100,
        message = '提取完成',
        result = ?,
        offer_id = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [toDbJson(resultWithOfferId), createdOfferId, task.id])

    console.log(`✅ Offer提取任务完成: ${task.id}, offerId=${createdOfferId}`)

    return resultWithOfferId
  } catch (error: any) {
    console.error(`❌ Offer提取任务失败: ${task.id}:`, error.message)

    // 更新任务为失败状态
    await db.exec(`
      UPDATE offer_tasks
      SET
        status = 'failed',
        message = ?,
        error = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [
      error.message,
      toDbJson({ message: error.message, stack: error.stack }),
      task.id
    ])

    throw error
  }
}
