import {
  mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType,
  type CanonicalCreativeType,
} from './creative-type'
import {
  normalizeCreativeBucketSelection,
  type CreativeBucketSelection,
  type CreativeBucketSlot,
} from './creative-bucket-selection'

export type CreativeSelectionErrorCode =
  | 'invalid-creative-type'
  | 'invalid-bucket'
  | 'creative-type-bucket-conflict'

export type NormalizeSingleCreativeSelectionParams = {
  creativeType: unknown
  bucket: unknown
  hasExplicitCreativeType: boolean
  hasExplicitBucket: boolean
  resolveLegacyModelIntent?: () => boolean
}

export type NormalizeSingleCreativeSelectionResult = {
  normalizedCreativeType: CanonicalCreativeType | null
  bucketSelection: CreativeBucketSelection
  bucketFromCreativeType: CreativeBucketSlot | null
  requestedBucket: CreativeBucketSlot | null
  errorCode: CreativeSelectionErrorCode | null
  legacyFallbackToProduct: boolean
}

export function normalizeSingleCreativeSelection(
  params: NormalizeSingleCreativeSelectionParams
): NormalizeSingleCreativeSelectionResult {
  const normalizedCreativeType = normalizeCanonicalCreativeType(params.creativeType)
  const bucketSelection = normalizeCreativeBucketSelection(params.bucket)
  const bucketFromCreativeType = mapCreativeTypeToBucketSlot(normalizedCreativeType)

  if (params.hasExplicitCreativeType && !normalizedCreativeType) {
    return {
      normalizedCreativeType,
      bucketSelection,
      bucketFromCreativeType,
      requestedBucket: null,
      errorCode: 'invalid-creative-type',
      legacyFallbackToProduct: false,
    }
  }

  if (params.hasExplicitBucket && !bucketSelection.normalizedBucket) {
    return {
      normalizedCreativeType,
      bucketSelection,
      bucketFromCreativeType,
      requestedBucket: null,
      errorCode: 'invalid-bucket',
      legacyFallbackToProduct: false,
    }
  }

  if (
    bucketFromCreativeType &&
    bucketSelection.normalizedBucket &&
    bucketFromCreativeType !== bucketSelection.normalizedBucket
  ) {
    return {
      normalizedCreativeType,
      bucketSelection,
      bucketFromCreativeType,
      requestedBucket: null,
      errorCode: 'creative-type-bucket-conflict',
      legacyFallbackToProduct: false,
    }
  }

  let requestedBucket: CreativeBucketSlot | null = bucketFromCreativeType || bucketSelection.normalizedBucket
  let legacyFallbackToProduct = false

  if (!bucketFromCreativeType && bucketSelection.legacyModelHint && bucketSelection.normalizedBucket === 'B') {
    const shouldKeepModelIntent = params.resolveLegacyModelIntent ? params.resolveLegacyModelIntent() : true
    if (!shouldKeepModelIntent) {
      requestedBucket = 'D'
      legacyFallbackToProduct = true
    }
  }

  return {
    normalizedCreativeType,
    bucketSelection,
    bucketFromCreativeType,
    requestedBucket,
    errorCode: null,
    legacyFallbackToProduct,
  }
}
