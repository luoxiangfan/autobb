import { normalizeCountryCode } from '@/lib/common/server'
import { detectCountryInKeyword } from '@/lib/keywords/google-suggestions'
import {
  detectPlatformsInKeyword,
  extractPlatformFromUrl,
  isSemanticQuery,
} from '@/lib/keywords/keyword-quality-filter'

function resolveCountryCodeSet(country?: string): Set<string> {
  if (!country) return new Set()
  const normalized = normalizeCountryCode(country)
  return new Set(
    [country, country.toUpperCase?.(), normalized]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map((value) => value.trim().toUpperCase())
  )
}

function isGeoMismatch(keyword: string, targetCountry?: string): boolean {
  if (!targetCountry) return false
  const detectedCountries = detectCountryInKeyword(keyword)
  if (detectedCountries.length === 0) return false

  const targetCodes = resolveCountryCodeSet(targetCountry)
  if (targetCodes.size === 0) return false

  const normalizedDetectedCodes = new Set(
    detectedCountries
      .map((code) => normalizeCountryCode(code))
      .filter(Boolean)
      .map((code) => code.toUpperCase())
  )

  for (const code of targetCodes) {
    if (normalizedDetectedCodes.has(code)) {
      return false
    }
  }

  return true
}

function shouldFilterSemanticKeyword(keyword: string, productUrl?: string): boolean {
  if (!isSemanticQuery(keyword)) return false

  const urlPlatform = productUrl ? extractPlatformFromUrl(productUrl) : null
  if (!urlPlatform) return true

  const keywordPlatforms = detectPlatformsInKeyword(keyword)
  if (keywordPlatforms.length === 0) return true

  return !keywordPlatforms.includes(urlPlatform)
}

export { resolveCountryCodeSet, isGeoMismatch, shouldFilterSemanticKeyword }
