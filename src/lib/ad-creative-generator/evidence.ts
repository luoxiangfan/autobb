// 🔥 AI语义分类
// 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分

// 🔥 优化：Google Ads关键词标准化去重

// 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数

import { parsePrice } from '../common'

import type { CreativePriceEvidenceResolution, CreativeSalesRankSignal } from './types'
import { safeParseJson } from './utils'

export const PRICE_EVIDENCE_MISMATCH_THRESHOLD = 0.2

export const SALES_RANK_PROMPT_MAX = 1000

export const SALES_RANK_STRONG_SIGNAL_MAX = 100

export const REVIEW_QUOTE_MIN_LENGTH = 8

export const REVIEW_QUOTE_MAX_LENGTH = 90

export const REVIEW_QUOTE_BLOCKLIST_PATTERN =
  /\b(cuz|awesome|ain't|gonna|kinda|sorta|wtf|omg|lol)\b/i

export const RISKY_SOCIAL_PROOF_PERCENT_PATTERN =
  /\b\d{1,3}%\s+of\s+(?:women|men|users|people|customers)\s+(?:love|prefer|recommend|say|agree)\b/i

export function toNonEmptyPriceText(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function parsePriceAmount(value: string | null): number | null {
  if (!value) return null
  const direct = parsePrice(value)
  if (direct !== null) return direct
  const stripped = value.replace(/[A-Za-z]/g, '').trim()
  if (!stripped) return null
  return parsePrice(stripped)
}

export function resolveCreativeSalesRankSignal(value: unknown): CreativeSalesRankSignal {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return {
      raw: null,
      normalizedRankText: null,
      rankNumber: null,
      eligibleForPrompt: false,
      strongSignal: false,
    }
  }

  const rankMatch = raw.match(/#\s*([\d,]+)/)
  if (!rankMatch?.[1]) {
    return {
      raw,
      normalizedRankText: null,
      rankNumber: null,
      eligibleForPrompt: false,
      strongSignal: false,
    }
  }

  const rankNumber = Number.parseInt(rankMatch[1].replace(/,/g, ''), 10)
  if (!Number.isFinite(rankNumber) || rankNumber <= 0) {
    return {
      raw,
      normalizedRankText: null,
      rankNumber: null,
      eligibleForPrompt: false,
      strongSignal: false,
    }
  }

  return {
    raw,
    normalizedRankText: `#${rankNumber.toLocaleString('en-US')}`,
    rankNumber,
    eligibleForPrompt: rankNumber <= SALES_RANK_PROMPT_MAX,
    strongSignal: rankNumber <= SALES_RANK_STRONG_SIGNAL_MAX,
  }
}

export function sanitizeReviewSnippetForPrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim()

  if (normalized.length < REVIEW_QUOTE_MIN_LENGTH) return null

  const truncated =
    normalized.length > REVIEW_QUOTE_MAX_LENGTH
      ? `${normalized.slice(0, REVIEW_QUOTE_MAX_LENGTH - 3).trim()}...`
      : normalized

  if (REVIEW_QUOTE_BLOCKLIST_PATTERN.test(truncated)) return null
  if (RISKY_SOCIAL_PROOF_PERCENT_PATTERN.test(truncated)) return null

  return truncated
}

export function resolveCreativePriceEvidence(offer: any): CreativePriceEvidenceResolution {
  const pricingData = safeParseJson(offer?.pricing, null)
  const scrapedData = safeParseJson(offer?.scraped_data, null)

  const offerProductPrice = toNonEmptyPriceText(offer?.product_price)
  const offerPricingCurrent = toNonEmptyPriceText(pricingData?.current)
  const offerPricingOriginal = toNonEmptyPriceText(pricingData?.original)

  const scrapedCurrentPrice = toNonEmptyPriceText(scrapedData?.productPrice)
  const scrapedOriginalPrice = toNonEmptyPriceText(scrapedData?.originalPrice)
  const scrapedDiscount = toNonEmptyPriceText(scrapedData?.discount)

  const currentFromOffer = offerProductPrice || offerPricingCurrent
  const priceSource: CreativePriceEvidenceResolution['priceSource'] = offerProductPrice
    ? 'offer_product_price'
    : offerPricingCurrent
      ? 'offer_pricing_current'
      : scrapedCurrentPrice
        ? 'scraped_data'
        : 'none'

  let currentPrice = currentFromOffer || scrapedCurrentPrice || null
  let originalPrice = offerPricingOriginal || scrapedOriginalPrice || null
  let discount = scrapedDiscount || null
  let priceEvidenceBlocked = false
  let priceEvidenceWarning: string | null = null

  const offerPriceAmount = parsePriceAmount(currentFromOffer)
  const scrapedPriceAmount = parsePriceAmount(scrapedCurrentPrice)

  if (offerPriceAmount !== null && scrapedPriceAmount !== null && offerPriceAmount > 0) {
    const ratio = Math.abs(scrapedPriceAmount - offerPriceAmount) / offerPriceAmount
    if (ratio > PRICE_EVIDENCE_MISMATCH_THRESHOLD) {
      const deviationPercent = Math.round(ratio * 100)
      priceEvidenceBlocked = true
      priceEvidenceWarning = `[PriceEvidenceGuard] Offer ${offer?.id ?? 'unknown'} detected conflicting prices: authoritative=${currentFromOffer}, scraped=${scrapedCurrentPrice}, deviation=${deviationPercent}%. Blocking price claims in creative output.`
      currentPrice = null
      originalPrice = null
      discount = null
    }
  }

  return {
    currentPrice,
    originalPrice,
    discount,
    priceEvidenceBlocked,
    priceEvidenceWarning,
    priceSource,
  }
}
