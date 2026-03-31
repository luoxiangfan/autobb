import type { CreativeBucketSlot } from './creative-bucket-selection'

type ResolveGeneratedBucketsParams = {
  availableBuckets: CreativeBucketSlot[]
  selectedBucket: CreativeBucketSlot
}

export function resolveGeneratedBuckets(params: ResolveGeneratedBucketsParams): CreativeBucketSlot[] {
  const slotOrder: CreativeBucketSlot[] = ['A', 'B', 'D']
  return slotOrder.filter((slot) => slot === params.selectedBucket || !params.availableBuckets.includes(slot))
}
