/**
 * ExchangeRate-API v6 sync: fetch USD-latest rates, persist, refresh in-memory cache.
 * API key: EXCHANGE_RATE_API_KEY (or EXCHANGERATE_API_KEY).
 */

import { getDatabase } from '@/lib/db'
import { setUsdRatesMemoryCache } from '@/lib/exchange-rates-cache'

export type ExchangeRateApiPayload = {
  result: string
  documentation?: string
  terms_of_use?: string
  time_last_update_unix?: number
  time_last_update_utc?: string
  time_next_update_unix?: number
  time_next_update_utc?: string
  base_code?: string
  conversion_rates?: Record<string, number>
}

export function getExchangeRateApiKey(): string | undefined {
  const k = process.env.EXCHANGE_RATE_API_KEY || process.env.EXCHANGERATE_API_KEY
  const t = String(k || '').trim()
  return t || undefined
}

function normalizeCurrencyCode(code: string): string | null {
  const c = String(code || '')
    .trim()
    .toUpperCase()
  if (c.length !== 3 || !/^[A-Z]{3}$/.test(c)) return null
  return c
}

export async function countUsdExchangeRateRows(): Promise<number> {
  const db = getDatabase()
  const rows = await db.query<{ n: number | string }>(
    'SELECT COUNT(*) AS n FROM usd_exchange_rates'
  )
  return Number(rows[0]?.n || 0)
}

export async function loadUsdRatesFromDatabase(): Promise<void> {
  const db = getDatabase()
  const rows = await db.query<{ currency: string; rate: number }>(
    'SELECT currency, rate FROM usd_exchange_rates'
  )
  if (!rows.length) {
    setUsdRatesMemoryCache(null)
    return
  }
  const map: Record<string, number> = {}
  for (const row of rows) {
    const code = normalizeCurrencyCode(row.currency)
    if (!code) continue
    const rate = Number(row.rate)
    if (!Number.isFinite(rate) || rate <= 0) continue
    map[code] = rate
  }
  setUsdRatesMemoryCache(Object.keys(map).length ? map : null)
}

export async function replaceUsdExchangeRatesInDb(params: {
  conversionRates: Record<string, number>
  baseCode: string
  timeLastUpdateUnix: number | null
  timeNextUpdateUnix: number | null
  timeLastUpdateUtc: string | null
  timeNextUpdateUtc: string | null
}): Promise<void> {
  const db = getDatabase()
  const entries: Array<[string, number]> = []
  for (const [rawCode, rawRate] of Object.entries(params.conversionRates)) {
    const code = normalizeCurrencyCode(rawCode)
    if (!code) continue
    const rate = Number(rawRate)
    if (!Number.isFinite(rate) || rate <= 0) continue
    entries.push([code, rate])
  }
  if (!entries.length) {
    throw new Error('exchange rates: no valid currency rows to persist')
  }

  await db.transaction(async () => {
    await db.exec('DELETE FROM usd_exchange_rates')
    for (const [currency, rate] of entries) {
      await db.exec(
        "INSERT INTO usd_exchange_rates (currency, rate, updated_at) VALUES (?, ?, datetime('now'))",
        [currency, rate]
      )
    }
    if (db.type === 'postgres') {
      await db.exec(
        `INSERT INTO exchange_rate_snapshot_meta (id, base_code, time_last_update_unix, time_next_update_unix, time_last_update_utc, time_next_update_utc, fetched_at)
         VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           base_code = EXCLUDED.base_code,
           time_last_update_unix = EXCLUDED.time_last_update_unix,
           time_next_update_unix = EXCLUDED.time_next_update_unix,
           time_last_update_utc = EXCLUDED.time_last_update_utc,
           time_next_update_utc = EXCLUDED.time_next_update_utc,
           fetched_at = EXCLUDED.fetched_at`,
        [
          params.baseCode || 'USD',
          params.timeLastUpdateUnix,
          params.timeNextUpdateUnix,
          params.timeLastUpdateUtc,
          params.timeNextUpdateUtc,
        ]
      )
    } else {
      await db.exec(
        `INSERT OR REPLACE INTO exchange_rate_snapshot_meta (id, base_code, time_last_update_unix, time_next_update_unix, time_last_update_utc, time_next_update_utc, fetched_at)
         VALUES (1, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          params.baseCode || 'USD',
          params.timeLastUpdateUnix,
          params.timeNextUpdateUnix,
          params.timeLastUpdateUtc,
          params.timeNextUpdateUtc,
        ]
      )
    }
  })

  // Persist succeeded: always refresh in-memory cache from DB snapshot.
  await loadUsdRatesFromDatabase()
}

export async function fetchLatestUsdRatesFromApi(): Promise<ExchangeRateApiPayload> {
  const apiKey = getExchangeRateApiKey()
  if (!apiKey) {
    throw new Error('EXCHANGE_RATE_API_KEY (or EXCHANGERATE_API_KEY) is not set')
  }
  const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/latest/USD`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text) as ExchangeRateApiPayload
    } catch {
      throw new Error(`exchange rate API: invalid JSON (HTTP ${res.status})`)
    }
    const body = json as ExchangeRateApiPayload
    if (!res.ok) {
      throw new Error(`exchange rate API: HTTP ${res.status} ${body?.result || ''}`)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

export async function syncExchangeRatesFromRemote(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const payload = await fetchLatestUsdRatesFromApi()
    if (payload.result !== 'success' || !payload.conversion_rates) {
      return { ok: false, message: `API result=${String(payload?.result)}` }
    }
    await replaceUsdExchangeRatesInDb({
      conversionRates: payload.conversion_rates,
      baseCode: String(payload.base_code || 'USD'),
      timeLastUpdateUnix: payload.time_last_update_unix ?? null,
      timeNextUpdateUnix: payload.time_next_update_unix ?? null,
      timeLastUpdateUtc: payload.time_last_update_utc ?? null,
      timeNextUpdateUtc: payload.time_next_update_utc ?? null,
    })
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, message }
  }
}

/**
 * After migrations: load DB into memory; if table empty and API key present, fetch once.
 */
export async function ensureExchangeRatesOnStartup(): Promise<void> {
  try {
    await loadUsdRatesFromDatabase()
  } catch (e) {
    console.warn(
      '[exchange-rates] load from DB failed (tables may not exist yet):',
      e instanceof Error ? e.message : e
    )
    return
  }

  let count = 0
  try {
    count = await countUsdExchangeRateRows()
  } catch {
    return
  }

  if (count > 0) {
    return
  }

  const key = getExchangeRateApiKey()
  if (!key) {
    console.warn(
      '[exchange-rates] usd_exchange_rates is empty and EXCHANGE_RATE_API_KEY is unset; using static fallback rates'
    )
    return
  }

  const result = await syncExchangeRatesFromRemote()
  if (result.ok) {
    console.log('[exchange-rates] initial sync completed after table creation')
  } else {
    console.warn('[exchange-rates] initial sync failed:', result.message)
  }
}
