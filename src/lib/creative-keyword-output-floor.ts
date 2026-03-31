import type { CanonicalCreativeType } from './creative-type'

const BRAND_INTENT_MIN_OUTPUT_KEYWORDS = 3
const DEMAND_INTENT_MIN_OUTPUT_KEYWORDS = 4
const BUCKET_MIN_OUTPUT_KEYWORDS: Record<'A' | 'B' | 'D', number> = {
  A: 10,
  B: 8,
  D: 10,
}

function normalizeBucketForOutputFloor(bucket: unknown): 'A' | 'B' | 'D' | null {
  const normalized = String(bucket || '').trim().toUpperCase()
  if (normalized === 'A') return 'A'
  if (normalized === 'B' || normalized === 'C') return 'B'
  if (normalized === 'D' || normalized === 'S') return 'D'
  return null
}

export function resolveCreativeKeywordMinimumOutputCount(params: {
  creativeType: CanonicalCreativeType | null | undefined
  maxKeywords: number
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
}): number {
  const safeMax = Math.max(1, Math.floor(params.maxKeywords))
  let floor = 1

  if (params.creativeType === 'brand_intent') {
    floor = BRAND_INTENT_MIN_OUTPUT_KEYWORDS
  } else if (params.creativeType === 'model_intent' || params.creativeType === 'product_intent') {
    floor = DEMAND_INTENT_MIN_OUTPUT_KEYWORDS
  }

  const normalizedBucket = normalizeBucketForOutputFloor(params.bucket)
  if (normalizedBucket) {
    floor = Math.max(floor, BUCKET_MIN_OUTPUT_KEYWORDS[normalizedBucket])
  }

  return Math.min(safeMax, floor)
}
