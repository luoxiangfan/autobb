/**
 * Offer category utilities
 * src/lib/offer-category.ts
 */

export function compactCategoryLabel(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) return ''

  const withoutPrefix = raw.replace(/^\s*(category|产品分类)\s*[:：]\s*/i, '').trim()

  const parts = withoutPrefix
    .split(/(?:\s*[›»>\/|]\s*|\s*→\s*|\r?\n)+/g)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((p) => !isNoiseCategorySegment(p))

  const candidate = (parts.length > 0 ? parts[parts.length - 1] : withoutPrefix)
    .replace(/\s+/g, ' ')
    .trim()

  if (!candidate) return ''

  // Guardrail: category should be short; if AI returns a sentence, keep the first clause.
  const firstClause = candidate.split(/[.。!！?？;；]\s*/)[0].trim()
  const finalValue = firstClause || candidate

  return finalValue.length > 80 ? finalValue.slice(0, 80).trim() : finalValue
}

function isNoiseCategorySegment(segment: string): boolean {
  const s = segment.trim().toLowerCase()
  if (!s) return true

  // Common breadcrumb noise / generic buckets that reduce accuracy.
  const noise = new Set([
    'home',
    'homepage',
    'inicio',
    'accueil',
    'start',
    'index',
    '首页',
    '主页',
    'home page',
    'all',
    'all departments',
    'departments',
    'shop',
    'store',
    'stores',
    'products',
    'product',
    'category',
    'categories',
  ])
  if (noise.has(s)) return true

  // Numbers-only / separator-only.
  if (!/\p{L}/u.test(segment)) return true

  return false
}

function normalizeTextForCategory(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function isGenericStoreCategoryLabel(label: string): boolean {
  const s = normalizeTextForCategory(label).trim()
  if (!s) return true
  if (isNoiseCategorySegment(s)) return true

  const generic = [
    'productos',
    'productos domesticos',
    'productos del hogar',
    'hogar',
    'inicio',
  ]
  if (generic.includes(s)) return true

  if (s.startsWith('productos') && (s.includes('domestic') || s.includes('hogar'))) return true

  return false
}

function deriveCategoryFromTextSignals(parsed: any): string | null {
  if (!parsed || typeof parsed !== 'object') return null

  const textParts: string[] = []
  const push = (v: unknown) => {
    if (typeof v !== 'string') return
    const t = v.trim()
    if (t) textParts.push(t)
  }

  push(parsed.metaTitle)
  push(parsed.metaDescription)
  push(parsed.pageTitle)
  push(parsed.storeDescription)
  push(parsed.productDescription)
  push(parsed.productName)
  push(parsed.productCategory)

  if (Array.isArray(parsed.products)) {
    for (const p of parsed.products) push(p?.name)
  }

  const deepTop = parsed?.deepScrapeResults?.topProducts
  if (Array.isArray(deepTop)) {
    for (const item of deepTop) {
      const pd = item?.productData
      push(pd?.productName)
      push(pd?.productDescription)
      if (Array.isArray(pd?.features)) {
        for (const f of pd.features) push(f)
      }
    }
  }

  const text = normalizeTextForCategory(textParts.join('\n'))
  if (!text) return null

  if (/(\\bantivirus\\b|malware|ransomware|phishing|spyware|rootkit|ciberseguridad|cybersecurity)/.test(text)) {
    return 'Antivirus'
  }
  if (/(\\bvpn\\b|virtual private network)/.test(text)) {
    return 'VPN'
  }
  if (/(ai\\s*companion|virtual\\s*friend|ai\\s*friend|conversation\\s*ai|mental\\s*wellness|emotional\\s*support)/.test(text)) {
    return 'AI Companion'
  }
  if (/(\\bchatbot\\b|ai\\s*chatbot)/.test(text)) {
    return 'Chatbot'
  }

  return null
}

export function deriveCategoryFromScrapedData(scrapedDataJson: string | null | undefined): string | null {
  if (!scrapedDataJson) return null

  const parsed = safeJsonParse(scrapedDataJson)
  if (!parsed || typeof parsed !== 'object') return null

  // Store pages: prefer aggregated primary categories if available.
  const primaryCategories = (parsed as any)?.productCategories?.primaryCategories
  if (Array.isArray(primaryCategories) && primaryCategories.length > 0) {
    const sorted = [...primaryCategories]
      .filter((c) => c && typeof c.name === 'string' && c.name.trim())
      .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))

    for (const item of sorted) {
      const name = item?.name
      if (typeof name !== 'string' || !name.trim()) continue
      const compact = compactCategoryLabel(name)
      if (!compact) continue
      if (isGenericStoreCategoryLabel(compact)) continue
      return compact
    }
  }

  // Store pages fallback: derive from deep-scraped product categories when store-level categories are missing.
  const deepProducts = (parsed as any)?.deepScrapeResults?.topProducts
  if (Array.isArray(deepProducts) && deepProducts.length > 0) {
    const counts = new Map<string, number>()
    for (const item of deepProducts) {
      const raw = item?.productData?.category
      if (typeof raw !== 'string') continue
      const compact = compactCategoryLabel(raw)
      if (!compact) continue
      if (isGenericStoreCategoryLabel(compact)) continue
      counts.set(compact, (counts.get(compact) || 0) + 1)
    }
    if (counts.size > 0) {
      const [top] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
      if (top?.[0]) return top[0]
    }
  }

  // Product pages: prefer breadcrumb category.
  const breadcrumb = (parsed as any)?.productCategory
  if (typeof breadcrumb === 'string') {
    const compact = compactCategoryLabel(breadcrumb)
    if (compact) return compact
  }

  // Fallbacks (varies by scraper/source).
  const category = (parsed as any)?.category
  if (typeof category === 'string') {
    const compact = compactCategoryLabel(category)
    if (compact) return compact
  }

  const inferred = deriveCategoryFromTextSignals(parsed)
  if (inferred) return inferred

  return null
}

export function safeJsonParse(input: string): any | null {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}
