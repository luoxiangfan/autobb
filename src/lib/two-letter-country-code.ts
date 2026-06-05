export function normalizeTwoLetterCountryCode(value: unknown): string | null {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) return null
  return normalized
}

export function pickFirstTwoLetterCountryCode(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeTwoLetterCountryCode(value)
    if (normalized) return normalized
  }
  return null
}
