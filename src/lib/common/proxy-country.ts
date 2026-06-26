import { normalizeCountryCode } from './language-country-codes'

const PROXY_COUNTRY_ALIAS_MAP: Readonly<Record<string, string[]>> = {
  GB: ['UK'],
  UK: ['GB'],
}

function addProxyCountryAliases(candidates: Set<string>, code: string): void {
  const aliases = PROXY_COUNTRY_ALIAS_MAP[code]
  if (!aliases) return
  for (const alias of aliases) {
    if (alias) candidates.add(alias)
  }
}

/**
 * 将国家码展开为代理匹配用的等价集合（如 GB ↔ UK）。
 */
export function resolveProxyCountryCandidates(country: string): string[] {
  const raw = String(country || '').trim()
  if (!raw) return []

  const rawUpper = raw.toUpperCase()
  const normalized = normalizeCountryCode(raw)
  const candidates = new Set<string>()

  if (normalized) candidates.add(normalized)
  if (rawUpper) candidates.add(rawUpper)

  if (normalized) addProxyCountryAliases(candidates, normalized)
  if (rawUpper && rawUpper !== normalized) addProxyCountryAliases(candidates, rawUpper)

  return Array.from(candidates)
}

export function proxyCountryCodesOverlap(countryA: string, countryB: string): boolean {
  const candidatesA = new Set(resolveProxyCountryCandidates(countryA))
  for (const code of resolveProxyCountryCandidates(countryB)) {
    if (candidatesA.has(code)) return true
  }
  return false
}

export type ProxyCountryUrlConfig = {
  country: string
  url: string
}

/**
 * 按国家别名展开代理 URL 配置，同一 URL 可为 GB/UK 等各保留一条。
 */
export function expandProxyUrlCountries<T extends ProxyCountryUrlConfig>(proxyUrls: T[]): T[] {
  const expanded: T[] = []
  const seen = new Set<string>()

  for (const item of proxyUrls) {
    const rawCountry = String(item?.country || '').trim()
    const url = String(item?.url || '').trim()
    if (!rawCountry || !url) continue

    const countryCandidates = resolveProxyCountryCandidates(rawCountry)
    const finalCandidates =
      countryCandidates.length > 0 ? countryCandidates : [rawCountry.toUpperCase()]

    for (const country of finalCandidates) {
      const key = `${country}\u0000${url}`
      if (seen.has(key)) continue
      seen.add(key)
      expanded.push({ ...item, country, url })
    }
  }

  return expanded
}

/**
 * 代理池 map key 等场景用的主国家码（normalize 失败时回退大写原文）。
 */
export function resolvePrimaryProxyCountryCode(country: string): string {
  const normalized = normalizeCountryCode(String(country || '').trim())
  return (
    normalized ||
    String(country || '')
      .trim()
      .toUpperCase()
  )
}
