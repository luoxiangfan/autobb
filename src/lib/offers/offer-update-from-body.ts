/**
 * 从 API 请求体解析 Offer 更新字段（PUT / rebuild 共用）
 */

import { z } from 'zod'
import { zErr } from '@/lib/common/zod-errors'
import { compactCategoryLabel } from '@/lib/offers/offer-category'
import { findOfferById, updateOffer, type Offer } from '@/lib/offers/offers'
import {
  normalizeOfferCommissionInput,
  resolveLegacyBareNumericMode,
} from '@/lib/offers/offer-monetization'
import { inferOfferPageType } from '@/lib/offers/offer-extraction-task'
import {
  OfferExtractRequestError,
  resolveValidatedTargetCountry,
} from '@/lib/offers/offer-extract-request'
import {
  normalizeOfferExtractionMode,
  resolveExtractionModeInput,
} from '@/lib/offers/offer-extraction-mode'

const extractionModeSchema = z
  .union([z.string(), z.undefined(), z.null(), z.literal('')])
  .transform((val): string | undefined => (val == null || val === '' ? undefined : val))
  .pipe(
    z
      .string()
      .optional()
      .superRefine((val, ctx) => {
        if (val === undefined) return
        if (resolveExtractionModeInput(val) === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: zErr.invalidExtractionMode.error,
          })
        }
      })
      .transform((val) => {
        if (val === undefined) return undefined
        return resolveExtractionModeInput(val)!
      })
  )

const updateOfferBodySchema = z.object({
  url: z.url(zErr.invalidUrl).optional(),
  brand: z.string().min(1, zErr.brandRequired).optional(),
  category: z.string().optional(),
  target_country: z.string().min(2, zErr.targetCountryMin).optional(),
  affiliate_link: z.url(zErr.invalidAffiliateUrl).optional(),
  brand_description: z.string().optional(),
  unique_selling_points: z.string().optional(),
  product_highlights: z.string().optional(),
  target_audience: z.string().optional(),
  page_type: z.enum(['store', 'product']).optional(),
  store_product_links: z.array(z.url(zErr.invalidUrl)).max(3, zErr.maxItems(3)).optional(),
  product_price: z.string().optional(),
  commission_payout: z.string().optional(),
  commission_type: z.enum(['percent', 'amount']).optional(),
  commission_value: z.union([z.string(), z.number()]).optional(),
  commission_currency: z.string().optional(),
  is_active: z.boolean().optional(),
  extraction_mode: extractionModeSchema.optional(),
  extractionMode: extractionModeSchema.optional(),
})

const OFFER_UPDATE_KEYS = new Set([
  'url',
  'brand',
  'category',
  'target_country',
  'affiliate_link',
  'brand_description',
  'unique_selling_points',
  'product_highlights',
  'target_audience',
  'page_type',
  'store_product_links',
  'product_price',
  'commission_payout',
  'commission_type',
  'commission_value',
  'commission_currency',
  'is_active',
  'extraction_mode',
  'extractionMode',
])

/** 从 rebuild 请求体中剥离 Offer 更新字段 */
export function pickOfferUpdateBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const key of OFFER_UPDATE_KEYS) {
    if (record[key] !== undefined) {
      picked[key] = record[key]
    }
  }
  return Object.keys(picked).length > 0 ? picked : null
}

/**
 * 解析 store_product_links 列更新值：
 * - undefined：不更新该列
 * - null：清空（显式改为单品页时）
 * - string：JSON 数组写入
 */
export function resolveStoreProductLinksForUpdate(
  pageType: 'store' | 'product' | undefined,
  linksInput: string[] | undefined
): string | null | undefined {
  if (pageType === 'product') {
    return null
  }
  if (pageType === 'store' && linksInput !== undefined) {
    const normalized = Array.from(
      new Set(linksInput.map((link) => link.trim()).filter(Boolean))
    ).slice(0, 3)
    return normalized.length > 0 ? JSON.stringify(normalized) : null
  }
  return undefined
}

export function mapOfferToPutResponse(offer: Offer) {
  return {
    id: offer.id,
    url: offer.url,
    brand: offer.brand,
    offerName: offer.offer_name,
    category: offer.category ? compactCategoryLabel(offer.category) : offer.category,
    categoryRaw: offer.category,
    targetCountry: offer.target_country,
    targetLanguage: offer.target_language,
    affiliateLink: offer.affiliate_link,
    brandDescription: offer.brand_description,
    uniqueSellingPoints: offer.unique_selling_points,
    productHighlights: offer.product_highlights,
    targetAudience: offer.target_audience,
    finalUrl: offer.final_url,
    finalUrlSuffix: offer.final_url_suffix,
    productPrice: offer.product_price,
    commissionPayout: offer.commission_payout,
    commissionType: offer.commission_type,
    commissionValue: offer.commission_value,
    commissionCurrency: offer.commission_currency,
    pageType: offer.page_type,
    storeProductLinks: offer.store_product_links,
    extractionMode: normalizeOfferExtractionMode(offer.extraction_mode),
    scrapeStatus: offer.scrape_status,
    isActive: offer.is_active === true || offer.is_active === 1,
    createdAt: offer.created_at,
    updatedAt: offer.updated_at,
  }
}

export async function applyOfferUpdateFromBody(
  offerId: number,
  userId: number,
  body: unknown
): Promise<{ offer: Offer } | { error: string; status: number }> {
  const picked = pickOfferUpdateBody(body)
  if (!picked) {
    const existing = await findOfferById(offerId, userId)
    if (!existing) {
      return { error: 'Offer不存在或无权访问', status: 404 }
    }
    return { offer: existing }
  }

  const validationResult = updateOfferBodySchema.safeParse(picked)
  if (!validationResult.success) {
    return {
      error: validationResult.error.issues[0]?.message || '请求参数无效',
      status: 400,
    }
  }

  const data = validationResult.data

  let normalizedTargetCountry: string | undefined
  if (data.target_country !== undefined) {
    try {
      normalizedTargetCountry = resolveValidatedTargetCountry(data.target_country, {
        missingMessage: '目标国家不能为空',
        invalidMessage: '无效的目标国家代码',
      })
    } catch (error: unknown) {
      if (error instanceof OfferExtractRequestError) {
        return { error: error.message, status: 400 }
      }
      const message = error instanceof Error ? error.message : '无效的目标国家代码'
      return { error: message, status: 400 }
    }
  }

  let pageType = data.page_type
  if (
    pageType === undefined &&
    (data.store_product_links !== undefined || data.affiliate_link !== undefined)
  ) {
    let affiliateForInfer = data.affiliate_link
    if (!affiliateForInfer) {
      const existingForInfer = await findOfferById(offerId, userId)
      if (!existingForInfer) {
        return { error: 'Offer不存在或无权访问', status: 404 }
      }
      affiliateForInfer = existingForInfer.affiliate_link || existingForInfer.url || undefined
    }
    pageType = inferOfferPageType({
      affiliateLink: affiliateForInfer,
      storeProductLinks: data.store_product_links,
    })
  }

  const storeProductLinksUpdate = resolveStoreProductLinksForUpdate(
    pageType,
    data.store_product_links
  )

  const hasCommissionInput =
    data.commission_payout !== undefined ||
    data.commission_type !== undefined ||
    data.commission_value !== undefined ||
    data.commission_currency !== undefined

  let normalizedCommission: ReturnType<typeof normalizeOfferCommissionInput> | null = null
  if (hasCommissionInput) {
    let commissionTargetCountry = normalizedTargetCountry
    if (!commissionTargetCountry) {
      const existingOffer = await findOfferById(offerId, userId)
      if (!existingOffer) {
        return { error: 'Offer不存在或无权访问', status: 404 }
      }
      commissionTargetCountry = existingOffer.target_country
    }
    try {
      normalizedCommission = normalizeOfferCommissionInput({
        targetCountry: commissionTargetCountry,
        commissionPayout: data.commission_payout,
        commissionType: data.commission_type,
        commissionValue: data.commission_value,
        commissionCurrency: data.commission_currency,
        legacyBareNumericMode: resolveLegacyBareNumericMode({
          commissionType: data.commission_type,
          commissionValue: data.commission_value,
          commissionPayout: data.commission_payout,
        }),
      })
    } catch (error: any) {
      return { error: error?.message || '佣金参数格式错误', status: 400 }
    }
  }

  const offer = await updateOffer(offerId, userId, {
    url: data.url,
    brand: data.brand,
    category: data.category,
    target_country: normalizedTargetCountry,
    affiliate_link: data.affiliate_link,
    store_product_links: storeProductLinksUpdate,
    brand_description: data.brand_description,
    unique_selling_points: data.unique_selling_points,
    product_highlights: data.product_highlights,
    target_audience: data.target_audience,
    product_price: data.product_price,
    commission_payout: hasCommissionInput
      ? normalizedCommission?.commissionPayout || undefined
      : undefined,
    commission_type: hasCommissionInput
      ? normalizedCommission?.commissionType || undefined
      : undefined,
    commission_value: hasCommissionInput
      ? normalizedCommission?.commissionValue || undefined
      : undefined,
    commission_currency: hasCommissionInput
      ? normalizedCommission?.commissionCurrency || undefined
      : undefined,
    page_type: pageType,
    is_active: data.is_active,
    extraction_mode: data.extraction_mode ?? data.extractionMode,
  })

  return { offer }
}
