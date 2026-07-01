import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { hasModelAnchorInText } from './model-anchor-evidence'

export type CanonicalCreativeType = 'brand_intent' | 'model_intent' | 'product_intent'

export type CreativeBucketSlot = 'A' | 'B' | 'D'

const STORED_CREATIVE_TYPE_ALIASES: Record<string, CanonicalCreativeType> = {
  brand_focus: 'brand_intent',
  model_focus: 'model_intent',
  brand_product: 'product_intent',
}

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

/* * ad_creatives / 创意入队：仅接受 canonical 槽位 A/B/D */
export function normalizeCreativeBucketSelection(value: unknown): CreativeBucketSelection {
  const rawBucket = String(value || '')
    .trim()
    .toUpperCase()
  return {
    rawBucket,
    normalizedBucket: normalizeCreativeBucketSlot(rawBucket),
  }
}

/* * Canonical 创意槽位：仅 A/B/D（ad_creatives.keyword_bucket） */
export function normalizeCreativeBucketSlot(value: unknown): CreativeBucketSlot | null {
  const upper = String(value || '')
    .trim()
    .toUpperCase()
  if (upper === 'A') return 'A'
  if (upper === 'B') return 'B'
  if (upper === 'D') return 'D'
  return null
}

/* * 读取历史 DB/API 响应中的 keyword_bucket（C/S 仅在此处归一化，不接受为新入参） */
export function normalizeStoredCreativeBucketSlot(value: unknown): CreativeBucketSlot | null {
  const canonical = normalizeCreativeBucketSlot(value)
  if (canonical) return canonical

  const upper = String(value || '')
    .trim()
    .toUpperCase()
  if (upper === 'C') return 'B'
  if (upper === 'S') return 'D'
  return null
}

/* * API 入参：仅接受 canonical creativeType */
export function normalizeCanonicalCreativeType(value: unknown): CanonicalCreativeType | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return null

  if (normalized === 'brand_intent') return 'brand_intent'
  if (normalized === 'model_intent') return 'model_intent'
  if (normalized === 'product_intent') return 'product_intent'

  return null
}

/* * 读取历史 DB 中的 creative_type（含旧别名） */
export function normalizeStoredCreativeType(value: unknown): CanonicalCreativeType | null {
  const canonical = normalizeCanonicalCreativeType(value)
  if (canonical) return canonical

  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return null

  return STORED_CREATIVE_TYPE_ALIASES[normalized] ?? null
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
  const normalizedCreativeType = normalizeStoredCreativeType(params.creativeType)
  if (normalizedCreativeType) {
    return normalizedCreativeType
  }

  const rawBucket = String(params.keywordBucket || '')
    .trim()
    .toUpperCase()
  const bucketSlot = normalizeStoredCreativeBucketSlot(params.keywordBucket)
  if (!bucketSlot) return null

  // 历史 keyword_bucket 别名在读取时保留原槽位意图，不经过 B 槽位的锚点推断
  if (rawBucket === 'C') return 'model_intent'
  if (rawBucket === 'S') return 'product_intent'

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
