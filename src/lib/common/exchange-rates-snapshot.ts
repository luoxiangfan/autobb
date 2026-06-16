import 'server-only'

import { EXCHANGE_RATES } from './currency'
import { getEffectiveUsdRates } from './exchange-rates-cache'
import { loadUsdRatesFromDatabase } from '@/lib/common/exchange-rates-service'

/**
 * Load USD rates from DB into the in-process cache and return the effective map
 * (DB overlay merged with static fallback for missing codes).
 */
export async function loadAndGetUsdExchangeRates(): Promise<Record<string, number>> {
  await loadUsdRatesFromDatabase()
  return getEffectiveUsdRates(EXCHANGE_RATES)
}
