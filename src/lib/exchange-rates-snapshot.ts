import { EXCHANGE_RATES } from '@/lib/currency'
import { getEffectiveUsdRates } from '@/lib/exchange-rates-cache'
import { loadUsdRatesFromDatabase } from '@/lib/exchange-rates-service'

/**
 * Load USD rates from DB into the in-process cache and return the effective map
 * (DB overlay merged with static fallback for missing codes).
 */
export async function loadAndGetUsdExchangeRates(): Promise<Record<string, number>> {
  await loadUsdRatesFromDatabase()
  return getEffectiveUsdRates(EXCHANGE_RATES)
}
