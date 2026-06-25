/**
 * Geo mismatch and search volume threshold helpers.
 */
const COUNTRY_CODE_ALIASES: Record<string, string[]> = {
  GB: ['uk', 'united kingdom', 'great britain', 'britain', 'england'],
  US: ['usa', 'united states', 'united states of america', 'america'],
  CA: ['canada'],
  AU: ['australia'],
  DE: ['germany', 'deutschland'],
  FR: ['france'],
  IT: ['italy'],
  ES: ['spain'],
  MX: ['mexico'],
  IN: ['india'],
  PK: ['pakistan'],
  BD: ['bangladesh'],
  JP: ['japan'],
  KR: ['korea', 'south korea'],
  BR: ['brazil'],
  TR: ['turkey'],
  ID: ['indonesia'],
  MY: ['malaysia'],
  TH: ['thailand'],
  VN: ['vietnam'],
  PH: ['philippines'],
  SG: ['singapore'],
  HK: ['hong kong'],
  TW: ['taiwan'],
  CN: ['china'],
  RU: ['russia'],
  AE: ['uae', 'united arab emirates'],
  SA: ['saudi arabia'],
}

const COUNTRY_CODE_EQUIVALENTS: Record<string, string[]> = {
  GB: ['GB', 'UK'],
  UK: ['GB', 'UK'],
}

function normalizeGeoCountryCode(value: string | undefined | null): string {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
  if (!normalized) return ''
  if (normalized === 'UK') return 'GB'
  return normalized
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildCountryAliasPattern(alias: string): RegExp {
  const escaped = escapeRegExp(alias.trim()).replace(/\s+/g, '\\s+')
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

function detectKeywordCountryHints(keyword: string): string[] {
  const text = String(keyword || '')
    .trim()
    .toLowerCase()
  if (!text) return []

  const detected: string[] = []
  for (const [countryCode, aliases] of Object.entries(COUNTRY_CODE_ALIASES)) {
    if (aliases.some((alias) => buildCountryAliasPattern(alias).test(text))) {
      detected.push(countryCode)
    }
  }

  return detected
}

export function resolveGeoMismatch(params: { keyword: string; targetCountry?: string }): {
  mismatch: boolean
  detectedCountries: string[]
  targetCountryCode: string
} {
  const targetCountryCode = normalizeGeoCountryCode(params.targetCountry)
  if (!targetCountryCode) {
    return { mismatch: false, detectedCountries: [], targetCountryCode }
  }

  const detectedCountries = detectKeywordCountryHints(params.keyword)
  if (detectedCountries.length === 0) {
    return { mismatch: false, detectedCountries, targetCountryCode }
  }

  const accepted = new Set([
    targetCountryCode,
    ...(COUNTRY_CODE_EQUIVALENTS[targetCountryCode] || []),
  ])
  const mismatch = detectedCountries.some((code) => !accepted.has(code))
  return { mismatch, detectedCountries, targetCountryCode }
}

/**
 * 过滤地理不匹配关键词
 *
 * @param keywords - 关键词数组
 * @param targetCountry - 目标国家
 * @returns 过滤后的关键词
 */
export function filterMismatchedGeoKeywords(keywords: string[], _targetCountry: string): string[] {
  const targetCountryCode = normalizeGeoCountryCode(_targetCountry)
  if (!targetCountryCode) return keywords
  if (!keywords || keywords.length === 0) return []
  return keywords.filter((kw) => {
    const keyword = String(kw || '').trim()
    if (!keyword) return false
    return !resolveGeoMismatch({
      keyword,
      targetCountry: targetCountryCode,
    }).mismatch
  })
}

// 搜索量阈值计算

/**
 * 计算搜索量阈值
 *
 * 阈值计算逻辑
 * 如果有足够数据（>=5个关键词），取中位数的10%作为阈值
 * 如果数据不足，返回最小阈值50
 * 如果所有搜索量都很低（最大值<500），阈值设为0（不过滤）
 *
 * @param searchVolumes - 搜索量数组
 * @param minThreshold - 最小阈值（默认50）
 * @returns 计算后的阈值
 */
export function calculateSearchVolumeThreshold(
  searchVolumes: number[],
  minThreshold: number = 50
): number {
  if (!searchVolumes || searchVolumes.length === 0) {
    return 0
  }

  // 过滤掉0值
  const validVolumes = searchVolumes.filter((v) => v > 0)

  if (validVolumes.length === 0) {
    return 0
  }

  // 如果最大值很小（<500），不设置阈值
  const maxVolume = Math.max(...validVolumes)
  if (maxVolume < 500) {
    return 0
  }

  // 计算中位数
  const sorted = [...validVolumes].sort((a, b) => a - b)
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]

  // 阈值 = 中位数的10%
  const threshold = Math.floor(median * 0.1)

  // 返回最大值（阈值和最小阈值比较）
  return Math.max(threshold, minThreshold)
}
