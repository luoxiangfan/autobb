import type { GeneratedAdCreativeData } from './ad-creative'

export interface CreativeRuleContextInput {
  brandName?: string | null
  category?: string | null
  productName?: string | null
  productTitle?: string | null
  productDescription?: string | null
  uniqueSellingPoints?: string | null
  keywords?: string[]
  targetLanguage?: string | null
  bucket?: string | null
  pageType?: string | null
}

export interface CreativeRuleContext {
  anchorTokens: Set<string>
  keywordTokens: Set<string>
  targetLanguage: string
  bucket: 'A' | 'B' | 'D' | null
  pageType: 'store' | 'product' | null
}

export interface CreativeRelevanceDecision {
  passed: boolean
  reasons: string[]
  anchorCoverage: number
  offTopicHits: string[]
}

export interface CreativeDiversityDecision {
  passed: boolean
  reasons: string[]
  headlineUniqueRatio: number
  descriptionUniqueRatio: number
  nearDuplicateHeadlinePairs: number
}

export interface CreativeConversionDecision {
  passed: boolean
  reasons: string[]
  hasCta: boolean
  hasTrust: boolean
  hasValue: boolean
}

export interface CreativeRuleGateDecision {
  passed: boolean
  reasons: string[]
  relevance: CreativeRelevanceDecision
  diversity: CreativeDiversityDecision
  conversion: CreativeConversionDecision
}

const TOKEN_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'from',
  'with', 'without', 'your', 'our', 'you', 'us', 'is', 'are', 'be', 'this', 'that',
  'it', 'its', 'as', 'now', 'new', 'best', 'top', 'today', 'shop', 'buy'
])

// 可穷举的噪声词清单：用于识别“工具/维修类”偏题表达。
export const CREATIVE_RELEVANCE_NOISE_TERMS: string[] = [
  'repair',
  'repairs',
  'fix',
  'fixes',
  'fixing',
  'tackle repairs',
  'troubleshoot',
  'maintenance',
  'tool',
  'tools',
  'power tool',
  'drill',
  'hammer',
  'wrench',
  'screwdriver',
  'workshop',
  'hardware',
  'contractor',
  'plumbing',
  'electrical'
]

const CREATIVE_RELEVANCE_NOISE_PATTERNS: RegExp[] = [
  /\breliable\s+fix\b/i,
  /\btackle\s+repairs?\b/i,
  /\brepair\s+projects?\b/i,
  /\bfor\s+real\s+projects?\b/i,
]

const CTA_PATTERN =
  /\b(shop now|buy now|order now|learn more|get offer|get yours|discover|start now|try now|立即购买|了解更多|马上下单|acheter|comprar|kaufen|acquista|今すぐ購入|지금 구매)\b/i

const TRUST_PATTERN =
  /\b(official|trusted|certified|authentic|warranty|guarantee|secure|verified|support|proven|refund|returns?)\b|官方|正品|保修|信赖/i

const VALUE_PATTERN =
  /\b(save|off|deal|discount|value|premium|free shipping|bundle|comfort|breathable|durable|lightweight|supportive|efficient|efficiency|performance|cooling|filtration|tankless|energy\s*saving|schnell|effizient|leistung|filtration|tanklos|risparmio|efficiente|prestazioni|filtrazione|silenzios[oa]|rapido|depuratore)\b|优惠|折扣|超值/i

const PAIN_PATTERN =
  /\b(struggle|struggling|frustrat|annoyed|hard to|tired of|bounce|chafing|slip|discomfort|irritat|worry)\b|困扰|烦恼|不适/i

const STRONG_NEGATIVE_PATTERN =
  /\b(panic|terrified|desperate|humiliat|ashamed|embarrass|disaster|suffer(?:ing)?)\b/i

const WEAK_SALES_RANK_THRESHOLD = 1000
const SALES_RANK_CONTEXT_PATTERN = /\b(best\s*seller|rank(?:ed|ing)?|category)\b/i
const RISKY_SOCIAL_PROOF_PERCENT_PATTERN =
  /\b\d{1,3}%\s+of\s+(?:women|men|users|people|customers)\s+(?:love|prefer|recommend|say|agree)\b/i
const LOW_TRUST_SLANG_PATTERN = /\b(cuz|awesome|ain't|gonna|kinda|sorta)\b/i

function normalizeWord(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/^[^a-z0-9\u4e00-\u9fff]+|[^a-z0-9\u4e00-\u9fff]+$/gi, '')
    .trim()
}

function normalizePhrase(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string): string[] {
  return normalizePhrase(value)
    .split(/\s+/)
    .map(normalizeWord)
    .filter(token => token.length >= 2 && !TOKEN_STOPWORDS.has(token))
}

function toNormalizedUnique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const normalized = normalizePhrase(raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function isEnglishLike(language: string): boolean {
  const normalized = String(language || '').toLowerCase()
  return normalized.includes('en') || normalized.includes('english')
}

function isRuleGateBooleanEnvEnabled(name: string, fallback: boolean): boolean {
  const normalized = String(process.env[name] || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function buildAnchorTokens(input: CreativeRuleContextInput): Set<string> {
  const text = [
    input.brandName,
    input.category,
    input.productName,
    input.productTitle,
    input.productDescription,
    input.uniqueSellingPoints,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ')

  return new Set(tokenize(text))
}

function buildKeywordTokens(input: CreativeRuleContextInput): Set<string> {
  return new Set(
    (input.keywords || [])
      .flatMap(keyword => tokenize(keyword))
  )
}

function toAssetTexts(creative: GeneratedAdCreativeData): string[] {
  const texts: string[] = []
  for (const headline of creative.headlines || []) texts.push(headline)
  for (const description of creative.descriptions || []) texts.push(description)
  for (const callout of creative.callouts || []) texts.push(callout)
  for (const sitelink of creative.sitelinks || []) {
    texts.push(sitelink.text || '')
    if (sitelink.description) texts.push(sitelink.description)
  }
  return texts
    .map(text => String(text || '').trim())
    .filter(Boolean)
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const token of a) {
    if (b.has(token)) intersect += 1
  }
  const union = a.size + b.size - intersect
  return union > 0 ? intersect / union : 0
}

function hasTokenOverlap(tokens: string[], anchorTokens: Set<string>): boolean {
  return tokens.some(token => anchorTokens.has(token))
}

function findOffTopicNoiseTerms(
  texts: string[],
  anchorTokens: Set<string>,
  keywordTokens: Set<string>
): string[] {
  const contextTokens = new Set<string>([...anchorTokens, ...keywordTokens])
  const hits = new Set<string>()
  const hasContextToken = (token: string): boolean => {
    if (!token) return false
    if (contextTokens.has(token)) return true

    // Handle simple singular/plural forms so "tool" and "tools" are treated as related.
    if (token.endsWith('s') && token.length > 3 && contextTokens.has(token.slice(0, -1))) return true
    if (!token.endsWith('s') && contextTokens.has(`${token}s`)) return true

    return false
  }

  for (const text of texts) {
    const normalized = normalizePhrase(text)
    if (!normalized) continue

    for (const term of CREATIVE_RELEVANCE_NOISE_TERMS) {
      const normalizedTerm = normalizePhrase(term)
      if (!normalizedTerm) continue
      if (!normalized.includes(normalizedTerm)) continue

      const termTokens = tokenize(normalizedTerm)
      const inContext = termTokens.some(token => hasContextToken(token))
      if (!inContext) {
        hits.add(term)
      }
    }

    for (const pattern of CREATIVE_RELEVANCE_NOISE_PATTERNS) {
      const match = normalized.match(pattern)
      if (!match?.[0]) continue
      const termTokens = tokenize(match[0])
      const inContext = termTokens.some(token => hasContextToken(token))
      if (!inContext) {
        hits.add(match[0].toLowerCase())
      }
    }
  }

  return Array.from(hits)
}

function findWeakSalesRankClaims(texts: string[]): string[] {
  const hits = new Set<string>()

  for (const text of texts) {
    const raw = String(text || '').trim()
    if (!raw) continue

    const hasRankingContext = SALES_RANK_CONTEXT_PATTERN.test(raw) || raw.includes('#')
    if (!hasRankingContext) continue

    const rankMatches = raw.matchAll(/#\s*([\d,]+)/g)
    for (const match of rankMatches) {
      const rankText = match[1]
      if (!rankText) continue
      const rankNumber = Number.parseInt(rankText.replace(/,/g, ''), 10)
      if (!Number.isFinite(rankNumber) || rankNumber <= WEAK_SALES_RANK_THRESHOLD) continue
      hits.add(`#${rankNumber.toLocaleString('en-US')}`)
    }
  }

  return Array.from(hits)
}

function findNegativeTrustSignals(texts: string[]): string[] {
  const hits = new Set<string>()

  for (const text of texts) {
    const raw = String(text || '').trim()
    if (!raw) continue

    const riskyPercentMatch = raw.match(RISKY_SOCIAL_PROOF_PERCENT_PATTERN)
    if (riskyPercentMatch?.[0]) {
      hits.add(riskyPercentMatch[0].toLowerCase())
    }

    const slangMatch = raw.match(LOW_TRUST_SLANG_PATTERN)
    if (slangMatch?.[0]) {
      hits.add(slangMatch[0].toLowerCase())
    }
  }

  return Array.from(hits)
}

function evaluateRelevance(
  creative: GeneratedAdCreativeData,
  context: CreativeRuleContext
): CreativeRelevanceDecision {
  const texts = toAssetTexts(creative)
  const reasons: string[] = []
  if (texts.length === 0) {
    return {
      passed: false,
      reasons: ['creative has no text assets'],
      anchorCoverage: 0,
      offTopicHits: []
    }
  }

  const combinedAnchors = new Set<string>([...context.anchorTokens, ...context.keywordTokens])
  const coveredCount = texts.reduce((count, text) => {
    const tokens = tokenize(text)
    return count + (hasTokenOverlap(tokens, combinedAnchors) ? 1 : 0)
  }, 0)
  const anchorCoverage = coveredCount / texts.length
  const minCoverage = texts.length >= 8 ? 0.4 : 0.34

  if (anchorCoverage < minCoverage) {
    reasons.push(`anchor coverage ${(anchorCoverage * 100).toFixed(1)}% < ${(minCoverage * 100).toFixed(0)}%`)
  }

  const skipOffTopicNoiseForStoreBrandBucket = context.pageType === 'store' && context.bucket === 'A'
  const offTopicNoiseHits = skipOffTopicNoiseForStoreBrandBucket
    ? []
    : findOffTopicNoiseTerms(texts, context.anchorTokens, context.keywordTokens)
  if (offTopicNoiseHits.length > 0) {
    reasons.push(`off-topic noise terms: ${offTopicNoiseHits.slice(0, 6).join(', ')}`)
  }

  const weakSalesRankHits = findWeakSalesRankClaims(texts)
  if (weakSalesRankHits.length > 0) {
    reasons.push(`weak sales-rank claims: ${weakSalesRankHits.slice(0, 4).join(', ')}`)
  }

  const negativeTrustHits = findNegativeTrustSignals(texts)
  if (negativeTrustHits.length > 0) {
    reasons.push(`negative trust signals: ${negativeTrustHits.slice(0, 4).join(', ')}`)
  }

  const offTopicHits = [...offTopicNoiseHits, ...weakSalesRankHits, ...negativeTrustHits]

  return {
    passed: reasons.length === 0,
    reasons,
    anchorCoverage,
    offTopicHits
  }
}

function evaluateDiversity(creative: GeneratedAdCreativeData): CreativeDiversityDecision {
  const reasons: string[] = []
  const headlines = creative.headlines || []
  const descriptions = creative.descriptions || []

  const normalizedHeadlines = headlines.map(normalizePhrase).filter(Boolean)
  const normalizedDescriptions = descriptions.map(normalizePhrase).filter(Boolean)

  const uniqueHeadlines = toNormalizedUnique(normalizedHeadlines)
  const uniqueDescriptions = toNormalizedUnique(normalizedDescriptions)

  const headlineUniqueRatio = normalizedHeadlines.length > 0
    ? uniqueHeadlines.length / normalizedHeadlines.length
    : 0
  const descriptionUniqueRatio = normalizedDescriptions.length > 0
    ? uniqueDescriptions.length / normalizedDescriptions.length
    : 0

  if (normalizedHeadlines.length >= 8 && headlineUniqueRatio < 0.7) {
    reasons.push(`headline uniqueness ${(headlineUniqueRatio * 100).toFixed(1)}% < 70%`)
  }
  if (normalizedDescriptions.length >= 3 && descriptionUniqueRatio < 0.75) {
    reasons.push(`description uniqueness ${(descriptionUniqueRatio * 100).toFixed(1)}% < 75%`)
  }

  let nearDuplicateHeadlinePairs = 0
  for (let i = 0; i < normalizedHeadlines.length; i += 1) {
    for (let j = i + 1; j < normalizedHeadlines.length; j += 1) {
      const aTokens = new Set(tokenize(normalizedHeadlines[i]))
      const bTokens = new Set(tokenize(normalizedHeadlines[j]))
      const similarity = jaccardSimilarity(aTokens, bTokens)
      if (similarity >= 0.86) nearDuplicateHeadlinePairs += 1
    }
  }
  if (nearDuplicateHeadlinePairs > Math.max(2, Math.floor(normalizedHeadlines.length / 2))) {
    reasons.push(`too many near-duplicate headlines (${nearDuplicateHeadlinePairs} pairs)`)
  }

  return {
    passed: reasons.length === 0,
    reasons,
    headlineUniqueRatio,
    descriptionUniqueRatio,
    nearDuplicateHeadlinePairs
  }
}

function evaluateConversion(
  creative: GeneratedAdCreativeData,
  context: CreativeRuleContext
): CreativeConversionDecision {
  const reasons: string[] = []
  const texts = [
    ...(creative.descriptions || []),
    ...(creative.callouts || []),
    ...((creative.sitelinks || []).map(s => `${s.text || ''} ${s.description || ''}`))
  ]
    .map(text => String(text || '').trim())
    .filter(Boolean)

  const mergedText = texts.join(' ')
  const hasCta = CTA_PATTERN.test(mergedText)
  const hasTrust = TRUST_PATTERN.test(mergedText)
  const hasValue = VALUE_PATTERN.test(mergedText)

  if (!hasCta) reasons.push('missing CTA language in descriptions/callouts/sitelinks')

  // 多语言场景下只强制 CTA；英语场景保留 value 硬约束，并按桶控制 trust 约束。
  const englishLike = isEnglishLike(context.targetLanguage)
  const isStoreBrandBucket = context.pageType === 'store' && context.bucket === 'A'
  const requireTrust = englishLike && context.bucket !== 'B' && context.bucket !== 'D'
  const requireValue = englishLike && !isStoreBrandBucket
  if (requireTrust && !hasTrust) reasons.push('missing trust/proof signal')
  if (requireValue && !hasValue) reasons.push('missing value/benefit signal')

  // 分桶情绪规则（KISS）：
  // A/D：避免强负面情绪；B：允许轻痛点，但限制强负面并要求至少1条痛点表达。
  const allAssetText = [
    ...(creative.headlines || []),
    ...(creative.descriptions || []),
    ...(creative.callouts || []),
    ...((creative.sitelinks || []).map(s => `${s.text || ''} ${s.description || ''}`))
  ].join(' ')
  const strongNegativeMatches = allAssetText.match(new RegExp(STRONG_NEGATIVE_PATTERN.source, 'gi')) || []

  if ((context.bucket === 'A' || context.bucket === 'D') && strongNegativeMatches.length > 0) {
    reasons.push(`bucket ${context.bucket} should avoid strong negative emotion language`)
  }
  if (context.bucket === 'B') {
    if (strongNegativeMatches.length > 2) {
      reasons.push('bucket B uses too much strong negative emotion language')
    }

    const requirePainCueForBucketB = isRuleGateBooleanEnvEnabled(
      'AD_CREATIVE_RULE_GATE_REQUIRE_BUCKET_B_PAIN_CUE',
      false
    )
    if (requirePainCueForBucketB && isEnglishLike(context.targetLanguage)) {
      const descriptionText = (creative.descriptions || []).join(' ')
      const hasPainCue = PAIN_PATTERN.test(descriptionText)
      if (!hasPainCue) {
        reasons.push('bucket B should include at least one mild pain-point cue in descriptions')
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    hasCta,
    hasTrust,
    hasValue
  }
}

export function createCreativeRuleContext(input: CreativeRuleContextInput): CreativeRuleContext {
  const anchorTokens = buildAnchorTokens(input)
  const keywordTokens = buildKeywordTokens(input)
  const normalizedBucket = (() => {
    const upper = String(input.bucket || '').toUpperCase()
    if (upper === 'A') return 'A'
    if (upper === 'B' || upper === 'C') return 'B'
    if (upper === 'D' || upper === 'S') return 'D'
    return null
  })()
  const normalizedPageType = (() => {
    const normalized = String(input.pageType || '').trim().toLowerCase()
    if (normalized === 'store') return 'store'
    if (normalized === 'product') return 'product'
    return null
  })()
  return {
    anchorTokens,
    keywordTokens,
    targetLanguage: String(input.targetLanguage || 'en'),
    bucket: normalizedBucket,
    pageType: normalizedPageType
  }
}

export function evaluateCreativeRuleGate(
  creative: GeneratedAdCreativeData,
  contextInput: CreativeRuleContextInput | CreativeRuleContext
): CreativeRuleGateDecision {
  const context = (contextInput as CreativeRuleContext).anchorTokens instanceof Set
    ? contextInput as CreativeRuleContext
    : createCreativeRuleContext(contextInput as CreativeRuleContextInput)

  const relevance = evaluateRelevance(creative, context)
  const diversity = evaluateDiversity(creative)
  const conversion = evaluateConversion(creative, context)
  const reasons = [
    ...relevance.reasons,
    ...diversity.reasons,
    ...conversion.reasons,
  ]

  return {
    passed: reasons.length === 0,
    reasons,
    relevance,
    diversity,
    conversion
  }
}

export function filterPromptExtrasByRelevance(
  extras: string[],
  contextInput: CreativeRuleContextInput | CreativeRuleContext
): { filtered: string[]; removed: string[] } {
  const context = (contextInput as CreativeRuleContext).anchorTokens instanceof Set
    ? contextInput as CreativeRuleContext
    : createCreativeRuleContext(contextInput as CreativeRuleContextInput)
  const filtered: string[] = []
  const removed: string[] = []

  for (const extra of extras) {
    const text = String(extra || '').trim()
    if (!text) continue
    const hits = findOffTopicNoiseTerms([text], context.anchorTokens, context.keywordTokens)
    if (hits.length > 0) {
      removed.push(`${text} [hits=${hits.join(', ')}]`)
      continue
    }
    const weakSalesRankHits = findWeakSalesRankClaims([text])
    if (weakSalesRankHits.length > 0) {
      removed.push(`${text} [weak_rank=${weakSalesRankHits.join(', ')}]`)
      continue
    }
    const negativeTrustHits = findNegativeTrustSignals([text])
    if (negativeTrustHits.length > 0) {
      removed.push(`${text} [trust_risk=${negativeTrustHits.join(', ')}]`)
      continue
    }
    filtered.push(text)
  }

  return { filtered, removed }
}
