'use client'

import { useLayoutEffect } from 'react'
import { setUsdRatesMemoryCache } from '@/lib/exchange-rates-cache'

type ExchangeRatesHydratorProps = {
  rates: Record<string, number>
  children: React.ReactNode
}

/**
 * Seeds client-side convertCurrency() with server-fetched DB rates.
 * Without this, browser bundles only see the static EXCHANGE_RATES fallback.
 */
export function ExchangeRatesHydrator({ rates, children }: ExchangeRatesHydratorProps) {
  if (rates && Object.keys(rates).length > 0) {
    setUsdRatesMemoryCache(rates)
  }

  useLayoutEffect(() => {
    if (rates && Object.keys(rates).length > 0) {
      setUsdRatesMemoryCache(rates)
    }
  }, [rates])

  return <>{children}</>
}
