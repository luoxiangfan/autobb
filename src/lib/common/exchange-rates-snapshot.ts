import { EXCHANGE_RATES } from '@/lib/common'
import { getEffectiveUsdRates } from '@/lib/common'
import { loadUsdRatesFromDatabase } from '@/lib/common/exchange-rates-service'

/**
 * Load USD rates from DB into the in-process cache and return the effective map
 * (DB overlay merged with static fallback for missing codes).
 */
export async function loadAndGetUsdExchangeRates(): Promise<Record<string, number>> {
  await loadUsdRatesFromDatabase()
  return getEffectiveUsdRates(EXCHANGE_RATES)
}
