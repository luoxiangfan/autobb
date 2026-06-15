import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { hasModelAnchorInText } from './model-anchor-evidence'

export type CanonicalCreativeType = 'brand_intent' | 'model_intent' | 'product_intent'

export type LegacyCreativeType = 'brand_focus' | 'model_focus' | 'brand_product'

export type CreativeTypeValue = CanonicalCreativeType | LegacyCreativeType

export type CreativeBucketSlot = 'A' | 'B' | 'D'

/** keyword_pool 查询参数仍可能传入历史桶 C/S（非 ad_creatives 字段） */
export type LegacyKeywordPoolBucketQuery = 'C' | 'S'

function normalizeTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
      }
    } catch {
      return [trimmed]
    }

    return [trimmed]
  }

  return []
}

export type CreativeBucketSelection = {
  rawBucket: string
  normalizedBucket: CreativeBucketSlot | null
}

/** ad_creatives / 创意入队：仅接受 canonical 槽位 A/B/D */
export function normalizeCreativeBucketSelection(value: unknown): CreativeBucketSelection {
  const rawBucket = String(value || '')
    .trim()
    .toUpperCase()
  return {
    rawBucket,
    normalizedBucket: normalizeCreativeBucketSlot(rawBucket),
  }
}

/** Canonical 创意槽位：仅 A/B/D（ad_creatives.keyword_bucket） */
export function normalizeCreativeBucketSlot(value: unknown): CreativeBucketSlot | null {
  const upper = String(value || '')
    .trim()
    .toUpperCase()
  if (upper === 'A') return 'A'
  if (upper === 'B') return 'B'
  if (upper === 'D') return 'D'
  return null
}

/** keyword_pool 查询：历史 C→B、S→D（不影响 ad_creatives 存储） */
export function normalizeKeywordPoolBucketQuery(value: unknown): CreativeBucketSlot | null {
  const upper = String(value || '')
    .trim()
    .toUpperCase()
  if (upper === 'C') return 'B'
  if (upper === 'S') return 'D'
  return normalizeCreativeBucketSlot(upper)
}

export function normalizeCanonicalCreativeType(value: unknown): CanonicalCreativeType | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return null

  if (normalized === 'brand_intent' || normalized === 'brand_focus') {
    return 'brand_intent'
  }
  if (normalized === 'model_intent' || normalized === 'model_focus') {
    return 'model_intent'
  }
  if (normalized === 'product_intent' || normalized === 'brand_product') {
    return 'product_intent'
  }

  return null
}

export function mapCreativeTypeToBucketSlot(
  creativeType: CanonicalCreativeType | null | undefined
): CreativeBucketSlot | null {
  if (creativeType === 'brand_intent') return 'A'
  if (creativeType === 'model_intent') return 'B'
  if (creativeType === 'product_intent') return 'D'
  return null
}

export function getCreativeTypeForBucketSlot(bucket: CreativeBucketSlot): CanonicalCreativeType {
  if (bucket === 'A') return 'brand_intent'
  if (bucket === 'B') return 'model_intent'
  return 'product_intent'
}

export function hasModelAnchorEvidence(params: {
  keywords?: unknown
  headlines?: unknown
  descriptions?: unknown
  theme?: unknown
  bucketIntent?: unknown
}): boolean {
  const texts = [
    ...normalizeTextArray(params.keywords),
    ...normalizeTextArray(params.headlines),
    ...normalizeTextArray(params.descriptions),
    ...normalizeTextArray(params.theme),
    ...normalizeTextArray(params.bucketIntent),
  ]

  for (const text of texts) {
    const normalized = normalizeGoogleAdsKeyword(text)
    if (!normalized) continue
    if (hasModelAnchorInText(normalized)) {
      return true
    }
  }

  return false
}

export function deriveCanonicalCreativeType(params: {
  creativeType?: unknown
  keywordBucket?: unknown
  keywords?: unknown
  headlines?: unknown
  descriptions?: unknown
  theme?: unknown
  bucketIntent?: unknown
}): CanonicalCreativeType | null {
  const normalizedCreativeType = normalizeCanonicalCreativeType(params.creativeType)
  if (normalizedCreativeType) {
    return normalizedCreativeType
  }

  const bucketSlot = normalizeCreativeBucketSlot(params.keywordBucket)
  if (!bucketSlot) return null

  if (bucketSlot === 'A') return 'brand_intent'
  if (bucketSlot === 'D') return 'product_intent'

  return hasModelAnchorEvidence({
    keywords: params.keywords,
    headlines: params.headlines,
    descriptions: params.descriptions,
    theme: params.theme,
    bucketIntent: params.bucketIntent,
  })
    ? 'model_intent'
    : 'product_intent'
}
