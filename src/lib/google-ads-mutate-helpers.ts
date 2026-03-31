/**
 * Helpers for normalizing Google Ads mutate/update operations.
 *
 * In this codebase we sometimes build "mutate" style ops:
 *   { update: {...}, update_mask: 'field.path' }
 * But the `google-ads-api` Node client `*.update()` expects plain resource objects:
 *   { resource_name: 'customers/...', field: value }
 */

export type MutateStyleUpdateOperation = {
  update: Record<string, any>
  update_mask?: any
}

export function normalizeGoogleAdsApiUpdateOperations(
  operations: Array<Record<string, any> | MutateStyleUpdateOperation>
): Array<Record<string, any>> {
  const normalized = operations.map((op: any) => (op && typeof op === 'object' && 'update' in op ? op.update : op))

  for (const item of normalized) {
    const resourceName = (item as any)?.resource_name
    if (typeof resourceName !== 'string' || !resourceName.trim()) {
      throw new Error('Resource name is missing.')
    }
  }

  return normalized
}

