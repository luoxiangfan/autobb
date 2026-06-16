/**
 * 新建 Offer 提取请求解析（extract / extract/stream 共用）
 */

import {
  normalizeOfferExtractRequestBody,
  type NormalizeOfferExtractOptions,
} from '@/lib/common/server'
import {
  getDefaultOfferExtractionMode,
  getExtractionModeFromRequestBody,
  normalizeOfferExtractionMode,
  type OfferExtractionMode,
} from '@/lib/offers/server'
import { normalizeOfferTargetCountry } from '@/lib/offers/server'
import { resolveExtractPageInput, type OfferPageType } from '@/lib/offers/server'

export class OfferExtractRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'OfferExtractRequestError'
  }
}

export type ParsedNewOfferExtractRequest = {
  affiliateLink: string
  targetCountry: string
  productPrice: string | null
  commissionPayout: string | null
  commissionType: 'percent' | 'amount' | undefined
  commissionValue: string | undefined
  commissionCurrency: string | undefined
  brandName: string | undefined
  pageType: OfferPageType
  storeProductLinks: string[] | undefined
  skipCache: boolean
  skipWarmup: boolean
  extractionMode: OfferExtractionMode
}

export type ExistingOfferExtractionPrerequisites = {
  affiliateLink: string
  targetCountry: string
}

/** 解析并校验目标国家（禁止空白；不默认 US） */
export function resolveValidatedTargetCountry(
  value: string | null | undefined,
  options?: { missingMessage?: string; invalidMessage?: string }
): string {
  const trimmed = (value || '').trim()
  if (!trimmed) {
    throw new OfferExtractRequestError(
      400,
      options?.missingMessage ?? 'Offer缺少推广国家，无法提取'
    )
  }

  const normalized = normalizeOfferTargetCountry(trimmed)
  if (!normalized) {
    throw new OfferExtractRequestError(
      400,
      options?.invalidMessage ?? `无效的目标国家代码: ${trimmed}`
    )
  }

  return normalized
}

/** 已有 Offer 入队前校验（rebuild / scrape / batch/rebuild 共用） */
export function validateExistingOfferForExtraction(offer: {
  affiliate_link?: string | null
  url?: string | null
  target_country?: string | null
}): ExistingOfferExtractionPrerequisites {
  const affiliateLink = (offer.affiliate_link || offer.url || '').trim()
  if (!affiliateLink) {
    throw new OfferExtractRequestError(400, 'Offer缺少推广链接，无法提取')
  }

  const targetCountry = resolveValidatedTargetCountry(offer.target_country)
  return { affiliateLink, targetCountry }
}

/** 路由层统一错误 JSON（extract / rebuild / scrape） */
export function offerExtractApiErrorBody(
  error: unknown,
  fallbackError = 'Invalid data'
): { status: number; error: string; message: string } | null {
  if (error instanceof OfferExtractRequestError) {
    const errorLabel =
      error.status === 401 ? 'Unauthorized' : error.status === 409 ? 'Conflict' : fallbackError
    return {
      status: error.status,
      error: errorLabel,
      message: error.message,
    }
  }
  return null
}

/** 解析并校验 POST /api/offers/extract 类请求体 */
export function parseNewOfferExtractRequest(
  rawBody: unknown,
  normalizeOptions?: NormalizeOfferExtractOptions
): ParsedNewOfferExtractRequest {
  const modeFromBody = getExtractionModeFromRequestBody(rawBody)
  if ('invalid' in modeFromBody && modeFromBody.invalid) {
    throw new OfferExtractRequestError(400, '无效的提取模式，可选：fast、balanced、original')
  }

  let body: Record<string, unknown>
  try {
    body =
      normalizeOfferExtractRequestBody(rawBody, {
        strictMonetization: true,
        ...normalizeOptions,
      }) || (rawBody as Record<string, unknown>)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '佣金参数格式错误'
    throw new OfferExtractRequestError(400, message)
  }

  const {
    affiliate_link,
    target_country,
    product_price,
    commission_payout,
    commission_type,
    commission_value,
    commission_currency,
    brand_name,
    page_type,
    store_product_links,
    skipCache,
    skipWarmup,
  } = body as Record<string, unknown>

  if (!affiliate_link || typeof affiliate_link !== 'string' || affiliate_link.trim() === '') {
    throw new OfferExtractRequestError(400, 'affiliate_link is required')
  }

  if (!target_country || typeof target_country !== 'string' || target_country.trim().length < 2) {
    throw new OfferExtractRequestError(
      400,
      'target_country is required (至少2个字符，如US、UK、DE)'
    )
  }

  if (brand_name !== undefined && brand_name !== null) {
    if (typeof brand_name !== 'string') {
      throw new OfferExtractRequestError(400, 'brand_name must be a string')
    }
    if (brand_name.trim().length > 120) {
      throw new OfferExtractRequestError(400, 'brand_name length must be <= 120')
    }
  }

  const pageInput = resolveExtractPageInput({
    pageType: typeof page_type === 'string' ? page_type : undefined,
    affiliateLink: affiliate_link,
    storeProductLinks: store_product_links,
  })
  if ('error' in pageInput) {
    throw new OfferExtractRequestError(400, pageInput.error)
  }

  const extractionMode =
    ('mode' in modeFromBody ? modeFromBody.mode : undefined) ??
    (body.extraction_mode
      ? normalizeOfferExtractionMode(body.extraction_mode)
      : getDefaultOfferExtractionMode())

  return {
    affiliateLink: affiliate_link.trim(),
    targetCountry: target_country.trim(),
    productPrice: product_price != null ? String(product_price) : null,
    commissionPayout: commission_payout != null ? String(commission_payout) : null,
    commissionType:
      commission_type === 'percent' || commission_type === 'amount' ? commission_type : undefined,
    commissionValue: commission_value != null ? String(commission_value) : undefined,
    commissionCurrency: commission_currency != null ? String(commission_currency) : undefined,
    brandName: typeof brand_name === 'string' ? brand_name.trim() : undefined,
    pageType: pageInput.pageType,
    storeProductLinks:
      pageInput.storeProductLinks.length > 0 ? pageInput.storeProductLinks : undefined,
    skipCache: Boolean(skipCache),
    skipWarmup: Boolean(skipWarmup),
    extractionMode,
  }
}
