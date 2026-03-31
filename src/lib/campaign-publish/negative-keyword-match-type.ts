export type NegativeKeywordMatchType = 'EXACT' | 'PHRASE' | 'BROAD'

type NegativeKeywordMatchTypeInput = Record<string, unknown> | null | undefined

const BROAD_BLOCKERS = new Set([
  'free',
  'cheap',
  'cheapest',
  'discount',
  'clearance',
  'wholesale',
  'bulk',
  'coupon',
  'coupons',
  'job',
  'jobs',
  'employment',
  'recruit',
  'recruitment',
  'recruiter',
  'recruiters',
  'recruiting',
  'career',
  'careers',
  'hiring',
  'salary',
  'vs',
  'versus',
  'compare',
  'compared',
  'comparison',
  'alternative',
  'alternatives',
  'replace',
  'review',
  'reviews',
  'manual',
  'guide',
  'tutorial',
  'instructions',
  'unboxing',
  'setup',
  'install',
  'repair',
  'fix',
  'broken',
  'parts',
  'used',
  'refurbished',
  'secondhand',
  'download',
  'software',
  'app',
  'ebook',
  'digital',
  'clothing',
  'shoes',
  'toy',
  'book',
  'homemade',
  'handmade',
  'ebay',
  'craigslist',
  'alibaba',
  'aliexpress',
  'wish',
  'diy',
  'trial',
  'sample',
  'demo',
  'crack',
  'cracked',
  'pirate',
  'pirated',
  'torrent',
  'apk',
  'pdf',
  'reddit',
  'forum',
  'youtube',
  // High-frequency blockers in non-English markets.
  'gratis',
  'barato',
  'descuento',
  'trabajo',
  'empleo',
  'tutorial',
  'reseña',
  'comparar',
  'usado',
  'reparar',
  'descargar',
  'gratuit',
  'remise',
  'emploi',
  'travail',
  'occasion',
  'réparer',
  'télécharger',
  'kostenlos',
  'billig',
  'rabatt',
  'arbeit',
  'stelle',
  'gebraucht',
  'reparieren',
  'herunterladen',
  '無料',
  '割れ',
  '仕事',
  '求人',
  '中古',
  '修理',
  '安い',
  '割引',
  'ダウンロード',
  '무료',
  '무료체험',
  '중고',
  '수리',
  '할인',
  '下载',
  '免费',
  '便宜',
  '教程',
  '评测',
  '对比',
  '比较',
  '替代',
  '招聘',
  '工作',
  '职位',
  '二手',
  '维修',
  '配件',
  '批发',
])

const AMBIGUOUS_SINGLE_WORDS = new Set([
  'or',
  'and',
  'to',
  'for',
  'in',
  'on',
  'at',
  'by',
  'uk',
  'us',
  'eu',
])

export function normalizeMatchType(value?: string | null): NegativeKeywordMatchType | null {
  if (!value) return null

  const normalized = value.trim().toUpperCase()
  if (normalized === 'BROAD' || normalized === 'PHRASE' || normalized === 'EXACT') {
    return normalized
  }

  if (normalized === 'BROAD_MATCH_MODIFIER' || normalized === 'BMM') {
    return 'BROAD'
  }

  return null
}

export function normalizeNegativeKeywordMatchTypeMap(
  input: NegativeKeywordMatchTypeInput
): Map<string, NegativeKeywordMatchType> {
  const result = new Map<string, NegativeKeywordMatchType>()
  if (!input || typeof input !== 'object') return result

  for (const [rawKeyword, rawMatchType] of Object.entries(input)) {
    const keyword = String(rawKeyword ?? '').trim().toLowerCase()
    const matchType = normalizeMatchType(typeof rawMatchType === 'string' ? rawMatchType : null)
    if (keyword && matchType) {
      result.set(keyword, matchType)
    }
  }

  return result
}

export function inferNegativeKeywordMatchType(keyword: string): NegativeKeywordMatchType {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return 'EXACT'

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return 'PHRASE'
  }

  if (BROAD_BLOCKERS.has(normalized)) {
    return 'BROAD'
  }

  if (normalized.length <= 2 || AMBIGUOUS_SINGLE_WORDS.has(normalized)) {
    return 'EXACT'
  }

  return 'EXACT'
}

export function resolveNegativeKeywordMatchType(params: {
  keyword: string
  explicitMatchType?: string | null
  explicitMap?: Map<string, NegativeKeywordMatchType>
}): NegativeKeywordMatchType {
  const normalizedKeyword = params.keyword.trim().toLowerCase()

  const explicit = normalizeMatchType(params.explicitMatchType)
  if (explicit) return explicit

  const mapped = normalizedKeyword ? params.explicitMap?.get(normalizedKeyword) : null
  if (mapped) return mapped

  return inferNegativeKeywordMatchType(params.keyword)
}
