import {
  mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType,
  normalizeCreativeBucketSelection,
  type CanonicalCreativeType,
  type CreativeBucketSelection,
  type CreativeBucketSlot,
} from './creative-type'

export type CreativeSelectionErrorCode =
  | 'invalid-creative-type'
  | 'invalid-bucket'
  | 'creative-type-bucket-conflict'

export type NormalizeSingleCreativeSelectionParams = {
  creativeType: unknown
  bucket: unknown
  hasExplicitCreativeType: boolean
  hasExplicitBucket: boolean
}

export type NormalizeSingleCreativeSelectionResult = {
  normalizedCreativeType: CanonicalCreativeType | null
  bucketSelection: CreativeBucketSelection
  bucketFromCreativeType: CreativeBucketSlot | null
  requestedBucket: CreativeBucketSlot | null
  errorCode: CreativeSelectionErrorCode | null
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
    }
  }

  if (params.hasExplicitBucket && !bucketSelection.normalizedBucket) {
    return {
      normalizedCreativeType,
      bucketSelection,
      bucketFromCreativeType,
      requestedBucket: null,
      errorCode: 'invalid-bucket',
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
    }
  }

  const requestedBucket: CreativeBucketSlot | null =
    bucketFromCreativeType || bucketSelection.normalizedBucket

  return {
    normalizedCreativeType,
    bucketSelection,
    bucketFromCreativeType,
    requestedBucket,
    errorCode: null,
  }
}
