/**
 * 否定关键词固定模板（10 类 + 多语言扩展）
 */

export const BASE_NEGATIVE_KEYWORD_TEMPLATES: readonly string[] = [
  // === 1. 低价值搜索（免费、盗版、样品）===
  'free',
  'crack',
  'cracked',
  'torrent',
  'pirate',
  'pirated',
  'trial',
  'sample',
  'demo',

  // === 2. 信息查询（教程、评测、对比）===
  'forum',
  'youtube',
  'how to',
  'tutorial',
  'guide',
  'manual',
  'instructions',
  'setup',
  'install',
  'unboxing',

  // === 3. 招聘/工作 ===
  'job',
  'jobs',
  'career',
  'hiring',
  'salary',
  'employment',
  'recruit',

  // === 4. 二手/维修 ===
  'used',
  'refurbished',
  'repair',
  'fix',
  'broken',
  'replacement parts',
  'spare parts',
  'parts',

  // === 5. 竞品比较意向（不维护具体竞品名，只否定比较模式）===
  'vs',
  'versus',
  'compared to',
  'compare',
  'comparison',
  'alternative',
  'alternative to',
  'instead of',
  'replace',
  'better than',
  'or',

  // === 6. 不相关产品（通用否定词，避免跨品类流量）===
  'clothing',
  'shoes',
  'toy',
  'book',

  // === 7. 低价搜索（价格敏感用户）===
  'cheap',
  'cheapest',
  'discount',
  'clearance',
  'wholesale',
  'bulk',
  'lowest price',

  // === 8. DIY/自制 ===
  'diy',
  'homemade',
  'handmade',
  'build your own',
  'make your own',

  // === 9. 下载/虚拟（避免软件/数字产品流量）===
  'download',
  'software',
  'app',
  'apk',
  'pdf',
  'ebook',
  'digital',

  // === 10. 地域/渠道限制（避免不相关渠道）===
  'ebay',
  'craigslist',
  'alibaba',
  'aliexpress',
  'wish',
]

const LOCALIZED_NEGATIVE_KEYWORDS: Record<string, readonly string[]> = {
  chinese: [
    '免费',
    '破解',
    '试用',
    '样品',
    '教程',
    '评测',
    '对比',
    '如何使用',
    '安装',
    '招聘',
    '工作',
    '职位',
    '二手',
    '翻新',
    '维修',
    '配件',
    '对比',
    '替代',
    '便宜',
    '最低价',
    '批发',
    '手工',
    '自制',
    '下载',
    '软件',
    'APP',
  ],
  spanish: [
    'gratis',
    'piratear',
    'muestra',
    'tutorial',
    'reseña',
    'comparar',
    'trabajo',
    'empleo',
    'usado',
    'reparar',
    'barato',
    'descuento',
    'descargar',
    'aplicación',
  ],
  french: [
    'gratuit',
    'piraté',
    'échantillon',
    'tutoriel',
    'avis',
    'comparer',
    'emploi',
    'travail',
    'occasion',
    'réparer',
    'bon marché',
    'remise',
    'télécharger',
    'application',
  ],
  german: [
    'kostenlos',
    'raubkopie',
    'probe',
    'anleitung',
    'bewertung',
    'vergleichen',
    'arbeit',
    'stelle',
    'gebraucht',
    'reparieren',
    'billig',
    'rabatt',
    'herunterladen',
    'anwendung',
  ],
  japanese: [
    '無料',
    '割れ',
    'サンプル',
    'チュートリアル',
    'レビュー',
    '比較',
    '仕事',
    '求人',
    '中古',
    '修理',
    '安い',
    '割引',
    'ダウンロード',
    'アプリ',
  ],
}

function resolveLocalizedNegativeLanguageKey(
  targetLanguage: string
): keyof typeof LOCALIZED_NEGATIVE_KEYWORDS | null {
  const normalized = targetLanguage.toLowerCase()
  if (normalized.includes('chinese') || normalized === 'zh') return 'chinese'
  if (normalized.includes('spanish') || normalized === 'es') return 'spanish'
  if (normalized.includes('french') || normalized === 'fr') return 'french'
  if (normalized.includes('german') || normalized === 'de') return 'german'
  if (normalized.includes('japanese') || normalized === 'ja') return 'japanese'
  return null
}

export function buildNegativeKeywordTemplateList(targetLanguage: string): string[] {
  const localizedKey = resolveLocalizedNegativeLanguageKey(targetLanguage)
  const localized = localizedKey ? LOCALIZED_NEGATIVE_KEYWORDS[localizedKey] : []
  return [...BASE_NEGATIVE_KEYWORD_TEMPLATES, ...localized]
}

export function dedupeNegativeKeywords(keywords: string[]): string[] {
  const dedupedNegatives: string[] = []
  const seen = new Set<string>()
  for (const rawKeyword of keywords) {
    const keyword = String(rawKeyword ?? '')
      .trim()
      .replace(/\s+/g, ' ')
    if (!keyword) continue
    const key = keyword.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    dedupedNegatives.push(keyword)
  }
  return dedupedNegatives
}
