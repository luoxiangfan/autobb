type JsonArrayLike = unknown[] | string | null | undefined

const parseJsonArray = (value: JsonArrayLike): unknown[] => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const normalizeStringArray = (value: unknown): string[] => {
  const arr = Array.isArray(value) ? value : parseJsonArray(value as any)
  return arr
    .map(v => (typeof v === 'string' ? v : String(v ?? '')).trim())
    .filter(v => v.length > 0)
}

const normalizeKeywordsFromConfig = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((kw: any) => {
      if (typeof kw === 'string') return kw
      if (kw && typeof kw === 'object') return kw.text || kw.keyword || ''
      return ''
    })
    .map(v => String(v ?? '').trim())
    .filter(v => v.length > 0)
}

const normalizeSitelinks = (value: unknown): any[] => {
  const arr = Array.isArray(value) ? value : parseJsonArray(value as any)
  return arr
    .map((sl: any) => {
      if (typeof sl === 'string') {
        const text = sl.trim()
        return text ? text : null
      }
      if (!sl || typeof sl !== 'object') return null
      const text = typeof sl.text === 'string' ? sl.text.trim() : ''
      const url = typeof sl.url === 'string' ? sl.url.trim() : ''
      const descriptionCandidates = [
        sl.description,
        sl.desc,
        sl.description1,
        sl.description_1,
        sl.description2,
        sl.description_2,
        Array.isArray(sl.descriptions) ? sl.descriptions[0] : undefined
      ]
      const descriptionValue = descriptionCandidates.find(
        (v: any) => typeof v === 'string' && v.trim().length > 0
      ) as string | undefined
      const description = descriptionValue ? descriptionValue.trim() : undefined
      if (!text && !url && !description) return null
      return { ...sl, text, url, description }
    })
    .filter(Boolean)
}

export interface EffectiveCreativeInput {
  dbCreative: {
    headlines: JsonArrayLike
    descriptions: JsonArrayLike
    keywords: JsonArrayLike
    negativeKeywords: JsonArrayLike
    callouts: JsonArrayLike
    sitelinks: JsonArrayLike
    finalUrl?: string | null
    finalUrlSuffix?: string | null
  }
  campaignConfig?: any
  offerUrlFallback?: string
}

export interface EffectiveCreativeOutput {
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  negativeKeywords: string[]
  callouts: any[]
  sitelinks: any[]
  finalUrl: string
  finalUrlSuffix?: string
}

export function buildEffectiveCreative(input: EffectiveCreativeInput): EffectiveCreativeOutput {
  const { dbCreative, campaignConfig, offerUrlFallback } = input

  const dbHeadlines = normalizeStringArray(dbCreative.headlines)
  const dbDescriptions = normalizeStringArray(dbCreative.descriptions)
  const dbKeywords = normalizeStringArray(dbCreative.keywords)
  const dbNegativeKeywords = normalizeStringArray(dbCreative.negativeKeywords)
  const dbCallouts = parseJsonArray(dbCreative.callouts)
  const dbSitelinks = normalizeSitelinks(dbCreative.sitelinks)

  const overrideHeadlines = normalizeStringArray(campaignConfig?.headlines)
  const overrideDescriptions = normalizeStringArray(campaignConfig?.descriptions)
  const overrideKeywords = normalizeKeywordsFromConfig(campaignConfig?.keywords)
  const overrideNegativeKeywords = normalizeStringArray(campaignConfig?.negativeKeywords)
  const overrideCallouts = Array.isArray(campaignConfig?.callouts) ? campaignConfig.callouts : null
  const overrideSitelinks = Array.isArray(campaignConfig?.sitelinks) ? campaignConfig.sitelinks : null

  const overrideFinalUrl =
    Array.isArray(campaignConfig?.finalUrls) && typeof campaignConfig.finalUrls?.[0] === 'string'
      ? campaignConfig.finalUrls[0].trim()
      : ''

  const finalUrl =
    overrideFinalUrl ||
    (typeof dbCreative.finalUrl === 'string' ? dbCreative.finalUrl : '') ||
    (typeof offerUrlFallback === 'string' ? offerUrlFallback : '')

  const finalUrlSuffix =
    typeof campaignConfig?.finalUrlSuffix === 'string'
      ? campaignConfig.finalUrlSuffix
      : (typeof dbCreative.finalUrlSuffix === 'string' ? dbCreative.finalUrlSuffix : undefined)

  // Google Ads RSA 限制：Headlines ≤15, Descriptions ≤4
  const effectiveHeadlines = (overrideHeadlines.length > 0 ? overrideHeadlines : dbHeadlines).slice(0, 15)
  const effectiveDescriptions = (overrideDescriptions.length > 0 ? overrideDescriptions : dbDescriptions).slice(0, 4)

  return {
    headlines: effectiveHeadlines,
    descriptions: effectiveDescriptions,
    keywords: overrideKeywords.length > 0 ? overrideKeywords : dbKeywords,
    negativeKeywords: overrideNegativeKeywords.length > 0 ? overrideNegativeKeywords : dbNegativeKeywords,
    callouts: (overrideCallouts && overrideCallouts.length > 0) ? overrideCallouts : dbCallouts,
    sitelinks: (overrideSitelinks && overrideSitelinks.length > 0) ? overrideSitelinks : dbSitelinks,
    finalUrl,
    finalUrlSuffix
  }
}
