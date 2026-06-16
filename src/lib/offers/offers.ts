import { getDatabase } from '../db'
import {
  generateOfferName,
  getTargetLanguage,
  isOfferNameUnique,
  normalizeBrandName,
  normalizeOfferTargetCountry,
  validateBrandName,
} from './offer-utils'
import {
  generatePricingJSON,
  initializePromotionsJSON,
  initializeScrapedDataJSON,
} from '../common/server'
import { compactCategoryLabel, deriveCategoryFromScrapedData } from './offer-category'
import { deriveBrandFromProductTitle, isLikelyInvalidBrandName } from '../scraping'
import {
  normalizeOfferCommissionInput,
  normalizeOfferProductPriceInput,
} from './offer-monetization'
import {
  markUrlSwapTargetsRemovedByOfferAccount,
  markUrlSwapTargetsRemovedByOfferId,
  pauseUrlSwapTargetsByOfferId,
} from '../url-swap/index'
import { applyCampaignTransition, applyCampaignTransitionByIds } from '../campaign/server'
import { offerOccupyingCampaignIdSubquerySql } from '../campaign/server'
import { toDbJsonObjectField } from '../db'
import { removePendingClickFarmQueueTasksByTaskIds } from '../click-farm/queue-cleanup'
import { removePendingUrlSwapQueueTasksByTaskIds } from '../url-swap/queue-cleanup'
import type { OfferExtractionMode } from './offer-extraction-mode'
import { normalizeOfferExtractionMode } from './offer-extraction-mode'
import { executeGoogleAdsCampaignRemoteActions } from '@/lib/google-ads/campaign/remote-actions'
import { extractAsinFromOfferUrls } from '@/lib/openclaw/offer-asin'

export interface Offer {
  id: number
  user_id: number
  url: string
  brand: string
  product_name: string | null // 产品名称（数据库字段，之前遗漏）
  category: string | null
  target_country: string
  target_language: string | null
  offer_name: string | null
  affiliate_link: string | null
  store_product_links: string | null // 店铺模式：最多6个单品推广链接（JSON）
  brand_description: string | null
  unique_selling_points: string | null
  product_highlights: string | null
  target_audience: string | null
  // Final URL字段：存储解析后的最终落地页URL
  final_url: string | null
  final_url_suffix: string | null
  asin: string | null
  // 需求28：产品价格和佣金比例
  product_price: string | null
  commission_payout: string | null
  commission_type: 'percent' | 'amount' | null
  commission_value: string | null
  commission_currency: string | null
  scrape_status: string
  scrape_error: string | null
  scraped_at: string | null
  // 注意：PostgreSQL 返回 boolean
  is_active: number | boolean
  industry_code: string | null // 行业代码（数据库字段，之前遗漏）
  google_ads_campaign_id: string | null
  sync_source: string | null
  needs_completion: boolean | number
  // P0优化: 分析结果字段
  review_analysis: string | null
  competitor_analysis: string | null
  visual_analysis: string | null
  // Intent-driven optimization: 从review_analysis自动提取的场景数据
  user_scenarios: string | null // JSON: [{scenario, frequency, keywords, source}]
  pain_points: string | null // JSON: [string]
  user_questions: string | null // JSON: [{question, priority, category}]
  scenario_analyzed_at: string | null
  // 需求34: 广告元素提取结果字段
  extracted_keywords: string | null
  extracted_headlines: string | null
  extracted_descriptions: string | null
  extraction_metadata: string | null
  extracted_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null // 软删除时间戳（数据库字段，之前遗漏）
  is_deleted: number // 软删除标记（数据库字段，之前遗漏）
  // 增强数据字段（JSON格式存储）
  // ❌ 已删除冗余字段（2025-12-04）: pricing (与scraped_data重复)
  promotions: string | null // 促销信息JSON
  scraped_data: string | null // 原始爬虫数据（包含discount, salesRank, badge, reviews等所有字段）
  // 🎯 AI分析结果字段（数据库同步）
  ai_keywords: string | null // AI生成的关键词JSON（从competitor_analysis等提取）
  ai_reviews: string | null // AI分析的评论总结
  ai_competitive_edges: string | null // AI分析的竞争优势
  ai_analysis_v32: string | null // 新版AI分析结果JSON（v3.2架构）
  page_type: string | null // 页面类型：'product' | 'store'
  extraction_mode: string | null // 提取模式：fast | balanced | original
  generated_buckets: string | null // 🆕 v4.16: 已生成的创意类型列表（JSON数组）
  // P1-11: 关联的Google Ads账号信息（运行时计算字段，非数据库字段）
  // 🔧 修复(2025-12-11): snake_case → camelCase
  linked_accounts?: Array<{
    accountId: number
    accountName: string | null
    customerId: string
    campaignCount: number
  }>
  // 🔥 黑名单标记（运行时计算字段）
  is_blacklisted?: boolean
}

// 列表页所需的精简字段（避免拉取大字段导致内存膨胀）
export interface OfferListRow {
  id: number
  user_id: number
  url: string
  brand: string
  category: string | null
  target_country: string
  target_language: string | null
  offer_name: string | null
  affiliate_link: string | null
  brand_description: string | null
  unique_selling_points: string | null
  product_highlights: string | null
  target_audience: string | null
  final_url: string | null
  final_url_suffix: string | null
  asin: string | null
  product_price: string | null
  commission_payout: string | null
  commission_type: 'percent' | 'amount' | null
  commission_value: string | null
  commission_currency: string | null
  scrape_status: string
  needs_completion: boolean | number
  scrape_error: string | null
  scraped_at: string | null
  is_active: number | boolean
  created_at: string
  updated_at: string
  linked_accounts?: Array<{
    accountId: number
    accountName: string | null
    customerId: string
    campaignCount: number
  }>
  is_blacklisted?: boolean
  campaign_id?: number | null
  google_ads_campaign_id?: string | null
}

export interface CreateOfferInput {
  url: string
  brand?: string // 可选，抓取时自动提取
  category?: string
  target_country: string
  target_language?: string // 目标语言（如English, Spanish等）
  affiliate_link?: string
  store_product_links?: string // JSON string array
  brand_description?: string
  unique_selling_points?: string
  product_highlights?: string
  target_audience?: string
  // Final URL字段：存储解析后的最终落地页URL
  final_url?: string
  final_url_suffix?: string
  // 需求28：产品价格和佣金比例（可选）
  product_price?: string
  commission_payout?: string
  commission_type?: 'percent' | 'amount'
  commission_value?: string | number
  commission_currency?: string
  // 🔥 2025-12-16修复：添加product_name字段
  product_name?: string
  // AI分析结果字段（JSON字符串格式）
  review_analysis?: string
  competitor_analysis?: string
  extracted_keywords?: string
  extracted_headlines?: string
  extracted_descriptions?: string
  extraction_metadata?: string
  // 🔥 页面类型标识（店铺/单品）
  page_type?: 'store' | 'product'
  extraction_mode?: OfferExtractionMode | string
}

export interface UpdateOfferInput {
  url?: string
  brand?: string
  category?: string
  target_country?: string
  affiliate_link?: string
  store_product_links?: string | null
  brand_description?: string
  unique_selling_points?: string
  product_highlights?: string
  target_audience?: string
  product_price?: string
  commission_payout?: string
  commission_type?: 'percent' | 'amount' | null
  commission_value?: string | number | null
  commission_currency?: string | null
  // Final URL字段：存储解析后的最终落地页URL
  final_url?: string
  final_url_suffix?: string
  is_active?: boolean
  // AI分析结果字段
  competitor_analysis?: string
  review_analysis?: string
  extracted_keywords?: string
  extracted_headlines?: string
  extracted_descriptions?: string
  // P0/P1/P2/P3优化：增强提取字段
  enhanced_keywords?: string
  enhanced_product_info?: string
  enhanced_review_analysis?: string
  extraction_quality_score?: number
  extraction_enhanced_at?: string
  enhanced_headlines?: string
  enhanced_descriptions?: string
  localization_adapt?: string
  brand_analysis?: string
  // v3.2架构：店铺/单品差异化分析字段
  ai_analysis_v32?: unknown
  page_type?: string
  // Intent-driven optimization: 场景数据字段
  user_scenarios?: string
  pain_points?: string
  user_questions?: string
  scenario_analyzed_at?: string
  extraction_mode?: OfferExtractionMode | string
}

/**
 * 创建新Offer
 * 需求1: 自动生成offer_name和target_language
 * 增强功能: 自动生成pricing、promotions、scraped_data JSON
 */
export async function createOffer(userId: number, input: CreateOfferInput): Promise<Offer> {
  const db = await getDatabase()
  const normalizedTargetCountry = normalizeOfferTargetCountry(input.target_country) || 'US'

  // ========== 需求1和需求5: 自动生成字段 ==========
  // 如果没有提供brand，使用临时值"Unknown"，等抓取完成后更新
  const brandValue = input.brand || 'Unknown'

  // 生成offer_name: 品牌名称_推广国家_序号（如 Reolink_US_01）
  const offerName = await generateOfferName(brandValue, normalizedTargetCountry, userId)

  // Debug logging for PostgreSQL
  if (process.env.DEBUG_OFFERS) {
    console.log('[DEBUG] offerName:', offerName)
    console.log('[DEBUG] offerName type:', typeof offerName)
  }

  // 根据国家或用户输入自动映射推广语言（如 US→English, DE→German）
  const targetLanguage = input.target_language || getTargetLanguage(normalizedTargetCountry)

  if (process.env.DEBUG_OFFERS) {
    console.log('[DEBUG] targetLanguage:', targetLanguage)
    console.log('[DEBUG] targetLanguage type:', typeof targetLanguage)
  }

  const normalizedProductPrice = normalizeOfferProductPriceInput(
    input.product_price,
    normalizedTargetCountry
  )
  const normalizedCommission = normalizeOfferCommissionInput({
    targetCountry: normalizedTargetCountry,
    commissionType: input.commission_type,
    commissionValue: input.commission_value,
    commissionCurrency: input.commission_currency,
    commissionPayout: input.commission_payout,
  })

  // ========== 自动生成pricing、promotions、scraped_data JSON ==========
  // 1. 如果有product_price，自动解析并生成pricing JSON
  const pricingJSON = normalizedProductPrice ? generatePricingJSON(normalizedProductPrice) : null

  // 2. 初始化空的promotions JSON结构
  const promotionsJSON = initializePromotionsJSON()

  // 3. 初始化scraped_data JSON（包含price信息）
  const scrapedDataJSON = initializeScrapedDataJSON(normalizedProductPrice)

  const params = [
    userId,
    input.url,
    brandValue, // 使用临时值或用户提供的值
    input.category || null,
    normalizedTargetCountry,
    input.affiliate_link || null,
    input.store_product_links || null,
    input.brand_description || null,
    input.unique_selling_points || null,
    input.product_highlights || null,
    input.target_audience || null,
    input.final_url || null, // 解析后的最终URL
    input.final_url_suffix ?? null, // URL查询参数后缀
    extractAsinFromOfferUrls(input.url, input.final_url || null),
    offerName, // 自动生成
    targetLanguage, // 自动生成
    normalizedProductPrice || null, // 需求28
    normalizedCommission.commissionPayout || null, // 需求28（兼容字段）
    normalizedCommission.commissionType || null,
    normalizedCommission.commissionValue || null,
    normalizedCommission.commissionCurrency || null,
    // 🔥 2025-12-16修复：添加product_name字段
    input.product_name || null,
    // 自动生成的JSON字段
    pricingJSON, // 从product_price解析
    promotionsJSON, // 初始化空结构
    scrapedDataJSON, // 包含price信息的初始结构
    // AI分析结果字段
    input.review_analysis || null,
    input.competitor_analysis || null,
    input.extracted_keywords || null,
    input.extracted_headlines || null,
    input.extracted_descriptions || null,
    input.extraction_metadata || null,
    // P1-3修复: 如果有任何AI分析或广告元素提取结果，记录提取时间
    input.review_analysis ||
    input.competitor_analysis ||
    input.extracted_keywords ||
    input.extracted_headlines ||
    input.extracted_descriptions
      ? new Date().toISOString()
      : null,
    // 🔥 页面类型标识（店铺/单品）
    input.page_type || 'product', // 默认为'product'
    normalizeOfferExtractionMode(input.extraction_mode),
  ]

  // Debug: Check for undefined values
  const undefinedIndices = params.map((p, i) => (p === undefined ? i : -1)).filter((i) => i !== -1)
  if (undefinedIndices.length > 0) {
    console.error('❌ Found undefined parameters at indices:', undefinedIndices)
    console.error('Parameters:', params)
    throw new Error(
      `Cannot insert with undefined values at indices: ${undefinedIndices.join(', ')}`
    )
  }

  const result = await db.exec(
    `
    INSERT INTO offers (
      user_id, url, brand, category, target_country, affiliate_link, store_product_links,
      brand_description, unique_selling_points, product_highlights,
      target_audience, final_url, final_url_suffix, asin, scrape_status,
      offer_name, target_language,
      product_price, commission_payout, commission_type, commission_value, commission_currency, product_name,
      pricing, promotions, scraped_data,
      review_analysis, competitor_analysis,
      extracted_keywords, extracted_headlines, extracted_descriptions, extraction_metadata,
      extracted_at,
      page_type,
      extraction_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    params
  )

  const pgResult = result as { changes: number; lastInsertRowid?: number }
  if (pgResult.lastInsertRowid === undefined) {
    throw new Error('PostgreSQL INSERT 未返回 id')
  }
  const insertedId = pgResult.lastInsertRowid

  const offer = await findOfferById(insertedId, userId)
  if (!offer) {
    throw new Error('Offer创建失败')
  }

  // 🔥 2025-12-17修复：新创建的Offer需要清理API缓存，确保前端轮询立即获取到最新数据
  // 这样当批量上传中的单个offer创建完成时，GET /api/offers 能返回最新的offer列表
  const { invalidateOfferCache } = await import('../common/server')
  invalidateOfferCache(userId)

  return offer
}

/**
 * 通过ID查找Offer（包含用户验证，排除已删除）
 */
export async function findOfferById(id: number, userId: number): Promise<Offer | null> {
  const db = await getDatabase()
  const deletedCondition = "(is_deleted IS NULL OR is_deleted::text IN ('0', 'f', 'false'))"

  const offer = (await db.queryOne(
    `
    SELECT * FROM offers
    WHERE id = ? AND user_id = ? AND ${deletedCondition}
  `,
    [id, userId]
  )) as Offer | undefined
  return offer || null
}

/**
 * 获取用户的所有Offer列表
 */
export async function listOffers(
  userId: number,
  options?: {
    limit?: number
    offset?: number
    isActive?: boolean
    targetCountry?: string
    searchQuery?: string
    scrapeStatus?: string
    needsCompletion?: boolean
    /** true: 有非空联盟链接；false: 无或仅空白 */
    hasAffiliateLink?: boolean
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    includeDeleted?: boolean
    ids?: number[] // 批量查询特定ID的Offers
  }
): Promise<{ offers: OfferListRow[]; total: number }> {
  const db = await getDatabase()

  let whereConditions = ['o.user_id = ?']
  const params: any[] = [userId]

  // 默认排除已删除的Offer（需求25）
  if (!options?.includeDeleted) {
    whereConditions.push("(o.is_deleted IS NULL OR o.is_deleted::text IN ('0', 'f', 'false'))")
  }

  // 如果提供了ids参数，只查询特定ID的Offers（用于批量上传进度显示）
  if (options?.ids && options.ids.length > 0) {
    const placeholders = options.ids.map(() => '?').join(',')
    whereConditions.push(`o.id IN (${placeholders})`)
    params.push(...options.ids)
  }

  // 构建WHERE条件
  if (options?.isActive !== undefined) {
    whereConditions.push('o.is_active = ?')
    params.push(options.isActive)
  }

  if (options?.targetCountry) {
    whereConditions.push('o.target_country = ?')
    params.push(options.targetCountry)
  }

  if (options?.searchQuery) {
    const normalizedQuery = String(options.searchQuery).trim()
    if (normalizedQuery) {
      // Keep server-side search behavior aligned with client-side filtering:
      // - case-insensitive matching
      // - include id / brand / offer_name / url / final_url / category
      const likeOperator = 'ILIKE'
      const searchPattern = `%${normalizedQuery}%`
      whereConditions.push(
        `(
          CAST(o.id AS TEXT) ${likeOperator} ?
          OR o.brand ${likeOperator} ?
          OR o.offer_name ${likeOperator} ?
          OR o.url ${likeOperator} ?
          OR o.final_url ${likeOperator} ?
          OR o.category ${likeOperator} ?
        )`
      )
      params.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      )
    }
  }

  if (options?.scrapeStatus) {
    whereConditions.push('o.scrape_status = ?')
    params.push(options.scrapeStatus)
  }

  if (options?.needsCompletion !== undefined) {
    whereConditions.push('o.needs_completion = ?')
    params.push(options.needsCompletion)
  }

  if (options?.hasAffiliateLink === true) {
    whereConditions.push("(o.affiliate_link IS NOT NULL AND TRIM(o.affiliate_link) != '')")
  } else if (options?.hasAffiliateLink === false) {
    whereConditions.push("(o.affiliate_link IS NULL OR TRIM(o.affiliate_link) = '')")
  }

  const whereClause = whereConditions.join(' AND ')

  // 获取总数
  const countQuery = `SELECT COUNT(*) as count FROM offers o WHERE ${whereClause}`
  const { count } = (await db.queryOne(countQuery, params)) as { count: number }

  // 获取列表
  const listColumns = [
    'o.id',
    'o.user_id',
    'o.url',
    'o.brand',
    'o.category',
    'o.target_country',
    'o.target_language',
    'o.offer_name',
    'o.affiliate_link',
    'o.brand_description',
    'o.unique_selling_points',
    'o.product_highlights',
    'o.target_audience',
    'o.final_url',
    'o.final_url_suffix',
    'o.product_price',
    'o.commission_payout',
    'o.commission_type',
    'o.commission_value',
    'o.commission_currency',
    'o.scrape_status',
    'o.scrape_error',
    'o.scraped_at',
    'o.is_active',
    'o.created_at',
    'o.updated_at',
    'o.google_ads_campaign_id',
    'o.sync_source',
    'o.needs_completion',
  ].join(', ')

  const occupyingCampaignIdSubquery = offerOccupyingCampaignIdSubquerySql('o.id', 'o.user_id')
  const listColumnsWithCampaign = `${listColumns}, ${occupyingCampaignIdSubquery} as campaign_id`

  const sortableColumnMap: Record<string, string> = {
    offerName: 'o.offer_name',
    brand: 'o.brand',
    targetCountry: 'o.target_country',
    targetLanguage: 'o.target_language',
    scrapeStatus: 'o.scrape_status',
    needsCompletion: 'o.needs_completion',
    createdAt: 'o.created_at',
    updatedAt: 'o.updated_at',
  }

  const sortColumn =
    options?.sortBy && sortableColumnMap[options.sortBy]
      ? sortableColumnMap[options.sortBy]
      : 'o.created_at'
  const sortOrder = options?.sortOrder === 'asc' ? 'ASC' : 'DESC'
  let listQuery = `SELECT ${listColumnsWithCampaign} FROM offers o WHERE ${whereClause} ORDER BY ${sortColumn} ${sortOrder}, o.id DESC`

  if (options?.limit) {
    listQuery += ` LIMIT ${options.limit}`
  }

  if (options?.offset) {
    listQuery += ` OFFSET ${options.offset}`
  }

  const offers = (await db.query(listQuery, params)) as OfferListRow[]

  // ⚡ P0性能优化: 使用单次JOIN查询关联账号，避免N+1查询问题
  // 为每个offer查询关联的Google Ads账号信息
  // 只显示活跃的campaigns（排除REMOVED状态），且排除MCC账号
  // ⚠️ 修复：忽略未成功发布到Google Ads的campaigns(google_campaign_id为空)

  if (offers.length === 0) {
    return { offers: [], total: count }
  }

  const isManagerCondition =
    "(gaa.is_manager_account IS NULL OR gaa.is_manager_account::text IN ('0', 'f', 'false'))"
  const isActiveAccountCondition = "gaa.is_active::text IN ('1', 't', 'true')"
  const isNotDeletedAccountCondition =
    "(gaa.is_deleted IS NULL OR gaa.is_deleted::text IN ('0', 'f', 'false'))"

  // 构建offer IDs的占位符
  const offerIds = offers.map((o) => o.id)
  const placeholders = offerIds.map(() => '?').join(',')

  // 一次性查询所有offers的关联账号
  const linkedAccountsQuery = `
    SELECT DISTINCT
      c.offer_id,
      gaa.id as account_id,
      gaa.account_name,
      gaa.customer_id
    FROM campaigns c
    INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id IN (${placeholders})
      AND c.user_id = ?
      AND c.status != 'REMOVED'
      AND ${isManagerCondition}
      AND ${isActiveAccountCondition}
      AND ${isNotDeletedAccountCondition}
      AND c.google_campaign_id IS NOT NULL
      AND c.google_campaign_id != ''
    ORDER BY c.offer_id, gaa.account_name
  `

  const allLinkedAccounts = (await db.query(linkedAccountsQuery, [...offerIds, userId])) as Array<{
    offer_id: number
    account_id: number
    account_name: string | null
    customer_id: string
  }>

  // 按offer_id分组关联账号
  // 🔧 修复(2025-12-11): snake_case → camelCase
  const accountsByOfferId = new Map<
    number,
    Array<{
      accountId: number
      accountName: string | null
      customerId: string
      campaignCount: number
    }>
  >()

  for (const account of allLinkedAccounts) {
    if (!accountsByOfferId.has(account.offer_id)) {
      accountsByOfferId.set(account.offer_id, [])
    }
    accountsByOfferId.get(account.offer_id)!.push({
      accountId: account.account_id,
      accountName: account.account_name,
      customerId: account.customer_id,
      campaignCount: 0,
    })
  }

  // 合并关联账号到offers
  const offersWithAccounts = offers.map((offer) => ({
    ...offer,
    linked_accounts: accountsByOfferId.get(offer.id),
    campaign_id: offer.campaign_id ?? null,
  }))

  // 🔥 检查黑名单并标记风险
  const blacklistQuery = `
    SELECT brand, target_country
    FROM offer_blacklist
    WHERE user_id = ?
  `
  const blacklistRecords = (await db.query(blacklistQuery, [userId])) as Array<{
    brand: string
    target_country: string
  }>

  // 构建黑名单Map（品牌+国家）
  const blacklistSet = new Set(
    blacklistRecords.map((r) => `${r.brand.toLowerCase()}_${r.target_country.toUpperCase()}`)
  )

  // 标记每个offer是否在黑名单中
  const offersWithBlacklist = offersWithAccounts.map((offer) => ({
    ...offer,
    is_blacklisted: blacklistSet.has(
      `${offer.brand.toLowerCase()}_${offer.target_country.toUpperCase()}`
    ),
  }))

  return {
    offers: offersWithBlacklist,
    total: count,
  }
}

/**
 * 更新Offer
 */
export async function updateOffer(
  id: number,
  userId: number,
  input: UpdateOfferInput
): Promise<Offer> {
  const db = await getDatabase()
  const nowFunc = 'NOW()'

  // 验证Offer存在且属于该用户
  const existing = await findOfferById(id, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  const nextBrand = input.brand !== undefined ? input.brand : existing.brand
  const normalizedExistingTargetCountry = normalizeOfferTargetCountry(existing.target_country)
  let normalizedInputTargetCountry: string | undefined
  if (input.target_country !== undefined) {
    normalizedInputTargetCountry = normalizeOfferTargetCountry(input.target_country)
    if (!normalizedInputTargetCountry) {
      throw new Error('无效的目标国家代码')
    }
  }
  const nextTargetCountry = normalizedInputTargetCountry ?? normalizedExistingTargetCountry
  const brandChanged = input.brand !== undefined && input.brand !== existing.brand
  const targetCountryChanged =
    normalizedInputTargetCountry !== undefined &&
    normalizedInputTargetCountry !== normalizedExistingTargetCountry

  // 需求：当用户手动修改 brand/target_country 时，同步更新“产品标识”offer_name（以及目标语言）
  // - offer_name 格式：品牌_国家_序号
  // - 优先复用现有序号，若冲突则重新生成唯一名称
  let derivedOfferName: string | null = null
  let derivedTargetLanguage: string | null = null

  if (brandChanged || targetCountryChanged) {
    const brandForName = typeof nextBrand === 'string' ? nextBrand.trim() : ''

    if (targetCountryChanged) {
      derivedTargetLanguage = getTargetLanguage(nextTargetCountry)
    }

    if (brandForName) {
      if (existing.offer_name) {
        const parts = existing.offer_name.split('_')
        const sequenceNumber = parts.length >= 3 ? parts[parts.length - 1] || '01' : '01'
        const proposedOfferName = `${brandForName}_${nextTargetCountry}_${sequenceNumber}`
        const isUnique = await isOfferNameUnique(proposedOfferName, userId, id)
        derivedOfferName = isUnique
          ? proposedOfferName
          : await generateOfferName(brandForName, nextTargetCountry, userId)
      } else {
        derivedOfferName = await generateOfferName(brandForName, nextTargetCountry, userId)
      }
    }
  }

  const normalizedProductPrice =
    input.product_price !== undefined
      ? normalizeOfferProductPriceInput(input.product_price, nextTargetCountry)
      : undefined
  const shouldNormalizeCommission =
    input.commission_payout !== undefined ||
    input.commission_type !== undefined ||
    input.commission_value !== undefined ||
    input.commission_currency !== undefined
  const normalizedCommission = shouldNormalizeCommission
    ? normalizeOfferCommissionInput({
        targetCountry: nextTargetCountry,
        commissionType: input.commission_type,
        commissionValue: input.commission_value,
        commissionCurrency: input.commission_currency,
        commissionPayout: input.commission_payout,
      })
    : undefined

  // 构建UPDATE语句
  const updates: string[] = []
  const params: any[] = []

  if (input.url !== undefined) {
    updates.push('url = ?')
    params.push(input.url)
  }
  if (input.brand !== undefined) {
    updates.push('brand = ?')
    params.push(input.brand)
  }
  if (derivedOfferName) {
    updates.push('offer_name = ?')
    params.push(derivedOfferName)
  }
  if (input.category !== undefined) {
    updates.push('category = ?')
    params.push(input.category)
  }
  if (input.target_country !== undefined) {
    updates.push('target_country = ?')
    params.push(normalizedInputTargetCountry)
  }
  if (derivedTargetLanguage) {
    updates.push('target_language = ?')
    params.push(derivedTargetLanguage)
  }
  if (input.affiliate_link !== undefined) {
    updates.push('affiliate_link = ?')
    params.push(input.affiliate_link)
  }
  if (input.store_product_links !== undefined) {
    updates.push('store_product_links = ?')
    params.push(input.store_product_links)
  }
  if (input.brand_description !== undefined) {
    updates.push('brand_description = ?')
    params.push(input.brand_description)
  }
  if (input.unique_selling_points !== undefined) {
    updates.push('unique_selling_points = ?')
    params.push(input.unique_selling_points)
  }
  if (input.product_highlights !== undefined) {
    updates.push('product_highlights = ?')
    params.push(input.product_highlights)
  }
  if (input.target_audience !== undefined) {
    updates.push('target_audience = ?')
    params.push(input.target_audience)
  }
  if (input.final_url !== undefined) {
    updates.push('final_url = ?')
    params.push(input.final_url)
  }
  if (input.final_url_suffix !== undefined) {
    updates.push('final_url_suffix = ?')
    params.push(input.final_url_suffix)
  }
  if (input.url !== undefined || input.final_url !== undefined) {
    const nextUrl = input.url !== undefined ? input.url : existing.url
    const nextFinalUrl = input.final_url !== undefined ? input.final_url : existing.final_url
    updates.push('asin = ?')
    params.push(extractAsinFromOfferUrls(nextUrl, nextFinalUrl))
  }
  if (input.is_active !== undefined) {
    updates.push('is_active = ?')
    params.push(input.is_active)
  }
  if (input.product_price !== undefined) {
    updates.push('product_price = ?')
    params.push(normalizedProductPrice || null)
  }
  if (shouldNormalizeCommission) {
    updates.push('commission_payout = ?')
    params.push(normalizedCommission?.commissionPayout || null)
    updates.push('commission_type = ?')
    params.push(normalizedCommission?.commissionType || null)
    updates.push('commission_value = ?')
    params.push(normalizedCommission?.commissionValue || null)
    updates.push('commission_currency = ?')
    params.push(normalizedCommission?.commissionCurrency || null)
  }
  // AI分析结果字段
  if (input.competitor_analysis !== undefined) {
    updates.push('competitor_analysis = ?')
    params.push(input.competitor_analysis)
  }
  if (input.review_analysis !== undefined) {
    updates.push('review_analysis = ?')
    params.push(input.review_analysis)
  }
  if (input.extracted_keywords !== undefined) {
    updates.push('extracted_keywords = ?')
    params.push(input.extracted_keywords)
  }
  if (input.extracted_headlines !== undefined) {
    updates.push('extracted_headlines = ?')
    params.push(input.extracted_headlines)
  }
  if (input.extracted_descriptions !== undefined) {
    updates.push('extracted_descriptions = ?')
    params.push(input.extracted_descriptions)
  }
  // P0/P1/P2/P3优化：增强提取字段
  if (input.enhanced_keywords !== undefined) {
    updates.push('enhanced_keywords = ?')
    params.push(input.enhanced_keywords)
  }
  if (input.enhanced_product_info !== undefined) {
    updates.push('enhanced_product_info = ?')
    params.push(input.enhanced_product_info)
  }
  if (input.enhanced_review_analysis !== undefined) {
    updates.push('enhanced_review_analysis = ?')
    params.push(input.enhanced_review_analysis)
  }
  if (input.extraction_quality_score !== undefined) {
    updates.push('extraction_quality_score = ?')
    params.push(input.extraction_quality_score)
  }
  if (input.extraction_enhanced_at !== undefined) {
    updates.push('extraction_enhanced_at = ?')
    params.push(input.extraction_enhanced_at)
  }
  if (input.enhanced_headlines !== undefined) {
    updates.push('enhanced_headlines = ?')
    params.push(input.enhanced_headlines)
  }
  if (input.enhanced_descriptions !== undefined) {
    updates.push('enhanced_descriptions = ?')
    params.push(input.enhanced_descriptions)
  }
  if (input.localization_adapt !== undefined) {
    updates.push('localization_adapt = ?')
    params.push(input.localization_adapt)
  }
  if (input.brand_analysis !== undefined) {
    updates.push('brand_analysis = ?')
    params.push(input.brand_analysis)
  }
  // v3.2架构：店铺/单品差异化分析字段
  if (input.ai_analysis_v32 !== undefined) {
    updates.push('ai_analysis_v32 = ?')
    params.push(toDbJsonObjectField(input.ai_analysis_v32, null))
  }
  if (input.page_type !== undefined) {
    updates.push('page_type = ?')
    params.push(input.page_type)
  }
  if (input.extraction_mode !== undefined) {
    updates.push('extraction_mode = ?')
    params.push(normalizeOfferExtractionMode(input.extraction_mode))
  }

  if (updates.length === 0) {
    return existing
  }

  updates.push(`updated_at = ${nowFunc}`)

  const updateQuery = `
    UPDATE offers
    SET ${updates.join(', ')}
    WHERE id = ? AND user_id = ?
  `

  params.push(id, userId)
  await db.exec(updateQuery, params)

  const updated = await findOfferById(id, userId)
  if (!updated) {
    throw new Error('Offer更新失败')
  }

  const { invalidateOfferCache } = await import('../common/server')
  invalidateOfferCache(userId, id)

  return updated
}

/**
 * 更新 Offer 的 extraction_metadata（不触碰 scrape_status，避免副作用）
 *
 * 用途：在不重新跑抓取/AI分析的情况下，缓存“品牌官网”等补充元数据。
 */
export async function updateOfferExtractionMetadata(
  id: number,
  userId: number,
  extractionMetadata: string
): Promise<void> {
  const db = await getDatabase()
  const nowFunc = 'NOW()'

  const { invalidateOfferCache } = await import('../common/server')
  invalidateOfferCache(userId, id)

  await db.exec(
    `UPDATE offers SET extraction_metadata = ?, updated_at = ${nowFunc} WHERE id = ? AND user_id = ?`,
    [extractionMetadata, id, userId]
  )
}

/**
 * 删除Offer（软删除）
 * 需求25: 保留历史数据，解除Ads账号关联
 */
/**
 * 关联账号详情接口
 */
export interface LinkedAccountDetail {
  accountId: number
  customerId: string
  accountName: string | null
  campaignId: number
  campaignName: string
  status: string
  createdAt: string
}

/**
 * 删除Offer结果接口
 */
export interface DeleteOfferResult {
  success: boolean
  message: string
  hasLinkedAccounts?: boolean
  linkedAccounts?: LinkedAccountDetail[]
  accountCount?: number
  campaignCount?: number
}

/**
 * 删除Offer
 * @param id - Offer ID
 * @param userId - 用户ID
 * @param autoUnlink - 是否自动解除关联（默认false）
 * @returns 删除结果，包含关联账号详情（如果有）
 */
export async function deleteOffer(
  id: number,
  userId: number,
  autoUnlink: boolean = false,
  removeGoogleAdsCampaigns: boolean = false
): Promise<DeleteOfferResult> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数和布尔值
  const nowFunc = 'NOW()'
  const isDeletedTrue = true
  const isActiveFalse = false
  let autoPausedCampaignCount = 0
  let autoRemovedCampaignCount = 0

  // 验证Offer存在且属于该用户
  const existing = await findOfferById(id, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 获取关联的Ads账号和Campaign详情
  // 使用INNER JOIN确保只检查有效账号，忽略孤儿campaigns
  // ⚠️ 修复：忽略未成功发布到Google Ads的campaigns(google_campaign_id为空)
  const linkedAccounts = (await db.query(
    `
    SELECT
      gaa.id as accountId,
      gaa.customer_id as customerId,
      gaa.account_name as accountName,
      c.id as campaignId,
      c.campaign_name as campaignName,
      c.status,
      c.created_at as createdAt
    FROM campaigns c
    INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND c.status != 'REMOVED'
      AND c.google_campaign_id IS NOT NULL
      AND c.google_campaign_id != ''
    ORDER BY gaa.account_name, c.created_at DESC
  `,
    [id, userId]
  )) as LinkedAccountDetail[]

  // 如果有关联且未开启自动解除，返回关联详情
  if (linkedAccounts.length > 0 && !autoUnlink) {
    const accountCount = new Set(linkedAccounts.map((a) => a.accountId)).size
    return {
      success: false,
      message: `该Offer关联了 ${accountCount} 个Ads账号，共 ${linkedAccounts.length} 个广告系列。请选择"解除关联并删除"或先手动解除关联。`,
      hasLinkedAccounts: true,
      linkedAccounts,
      accountCount,
      campaignCount: linkedAccounts.length,
    }
  }

  // 🔥 自动暂停关联的已启用广告系列（防止 Offer 删除后仍在花费）
  // 仅处理已成功发布到 Google Ads 的 campaign（google_campaign_id 非空）
  const campaignStatusCondition = removeGoogleAdsCampaigns
    ? "c.status != 'REMOVED'"
    : "c.status = 'ENABLED'"

  const campaignsToProcess = (await db.query(
    `
    SELECT
      c.id as campaignRowId,
      c.campaign_name as campaignName,
      c.google_ads_account_id as googleAdsAccountId,
      c.google_campaign_id as googleCampaignId
    FROM campaigns c
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND ${campaignStatusCondition}
      AND c.google_campaign_id IS NOT NULL
      AND c.google_campaign_id != ''
      AND c.google_ads_account_id IS NOT NULL
  `,
    [id, userId]
  )) as Array<{
    campaignRowId: number
    campaignName: string
    googleAdsAccountId: number
    googleCampaignId: string
  }>

  if (campaignsToProcess.length > 0) {
    const { getGoogleAdsAuthContext, resolveGoogleAdsAuthReadyFailure } =
      await import('@/lib/google-ads/auth/context')
    const authContext = await getGoogleAdsAuthContext(userId)
    const errors: Array<{ campaignRowId: number; message: string }> = []

    const authFailure = resolveGoogleAdsAuthReadyFailure(authContext)
    if (authFailure) {
      console.warn(
        `[offers] 用户 ${userId} Google Ads 认证不可用，跳过远端 Campaign 操作: ${authFailure.message}`
      )
    } else {
      const campaignsByAccount = campaignsToProcess.reduce(
        (acc, c) => {
          if (!acc[c.googleAdsAccountId]) acc[c.googleAdsAccountId] = []
          acc[c.googleAdsAccountId].push(c)
          return acc
        },
        {} as Record<number, typeof campaignsToProcess>
      )

      const campaignRowIdByGoogleId = new Map<string, number>()

      for (const [accountIdStr, accountCampaigns] of Object.entries(campaignsByAccount)) {
        const accountId = Number(accountIdStr)
        if (!Number.isFinite(accountId)) continue

        for (const c of accountCampaigns) {
          campaignRowIdByGoogleId.set(c.googleCampaignId, c.campaignRowId)
        }

        const adsAccountRow = await db.queryOne<{
          customer_id: string | null
          parent_mcc_id: string | null
          service_account_id: string | null
        }>(
          `SELECT customer_id, parent_mcc_id, service_account_id
           FROM google_ads_accounts WHERE id = ? AND user_id = ? LIMIT 1`,
          [accountId, userId]
        )

        if (!adsAccountRow?.customer_id) {
          for (const c of accountCampaigns) {
            errors.push({ campaignRowId: c.campaignRowId, message: 'Google Ads账号凭证不存在' })
          }
          continue
        }

        const summary = await executeGoogleAdsCampaignRemoteActions({
          userId,
          adsAccount: {
            id: accountId,
            customer_id: adsAccountRow.customer_id,
            parent_mcc_id: adsAccountRow.parent_mcc_id,
            service_account_id: adsAccountRow.service_account_id,
            is_active: true,
            is_deleted: false,
          },
          campaigns: accountCampaigns.map((c) => ({
            google_campaign_id: c.googleCampaignId,
          })),
          shouldRemove: removeGoogleAdsCampaigns,
          logPrefix: '[offers]',
          skipAccountEligibilityCheck: true,
          onCampaignOutcome: async ({ campaignId, outcome, reason }) => {
            const campaignRowId = campaignRowIdByGoogleId.get(campaignId)
            if (!campaignRowId) return

            if (outcome === 'REMOVED') {
              await applyCampaignTransition({
                userId,
                campaignId: campaignRowId,
                action: 'OFFER_DELETE',
              })
              autoRemovedCampaignCount++
              return
            }

            if (outcome === 'PAUSED' || outcome === 'PAUSED_FALLBACK') {
              await applyCampaignTransition({
                userId,
                campaignId: campaignRowId,
                action: 'PAUSE_OLD_CAMPAIGNS',
              })
              autoPausedCampaignCount++
              return
            }

            if (outcome === 'FAILED') {
              errors.push({
                campaignRowId,
                message: reason || '远端操作失败',
              })
            }
          },
        })

        if (summary.skipReason === 'CREDENTIALS_MISSING') {
          const accountError =
            summary.failures.find((item) => item.campaignId === '*')?.reason ||
            'Google Ads 认证信息缺失'
          for (const c of accountCampaigns) {
            errors.push({ campaignRowId: c.campaignRowId, message: accountError })
          }
        }
      }

      if (errors.length > 0) {
        const actionLabel = removeGoogleAdsCampaigns ? '删除' : '暂停'
        throw new Error(
          `自动${actionLabel}关联广告系列失败：${errors.length}/${campaignsToProcess.length} 个未能${actionLabel}，请稍后重试或先手动处理后再删除`
        )
      }
    }
  }

  // 自动解除所有关联
  if (autoUnlink && linkedAccounts.length > 0) {
    const campaignsForUnlink = await db.query<{ id: number }>(
      `
      SELECT id
      FROM campaigns
      WHERE offer_id = ?
        AND user_id = ?
        AND status != 'REMOVED'
    `,
      [id, userId]
    )

    const campaignIdsToUnlink = campaignsForUnlink
      .map((row) => Number(row.id))
      .filter((campaignId) => Number.isFinite(campaignId) && campaignId > 0)

    if (campaignIdsToUnlink.length > 0) {
      await applyCampaignTransitionByIds({
        userId,
        campaignIds: campaignIdsToUnlink,
        action: 'OFFER_UNLINK',
      })
    }

    await markUrlSwapTargetsRemovedByOfferId(id)
  }

  // 🔥 需求：终止并软删除关联的补点击任务
  // 1. 停止所有运行中/待执行的补点击任务
  // 2. 软删除任务（保留历史统计数据）
  const isDeletedCondition = "(is_deleted IS NULL OR is_deleted::text IN ('0', 'f', 'false'))"
  const clickFarmTasks = await db.query<any>(
    `
    SELECT id, status
    FROM click_farm_tasks
    WHERE offer_id = ? AND user_id = ? AND ${isDeletedCondition}
  `,
    [id, userId]
  )

  if (clickFarmTasks.length > 0) {
    // 停止运行中/待执行的任务
    await db.exec(
      `
      UPDATE click_farm_tasks
      SET status = CASE
        WHEN status IN ('running', 'pending', 'paused') THEN 'stopped'
        ELSE status
      END,
      updated_at = ${nowFunc}
      WHERE offer_id = ? AND user_id = ? AND ${isDeletedCondition}
    `,
      [id, userId]
    )

    // 软删除所有任务（保留历史统计数据）
    await db.exec(
      `
      UPDATE click_farm_tasks
      SET is_deleted = ?,
          deleted_at = ${nowFunc},
          updated_at = ${nowFunc}
      WHERE offer_id = ? AND user_id = ?
    `,
      [isDeletedTrue, id, userId]
    )

    try {
      const cfIds = clickFarmTasks.map((t: { id: unknown }) => String(t.id).trim()).filter(Boolean)
      if (cfIds.length > 0) {
        await removePendingClickFarmQueueTasksByTaskIds(cfIds, userId)
      }
    } catch (queueError: unknown) {
      const msg = queueError instanceof Error ? queueError.message : String(queueError)
      console.warn(`[Offer删除] 补点击队列清理失败:`, msg)
    }
  }

  // 🔥 需求：禁用关联的URL Swap换链接任务
  // 当Offer删除后，换链接任务自动禁用（保留历史统计数据）
  const urlSwapTasks = await db.query<any>(
    `
    SELECT id, status
    FROM url_swap_tasks
    WHERE offer_id = ? AND user_id = ? AND ${isDeletedCondition}
  `,
    [id, userId]
  )

  if (urlSwapTasks.length > 0) {
    // 禁用所有启用/错误状态的任务
    await db.exec(
      `
      UPDATE url_swap_tasks
      SET status = 'disabled',
          error_message = 'Offer已删除，任务自动禁用',
          updated_at = ${nowFunc}
      WHERE offer_id = ? AND user_id = ?
        AND ${isDeletedCondition}
        AND status != 'disabled'
    `,
      [id, userId]
    )

    await pauseUrlSwapTargetsByOfferId(id)

    console.log(`[Offer删除] 禁用 ${urlSwapTasks.length} 个关联的URL Swap任务`)

    try {
      const usIds = urlSwapTasks.map((t: { id: unknown }) => String(t.id).trim()).filter(Boolean)
      if (usIds.length > 0) {
        const { removedCount } = await removePendingUrlSwapQueueTasksByTaskIds(usIds, userId)
        if (removedCount > 0) {
          console.log(`[Offer删除] 从队列移除 ${removedCount} 个待处理的URL Swap任务`)
        }
      }
    } catch (queueError: unknown) {
      const msg = queueError instanceof Error ? queueError.message : String(queueError)
      console.warn(`[Offer删除] 换链接队列清理失败:`, msg)
    }
  }

  // 软删除Offer（保留历史数据）
  await db.exec(
    `
    UPDATE offers
    SET is_deleted = ?,
        deleted_at = ${nowFunc},
        is_active = ?,
        updated_at = ${nowFunc}
    WHERE id = ? AND user_id = ?
  `,
    [isDeletedTrue, isActiveFalse, id, userId]
  )

  const campaignNoticeParts: string[] = []
  if (autoRemovedCampaignCount > 0) {
    campaignNoticeParts.push(`已自动删除 ${autoRemovedCampaignCount} 个广告系列`)
  }
  if (autoPausedCampaignCount > 0) {
    campaignNoticeParts.push(`已自动暂停 ${autoPausedCampaignCount} 个广告系列`)
  }
  const campaignNotice = campaignNoticeParts.length > 0 ? `，${campaignNoticeParts.join('，')}` : ''

  return {
    success: true,
    message: autoUnlink
      ? `Offer删除成功${campaignNotice}，已自动解除 ${linkedAccounts.length} 个广告系列的关联${clickFarmTasks.length > 0 ? `，已终止并删除 ${clickFarmTasks.length} 个补点击任务` : ''}${urlSwapTasks.length > 0 ? `，已禁用 ${urlSwapTasks.length} 个换链接任务` : ''}`
      : clickFarmTasks.length > 0 || urlSwapTasks.length > 0
        ? `Offer删除成功${campaignNotice}${clickFarmTasks.length > 0 ? `，已终止并删除 ${clickFarmTasks.length} 个补点击任务` : ''}${urlSwapTasks.length > 0 ? `，已禁用 ${urlSwapTasks.length} 个换链接任务` : ''}`
        : 'Offer删除成功',
  }
}

/**
 * 解除Offer与Ads账号的关联
 * 需求25: 手动解除关联功能
 */
export async function unlinkOfferFromAccount(
  offerId: number,
  accountId: number,
  userId: number
): Promise<{ unlinkedCount: number }> {
  const db = await getDatabase()

  // 验证Offer存在
  const existing = await findOfferById(offerId, userId)
  if (!existing) {
    throw new Error('Offer不存在或无权访问')
  }

  // 将该Offer在该账号下的Campaigns标记为已移除
  const linkedCampaignRows = await db.query<{ id: number }>(
    `
    SELECT id
    FROM campaigns
    WHERE offer_id = ?
      AND google_ads_account_id = ?
      AND user_id = ?
      AND status != 'REMOVED'
  `,
    [offerId, accountId, userId]
  )

  const campaignIds = linkedCampaignRows
    .map((row) => Number(row.id))
    .filter((campaignId) => Number.isFinite(campaignId) && campaignId > 0)

  let updatedCount = 0
  if (campaignIds.length > 0) {
    const transitionResult = await applyCampaignTransitionByIds({
      userId,
      campaignIds,
      action: 'OFFER_UNLINK',
    })
    updatedCount = transitionResult.updatedCount
  }

  await markUrlSwapTargetsRemovedByOfferAccount(offerId, accountId)

  // 🔥 2025-12-19修复：清理API缓存，确保前端立即看到解绑效果
  const { invalidateOfferCache } = await import('../common/server')
  invalidateOfferCache(userId, offerId)

  // TODO: 实现闲置账号标记功能（需要先添加 is_idle 列到 google_ads_accounts 表）
  // 检查该账号是否还有其他活跃关联
  // const activeCount = await db.queryOne(`
  //   SELECT COUNT(*) as count
  //   FROM campaigns c
  //   JOIN offers o ON c.offer_id = o.id
  //   WHERE c.google_ads_account_id = ?
  //     AND c.user_id = ?
  //     AND o.is_deleted = FALSE
  //     AND c.status != 'REMOVED'
  // `, [accountId, userId]) as { count: number }

  // // 如果没有活跃关联，标记账号为闲置
  // if (activeCount.count === 0) {
  //   await db.exec(`
  //     UPDATE google_ads_accounts
  //     SET is_idle = 1, updated_at = NOW()
  //     WHERE id = ? AND user_id = ?
  //   `, [accountId, userId])
  // }

  return { unlinkedCount: updatedCount }
}

/**
 * 获取闲置的Ads账号列表
 * 需求25: 便于其他Offer建立关联关系
 * 只返回ENABLED状态且非Manager的账号，且没有关联任何活跃Campaigns的账号
 */
export async function getIdleAdsAccounts(userId: number): Promise<any[]> {
  const db = await getDatabase()

  const isActiveCondition = "gaa.is_active::text IN ('1', 't', 'true')"
  const isManagerCondition =
    "(gaa.is_manager_account IS NULL OR gaa.is_manager_account::text IN ('0', 'f', 'false'))"
  const isDeletedCondition = "(o.is_deleted IS NULL OR o.is_deleted::text IN ('0', 'f', 'false'))"

  // 通过子查询判断账号是否闲置（没有活跃的Campaign关联）
  return await db.query(
    `
    SELECT gaa.*
    FROM google_ads_accounts gaa
    WHERE gaa.user_id = ?
      AND ${isActiveCondition}
      AND gaa.status = 'ENABLED'
      AND ${isManagerCondition}
      AND NOT EXISTS (
        SELECT 1
        FROM campaigns c
        JOIN offers o ON c.offer_id = o.id
        WHERE c.google_ads_account_id = gaa.id
          AND c.user_id = gaa.user_id
          AND ${isDeletedCondition}
          AND c.status != 'REMOVED'
      )
    ORDER BY gaa.updated_at DESC
  `,
    [userId]
  )
}

/**
 * 更新Offer抓取状态
 */
export async function updateOfferScrapeStatus(
  id: number,
  userId: number,
  status: 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed',
  error?: string,
  scrapedData?: {
    brand?: string
    url?: string
    // 可选显式传入 final_url（否则从 url / scraped_data 派生）
    final_url?: string
    // 🔥 2025-12-16修复：添加final_url_suffix字段到类型定义
    final_url_suffix?: string
    // 🔥 2025-12-16修复：添加product_name字段到类型定义
    product_name?: string
    brand_description?: string
    unique_selling_points?: string
    product_highlights?: string
    target_audience?: string
    category?: string
    // 增强数据字段
    pricing?: string
    reviews?: string
    promotions?: string
    competitive_edges?: string
    // P0优化: 分析结果字段
    review_analysis?: string
    competitor_analysis?: string
    visual_analysis?: string
    // 🎯 需求34: 广告元素提取结果字段
    extracted_keywords?: string
    extracted_headlines?: string
    extracted_descriptions?: string
    extraction_metadata?: string
    extracted_at?: string
    // 🎯 P0优化: 原始爬虫数据（JSON格式存储所有scraped字段）
    scraped_data?: string
    // 🆕 Phase 2: 产品分类元数据（Store Metadata Enhancement）
    product_categories?: string
    // 🔥 页面类型标识（店铺/单品）
    page_type?: 'store' | 'product'
    // 🔥 v3.2 AI分析结果（包含pageType、关键词策略等）
    ai_analysis_v32?: unknown
    // 🔥 v3.2 AI提取的关键词
    ai_keywords?: unknown
    // 🔥 v3.2 AI分析的竞品优势
    ai_competitive_edges?: unknown
  }
): Promise<void> {
  const db = await getDatabase()

  // 🔥 2025-12-17修复：更新状态前先清理API缓存，确保前端显示最新状态
  const { invalidateOfferCache } = await import('../common/server')
  invalidateOfferCache(userId, id)

  if (status === 'completed' && scrapedData) {
    const sanitizePersistableFinalUrl = (inputUrl?: string | null): string | null => {
      if (typeof inputUrl !== 'string') return null
      const trimmed = inputUrl.trim()
      if (!trimmed) return null

      const lower = trimmed.toLowerCase()
      if (
        lower === 'null' ||
        lower === 'null/' ||
        lower === 'undefined' ||
        lower.startsWith('chrome-error://')
      ) {
        return null
      }

      try {
        const urlObj = new URL(trimmed)
        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') return null
        if (!urlObj.hostname || urlObj.hostname.toLowerCase() === 'null') return null
        return `${urlObj.origin}${urlObj.pathname}`
      } catch {
        return null
      }
    }

    const deriveFinalUrlFromInput = (
      inputUrl?: string | null
    ): { finalUrl?: string; finalUrlSuffix?: string } => {
      if (!inputUrl) return {}
      try {
        const urlObj = new URL(inputUrl)
        const sanitizedFinalUrl = sanitizePersistableFinalUrl(inputUrl)
        if (!sanitizedFinalUrl) return {}
        return {
          finalUrl: sanitizedFinalUrl,
          finalUrlSuffix: urlObj.search.substring(1),
        }
      } catch {
        return {}
      }
    }

    const derivedFromUrl = deriveFinalUrlFromInput(scrapedData.url)
    const derivedFromScrapedData = (() => {
      if (!scrapedData.scraped_data) return {}
      try {
        const parsed = JSON.parse(scrapedData.scraped_data)
        const finalUrl =
          sanitizePersistableFinalUrl(
            typeof parsed?.finalUrl === 'string' ? parsed.finalUrl : undefined
          ) || undefined
        const finalUrlSuffix =
          finalUrl && typeof parsed?.finalUrlSuffix === 'string' ? parsed.finalUrlSuffix : undefined
        return { finalUrl, finalUrlSuffix }
      } catch {
        return {}
      }
    })()

    const explicitFinalUrl = sanitizePersistableFinalUrl(scrapedData.final_url)
    const finalUrlForWrite =
      explicitFinalUrl ?? derivedFromUrl.finalUrl ?? derivedFromScrapedData.finalUrl ?? null
    const urlForWrite = finalUrlForWrite ?? derivedFromUrl.finalUrl ?? null
    // 注意：不要用 URL 中推导出的空字符串覆盖已有 suffix。
    // 仅当显式传入、或在 scraped_data 中明确带出 suffix 时才允许写入空字符串。
    const hasExplicitFinalUrlSuffix =
      scrapedData.final_url_suffix !== undefined && explicitFinalUrl !== null
    const hasScrapedDataFinalUrlSuffix = derivedFromScrapedData.finalUrlSuffix !== undefined
    const finalUrlSuffixForWriteRaw = hasExplicitFinalUrlSuffix
      ? (scrapedData.final_url_suffix ?? null)
      : hasScrapedDataFinalUrlSuffix
        ? (derivedFromScrapedData.finalUrlSuffix ?? null)
        : derivedFromUrl.finalUrlSuffix && derivedFromUrl.finalUrlSuffix.length > 0
          ? derivedFromUrl.finalUrlSuffix
          : null
    const finalUrlSuffixForWrite = finalUrlForWrite ? finalUrlSuffixForWriteRaw : null

    const derivedCategory =
      deriveCategoryFromScrapedData(scrapedData.scraped_data) ??
      (scrapedData.category ? compactCategoryLabel(scrapedData.category) : null)

    const rawBrand = scrapedData.brand?.trim() || null
    const scrapedProductTitle = (() => {
      if (!scrapedData.scraped_data) return null
      try {
        const parsed = JSON.parse(scrapedData.scraped_data)
        return typeof parsed?.productName === 'string' ? parsed.productName : null
      } catch {
        return null
      }
    })()
    const titleDerivedBrand = deriveBrandFromProductTitle(scrapedProductTitle)

    const deriveBrandFromUrl = (inputUrl: string | null | undefined): string | null => {
      if (!inputUrl) return null
      try {
        const hostname = new URL(inputUrl).hostname
          .trim()
          .toLowerCase()
          .replace(/\.+$/, '')
          .replace(/^www\./i, '')
        if (!hostname) return null

        const parts = hostname.split('.').filter(Boolean)
        if (parts.length < 2) return null

        const tld = parts[parts.length - 1]
        const sld = parts[parts.length - 2]
        const sldIsCommonSecondLevel = new Set(['co', 'com', 'net', 'org', 'gov', 'edu'])

        const label =
          tld.length === 2 && sldIsCommonSecondLevel.has(sld) && parts.length >= 3
            ? parts[parts.length - 3]
            : sld

        const normalized = String(label || '')
          .replace(/[-_]+/g, ' ')
          .trim()
        return normalized ? normalizeBrandName(normalized) : null
      } catch {
        return null
      }
    }

    const isMarketplaceHost = (host: string): boolean => {
      return (
        host.includes('amazon.') ||
        host.includes('ebay.') ||
        host.includes('walmart.') ||
        host.includes('aliexpress.') ||
        host.includes('temu.') ||
        host.includes('etsy.')
      )
    }

    const brandUrlCandidate = finalUrlForWrite || urlForWrite
    const urlHost = (() => {
      try {
        return brandUrlCandidate ? new URL(brandUrlCandidate).hostname.toLowerCase() : null
      } catch {
        return null
      }
    })()

    const fallbackBrand =
      urlHost && isMarketplaceHost(urlHost) ? null : deriveBrandFromUrl(brandUrlCandidate || null)
    const rawBrandForWrite = (() => {
      // Prefer a deterministic title-derived brand when the extracted label is missing or obviously wrong.
      if (!rawBrand || rawBrand === 'Unknown' || isLikelyInvalidBrandName(rawBrand)) {
        if (titleDerivedBrand && validateBrandName(titleDerivedBrand).valid)
          return titleDerivedBrand
      }
      if (rawBrand && fallbackBrand && validateBrandName(fallbackBrand).valid) {
        const rawLower = rawBrand.toLowerCase()
        const fallbackLower = fallbackBrand.toLowerCase()
        // Prefer domain-derived brand when it’s a meaningful substring of the extracted label.
        // e.g. "Kaspersky España" -> "Kaspersky"
        if (
          fallbackLower.length >= 3 &&
          rawLower.includes(fallbackLower) &&
          rawLower !== fallbackLower
        ) {
          return fallbackBrand
        }
      }

      if (rawBrand && validateBrandName(rawBrand).valid && !isLikelyInvalidBrandName(rawBrand))
        return rawBrand
      if (titleDerivedBrand && validateBrandName(titleDerivedBrand).valid) return titleDerivedBrand
      if (fallbackBrand && validateBrandName(fallbackBrand).valid) return fallbackBrand
      if (!rawBrand) return null
      const truncated = rawBrand.slice(0, 25)
      console.warn(`⚠️ 自动提取的品牌名不可靠或过长，已截断写入 offers.brand: "${truncated}"`)
      return truncated
    })()
    const brandForWrite = rawBrandForWrite ? normalizeBrandName(rawBrandForWrite).trim() : null

    // 🔧 修复：当品牌名更新时，同步更新offer_name
    // 需要先查询当前的offer_name以提取序号
    let currentOffer:
      | { offer_name: string; target_country: string; url: string | null; final_url: string | null }
      | undefined
    let newOfferName: string | null = null

    try {
      currentOffer = (await db.queryOne(
        `
        SELECT offer_name, target_country, url, final_url
        FROM offers
        WHERE id = ? AND user_id = ?
      `,
        [id, userId]
      )) as
        | {
            offer_name: string
            target_country: string
            url: string | null
            final_url: string | null
          }
        | undefined

      newOfferName = currentOffer?.offer_name || null

      // 如果提供了新的品牌名且不是Unknown，则更新offer_name
      if (brandForWrite && currentOffer) {
        const normalizedTargetCountry = normalizeOfferTargetCountry(currentOffer.target_country)
        // 从旧的offer_name中提取序号（格式：Brand_Country_序号）
        const parts = currentOffer.offer_name.split('_')
        const sequenceNumber = parts.length >= 3 ? parts[parts.length - 1] : '01'
        const proposedOfferName = `${brandForWrite}_${normalizedTargetCountry}_${sequenceNumber}`

        // 🔧 修复：检查新offer_name是否已被占用，如果是则重新生成唯一名称
        const isUnique = await isOfferNameUnique(proposedOfferName, userId, id)
        if (isUnique) {
          newOfferName = proposedOfferName
        } else {
          // 已被占用，使用generateOfferName生成新的唯一名称
          newOfferName = await generateOfferName(brandForWrite, normalizedTargetCountry, userId)
        }
      }
    } catch (nameError: any) {
      // 🔥 修复（2025-12-10）: offer_name更新失败不应阻止状态更新
      console.error('❌ offer_name更新失败:', nameError.message)
      // 继续使用原有的offer_name
    }

    // 🔧 PostgreSQL兼容性修复：使用NOW()替代NOW()
    const nowFunc = 'NOW()'
    const effectiveUrl = urlForWrite ?? currentOffer?.url ?? null
    const effectiveFinalUrl = finalUrlForWrite ?? currentOffer?.final_url ?? null
    const asinForWrite = extractAsinFromOfferUrls(effectiveUrl, effectiveFinalUrl)

    // 🔥 修复（2025-12-11）: 移除不存在的列 reviews 和 competitive_edges
    // PostgreSQL offers表中没有这两个字段，导致UPDATE语句失败
    // reviews数据应该存储在 review_analysis 或 ai_reviews 字段
    // competitive_edges数据应该存储在 competitor_analysis 或 ai_competitive_edges 字段
    await db.exec(
      `
      UPDATE offers
      SET scrape_status = ?,
          scraped_at = ${nowFunc},
          brand = COALESCE(?, brand),
          offer_name = COALESCE(?, offer_name),
          url = COALESCE(?, url),
          final_url = COALESCE(?, final_url),
          final_url_suffix = COALESCE(?, final_url_suffix),
          asin = ?,
          product_name = COALESCE(?, product_name),
          brand_description = COALESCE(?, brand_description),
          unique_selling_points = COALESCE(?, unique_selling_points),
          product_highlights = COALESCE(?, product_highlights),
          target_audience = COALESCE(?, target_audience),
          category = COALESCE(?, category),
          pricing = COALESCE(?, pricing),
          promotions = COALESCE(?, promotions),
          review_analysis = COALESCE(?, review_analysis),
          competitor_analysis = COALESCE(?, competitor_analysis),
          visual_analysis = COALESCE(?, visual_analysis),
          extracted_keywords = COALESCE(?, extracted_keywords),
          extracted_headlines = COALESCE(?, extracted_headlines),
          extracted_descriptions = COALESCE(?, extracted_descriptions),
          extraction_metadata = COALESCE(?, extraction_metadata),
          extracted_at = COALESCE(?, extracted_at),
          scraped_data = COALESCE(?, scraped_data),
          product_categories = COALESCE(?, product_categories),
          page_type = COALESCE(?, page_type),
          ai_analysis_v32 = COALESCE(?, ai_analysis_v32),
          ai_keywords = COALESCE(?, ai_keywords),
          ai_competitive_edges = COALESCE(?, ai_competitive_edges),
          updated_at = ${nowFunc}
      WHERE id = ? AND user_id = ?
    `,
      [
        status,
        brandForWrite,
        newOfferName,
        urlForWrite,
        finalUrlForWrite,
        finalUrlSuffixForWrite,
        asinForWrite,
        scrapedData.product_name || null,
        scrapedData.brand_description || null,
        scrapedData.unique_selling_points || null,
        scrapedData.product_highlights || null,
        scrapedData.target_audience || null,
        derivedCategory,
        scrapedData.pricing || null,
        scrapedData.promotions || null,
        scrapedData.review_analysis || null,
        scrapedData.competitor_analysis || null,
        scrapedData.visual_analysis || null,
        scrapedData.extracted_keywords || null,
        scrapedData.extracted_headlines || null,
        scrapedData.extracted_descriptions || null,
        scrapedData.extraction_metadata || null,
        scrapedData.extracted_at || null,
        scrapedData.scraped_data || null,
        scrapedData.product_categories || null,
        scrapedData.page_type || null,
        toDbJsonObjectField(scrapedData.ai_analysis_v32, null),
        toDbJsonObjectField(scrapedData.ai_keywords, null),
        toDbJsonObjectField(scrapedData.ai_competitive_edges, null),
        id,
        userId,
      ]
    )
  } else {
    // 🔧 修复: 为了兼容PostgreSQL，使用条件更新而不是CASE表达式
    // scraped_at 为 TIMESTAMP，CASE 分支须保持类型一致
    // 🔧 PostgreSQL兼容性修复：使用NOW()替代NOW()
    const nowFunc = 'NOW()'

    if (status === 'completed') {
      await db.exec(
        `
        UPDATE offers
        SET scrape_status = ?,
            scrape_error = ?,
            scraped_at = ${nowFunc},
            updated_at = ${nowFunc}
        WHERE id = ? AND user_id = ?
      `,
        [status, error || null, id, userId]
      )
    } else {
      await db.exec(
        `
        UPDATE offers
        SET scrape_status = ?,
            scrape_error = ?,
            updated_at = ${nowFunc}
        WHERE id = ? AND user_id = ?
      `,
        [status, error || null, id, userId]
      )
    }
  }
}
