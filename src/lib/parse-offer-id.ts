const MAX_SAFE_POSITIVE_INTEGER_ID = Number.MAX_SAFE_INTEGER

/**
 * Parse a positive integer id from API/JSON payloads (number or numeric string).
 */
export function parsePositiveIntegerId(value: unknown): number | undefined {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_SAFE_POSITIVE_INTEGER_ID
  ) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10)
      if (parsed > 0 && parsed <= MAX_SAFE_POSITIVE_INTEGER_ID) {
        return parsed
      }
    }
  }
  return undefined
}

/** Parse a positive integer offer id (alias of {@link parsePositiveIntegerId}). */
export function parsePositiveIntegerOfferId(value: unknown): number | undefined {
  return parsePositiveIntegerId(value)
}

/** Parse comma-separated offer ids (e.g. query `ids=1,2,3`). */
export function parsePositiveIntegerOfferIdList(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => parsePositiveIntegerId(part.trim()))
    .filter((id): id is number => id != null)
}

/**
 * Parse a list of positive integer ids; rejects invalid entries and duplicates.
 */
export function parseUniquePositiveIntegerIds(
  values: unknown[]
): { ok: true; ids: number[] } | { ok: false; reason: 'invalid' | 'duplicate' } {
  const ids: number[] = []
  const seen = new Set<number>()
  for (const raw of values) {
    const id = parsePositiveIntegerId(raw)
    if (id == null) {
      return { ok: false, reason: 'invalid' }
    }
    if (seen.has(id)) {
      return { ok: false, reason: 'duplicate' }
    }
    seen.add(id)
    ids.push(id)
  }
  return { ok: true, ids }
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
