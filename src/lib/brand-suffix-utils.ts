const COMMON_COUNTRY_CODE_SUFFIXES = new Set([
  'US', 'GB', 'UK', 'CA', 'MX', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'CH',
  'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'GR', 'RO', 'IE', 'AU', 'NZ', 'JP', 'KR',
  'CN', 'HK', 'TW', 'IN', 'SG', 'MY', 'TH', 'PH', 'ID', 'VN', 'BR', 'AR', 'CL', 'CO',
  'PE', 'AE', 'SA', 'TR',
])

export function stripTrailingCountryCodeSuffix(brand: string): string {
  const normalized = String(brand || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return normalized

  const match = normalized.match(/^(.+?)\s+([A-Za-z]{2})$/)
  if (!match) return normalized

  const core = match[1]?.trim() || ''
  const suffix = (match[2] || '').toUpperCase()
  if (!core || core.length < 2) return normalized
  if (!COMMON_COUNTRY_CODE_SUFFIXES.has(suffix)) return normalized

  return core
}
