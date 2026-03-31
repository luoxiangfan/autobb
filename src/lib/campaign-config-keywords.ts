export type CampaignConfigKeywordMatchType = 'BROAD' | 'PHRASE' | 'EXACT'

export type CampaignConfigKeyword = {
  text: string
  matchType: CampaignConfigKeywordMatchType
}

function normalizeKeywordText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeMatchType(
  value: unknown,
  fallback: CampaignConfigKeywordMatchType = 'PHRASE'
): CampaignConfigKeywordMatchType {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'BROAD_MATCH_MODIFIER' || text === 'BMM') return 'BROAD'
  if (text === 'BROAD' || text === 'PHRASE' || text === 'EXACT') {
    return text
  }
  return fallback
}

function normalizeBoolean(value: unknown): boolean {
  if (value === true || value === false) return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  const text = String(value || '').trim().toLowerCase()
  return text === 'true' || text === 'yes' || text === 'on'
}

function safeParseCampaignConfig(campaignConfig: unknown): Record<string, any> {
  if (campaignConfig && typeof campaignConfig === 'object' && !Array.isArray(campaignConfig)) {
    return { ...(campaignConfig as Record<string, any>) }
  }
  if (typeof campaignConfig === 'string') {
    try {
      const parsed = JSON.parse(campaignConfig)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, any>) }
      }
    } catch {
      return {}
    }
  }
  return {}
}

function toKeywordKey(keyword: CampaignConfigKeyword): string {
  return `${keyword.text.toLowerCase()}|${keyword.matchType}`
}

function parseKeywordEntry(value: unknown): CampaignConfigKeyword | null {
  let text = ''
  let matchType: CampaignConfigKeywordMatchType = 'PHRASE'
  let isNegative = false

  if (typeof value === 'string') {
    text = normalizeKeywordText(value)
  } else if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    text = normalizeKeywordText(row.text || row.keyword || row.keywordText || row.value)
    matchType = normalizeMatchType(
      row.matchType || row.recommendedMatchType || row.currentMatchType,
      'PHRASE'
    )
    isNegative =
      normalizeBoolean(row.isNegative)
      || normalizeBoolean(row.is_negative)
      || normalizeBoolean(row.negative)
  }

  if (!text || text.length < 2 || text.length > 80 || isNegative) return null
  return { text, matchType }
}

export function extractCampaignConfigKeywords(campaignConfig: unknown): CampaignConfigKeyword[] {
  const config = safeParseCampaignConfig(campaignConfig)
  const source = Array.isArray(config.keywords) ? config.keywords : []
  const output: CampaignConfigKeyword[] = []
  const seen = new Set<string>()

  for (const item of source) {
    const keyword = parseKeywordEntry(item)
    if (!keyword) continue
    const key = toKeywordKey(keyword)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(keyword)
  }

  return output
}

export function extractCampaignConfigNegativeKeywords(campaignConfig: unknown): string[] {
  const config = safeParseCampaignConfig(campaignConfig)
  const source = Array.isArray(config.negativeKeywords) ? config.negativeKeywords : []
  const output: string[] = []
  const seen = new Set<string>()

  for (const item of source) {
    const text = typeof item === 'string'
      ? normalizeKeywordText(item)
      : normalizeKeywordText((item as Record<string, unknown>)?.text || (item as Record<string, unknown>)?.keyword)
    if (!text || text.length < 2 || text.length > 80) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(text)
  }

  return output
}

function buildKeywordSignature(values: CampaignConfigKeyword[]): string {
  return values
    .map((item) => toKeywordKey(item))
    .sort()
    .join('||')
}

function buildNegativeKeywordSignature(values: string[]): string {
  return values
    .map((item) => item.toLowerCase())
    .sort()
    .join('||')
}

export function patchCampaignConfigKeywords(params: {
  campaignConfig: unknown
  addKeywords?: CampaignConfigKeyword[]
  removeKeywords?: CampaignConfigKeyword[]
  addNegativeKeywords?: string[]
  removeNegativeKeywords?: string[]
}): { nextCampaignConfigJson: string; changed: boolean } {
  const config = safeParseCampaignConfig(params.campaignConfig)

  const existingKeywords = extractCampaignConfigKeywords(config)
  const existingNegativeKeywords = extractCampaignConfigNegativeKeywords(config)
  const keywordMap = new Map<string, CampaignConfigKeyword>()
  for (const item of existingKeywords) {
    keywordMap.set(toKeywordKey(item), item)
  }

  for (const item of params.removeKeywords || []) {
    const parsed = parseKeywordEntry(item)
    if (!parsed) continue
    keywordMap.delete(toKeywordKey(parsed))
  }
  for (const item of params.addKeywords || []) {
    const parsed = parseKeywordEntry(item)
    if (!parsed) continue
    keywordMap.set(toKeywordKey(parsed), parsed)
  }

  const negativeKeywordMap = new Map<string, string>()
  for (const item of existingNegativeKeywords) {
    negativeKeywordMap.set(item.toLowerCase(), item)
  }

  for (const item of params.removeNegativeKeywords || []) {
    const text = normalizeKeywordText(item)
    if (!text) continue
    negativeKeywordMap.delete(text.toLowerCase())
  }
  for (const item of params.addNegativeKeywords || []) {
    const text = normalizeKeywordText(item)
    if (!text || text.length < 2 || text.length > 80) continue
    negativeKeywordMap.set(text.toLowerCase(), text)
  }

  const nextKeywords = Array.from(keywordMap.values())
  const nextNegativeKeywords = Array.from(negativeKeywordMap.values())

  const changed =
    buildKeywordSignature(existingKeywords) !== buildKeywordSignature(nextKeywords)
    || buildNegativeKeywordSignature(existingNegativeKeywords) !== buildNegativeKeywordSignature(nextNegativeKeywords)

  config.keywords = nextKeywords.map((item) => ({
    text: item.text,
    matchType: item.matchType,
  }))
  config.negativeKeywords = nextNegativeKeywords

  return {
    nextCampaignConfigJson: JSON.stringify(config),
    changed,
  }
}
