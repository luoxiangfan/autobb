/**
 * In-memory USD rate overlay (filled from DB on server). No Node DB imports — safe for client bundles.
 */

let usdRatesFromDb: Record<string, number> | null = null

export function getEffectiveUsdRates(fallback: Record<string, number>): Record<string, number> {
  if (usdRatesFromDb && Object.keys(usdRatesFromDb).length > 0) {
    return { ...fallback, ...usdRatesFromDb }
  }
  return fallback
}

export function setUsdRatesMemoryCache(rates: Record<string, number> | null): void {
  usdRatesFromDb = rates && Object.keys(rates).length > 0 ? rates : null
}
