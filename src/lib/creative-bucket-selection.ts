export type CreativeBucketSlot = 'A' | 'B' | 'D'

export type CreativeBucketSelection = {
  rawBucket: string
  normalizedBucket: CreativeBucketSlot | null
  legacyModelHint: boolean
}

export function normalizeCreativeBucketSelection(value: unknown): CreativeBucketSelection {
  const rawBucket = String(value || '').trim().toUpperCase()
  let normalizedBucket: CreativeBucketSlot | null = null
  if (rawBucket === 'A') {
    normalizedBucket = 'A'
  } else if (rawBucket === 'B' || rawBucket === 'C') {
    normalizedBucket = 'B'
  } else if (rawBucket === 'D' || rawBucket === 'S') {
    normalizedBucket = 'D'
  }

  return {
    rawBucket,
    normalizedBucket,
    legacyModelHint: rawBucket === 'C',
  }
}
