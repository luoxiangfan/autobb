const MAX_SAFE_OFFER_ID = Number.MAX_SAFE_INTEGER

/**
 * Parse a positive integer offer id from API/JSON payloads (number or numeric string).
 */
export function parsePositiveIntegerOfferId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_SAFE_OFFER_ID) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10)
      if (parsed > 0 && parsed <= MAX_SAFE_OFFER_ID) {
        return parsed
      }
    }
  }
  return undefined
}

/**
 * When keyword-pool expand prepare did not succeed, skip per-evaluate expand reload in Ad Strength.
 */
export function deriveSkipKeywordPoolExpandLoad(
  preparedExpand?: { ok: boolean } | undefined,
  plannerSession?: unknown
): boolean {
  if (plannerSession) {
    return false
  }
  return preparedExpand?.ok !== true
}
