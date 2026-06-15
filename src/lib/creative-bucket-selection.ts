export type CreativeBucketSlot = 'A' | 'B' | 'D'

export type CreativeBucketSelection = {
  rawBucket: string
  normalizedBucket: CreativeBucketSlot | null
}

/** ad_creatives / 创意入队：仅接受 canonical 槽位 A/B/D */
export function normalizeCreativeBucketSelection(value: unknown): CreativeBucketSelection {
  const rawBucket = String(value || '')
    .trim()
    .toUpperCase()
  let normalizedBucket: CreativeBucketSlot | null = null
  if (rawBucket === 'A') {
    normalizedBucket = 'A'
  } else if (rawBucket === 'B') {
    normalizedBucket = 'B'
  } else if (rawBucket === 'D') {
    normalizedBucket = 'D'
  }

  return {
    rawBucket,
    normalizedBucket,
  }
}
