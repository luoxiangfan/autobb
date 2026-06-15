import type { CreativeKeywordUsagePlan } from '../ad-creative'

// 🔥 AI语义分类
// 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
import { loadPrompt } from '../prompt-loader' // 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer' // 🔥 优化：Google Ads关键词标准化去重

import {
  containsPureBrand,
  getPureBrandKeywords,
  isBrandConcatenation,
} from '../keyword-quality-filter' // 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数
import { normalizeLanguageCode } from '../language-country-codes'
import { parsePrice } from '../pricing-utils'
import { getGoogleAdsTextEffectiveLength } from '@/lib/google-ads/common/ad-text'
import { getLocalizedDkiOfficialSuffix, type DkiLocaleOptions } from '../dki-localization'
import { classifyKeywordIntent } from '../keyword-intent'
import { resolveNonBrandMinSearchVolumeByBrandKeywordCount } from '../keyword-policy'
import {
  buildGoogleAdsPolicyPromptGuardrails,
  extractGoogleAdsPolicySensitiveTerms,
  resolveGoogleAdsPolicyGuardMode,
  sanitizeGoogleAdsPolicyText,
} from '@/lib/google-ads/policy/policy-guard'
import { createCreativeRuleContext, filterPromptExtrasByRelevance } from '../ad-creative-rule-gate'

import { normalizeCreativeBucketSlot } from '../creative-type'
import { normalizeCreativeBucketType } from './bucket'
import {
  RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX,
  RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX,
  buildCreativeKeywordUsagePlan,
} from './contract'
import {
  REVIEW_QUOTE_BLOCKLIST_PATTERN,
  SALES_RANK_PROMPT_MAX,
  resolveCreativePriceEvidence,
  resolveCreativeSalesRankSignal,
  sanitizeReviewSnippetForPrompt,
} from './evidence'
import { isSearchVolumeUnavailableReason } from './keyword-audit'
import { getCopyPatterns, getLanguageInstruction, resolveCreativeTargetLanguage } from './language'
import {
  countBrandContainingKeywords,
  extractTitleAndAboutSignals,
  resolveAdCreativePromptKeywordPlan,
} from './prompt-keywords'
import type {
  NormalizedCreativeBucket,
  PromptRuntimeGuidanceOptions,
  RetryFailureType,
  SearchTermFeedbackHintsInput,
} from './types'
import {
  dedupePhrases,
  deriveLinkTypeFromScrapedData,
  safeParseJson,
  substitutePlaceholders,
  truncateSnippetByWords,
} from './utils'

export function buildRetainedKeywordSlotSection(plan: CreativeKeywordUsagePlan): string {
  if (plan.retainedNonBrandKeywords.length === 0) {
    return '- No retained non-brand keywords were safe for forced slot coverage. Do not force awkward, low-quality, or semantically empty keywords into headlines or descriptions.'
  }

  const headlineLines = plan.headlineKeywordTargets.map(
    (keyword, index) =>
      `- Headline #${RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + index + 1}: must contain "${keyword}"`
  )
  const descriptionLines = plan.descriptionKeywordTargets.map(
    (keyword, index) =>
      `- Description #${RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX + index + 1}: must contain "${keyword}"`
  )

  return [
    `- Final retained non-brand keywords: ${plan.retainedNonBrandKeywords.join(', ')}`,
    '- Headline #1 is fixed DKI. Headline #2-#4 are title/about protected and must not be repurposed for retained keyword coverage.',
    `- Headline coverage mode: ${plan.headlineCoverageMode}`,
    ...headlineLines,
    `- Description coverage mode: ${plan.descriptionCoverageMode}`,
    ...descriptionLines,
    '- Do not invent replacement keywords outside the final retained set.',
    '- Retained-keyword headlines must stay meaningfully different from Headline #1-#4; do not paraphrase or lightly remix those protected headlines.',
    '- If a listed retained keyword cannot be used naturally without harming copy quality, keep the wording natural instead of forcing a broken phrase.',
  ].join('\n')
}

export function normalizeLocalizationPayload(
  localization: any
): { currency?: string; culturalNotes?: string[]; localKeywords?: string[] } | undefined {
  if (!localization || typeof localization !== 'object') return undefined

  if (
    'currency' in localization ||
    'culturalNotes' in localization ||
    'localKeywords' in localization
  ) {
    return {
      currency: typeof localization.currency === 'string' ? localization.currency : undefined,
      culturalNotes: Array.isArray(localization.culturalNotes)
        ? localization.culturalNotes
            .map((v: any) => String(v || '').trim())
            .filter((v: string) => v.length > 0)
            .slice(0, 8)
        : undefined,
      localKeywords: Array.isArray(localization.localKeywords)
        ? localization.localKeywords
            .map((v: any) => String(v || '').trim())
            .filter((v: string) => v.length > 0)
            .slice(0, 12)
        : undefined,
    }
  }

  const pricingCurrency =
    typeof localization.pricing?.currency === 'string' ? localization.pricing.currency : undefined
  const contentNotes: string[] = Array.isArray(localization.content?.culturalNotes)
    ? localization.content.culturalNotes
        .map((v: any) => String(v || '').trim())
        .filter((v: string) => v.length > 0)
    : []
  const keywordNotes: string[] = Array.isArray(localization.keywords)
    ? localization.keywords
        .map((k: any) => (typeof k?.culturalNotes === 'string' ? k.culturalNotes : ''))
        .filter((v: string) => v.length > 0)
    : []
  const localKeywordCandidates: string[] = Array.isArray(localization.keywords)
    ? localization.keywords
        .map((k: any) => (typeof k?.localized === 'string' ? k.localized : ''))
        .filter((v: string) => v.length > 0)
    : []

  const mergedNotes: string[] = [...new Set([...contentNotes, ...keywordNotes])].slice(0, 8)
  const mergedLocalKeywords: string[] = [...new Set(localKeywordCandidates)].slice(0, 12)

  if (!pricingCurrency && mergedNotes.length === 0 && mergedLocalKeywords.length === 0) {
    return undefined
  }

  return {
    currency: pricingCurrency,
    culturalNotes: mergedNotes.length > 0 ? mergedNotes : undefined,
    localKeywords: mergedLocalKeywords.length > 0 ? mergedLocalKeywords : undefined,
  }
}

export function detectKeywordIntentsForPrompt(
  keywords: string[],
  languageCode: string
): {
  transactional: string[]
  scenario: string[]
  solution: string[]
  other: string[]
} {
  const result = {
    transactional: [] as string[],
    scenario: [] as string[],
    solution: [] as string[],
    other: [] as string[],
  }
  const patterns = getCopyPatterns(languageCode)

  const seen = new Set<string>()
  for (const kwRaw of keywords) {
    const kw = String(kwRaw || '').trim()
    if (!kw) continue
    const normalized = kw.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)

    const classified = classifyKeywordIntent(kw, { language: languageCode })
    if (classified.intent === 'TRANSACTIONAL') {
      result.transactional.push(kw)
      continue
    }
    if (patterns.scenario.test(kw) || classified.intent === 'COMMERCIAL') {
      result.scenario.push(kw)
      continue
    }
    if (patterns.solution.test(kw)) {
      result.solution.push(kw)
      continue
    }
    result.other.push(kw)
  }

  return {
    transactional: result.transactional.slice(0, 6),
    scenario: result.scenario.slice(0, 6),
    solution: result.solution.slice(0, 6),
    other: result.other.slice(0, 6),
  }
}

export const PROMPT_MODEL_ANCHOR_PATTERNS = [
  /\b[a-z]{1,5}[- ]?\d{2,4}[a-z0-9-]*\b/i,
  /\b(?:gen|generation|series|model|version|mk)\s*[a-z0-9-]+\b/i,
  /\b(?:omni|pro|ultra|max|plus|mini)\b/i,
]

export function extractModelAnchorsForPrompt(keywords: string[]): string[] {
  const anchors: string[] = []
  const seen = new Set<string>()

  for (const keyword of keywords) {
    const normalized = String(keyword || '').trim()
    if (!normalized) continue

    const matched = PROMPT_MODEL_ANCHOR_PATTERNS.some((pattern) => pattern.test(normalized))
    if (!matched) continue

    const compact = normalized.toLowerCase()
    if (seen.has(compact)) continue
    seen.add(compact)
    anchors.push(normalized)

    if (anchors.length >= 6) break
  }

  return anchors
}

export function buildCreativeTypeConstraintSection(params: {
  bucket: NormalizedCreativeBucket
  linkType: 'store' | 'product'
  brand: string
  category: string
  productName: string
  targetCountry: string
  targetLanguage: string
  topProducts: string[]
  keywords: string[]
}): string {
  const creativeType =
    params.bucket === 'A'
      ? 'brand_intent'
      : params.bucket === 'B'
        ? 'model_intent'
        : params.bucket === 'D'
          ? 'product_intent'
          : 'unclassified'

  const modelAnchors = extractModelAnchorsForPrompt(params.keywords)
  const lines: string[] = [
    '## 🧭 CREATIVE TYPE CONTRACT (HARD RULES)',
    `- creativeType: ${creativeType}`,
    `- pageType: ${params.linkType}`,
    `- market: ${params.targetCountry || 'unknown'}`,
    `- language: ${params.targetLanguage || 'English'}`,
    `- brand anchor: ${params.brand || 'unknown brand'}`,
  ]

  if (params.category) {
    lines.push(`- category anchor: ${params.category}`)
  }

  if (params.productName) {
    lines.push(`- primary product anchor: ${params.productName}`)
  }

  if (params.linkType === 'store') {
    if (params.topProducts.length > 0) {
      lines.push(`- verified hot products: ${params.topProducts.join(' | ')}`)
    } else {
      lines.push(
        '- verified hot products: none provided; do NOT invent hero SKUs, model names, or product lines.'
      )
    }
  }

  if (modelAnchors.length > 0) {
    lines.push(`- verified model/series anchors: ${modelAnchors.join(' | ')}`)
  }

  lines.push(
    '- Use only verified products, verified hot products, verified facts, and provided keywords. Do NOT invent new models, new series, or unsupported product relationships.'
  )

  if (params.bucket === 'A') {
    lines.push(
      '- brand_intent rule: every headline, description, and keyword must stay tied to BOTH the brand and a real product/category anchor.'
    )
    lines.push(
      '- brand_intent rule: trust language is supportive only; forbid pure brand-navigation copy such as "official store" without product context.'
    )
    lines.push(
      '- brand_intent keyword priority: brand + product > brand + category > brand + model > model + category.'
    )
  } else if (params.bucket === 'B') {
    lines.push(
      '- model_intent rule: every headline, description, and keyword must stay tightly tied to a verified model/series or verified hot product model.'
    )
    lines.push(
      '- model_intent rule: use exact-match purchase intent framing; forbid generic brand-only, category-only, or scenario-only copy.'
    )
    lines.push(
      '- model_intent keyword hard-ban: DO NOT generate template keyword strings that combine transactional modifiers with model anchors (e.g., "buy brandx x200", "brandx x200 price", "order gen 2 ring").'
    )
    lines.push(
      params.linkType === 'store'
        ? '- model_intent store rule: cover multiple verified hot products when available; do not collapse into a single generic store headline.'
        : '- model_intent product rule: stay on the current product model only; do not drift into other SKUs or store-level assortment copy.'
    )
  } else if (params.bucket === 'D') {
    lines.push('- product_intent rule: keep the first anchor on product demand, not brand trust.')
    lines.push(
      '- product_intent rule: headlines/descriptions should prioritize category, function, scenario, product line, or use-case coverage grounded in the brand.'
    )
    lines.push(
      '- product_intent rule: forbid generic brand slogans that do not point back to a concrete product demand or product family.'
    )
  }

  return `\n${lines.join('\n')}\n`
}

export function buildTypeIntentGuidanceSection(
  bucket: NormalizedCreativeBucket,
  keywords: string[],
  languageCode: string
): string {
  const intents = detectKeywordIntentsForPrompt(keywords, languageCode)
  const transactionalLine =
    intents.transactional.length > 0 ? intents.transactional.join(', ') : 'N/A'
  const scenarioLine = intents.scenario.length > 0 ? intents.scenario.join(', ') : 'N/A'
  const solutionLine = intents.solution.length > 0 ? intents.solution.join(', ') : 'N/A'

  const baseRules = `
## 🎯 TYPE-SPECIFIC INTENT USAGE (NON-DESTRUCTIVE)
- Use ONLY provided keywords. Do NOT invent or replace keyword list items.
- Keep existing A/B/D type semantics. This section guides copy usage only.
- If one intent group has no keyword candidates, reuse existing keywords naturally without forcing.`

  if (bucket === 'A') {
    return `${baseRules}
- Bucket A focus: brand + product anchor first, trust second.
- Every asset must clearly point back to a real product/category anchor from the brand.
- Prefer trust-oriented expressions in 1-2 descriptions only as support; keep product relevance explicit.
- Never write pure brand/store navigation copy without product context.
- Transactional keyword candidates: ${transactionalLine}
- Scenario keyword candidates (supportive only): ${scenarioLine}`
  }

  if (bucket === 'B') {
    return `${baseRules}
- Bucket B focus: verified model/series purchase intent.
- Keep copy precise and model-led; treat scenario/solution wording as secondary support only.
- At least 2 descriptions should reinforce model/series fit, specifications, or buying action.
- Do NOT output transactional+model template keywords (avoid forms like "buy X200", "X200 price", "order Gen 2").
- Scenario keyword candidates (support only): ${scenarioLine}
- Solution keyword candidates (support only): ${solutionLine}
- Transactional keyword candidates (primary): ${transactionalLine}
- Do not let scenario wording dominate over the model/series anchor.`
  }

  if (bucket === 'D') {
    return `${baseRules}
- Bucket D focus: product demand coverage grounded in brand + category/feature/scenario.
- Ensure at least 1 description emphasizes a concrete demand-solving angle with compliant evidence.
- Prioritize feature, scenario, and product-line language over generic brand slogans.
- Transactional keyword candidates (supportive): ${transactionalLine}
- Scenario keyword candidates (primary): ${scenarioLine}
- Solution keyword candidates (primary/supportive): ${solutionLine}`
  }

  return `${baseRules}
- Bucket not specified. Keep balanced copy intent usage with current keywords.
- Transactional keyword candidates: ${transactionalLine}
- Scenario keyword candidates: ${scenarioLine}
- Solution keyword candidates: ${solutionLine}`
}

export function normalizePersonaOrScenarioPhrase(
  value: string,
  maxWords: number,
  maxChars: number
): string {
  const cleaned = String(value || '')
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''

  const words = cleaned.split(' ').filter(Boolean).slice(0, maxWords)
  const joined = words.join(' ')
  if (joined.length <= maxChars) return joined
  return joined.slice(0, maxChars).trim()
}

export function splitAudienceCandidates(targetAudience: string): string[] {
  const raw = String(targetAudience || '').trim()
  if (!raw) return []
  return raw
    .split(/[;,|/]/g)
    .map((segment) => normalizePersonaOrScenarioPhrase(segment, 6, 40))
    .filter(Boolean)
}

export function buildPersonaScenarioGuidanceSection(params: {
  bucket: NormalizedCreativeBucket
  targetAudience: string
  useCases: string[]
  userProfiles: Array<{ profile: string; indicators?: string[] }>
  linkType: 'store' | 'product'
}): string {
  const personaCandidates = dedupePhrases(
    [
      ...params.userProfiles.map((profile) =>
        normalizePersonaOrScenarioPhrase(profile?.profile || '', 6, 40)
      ),
      ...splitAudienceCandidates(params.targetAudience),
    ],
    4
  )
  const scenarioCandidates = dedupePhrases(
    (params.useCases || []).map((useCase) => normalizePersonaOrScenarioPhrase(useCase, 8, 55)),
    5
  )

  const personaLine =
    personaCandidates.length > 0
      ? personaCandidates.join(' | ')
      : 'Use inferred buyer persona from audience intent'
  const scenarioLine =
    scenarioCandidates.length > 0
      ? scenarioCandidates.join(' | ')
      : 'Use one concrete real-world use scenario'
  const linkTypeHint =
    params.linkType === 'store'
      ? 'Store page: persona/scenario should guide exploration and trust, not only hard sell.'
      : 'Product page: persona/scenario must stay focused on the single product.'

  const baseRules = `
## 👤 PERSONA + SCENARIO COPY MODE (KISS)
- Write in a realistic user voice (what a real shopper would say), not abstract brand slogans.
- Each asset should center on ONE clear persona and ONE concrete scenario.
- Avoid mixing unrelated personas/scenarios in the same sentence.
- Persona candidates: ${personaLine}
- Scenario candidates: ${scenarioLine}
- ${linkTypeHint}`

  if (params.bucket === 'A') {
    return `${baseRules}
- Bucket A emotion rule: prioritize reassurance and trust language.
- Persona/scenario can support trust, but each asset must still land on brand + product relevance.
- If pain is mentioned, keep it light and brief (max 1 description).
- Avoid fear/shame-heavy wording.`
  }

  if (params.bucket === 'B') {
    return `${baseRules}
- Bucket B emotion rule: keep persona/scenario subordinate to the verified model/series anchor.
- Prefer practical purchase-fit language over broad pain-solution storytelling.
- Avoid store-exploration phrasing, generic assortment copy, and over-broad scenarios.
- Keep tone practical, precise, and conversion-oriented.`
  }

  if (params.bucket === 'D') {
    return `${baseRules}
- Bucket D emotion rule: emphasize value/action with clear CTA.
- Product demand, use-case, and function should be the main narrative lens.
- Use light loss-aversion only when evidence supports urgency/offer.
- Avoid fear/shame-heavy wording; keep conversion tone direct and positive.`
  }

  return `${baseRules}
- Keep a balanced tone across trust, scenario, and value.`
}

export function normalizeSearchTermHintsTerms(
  terms: string[] | undefined,
  limit: number
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of terms || []) {
    const cleaned = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned || cleaned.length < 2 || cleaned.length > 60) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
    if (out.length >= limit) break
  }

  return out
}

export function buildRetryFailureGuidanceSection(retryFailureType?: RetryFailureType): string {
  if (!retryFailureType) return ''

  if (retryFailureType === 'evidence_fail') {
    return `
## ♻️ RETRY FOCUS: EVIDENCE ALIGNMENT
- Remove any unverified numbers, guarantees, rankings, and price promises.
- Rebuild copy around verified facts only (promotion, stock, service, support, official signals).
- Prefer concrete but compliant proof language over exaggerated claims.`
  }

  if (retryFailureType === 'intent_fail') {
    return `
## ♻️ RETRY FOCUS: INTENT ALIGNMENT
- Increase search-intent match in headlines and first two descriptions.
- Keep value proposition explicit and add clearer action language.
- Use high-intent keywords naturally in copy, not as isolated keyword stuffing.`
  }

  return `
## ♻️ RETRY FOCUS: FORMAT/DELIVERY
- Prioritize RSA structure quality: clearer headline roles and stronger complementarity.
- Reduce repetitive wording; keep each headline serving a distinct angle.
- Keep descriptions concise, direct, and CTA-complete with no formatting violations.`
}

export function buildSearchTermFeedbackGuidanceSection(hints?: SearchTermFeedbackHintsInput): {
  hardTerms: string[]
  softTerms: string[]
  highTerms: string[]
  section: string
} {
  const hardTerms = normalizeSearchTermHintsTerms(hints?.hardNegativeTerms, 12)
  const softTerms = normalizeSearchTermHintsTerms(hints?.softSuppressTerms, 12)
  const highTerms = normalizeSearchTermHintsTerms(hints?.highPerformingTerms, 12)

  if (hardTerms.length === 0 && softTerms.length === 0 && highTerms.length === 0) {
    return { hardTerms, softTerms, highTerms, section: '' }
  }

  const lines: string[] = [
    '## 🔁 SEARCH-TERM FEEDBACK (RECENT PERFORMANCE)',
    '- Use this feedback to improve relevance and keyword selection.',
  ]

  if (highTerms.length > 0) {
    lines.push(
      `- ✅ HIGH-PERFORMING TERMS: ${highTerms.join(', ')} (prioritize these themes and related keywords).`
    )
  }
  if (hardTerms.length > 0) {
    lines.push(
      `- ❌ HARD EXCLUDE TERMS: ${hardTerms.join(', ')} (do not use in copy or generated keywords).`
    )
  }
  if (softTerms.length > 0) {
    lines.push(
      `- ⚠️ SOFT SUPPRESS TERMS: ${softTerms.join(', ')} (deprioritize unless absolutely necessary).`
    )
  }

  return {
    hardTerms,
    softTerms,
    highTerms,
    section: lines.join('\n'),
  }
}

export function validateOfferDataQuality(offer: {
  id: number
  brand?: string
  category?: string
  brand_description?: string
  extracted_keywords?: string
  ai_keywords?: unknown
  scrape_status?: string
  scrape_error?: string
}): { isValid: boolean; issues: string[] } {
  const issues: string[] = []
  const UNKNOWN_KEYWORD_PATTERN = /^unknown(\s|$)/i

  const parseKeywordList = (raw: unknown): string[] => {
    const parsed = safeParseJson(raw, [])
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((kw: any) => {
        if (typeof kw === 'string') return kw.trim()
        if (kw && typeof kw.keyword === 'string') return kw.keyword.trim()
        return ''
      })
      .filter(Boolean)
  }

  // 1. 检查 extracted_keywords 是否包含 "unknown" 模式
  if (offer.extracted_keywords) {
    const extractedKeywords = parseKeywordList(offer.extracted_keywords)
    const unknownKeywords = extractedKeywords.filter((kw) => UNKNOWN_KEYWORD_PATTERN.test(kw))

    if (unknownKeywords.length > 3) {
      const aiKeywords = parseKeywordList(offer.ai_keywords)
      const validAiKeywords = aiKeywords.filter((kw) => !UNKNOWN_KEYWORD_PATTERN.test(kw))

      if (validAiKeywords.length <= 3) {
        issues.push(`关键词中包含过多 "unknown" 模式 (${unknownKeywords.length}个)，可能是抓取失败`)
      } else {
        console.warn(
          `[validateOfferDataQuality] Offer ${offer.id}: extracted_keywords异常(${unknownKeywords.length}个unknown)，但ai_keywords可用(${validAiKeywords.length}个)，跳过拦截`
        )
      }
    }
  }

  // 2. 检查品牌描述是否与品牌名一致
  if (offer.brand && offer.brand_description) {
    const brandLower = offer.brand.toLowerCase()
    const descLower = offer.brand_description.toLowerCase()

    // 已知的问题品牌名（从历史案例中提取）
    const knownMismatchBrands = ['lilysilk', 'u-share', 'ushare']

    for (const mismatchBrand of knownMismatchBrands) {
      if (descLower.includes(mismatchBrand) && !brandLower.includes(mismatchBrand)) {
        issues.push(`品牌描述中提到了 "${mismatchBrand}"，但录入品牌是 "${offer.brand}"`)
      }
    }

    // 检查品牌描述是否以其他品牌名开头
    const brandStartMatch = descLower.match(
      /^([a-z][a-z0-9\-\s]{1,20})\s+(is|specializes|focuses|offers|provides)/i
    )
    if (brandStartMatch) {
      const detectedBrand = brandStartMatch[1].trim()
      // 标准化品牌名：统一连字符和空格，便于比较 "k-swiss" vs "k swiss"
      const normalize = (s: string) => s.replace(/[-\s]+/g, '').toLowerCase()
      const detectedNorm = normalize(detectedBrand)
      const brandNorm = normalize(brandLower)
      if (
        detectedNorm !== brandNorm &&
        !brandNorm.includes(detectedNorm) &&
        !detectedNorm.includes(brandNorm)
      ) {
        issues.push(`品牌描述以 "${detectedBrand}" 开头，但录入品牌是 "${offer.brand}"`)
      }
    }
  }

  // 3. 检查类别是否与电子产品品牌明显不匹配
  const electronicsBrands = [
    'anker',
    'reolink',
    'eufy',
    'soundcore',
    'nebula',
    'ecoflow',
    'jackery',
  ]
  const nonElectronicsCategories = [
    'pajama',
    'sleepwear',
    'clothing',
    'apparel',
    'picture frame',
    'photo frame',
    'home decor',
    'furniture',
    'jewelry',
    'cosmetics',
    'beauty',
  ]

  if (offer.brand && offer.category) {
    const brandLower = offer.brand.toLowerCase()
    const categoryLower = offer.category.toLowerCase()

    if (electronicsBrands.includes(brandLower)) {
      for (const nonElecCat of nonElectronicsCategories) {
        if (categoryLower.includes(nonElecCat)) {
          issues.push(`电子产品品牌 "${offer.brand}" 的类别 "${offer.category}" 明显不匹配`)
          break
        }
      }
    }
  }

  // 4. 检查抓取状态
  if (offer.scrape_status === 'failed' && offer.scrape_error) {
    issues.push(`Offer 抓取失败: ${offer.scrape_error}`)
  }

  return {
    isValid: issues.length === 0,
    issues,
  }
} // Keyword with search volume data
// 🎯 数据来源说明：统一使用Historical Metrics API的精确搜索量
// 🎯 意图分类（3类）

export function truncateDkiDefaultText(defaultText: string, maxLength: number): string {
  let candidate = defaultText
  while (
    candidate.length > 0 &&
    getGoogleAdsTextEffectiveLength(`{KeyWord:${candidate}}`) > maxLength
  ) {
    candidate = candidate.slice(0, -1)
  }
  return candidate || 'Keyword'
}

export function buildDkiFirstHeadline(
  brandName: string,
  maxLength = 30,
  localeOptions?: DkiLocaleOptions
): string {
  const normalizedBrand = String(brandName || '')
    .replace(/[{}]/g, '')
    .replace(/\s{2 }/g, ' ')
    .trim()

  if (!normalizedBrand) {
    return '{KeyWord:Keyword}'
  }

  const suffix = getLocalizedDkiOfficialSuffix(localeOptions)
  const headlineWithSuffix = `{KeyWord:${normalizedBrand}}${suffix}`

  // Google Ads DKI 规则：{KeyWord:DefaultText} token 本身不计入字符数，只计 DefaultText 的长度
  // token 之外的普通文本（如本地化后的 " Official/Oficial/官方"）会计入有效字符数。
  if (suffix && getGoogleAdsTextEffectiveLength(headlineWithSuffix) <= maxLength) {
    return headlineWithSuffix
  }

  const headlineWithoutSuffix = `{KeyWord:${normalizedBrand}}`
  if (getGoogleAdsTextEffectiveLength(headlineWithoutSuffix) <= maxLength) {
    return headlineWithoutSuffix
  }

  return `{KeyWord:${truncateDkiDefaultText(normalizedBrand, maxLength)}}`
}

export function buildDkiKeywordHeadline(defaultText: string, maxLength = 30): string {
  const normalized = String(defaultText || '')
    .replace(/[{}]/g, '')
    .replace(/\s{2 }/g, ' ')
    .trim()

  if (!normalized) return `{KeyWord:Keyword}`

  if (normalized.length <= maxLength) {
    return `{KeyWord:${normalized}}`
  }

  return `{KeyWord:${normalized.substring(0, maxLength)}}`
}

/**
 * AI广告创意生成器
 * 优先使用Vertex AI，其次使用Gemini API
 */

/**
 * 获取语言指令 - 确保 AI 生成指定语言的内容
 */

export async function buildAdCreativePrompt(
  offer: any,
  theme?: string,
  referencePerformance?: any,
  excludeKeywords?: string[],
  extractedElements?: {
    keywords?: Array<{ keyword: string; searchVolume: number; source: string; priority: string }>
    headlines?: string[]
    descriptions?: string[]
    // 🎯 P0/P1/P2/P3优化：增强数据字段
    productInfo?: { features?: string[]; benefits?: string[]; useCases?: string[] }
    reviewAnalysis?: { sentiment?: string; themes?: string[]; insights?: string[] }
    localization?: { currency?: string; culturalNotes?: string[]; localKeywords?: string[] }
    brandAnalysis?: {
      positioning?: string
      voice?: string
      competitors?: string[]
      // 🔥 修复（2025-12-11）：添加店铺分析新字段
      hotProducts?: Array<{
        name: string
        productHighlights?: string[]
        successFactors?: string[]
      }>
      reviewAnalysis?: {
        overallSentiment?: string
        positives?: string[]
        concerns?: string[]
        customerUseCases?: string[]
        trustIndicators?: string[]
      }
      sellingPoints?: string[]
    }
    qualityScore?: number
    // 🆕 v4.10: 关键词池桶信息
    bucketInfo?: {
      bucket: string
      intent?: string
      intentEn?: string
      keywordCount: number
    }
  },
  runtimeGuidance?: PromptRuntimeGuidanceOptions
): Promise<{ prompt: string; promptKeywords: string[] }> {
  // 🎯 v3.0 REFACTOR: Load template from database (migration 056)
  const promptTemplate = await loadPrompt('ad_creative_generation')

  // Build variables map for simple substitution
  // Build variables map for basic product information
  const resolvedLanguage = resolveCreativeTargetLanguage(
    offer.target_language || null,
    offer.target_country || null
  )
  const targetLanguage = resolvedLanguage.languageName
  const languageInstruction = getLanguageInstruction(
    offer.target_language || null,
    offer.target_country || null
  )
  const policyGuardMode = resolveGoogleAdsPolicyGuardMode(runtimeGuidance?.policyGuardMode)
  const rawProductTitle = offer.product_title || offer.name || offer.title || 'Product'
  const rawProductName = offer.product_name || offer.product_title || offer.name || offer.brand
  const rawProductDescription =
    offer.brand_description || offer.unique_selling_points || 'Quality product'
  const rawUniqueSellingPoints =
    offer.unique_selling_points || offer.product_highlights || 'Premium quality'
  const policySafeProductTitle = sanitizeGoogleAdsPolicyText(String(rawProductTitle || ''), {
    maxLength: 120,
    mode: policyGuardMode,
  })
  const policySafeProductName = sanitizeGoogleAdsPolicyText(String(rawProductName || ''), {
    maxLength: 120,
    mode: policyGuardMode,
  })
  const policySafeProductDescription = sanitizeGoogleAdsPolicyText(
    String(rawProductDescription || ''),
    { maxLength: 240, mode: policyGuardMode }
  )
  const policySafeUniqueSellingPoints = sanitizeGoogleAdsPolicyText(
    String(rawUniqueSellingPoints || ''),
    { maxLength: 240, mode: policyGuardMode }
  )
  const policySignalTerms = extractGoogleAdsPolicySensitiveTerms(
    [
      String(rawProductTitle || ''),
      String(rawProductName || ''),
      String(rawProductDescription || ''),
      String(rawUniqueSellingPoints || ''),
    ],
    { mode: policyGuardMode }
  )

  // 🆕 v4.16: 确定链接类型（含scraped_data兜底）
  const scrapedDataForLinkType = safeParseJson(offer.scraped_data, null)
  const derivedLinkType = deriveLinkTypeFromScrapedData(scrapedDataForLinkType)
  if (offer.page_type && derivedLinkType && offer.page_type !== derivedLinkType) {
    console.warn(
      `⚠️ page_type不一致: offer.page_type=${offer.page_type}, scraped_data.pageType=${derivedLinkType}。将使用 ${derivedLinkType} 作为链接类型。`
    )
  }
  const linkType = (() => {
    const explicit = offer.page_type as 'product' | 'store' | null
    if (explicit === 'store') return 'store'
    if (explicit === 'product') return derivedLinkType === 'store' ? 'store' : 'product'
    return derivedLinkType || 'product'
  })()

  const variables: Record<string, string> = {
    language_instruction: languageInstruction,
    brand: offer.brand,
    category: offer.category || 'product',
    product_title: policySafeProductTitle.text || String(rawProductTitle || 'Product'),
    product_name: policySafeProductName.text || String(rawProductName || offer.brand || 'Product'),
    product_description:
      policySafeProductDescription.text || String(rawProductDescription || 'Quality product'),
    unique_selling_points:
      policySafeUniqueSellingPoints.text || String(rawUniqueSellingPoints || 'Premium quality'),
    target_audience: offer.target_audience || 'General',
    target_country: offer.target_country,
    target_language: targetLanguage,
    target_language_code: resolvedLanguage.languageCode,
    // 🆕 KISS-3类型优化：Headline #2 主关键词（非品牌）
    primary_keyword: '',
    // 🆕 证据约束：仅允许使用此处可验证事实（避免“编造数字/承诺”）
    verified_facts_section: '',
    // 🆕 非破坏式意图增强：只指导文案，不改变关键词列表
    type_intent_guidance_section: '',
  }

  // Build conditional sections as complete strings
  let enhanced_features_section = ''
  let localization_section = ''
  let brand_analysis_section = ''
  // 🆕 v4.10: 关键词池桶section
  let keyword_bucket_section = ''
  let link_type_instructions = ''
  let store_creative_instructions = ''

  // 🆕 v4.16: 添加链接类型信息
  if (linkType === 'store') {
    link_type_instructions = `
**⚠️ 店铺链接关键词使用规则：**
- 品牌词使用比例可适当提高（80%+品牌词）
- 场景词和品类词用于描述使用场景
- 强调店铺信誉、官方授权、售后保障
- 避免过于具体的购买意图词汇`
    // 🆕 v4.16: 店铺创意特殊指令（KISS-3：A/B/D）
    store_creative_instructions = `
## 🏪 店铺链接创意特殊规则（KISS-3：A/B/D）

### A（品牌意图）
**目标**: 建立品牌权威，并把品牌与真实商品集合绑定
- 关键词侧重：品牌词 + 商品/品类锚点词
- 表达重点：品牌背书、代表商品、核心品类、热门商品线
- CTA：偏“进店/了解品牌商品”（如 "Explore Brand Products", "Shop Brand Direct"）

### B（热门商品型号/产品族意图）
**目标**: 承接已锁定热门商品型号/产品族的强购买意图
- 关键词侧重：品牌 + 热门商品型号/产品族 + 品类长尾词
- 表达重点：围绕热门商品型号、产品族和具体购买动作
- CTA：偏“查看型号/立即购买”（如 "Shop Exact Model", "Buy Now"）

### D（商品需求意图）
**目标**: 承接品牌下明确商品需求，但用户尚未锁定具体型号
- 关键词侧重：品牌 + 品类 + 功能/场景/产品线词
- 表达重点：商品卖点、功能、使用场景、产品线覆盖 + 明确CTA

⚠️ 兼容性说明：历史桶 \`C→B\`、\`S→D\`，不要在输出中使用/展示 \`C/S\`。`
  } else {
    link_type_instructions = `
**⚠️ 单品链接关键词使用规则：**
- 品牌词和非品牌词均衡使用（约50%/50%）
- 根据创意类型选择对应桶的关键词
- 强调产品特性和购买优势
- 明确CTA引导购买行为`
  }

  // 🆕 v4.10: 添加关键词池桶指令
  if (extractedElements?.bucketInfo) {
    const { bucket, intent, intentEn, keywordCount } = extractedElements.bucketInfo
    // 🆕 KISS-3: 归一化创意类型（兼容历史 C/S）
    const kissBucket = normalizeCreativeBucketSlot(bucket) ?? bucket

    // 🆕 v4.16: 店铺链接特殊桶处理
    if (linkType === 'store') {
      const storeBucketInstructions: Record<string, string> = {
        A: `
**🏪 店铺桶A - 品牌意图导向**
- 核心主题: 品牌背书 + 真实商品集合
- 关键词策略: 品牌词优先，但必须同时覆盖商品/品类锚点
- 创意重点: 强调品牌优势、核心品类、热门商品线`,
        B: `
**🏪 店铺桶B - 热门商品型号/产品族意图导向**
- 核心主题: 热门商品型号/产品族购买意图
- 关键词策略: 品牌 + 热门商品型号/产品族 + 品类，统一完全匹配
- 创意重点: 默认覆盖多个热门商品，不得退化为泛店铺文案`,
        D: `
**🏪 店铺桶D - 商品需求意图导向**
- 核心主题: 品牌下商品需求、功能、场景和产品线覆盖
- 关键词策略: 品牌 + 品类 + 功能/场景/热门商品线词
- 创意重点: 商品需求覆盖优先，不得退化为纯品牌导航词`,
      }
      keyword_bucket_section =
        storeBucketInstructions[kissBucket] ||
        `
**📦 STORE KEYWORD POOL BUCKET ${kissBucket} - ${intent || intentEn}**
This store creative focuses on "${intent || intentEn}" user intent.
- ${keywordCount} pre-selected keywords for this intent
- Keywords optimized for store-level marketing`
    }
    // 兼容旧 S 桶：仅保留提示说明，运行时语义统一按 D / product_intent 处理
    else if (bucket === 'S') {
      keyword_bucket_section = `
**🧭 LEGACY BUCKET S（已废弃）**
历史 S 桶不是独立创意类型，在 KISS-3 中统一映射为桶 D（商品需求意图）。
- 仅在品牌与商品需求锚点明确时才可使用
- 文案重点：品牌相关商品需求 + 明确CTA + 可信背书
`
    } else {
      // 🆕 v4.18: 为每个产品链接桶添加单品聚焦约束
      const productBucketInstructions: Record<string, string> = {
        A: `
**📦 产品桶A - 品牌意图导向 (Brand Intent)**
**🎯 核心主题**: 建立品牌可信度 + 强化“品牌与当前商品强相关”
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 必须提到具体产品名称/型号: {{product_name}}
- ✅ 可强调品牌优势、代表商品、品牌背书（仅限可验证事实）
- ✅ 所有创意元素必须聚焦于这一个产品
- ❌ 禁止: "Shop All Products", "Browse Collection", "Cameras & Doorbells"
- ❌ 禁止: 提及同品牌其他品类产品
- 创意重点: 品牌优先，但必须回到当前商品`,
        B: `
**📦 产品桶B - 商品型号/产品族意图导向 (Model Intent)**
**🎯 核心主题**: 当前商品型号/产品族购买意图
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 广告语和关键词必须围绕这一个产品的型号/产品族
- ✅ 关键词必须覆盖品牌 + 型号/产品族 + 品类的长尾词
- ✅ 最终关键词统一完全匹配
- ❌ 禁止: 退化成泛品类词、场景词或纯品牌词
- ❌ 禁止: 暗示多产品选择或店铺级文案
- 创意重点: 精准、可投放、强购买意图`,
        D: `
**📦 产品桶D - 商品需求意图导向 (Product Demand Intent)**
**🎯 核心主题**: 品牌下商品需求、功能、场景和产品线覆盖
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 广告语优先体现商品卖点、功能、场景、产品线
- ✅ 必须同时和品牌与当前商品有关
- ✅ 明确CTA: "Buy Now", "Shop Now", "Learn More"
- ❌ 禁止: 只有品牌没有商品需求锚点
- ❌ 禁止: 变成店铺级文案或纯促销口号
- 创意重点: 需求覆盖清晰 + 行动明确`,
      }
      keyword_bucket_section =
        productBucketInstructions[kissBucket] ||
        `
**📦 KEYWORD POOL BUCKET ${kissBucket} - ${intent || intentEn}**
**⚠️ 单品聚焦规则 (CRITICAL)**:
- This creative MUST focus on ONE specific product: {{product_name}}
- ALL headlines and descriptions must reference this specific product
- Do NOT use generic brand/store descriptions
- Do NOT mention other products or product categories

This creative focuses on "${intent || intentEn}" user intent.
- You have ${keywordCount} pre-selected keywords optimized for this intent
- Use these intent keyword hints as guidance, but do not treat them as a bucket-only hard constraint
- Ensure headlines and descriptions align with the "${intent || intentEn}" messaging strategy
- Do NOT mix intents - stay focused on this single theme
- Stay focused on ONE product - do not generalize to product categories`
    }
  }

  // 🎯 P0优化：使用增强产品信息
  if (extractedElements?.productInfo) {
    const { features, benefits, useCases } = extractedElements.productInfo
    if (features && features.length > 0) {
      enhanced_features_section += `\n**✨ ENHANCED FEATURES**: ${features.slice(0, 5).join(', ')}`
    }
    if (benefits && benefits.length > 0) {
      enhanced_features_section += `\n**✨ KEY BENEFITS**: ${benefits.slice(0, 3).join(', ')}`
    }
    if (useCases && useCases.length > 0) {
      enhanced_features_section += `\n**✨ USE CASES**: ${useCases.slice(0, 3).join(', ')}`
    }
  }

  // 🎯 P2优化：使用本地化适配数据
  if (extractedElements?.localization) {
    const { currency, culturalNotes, localKeywords } = extractedElements.localization
    if (currency) {
      // 🔥 修复（2025-12-23）：明确指定货币符号，确保AI生成正确格式
      const currencySymbolMap: Record<string, string> = {
        GBP: '£ (British Pound Sterling - UK market)',
        USD: '$ (US Dollar)',
        EUR: '€ (Euro)',
        JPY: '¥ (Japanese Yen)',
        AUD: 'A$ (Australian Dollar)',
        CAD: 'C$ (Canadian Dollar)',
        CHF: 'CHF (Swiss Franc)',
      }
      const currencySymbol = currencySymbolMap[currency] || currency
      localization_section += `\n**🌍 LOCAL CURRENCY**: ${currencySymbol}`
      // 🔥 重要：添加明确指令，要求所有价格使用正确符号
      localization_section += `\n**🔴 CRITICAL**: ALL prices in headlines and descriptions MUST use the correct currency symbol (${currencySymbol}).`
      localization_section += `\nExamples for ${currency}: "Save £170", "Only £499", "£XXX off" - NEVER use "$" or "€" for UK market.`
    }
    if (culturalNotes && culturalNotes.length > 0) {
      localization_section += `\n**🌍 CULTURAL NOTES**: ${culturalNotes.join('; ')}`
    }
    if (localKeywords && localKeywords.length > 0) {
      localization_section += `\n**🌍 LOCAL KEYWORDS**: ${localKeywords.slice(0, 5).join(', ')}`
    }
  }

  // 🎯 P3优化：使用品牌分析数据
  if (extractedElements?.brandAnalysis) {
    const {
      positioning,
      voice,
      competitors,
      hotProducts,
      reviewAnalysis: storeReviewAnalysis,
      sellingPoints,
    } = extractedElements.brandAnalysis
    if (positioning) {
      brand_analysis_section += `\n**🏷️ BRAND POSITIONING**: ${positioning}`
    }
    if (voice) {
      brand_analysis_section += `\n**🏷️ BRAND VOICE**: ${voice}`
    }
    if (competitors && competitors.length > 0) {
      brand_analysis_section += `\n**🏷️ KEY COMPETITORS**: ${competitors.slice(0, 3).join(', ')}`
    }
    // 🔥 修复（2025-12-11）：添加店铺卖点
    if (sellingPoints && sellingPoints.length > 0) {
      brand_analysis_section += `\n**🏷️ BRAND SELLING POINTS**: ${sellingPoints.slice(0, 5).join(', ')}`
    }
    // 🔥 修复（2025-12-11）：添加热销商品产品亮点
    if (hotProducts && hotProducts.length > 0) {
      const allHighlights: string[] = []
      hotProducts.slice(0, 3).forEach((p) => {
        if (p.productHighlights && p.productHighlights.length > 0) {
          allHighlights.push(...p.productHighlights.slice(0, 3))
        }
      })
      if (allHighlights.length > 0) {
        brand_analysis_section += `\n**🔥 HOT PRODUCT HIGHLIGHTS**: ${[...new Set(allHighlights)].slice(0, 8).join(', ')}`
      }
    }
    // 🔥 修复（2025-12-11）：添加店铺评论分析
    if (storeReviewAnalysis) {
      if (storeReviewAnalysis.overallSentiment) {
        brand_analysis_section += `\n**📊 STORE SENTIMENT**: ${storeReviewAnalysis.overallSentiment}`
      }
      if (storeReviewAnalysis.positives && storeReviewAnalysis.positives.length > 0) {
        brand_analysis_section += `\n**👍 CUSTOMER PRAISES**: ${storeReviewAnalysis.positives.slice(0, 4).join(', ')}`
      }
      if (storeReviewAnalysis.concerns && storeReviewAnalysis.concerns.length > 0) {
        brand_analysis_section += `\n**⚠️ CUSTOMER CONCERNS**: ${storeReviewAnalysis.concerns.slice(0, 3).join(', ')}`
      }
      if (storeReviewAnalysis.customerUseCases && storeReviewAnalysis.customerUseCases.length > 0) {
        brand_analysis_section += `\n**🎯 REAL USE CASES**: ${storeReviewAnalysis.customerUseCases.slice(0, 4).join(', ')}`
      }
      if (storeReviewAnalysis.trustIndicators && storeReviewAnalysis.trustIndicators.length > 0) {
        brand_analysis_section += `\n**✅ TRUST INDICATORS**: ${storeReviewAnalysis.trustIndicators.slice(0, 4).join(', ')}`
      }
    }
  }

  // 🔥 P0优化：增强数据 - 添加真实折扣、促销、排名、徽章等爬虫抓取的数据
  const extras: string[] = []
  const supplementalVerifiedFacts: string[] = []
  const supplementalHookLines: string[] = []

  const formatSupplementalName = (name: string) => {
    if (!name) return ''
    const cleaned = name
      .split(' - ')[0]
      .split(' – ')[0]
      .split(' — ')[0]
      .split(':')[0]
      .trim()
      .replace(/\s+/g, ' ')
    return cleaned.length > 48 ? `${cleaned.slice(0, 45).trim()}...` : cleaned
  }

  const formatSupplementalFeature = (feature: string) => {
    if (!feature) return ''
    const cleaned = feature.replace(/\s+/g, ' ').trim()
    return cleaned.length > 90 ? `${cleaned.slice(0, 87).trim()}...` : cleaned
  }

  // 价格证据策略：
  // 1) 优先使用 offer.product_price / offer.pricing.current（权威来源）
  // 2) scraped_data.productPrice 仅作为兜底
  // 3) 若权威价与抓取价偏差 >20%，触发熔断：禁止在创意中使用具体价格
  const resolvedPriceEvidence = resolveCreativePriceEvidence(offer)
  let currentPrice = resolvedPriceEvidence.currentPrice
  let originalPrice = resolvedPriceEvidence.originalPrice
  let discount = resolvedPriceEvidence.discount
  const priceEvidenceBlocked = resolvedPriceEvidence.priceEvidenceBlocked
  const priceEvidenceWarning = resolvedPriceEvidence.priceEvidenceWarning
  const priceSource = resolvedPriceEvidence.priceSource

  if (priceEvidenceWarning) {
    console.warn(priceEvidenceWarning)
    localization_section +=
      '\n**⚠️ PRICE SAFETY RULE**: Conflicting price signals were detected. Do NOT mention any exact price amount in headlines or descriptions.'
  } else if (currentPrice) {
    console.log(
      `[PriceEvidence] Offer ${offer.id}: using price source=${priceSource}, value=${currentPrice}`
    )
  }

  if (currentPrice) {
    extras.push(`PRICE: ${currentPrice}`)
  }
  if (originalPrice && discount) {
    extras.push(`ORIGINAL: ${originalPrice} | DISCOUNT: ${discount}`)
  }

  // 🔥 促销信息（优化版 - 完整提取active数组）
  interface PromotionItem {
    description: string
    code?: string | null
    validUntil?: string | null
    conditions?: string | null
  }
  let activePromotions: PromotionItem[] = []

  if (offer.promotions) {
    try {
      const promos = JSON.parse(offer.promotions)
      if (promos.active && Array.isArray(promos.active) && promos.active.length > 0) {
        activePromotions = promos.active
      }
    } catch (error) {
      console.warn('Failed to parse promotions:', error)
    }
  }

  // 在extras中展示主促销
  if (activePromotions.length > 0) {
    const mainPromo = activePromotions[0]
    let promoText = `PROMO: ${mainPromo.description}`
    if (mainPromo.code) {
      promoText += ` | CODE: ${mainPromo.code}`
    }
    if (mainPromo.validUntil) {
      promoText += ` | VALID UNTIL: ${mainPromo.validUntil}`
    }
    if (mainPromo.conditions) {
      promoText += ` | ${mainPromo.conditions}`
    }
    extras.push(promoText)

    // 次要促销
    if (activePromotions.length > 1) {
      const secondaryPromo = activePromotions[1]
      extras.push(`EXTRA PROMO: ${secondaryPromo.description}`)
    }
  }

  // 🔥 P0-2: 销售排名和徽章（社会证明）
  let salesRank: string | null = null
  let badge = null
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      salesRank = scrapedData.salesRank
      badge = scrapedData.badge
    } catch {}
  }
  const salesRankSignal = resolveCreativeSalesRankSignal(salesRank)
  const salesRankForPrompt = salesRankSignal.eligibleForPrompt ? salesRankSignal.raw : null
  const featuredSalesRank = salesRankSignal.strongSignal ? salesRankSignal.raw : null

  if (salesRankSignal.eligibleForPrompt && salesRankSignal.normalizedRankText) {
    extras.push(`SALES RANK: ${salesRankSignal.normalizedRankText}`)
  } else if (salesRank) {
    console.log(
      `[SalesRankGuard] Offer ${offer.id}: skip salesRank "${salesRank}" (rank=${salesRankSignal.rankNumber ?? 'N/A'} > ${SALES_RANK_PROMPT_MAX} or unparsable)`
    )
  }
  if (badge) {
    extras.push(`BADGE: ${badge}`)
  }

  // 🔥 P0-3: Prime资格和库存状态
  let primeEligible = false
  let availability = null
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      primeEligible = scrapedData.primeEligible || scrapedData.isPrime || false
      availability = scrapedData.availability
    } catch {}
  }
  if (primeEligible) {
    extras.push(`PRIME: Yes`)
  }
  if (availability) {
    extras.push(`STOCK: ${availability}`)
  }

  // 🔥 P1-1: 用户评论洞察（基础）
  let reviewHighlights: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      reviewHighlights = scrapedData.reviewHighlights || []
    } catch {}
  }
  if (reviewHighlights.length > 0) {
    extras.push(`REVIEW INSIGHTS: ${reviewHighlights.slice(0, 5).join(', ')}`)
  }

  // 🎯 P0优化: topReviews热门评论（真实用户引用）
  let topReviews: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      const rawTopReviews: unknown[] = Array.isArray(scrapedData.topReviews)
        ? scrapedData.topReviews
        : []
      topReviews = rawTopReviews
        .map((review: unknown) => sanitizeReviewSnippetForPrompt(review))
        .filter((review): review is string => !!review)
      const droppedTopReviews = rawTopReviews.length - topReviews.length
      if (droppedTopReviews > 0) {
        console.log(
          `[ReviewQuoteGuard] Offer ${offer.id}: dropped ${droppedTopReviews} low-trust top reviews`
        )
      }
    } catch {}
  }
  if (topReviews.length > 0) {
    // 只使用前2条最优质评论（避免prompt过长）
    extras.push(`TOP REVIEWS (Use for credibility): ${topReviews.slice(0, 2).join(' | ')}`)

    // 🔥 v4.1优化：提取用户语言模式（常用表达词汇）
    // 从评论中提取2-4词的短语作为自然语言参考
    const userPhrases: string[] = []
    topReviews.slice(0, 5).forEach((review) => {
      // 匹配常见的用户表达模式
      const patterns = [
        /very ([\w\s]+)/gi, // "very easy to use"
        /really ([\w\s]+)/gi, // "really quiet"
        /so ([\w]+)/gi, // "so powerful"
        /love the ([\w\s]+)/gi, // "love the design"
        /great ([\w\s]+)/gi, // "great battery life"
        /perfect for ([\w\s]+)/gi, // "perfect for pets"
        /works ([\w\s]+)/gi, // "works perfectly"
        /easy to ([\w]+)/gi, // "easy to clean"
      ]
      patterns.forEach((pattern) => {
        const matches = review.match(pattern)
        if (matches) {
          matches.slice(0, 2).forEach((m) => {
            const cleaned = m.toLowerCase().trim()
            if (
              cleaned.length > 5 &&
              cleaned.length < 30 &&
              !REVIEW_QUOTE_BLOCKLIST_PATTERN.test(cleaned)
            ) {
              userPhrases.push(cleaned)
            }
          })
        }
      })
    })
    const uniquePhrases = [...new Set(userPhrases)].slice(0, 6)
    if (uniquePhrases.length > 0) {
      extras.push(`USER LANGUAGE PATTERNS: ${uniquePhrases.join(', ')}`)
    }
  }

  // 🔥 P1-1+: 用户评论深度分析（增强版 - 充分利用所有评论分析字段）
  let commonPraises: string[] = []
  let purchaseReasons: string[] = []
  let useCases: string[] = []
  let commonPainPoints: string[] = []
  // 🆕 新增字段
  let topPositiveKeywords: Array<{ keyword: string; frequency: number; context?: string }> = []
  let userProfiles: Array<{ profile: string; indicators?: string[] }> = []
  let sentimentDistribution: { positive: number; neutral: number; negative: number } | null = null
  let totalReviews: number = 0
  let averageRating: number = 0
  // 🔥 v3.2新增：量化数据亮点
  let quantitativeHighlights: Array<{ metric: string; value: string; adCopy: string }> = []
  let competitorMentions: Array<{ brand: string; comparison: string; sentiment: string }> = []

  // 🎯 合并基础和增强评论分析数据
  if (offer.review_analysis) {
    try {
      const reviewAnalysis = JSON.parse(offer.review_analysis)
      // 原有字段
      commonPraises = reviewAnalysis.commonPraises || []
      purchaseReasons = (reviewAnalysis.purchaseReasons || []).map((r: any) =>
        typeof r === 'string' ? r : r.reason || r
      )
      useCases = (reviewAnalysis.realUseCases || reviewAnalysis.useCases || []).map((u: any) =>
        typeof u === 'string' ? u : u.scenario || u
      )
      commonPainPoints = (reviewAnalysis.commonPainPoints || []).map((p: any) =>
        typeof p === 'string' ? p : p.issue || p
      )
      // 🆕 新增字段提取
      topPositiveKeywords = reviewAnalysis.topPositiveKeywords || []
      userProfiles = reviewAnalysis.userProfiles || []
      sentimentDistribution = reviewAnalysis.sentimentDistribution || null
      totalReviews = reviewAnalysis.totalReviews || 0
      averageRating = reviewAnalysis.averageRating || 0
      // 🔥 v3.2新增字段
      quantitativeHighlights = reviewAnalysis.quantitativeHighlights || []
      competitorMentions = reviewAnalysis.competitorMentions || []
    } catch {}
  }

  // 🎯 P1优化：合并增强评论分析数据（如果有）
  if (extractedElements?.reviewAnalysis) {
    const enhanced = extractedElements.reviewAnalysis
    if (enhanced.themes && enhanced.themes.length > 0) {
      // themes 作为额外的洞察合并到 commonPraises
      commonPraises = [...new Set([...commonPraises, ...enhanced.themes])]
    }
    if (enhanced.insights && enhanced.insights.length > 0) {
      // insights 作为额外的购买理由
      purchaseReasons = [...new Set([...purchaseReasons, ...enhanced.insights])]
    }
    // sentiment 可以补充 sentimentDistribution
    if (enhanced.sentiment && !sentimentDistribution) {
      // 简单映射：positive/negative/neutral
      const sentimentMap: any = {
        positive: { positive: 70, neutral: 20, negative: 10 },
        negative: { positive: 10, neutral: 20, negative: 70 },
        neutral: { positive: 30, neutral: 50, negative: 20 },
      }
      sentimentDistribution = sentimentMap[enhanced.sentiment.toLowerCase()] || null
    }
  }

  // 将深度评论分析数据添加到Prompt
  if (commonPraises.length > 0) {
    extras.push(`USER PRAISES: ${commonPraises.slice(0, 3).join(', ')}`)
  }
  if (purchaseReasons.length > 0) {
    extras.push(`WHY BUY: ${purchaseReasons.slice(0, 3).join(', ')}`)
  }
  if (useCases.length > 0) {
    extras.push(`USE CASES: ${useCases.slice(0, 3).join(', ')}`)
  }
  if (commonPainPoints.length > 0) {
    extras.push(`AVOID: ${commonPainPoints.slice(0, 2).join(', ')}`)
  }

  // 🆕 新增：正面关键词作为关键词参考（高频用户好评词）
  if (topPositiveKeywords.length > 0) {
    const positiveKWs = topPositiveKeywords
      .slice(0, 5)
      .map((k) => `"${k.keyword}"(${k.frequency}x)`)
      .join(', ')
    extras.push(`POSITIVE KEYWORDS: ${positiveKWs}`)
  }

  // 🆕 新增：情感分布作为社会证明（高好评率）
  if (sentimentDistribution && totalReviews > 0) {
    const positiveRate = sentimentDistribution.positive
    if (positiveRate >= 80) {
      extras.push(
        `SOCIAL PROOF: Strong positive review sentiment from ${totalReviews} customers${averageRating ? `, ${averageRating} stars` : ''}`
      )
    } else if (positiveRate >= 60) {
      extras.push(
        `REVIEWS: ${totalReviews} customer reviews${averageRating ? `, ${averageRating} avg rating` : ''}`
      )
    }
  }

  // 🆕 新增：用户画像用于受众定制
  if (userProfiles.length > 0) {
    const profiles = userProfiles
      .slice(0, 3)
      .map((p) => p.profile)
      .join(', ')
    extras.push(`TARGET PERSONAS: ${profiles}`)
  }

  // 🔥 v3.2新增：量化数据亮点（评论中的具体数字 - 最有说服力的广告素材）
  // 例如："8小时续航"、"2000Pa吸力"、"覆盖2000平方英尺"
  if (quantitativeHighlights.length > 0) {
    const topHighlights = quantitativeHighlights
      .slice(0, 5)
      .map((q) => q.adCopy)
      .join(' | ')
    extras.push(`PROVEN CLAIMS: ${topHighlights}`)
  }

  // 🔥 v3.2新增：竞品对比优势（用户自发的竞品比较）
  if (competitorMentions.length > 0) {
    // 只提取正面对比（用户认为我们比竞品更好的地方）
    const positiveComparisons = competitorMentions
      .filter((c) => c.sentiment === 'positive')
      .slice(0, 3)
      .map((c) => `vs ${c.brand}: ${c.comparison}`)
      .join(' | ')
    if (positiveComparisons) {
      extras.push(`COMPETITIVE EDGE: ${positiveComparisons}`)
    }
  }

  // 🔥 P1-2: 技术规格（关键参数）
  let technicalDetails: Record<string, string> = {}
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      technicalDetails = scrapedData.technicalDetails || {}
    } catch {}
  }
  if (Object.keys(technicalDetails).length > 0) {
    // 提取前3个最重要的技术参数
    const topSpecs = Object.entries(technicalDetails)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ')
    extras.push(`SPECS: ${topSpecs}`)
  }

  // 🔥 2025-12-10优化：提取features和aboutThisItem（产品核心卖点）
  let productFeatures: string[] = []
  let aboutThisItem: string[] = []
  let scrapedProductTitle = ''
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      productFeatures = scrapedData.features || []
      aboutThisItem = scrapedData.aboutThisItem || []
      scrapedProductTitle =
        typeof scrapedData.productName === 'string'
          ? scrapedData.productName
          : typeof scrapedData.title === 'string'
            ? scrapedData.title
            : ''
    } catch {}
  }
  if (!scrapedProductTitle) {
    scrapedProductTitle = String(
      offer.product_name || offer.product_title || offer.name || ''
    ).trim()
  }
  // 优先使用aboutThisItem（更详细），其次使用features
  const featureSource = aboutThisItem.length > 0 ? aboutThisItem : productFeatures
  const titleAndAboutSignals = extractTitleAndAboutSignals(scrapedProductTitle, featureSource, {
    targetLanguage: resolvedLanguage.languageCode,
    brandName: offer.brand,
  })

  if (titleAndAboutSignals.productTitle) {
    extras.push(`AMAZON TITLE: ${truncateSnippetByWords(titleAndAboutSignals.productTitle, 180)}`)
  }
  if (titleAndAboutSignals.titlePhrases.length > 0) {
    extras.push(`TITLE CORE PHRASES: ${titleAndAboutSignals.titlePhrases.slice(0, 5).join(' | ')}`)
  }
  if (featureSource.length > 0) {
    // 提取前5个最重要的产品特点（限制每条100字符避免过长）
    const topFeatures = featureSource
      .slice(0, 5)
      .map((f: string) => (f.length > 100 ? f.substring(0, 100) + '...' : f))
      .join(' | ')
    extras.push(`PRODUCT FEATURES: ${topFeatures}`)
  }
  if (titleAndAboutSignals.aboutClaims.length > 0) {
    extras.push(`ABOUT CORE CLAIMS: ${titleAndAboutSignals.aboutClaims.slice(0, 5).join(' | ')}`)
  }

  // 🔥 P1-3: Store热销数据（新增优化 - 用于Amazon Store或独立站店铺页）
  let hotInsights: { avgRating: number; avgReviews: number; topProductsCount: number } | null = null
  let topProducts: string[] = []
  // 🔥 2025-12-10优化：提取销售热度数据
  let storeSalesVolumes: string[] = []
  let storeDiscounts: string[] = []
  let supplementalProducts: any[] = []
  let storePriceRange: string | null = null
  let storePriceSamples: Array<{ name: string; price: string }> = []
  let storeDescriptionClaims: string[] = []

  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      const storeDescription =
        typeof scrapedData.storeDescription === 'string' ? scrapedData.storeDescription : ''
      if (storeDescription) {
        const descLower = storeDescription.toLowerCase()
        if (/free\\s+uk\\s+(delivery|shipping)/i.test(descLower)) {
          storeDescriptionClaims.push('Free UK delivery')
        } else if (/free\\s+(delivery|shipping)/i.test(descLower)) {
          storeDescriptionClaims.push('Free delivery')
        }
      }
      hotInsights = scrapedData.hotInsights || null
      supplementalProducts = Array.isArray(scrapedData.supplementalProducts)
        ? scrapedData.supplementalProducts
        : []
      // 提取热销产品名称（如果有products数组）
      if (scrapedData.products && Array.isArray(scrapedData.products)) {
        topProducts = scrapedData.products
          .slice(0, 5)
          .map((p: any) => p.name || p.productName)
          .filter(Boolean)

        const priceSamples = scrapedData.products
          .filter((p: any) => p && p.price && (p.name || p.productName))
          .slice(0, 3)
          .map((p: any) => ({
            name: p.name || p.productName,
            price: p.price,
          }))
        storePriceSamples = priceSamples

        // 🔥 2025-12-10优化：提取销量数据（"1K+ bought in past month"等）
        storeSalesVolumes = scrapedData.products
          .filter((p: any) => p.salesVolume)
          .slice(0, 3)
          .map((p: any) => `${(p.name || '').substring(0, 20)}... (${p.salesVolume})`)

        // 🔥 2025-12-10优化：提取折扣数据（"-20%"等）
        storeDiscounts = scrapedData.products
          .filter((p: any) => p.discount)
          .slice(0, 3)
          .map((p: any) => p.discount)
        storeDiscounts = [...new Set(storeDiscounts)] // 去重

        const storePriceValues = scrapedData.products
          .map((p: any) => parsePrice(p?.price))
          .filter((v: any) => typeof v === 'number' && !Number.isNaN(v)) as number[]
        if (storePriceValues.length > 0) {
          const minPrice = Math.min(...storePriceValues)
          const maxPrice = Math.max(...storePriceValues)
          if (minPrice > 0 && maxPrice > 0) {
            storePriceRange =
              minPrice === maxPrice
                ? `${minPrice.toFixed(2)}`
                : `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}`
          }
        }
      }

      if (supplementalProducts.length > 0) {
        const supplementalItems = supplementalProducts
          .filter((p: any) => !p?.error)
          .map((p: any) => ({
            name: p.productName || p.name,
            price: p.productPrice || p.price,
            rating: p.rating,
            reviewCount: p.reviewCount,
            features: Array.isArray(p.productFeatures) ? p.productFeatures : [],
          }))
          .filter((p: any) => Boolean(p.name))

        const supplementalNames = supplementalItems
          .map((p: any) => formatSupplementalName(p.name))
          .filter(Boolean)

        if (supplementalNames.length > 0) {
          topProducts = [...topProducts, ...supplementalNames].slice(0, 5)
        }

        const supplementalFeatured = Array.from(new Set(supplementalNames)).slice(0, 3)
        if (supplementalFeatured.length > 0) {
          extras.push(`SUPPLEMENTAL PICKS: ${supplementalFeatured.join(', ')}`)
        }

        const supplementalHooks = supplementalItems.slice(0, 3).map((item: any) => {
          const name = formatSupplementalName(item.name)
          const featureBits = (item.features || [])
            .map((f: string) => formatSupplementalFeature(f))
            .filter(Boolean)
            .slice(0, 2)
          const valueBits: string[] = []
          if (item.rating) valueBits.push(`${item.rating}★`)
          if (item.reviewCount) valueBits.push(`${item.reviewCount} reviews`)
          if (item.price) valueBits.push(item.price)
          if (featureBits.length > 0) {
            return `${name}: ${featureBits.join(' | ')}`
          }
          if (valueBits.length > 0) {
            return `${name}: ${valueBits.join(', ')}`
          }
          return name
        })
        if (supplementalHooks.length > 0) {
          supplementalHookLines.push(...supplementalHooks)
          extras.push(`SUPPLEMENTAL HOOKS: ${supplementalHooks.join(' || ')}`)
        }

        // 收集可验证事实（仅单品链接来源）
        supplementalItems.slice(0, 3).forEach((item: any) => {
          const name = formatSupplementalName(item.name)
          if (item.price)
            supplementalVerifiedFacts.push(`- SUPPLEMENTAL ${name} PRICE: ${item.price}`)
          if (item.rating)
            supplementalVerifiedFacts.push(`- SUPPLEMENTAL ${name} RATING: ${item.rating}`)
          if (item.reviewCount)
            supplementalVerifiedFacts.push(
              `- SUPPLEMENTAL ${name} REVIEW COUNT: ${item.reviewCount}`
            )
        })

        const supplementalPriceValues = supplementalItems
          .map((p: any) => parsePrice(p?.price))
          .filter((v: any) => typeof v === 'number' && !Number.isNaN(v)) as number[]
        const storePriceValues = Array.isArray(scrapedData.products)
          ? (scrapedData.products
              .map((p: any) => parsePrice(p?.price))
              .filter((v: any) => typeof v === 'number' && !Number.isNaN(v)) as number[])
          : []
        const allPriceValues = [...supplementalPriceValues, ...storePriceValues]
        if (allPriceValues.length > 0) {
          const minPrice = Math.min(...allPriceValues)
          const maxPrice = Math.max(...allPriceValues)
          if (minPrice > 0 && maxPrice > 0) {
            storePriceRange =
              minPrice === maxPrice
                ? `${minPrice.toFixed(2)}`
                : `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}`
          }
        }
      }
    } catch {}
  }

  if (storePriceRange) {
    extras.push(`STORE PRICE RANGE: ${storePriceRange}`)
  }
  // 如果是Store页面，添加热销洞察到Prompt
  if (hotInsights && topProducts.length > 0) {
    extras.push(
      `STORE HOT PRODUCTS: ${topProducts.slice(0, 3).join(', ')} (Avg: ${hotInsights.avgRating.toFixed(1)} stars, ${hotInsights.avgReviews} reviews)`
    )
  }

  // 🔥 2025-12-10优化：添加销售热度数据到Prompt（强社会证明信号）
  if (storeSalesVolumes.length > 0) {
    extras.push(`🔥 SALES MOMENTUM: ${storeSalesVolumes.join(' | ')}`)
  }

  // 🔥 2025-12-10优化：添加折扣数据到Prompt（促销信号）
  if (storeDiscounts.length > 0) {
    extras.push(`ACTIVE DISCOUNTS: ${storeDiscounts.join(', ')}`)
  }

  // 🔥 v4.1优化（2025-12-09）：提取店铺深度抓取数据
  let storeAggregatedReviews: string[] = []
  let storeAggregatedFeatures: string[] = []
  let storeHotBadges: string[] = []
  let storeCategoryKeywords: string[] = []

  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)

      // 1. 提取深度抓取的聚合数据
      if (scrapedData.deepScrapeResults) {
        const dsr = scrapedData.deepScrapeResults
        storeAggregatedReviews = dsr.aggregatedReviews || []
        storeAggregatedFeatures = dsr.aggregatedFeatures || []

        // 从热销商品提取徽章
        if (dsr.topProducts && Array.isArray(dsr.topProducts)) {
          dsr.topProducts.forEach((tp: any) => {
            if (tp.productData?.badge) {
              storeHotBadges.push(tp.productData.badge)
            }
          })
          storeHotBadges = [...new Set(storeHotBadges)] // 去重
        }
      }

      // 2. 提取产品分类作为关键词来源
      if (scrapedData.productCategories?.primaryCategories) {
        storeCategoryKeywords = scrapedData.productCategories.primaryCategories
          .slice(0, 5)
          .map((c: any) => c.name)
          .filter(Boolean)
      }

      // 3. 从热销商品提取徽章（备选路径）
      if (storeHotBadges.length === 0 && scrapedData.products) {
        scrapedData.products.forEach((p: any) => {
          if (p.badge) storeHotBadges.push(p.badge)
        })
        storeHotBadges = [...new Set(storeHotBadges)].slice(0, 3)
      }

      if (supplementalProducts.length > 0) {
        const supplementalFeatures = supplementalProducts
          .flatMap((p: any) => (Array.isArray(p.productFeatures) ? p.productFeatures : []))
          .filter(Boolean)
        const supplementalReviews = supplementalProducts
          .flatMap((p: any) => (Array.isArray(p.reviewHighlights) ? p.reviewHighlights : []))
          .filter(Boolean)
        const supplementalTopReviews = supplementalProducts
          .flatMap((p: any) => (Array.isArray(p.topReviews) ? p.topReviews : []))
          .filter(Boolean)
        const supplementalCategories = supplementalProducts
          .map((p: any) => p.category)
          .filter(Boolean)

        if (supplementalFeatures.length > 0) {
          storeAggregatedFeatures = [...storeAggregatedFeatures, ...supplementalFeatures]
        }
        if (supplementalReviews.length > 0 || supplementalTopReviews.length > 0) {
          storeAggregatedReviews = [
            ...storeAggregatedReviews,
            ...supplementalReviews,
            ...supplementalTopReviews,
          ]
        }
        if (supplementalCategories.length > 0) {
          storeCategoryKeywords = [...storeCategoryKeywords, ...supplementalCategories]
        }
      }
    } catch {}
  }

  // 添加店铺深度数据到extras
  if (storeAggregatedFeatures.length > 0) {
    extras.push(`STORE HOT FEATURES: ${storeAggregatedFeatures.slice(0, 8).join(' | ')}`)
  }
  if (storeAggregatedReviews.length > 0) {
    extras.push(`STORE USER VOICES: ${storeAggregatedReviews.slice(0, 5).join(' | ')}`)
  }
  if (storeHotBadges.length > 0) {
    extras.push(`STORE TRUST BADGES: ${storeHotBadges.join(', ')}`)
  }
  if (storeCategoryKeywords.length > 0) {
    extras.push(`STORE CATEGORIES: ${storeCategoryKeywords.join(', ')}`)
  }

  if (linkType === 'store') {
    const uniqueClaims = [...new Set(storeDescriptionClaims)]
    uniqueClaims.forEach((claim) => supplementalVerifiedFacts.push(`- STORE CLAIM: ${claim}`))
    storePriceSamples.slice(0, 2).forEach((sample) => {
      const name = formatSupplementalName(sample.name)
      if (name && sample.price) {
        supplementalVerifiedFacts.push(`- STORE ITEM PRICE: ${name} ${sample.price}`)
      }
    })
    if (storePriceRange) {
      supplementalVerifiedFacts.push(`- STORE PRICE RANGE: ${storePriceRange}`)
    }
  }

  // 🆕 多单品卖点混合（店铺模式）：强约束提示
  if (linkType === 'store' && supplementalHookLines.length > 0) {
    const hooksList = supplementalHookLines
      .slice(0, 6)
      .map((h) => `- ${h}`)
      .join('\n')
    store_creative_instructions += `

### 🧩 多单品卖点混合（必须）
- 必须混合使用不同单品的卖点（至少覆盖 2 个不同单品）
- 至少 2 条 headlines 或 descriptions 需直接体现单品卖点/特色（可使用短名）
- 价格/评分只能使用 VERIFIED FACTS 中列出的数字

**可用单品卖点库（混合引用）**:
${hooksList}
`
  }

  // 🎯 v3.2优化（2025-12-08）：读取v3.2差异化分析数据
  let v32Analysis: {
    storeQualityLevel?: string
    categoryDiversification?: { level: string; categories?: string[]; primaryCategory?: string }
    hotInsights?: {
      avgRating?: number
      avgReviews?: number
      topProductsCount?: number
      bestSeller?: string
      priceRange?: { min: number; max: number }
    }
    marketFit?: { score: number; level: string; strengths?: string[]; gaps?: string[] }
    credibilityLevel?: { score: number; level: string; factors?: string[] }
    categoryPosition?: { rank?: string; percentile?: number; competitors?: number }
    pageType?: 'store' | 'product'
  } | null = null

  // 🔧 修复(2025-12-31): 使用 safeParseJson 处理 PostgreSQL jsonb 字段
  if (offer.ai_analysis_v32) {
    v32Analysis = safeParseJson(offer.ai_analysis_v32)
    if (v32Analysis) {
      console.log(`[AdCreativeGenerator] 🎯 使用v3.2分析数据: pageType=${v32Analysis?.pageType}`)
    }
  }

  // 店铺页面特殊处理（v3.2增强）
  if (v32Analysis?.pageType === 'store') {
    // 店铺质量等级
    if (v32Analysis.storeQualityLevel) {
      extras.push(`STORE QUALITY: ${v32Analysis.storeQualityLevel} Tier`)
    }
    // 分类多样化
    if (v32Analysis.categoryDiversification) {
      const catDiv = v32Analysis.categoryDiversification
      extras.push(
        `CATEGORY FOCUS: ${catDiv.level}${catDiv.primaryCategory ? ` - Primary: ${catDiv.primaryCategory}` : ''}`
      )
      if (catDiv.categories && catDiv.categories.length > 0) {
        extras.push(`PRODUCT RANGE: ${catDiv.categories.slice(0, 4).join(', ')}`)
      }
    }
    // 增强热销洞察
    if (v32Analysis.hotInsights) {
      const hi = v32Analysis.hotInsights
      if (hi.bestSeller) {
        extras.push(`BEST SELLER: ${hi.bestSeller}`)
      }
      if (hi.priceRange) {
        extras.push(`PRICE RANGE: $${hi.priceRange.min} - $${hi.priceRange.max}`)
      }
    }
  }

  // 单品页面特殊处理（v3.2增强）
  if (v32Analysis?.pageType === 'product') {
    // 市场契合度
    if (v32Analysis.marketFit) {
      const mf = v32Analysis.marketFit
      extras.push(`MARKET FIT: ${mf.level} (${mf.score}/100)`)
      if (mf.strengths && mf.strengths.length > 0) {
        extras.push(`PRODUCT STRENGTHS: ${mf.strengths.slice(0, 3).join(', ')}`)
      }
    }
    // 可信度评级
    if (v32Analysis.credibilityLevel) {
      const cl = v32Analysis.credibilityLevel
      extras.push(`CREDIBILITY: ${cl.level} (${cl.score}/100)`)
      if (cl.factors && cl.factors.length > 0) {
        extras.push(`TRUST FACTORS: ${cl.factors.slice(0, 3).join(', ')}`)
      }
    }
    // 品类排名
    if (v32Analysis.categoryPosition) {
      const cp = v32Analysis.categoryPosition
      if (cp.rank) {
        extras.push(`CATEGORY RANK: ${cp.rank}`)
      }
      if (cp.percentile) {
        extras.push(`TOP ${100 - cp.percentile}% IN CATEGORY`)
      }
    }
  }

  // 🔥 P0优化：竞品分析数据（差异化定位关键）
  if (offer.competitor_analysis) {
    try {
      const compAnalysis = JSON.parse(offer.competitor_analysis)

      // 1. 价格定位营销标签（🔥 v4.2优化：完整价格区间定位）
      if (compAnalysis.pricePosition) {
        const pricePos = compAnalysis.pricePosition
        // 价格节省信息
        if (pricePos.savingsVsAvg) {
          extras.push(`COMPETITIVE PRICE: ${pricePos.savingsVsAvg}`)
        }
        // 🔥 新增：完整价格区间营销标签
        switch (pricePos.priceAdvantage) {
          case 'lowest':
            extras.push(`MARKET POSITION: [BEST VALUE] Lowest priced in category`)
            break
          case 'below_average':
            const percentile = pricePos.pricePercentile || 0
            extras.push(`MARKET POSITION: [VALUE PICK] Top ${percentile}% most affordable`)
            break
          case 'average':
            extras.push(`MARKET POSITION: [BALANCED] Competitive price with quality features`)
            break
          case 'above_average':
            extras.push(`MARKET POSITION: [QUALITY] Premium features at fair price`)
            break
          case 'premium':
            extras.push(`MARKET POSITION: [FLAGSHIP] Top-tier quality and performance`)
            break
        }
      }

      // 🔥 新增：评分优势营销标签
      if (compAnalysis.ratingPosition) {
        const ratingPos = compAnalysis.ratingPosition
        switch (ratingPos.ratingAdvantage) {
          case 'top_rated':
            extras.push(
              `RATING ADVANTAGE: [TOP RATED] Highest customer satisfaction (${ratingPos.ourRating} stars)`
            )
            break
          case 'above_average':
            extras.push(
              `RATING ADVANTAGE: [HIGHLY RATED] Above average at ${ratingPos.ourRating} stars`
            )
            break
        }
      }

      // 2. 独特卖点（竞品没有的优势）
      if (compAnalysis.uniqueSellingPoints && compAnalysis.uniqueSellingPoints.length > 0) {
        const highSignificanceUSPs = compAnalysis.uniqueSellingPoints
          .filter((u: any) => u.significance === 'high')
          .map((u: any) => u.usp)
        if (highSignificanceUSPs.length > 0) {
          extras.push(`UNIQUE ADVANTAGES: ${highSignificanceUSPs.join('; ')}`)
        }
      }

      // 3. 如何应对竞品优势（定位策略）
      if (compAnalysis.competitorAdvantages && compAnalysis.competitorAdvantages.length > 0) {
        const counterStrategies = compAnalysis.competitorAdvantages
          .slice(0, 2) // 只取前2个最重要的
          .map((a: any) => a.howToCounter)
        if (counterStrategies.length > 0) {
          extras.push(`POSITIONING STRATEGY: ${counterStrategies.join('; ')}`)
        }
      }

      // 4. 我们有且竞品也有的功能（强化竞争力）
      if (compAnalysis.featureComparison && compAnalysis.featureComparison.length > 0) {
        const ourAdvantages = compAnalysis.featureComparison
          .filter((f: any) => f.weHave && f.ourAdvantage)
          .map((f: any) => f.feature)
        if (ourAdvantages.length > 0) {
          extras.push(`COMPETITIVE FEATURES: ${ourAdvantages.slice(0, 3).join(', ')}`)
        }
      }

      // 🔥 v3.2新增：竞品弱点（转化为我们的差异化卖点）
      // 这是最有说服力的广告素材 - 直接点出竞品问题，暗示我们解决了这些问题
      if (compAnalysis.competitorWeaknesses && compAnalysis.competitorWeaknesses.length > 0) {
        // 提取高频竞品弱点的adCopy
        const highFreqWeaknesses = compAnalysis.competitorWeaknesses
          .filter((w: any) => w.frequency === 'high' || w.frequency === 'medium')
          .slice(0, 3)
          .map((w: any) => w.adCopy)
          .filter((ad: string) => ad && ad.length > 0)
        if (highFreqWeaknesses.length > 0) {
          extras.push(
            `COMPETITOR WEAKNESSES (use to differentiate): ${highFreqWeaknesses.join(' | ')}`
          )
        }

        // 单独提取详细弱点描述，用于更深度的广告创意
        const weaknessDetails = compAnalysis.competitorWeaknesses
          .slice(0, 2)
          .map((w: any) => `${w.weakness} → We offer: ${w.ourAdvantage}`)
        if (weaknessDetails.length > 0) {
          extras.push(`AVOID COMPETITOR ISSUES: ${weaknessDetails.join(' | ')}`)
        }
      }

      // 🔥 v4.1优化：提取竞品特性用于差异化关键词
      if (compAnalysis.competitors && Array.isArray(compAnalysis.competitors)) {
        // 收集所有竞品特性
        const competitorFeatures: string[] = []
        compAnalysis.competitors.forEach((comp: any) => {
          if (comp.features && Array.isArray(comp.features)) {
            competitorFeatures.push(...comp.features.slice(0, 3))
          }
        })
        // 去重并取前10个
        const uniqueCompFeatures = [...new Set(competitorFeatures)].slice(0, 10)
        if (uniqueCompFeatures.length > 0) {
          extras.push(
            `COMPETITOR FEATURES (for differentiation): ${uniqueCompFeatures.join(' | ')}`
          )
        }
      }

      console.log('✅ 已加载竞品分析数据到Prompt')
    } catch (parseError: any) {
      console.warn('⚠️ 解析竞品分析数据失败（非致命错误）:', parseError.message)
    }
  }

  // 🔥 2026-01-04新增：处理独立站增强数据字段（reviews、faqs、specifications、packages、socialProof等）
  // 这些数据从scraped_data中提取，用于增强广告创意生成
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)

      // 1. User Reviews（真实用户评论）
      if (
        scrapedData.reviews &&
        Array.isArray(scrapedData.reviews) &&
        scrapedData.reviews.length > 0
      ) {
        const reviewSummaries = scrapedData.reviews
          .slice(0, 5)
          .map(
            (r: any) =>
              `${r.rating}★ - ${r.author}: ${r.title}${r.body ? `. ${r.body.substring(0, 80)}${r.body.length > 80 ? '...' : ''}` : ''}`
          )
        extras.push(`REAL USER REVIEWS: ${reviewSummaries.join(' | ')}`)

        // 从评论中提取用户常用表达模式
        const userPhrases: string[] = []
        scrapedData.reviews.slice(0, 5).forEach((r: any) => {
          if (r.body) {
            const patterns = [
              /very ([\w\s]+)/gi,
              /really ([\w\s]+)/gi,
              /love(s?)( the)?/gi,
              /great ([\w\s]+)/gi,
              /perfect for/gi,
              /easy to/gi,
              /highly recommend/gi,
            ]
            patterns.forEach((pattern) => {
              const matches = r.body.match(pattern)
              if (matches) {
                matches.slice(0, 2).forEach((m: string) => {
                  const cleaned = m.toLowerCase().trim().substring(0, 25)
                  if (cleaned.length > 5) userPhrases.push(cleaned)
                })
              }
            })
          }
        })
        const uniquePhrases = [...new Set(userPhrases)].slice(0, 5)
        if (uniquePhrases.length > 0) {
          extras.push(`USER LANGUAGE PATTERNS: ${uniquePhrases.join(', ')}`)
        }
      }

      // 2. FAQs（常见问题）
      if (scrapedData.faqs && Array.isArray(scrapedData.faqs) && scrapedData.faqs.length > 0) {
        // 将FAQ转化为广告创意素材：回答用户关心的问题
        const faqHighlights = scrapedData.faqs
          .slice(0, 4)
          .map(
            (f: any) => `Q: ${f.question.substring(0, 50)}${f.question.length > 50 ? '...' : ''}`
          )
        extras.push(`CUSTOMER FAQs: ${faqHighlights.join(' | ')}`)
      }

      // 3. Product Specifications（技术规格）
      if (scrapedData.specifications && typeof scrapedData.specifications === 'object') {
        const specEntries = Object.entries(scrapedData.specifications).slice(0, 5)
        if (specEntries.length > 0) {
          const specStr = specEntries.map(([k, v]) => `${k}: ${v}`).join(', ')
          extras.push(`TECH SPECS: ${specStr}`)
        }
      }

      // 4. Package Options（套餐选项）
      if (
        scrapedData.packages &&
        Array.isArray(scrapedData.packages) &&
        scrapedData.packages.length > 0
      ) {
        const packageInfo = scrapedData.packages
          .slice(0, 3)
          .map(
            (p: any) =>
              `${p.name || 'Package'}${p.price ? ` (${p.price})` : ''}: ${(p.includes || []).slice(0, 3).join(', ')}`
          )
        extras.push(`PACKAGE OPTIONS: ${packageInfo.join(' | ')}`)
      }

      // 5. Social Proof（社会证明）
      if (
        scrapedData.socialProof &&
        Array.isArray(scrapedData.socialProof) &&
        scrapedData.socialProof.length > 0
      ) {
        const socialMetrics = scrapedData.socialProof
          .map((sp: any) => `${sp.metric}: ${sp.value}`)
          .join(' | ')
        extras.push(`SOCIAL PROOF METRICS: ${socialMetrics}`)
      }

      // 6. Core Features（核心卖点）
      if (
        scrapedData.coreFeatures &&
        Array.isArray(scrapedData.coreFeatures) &&
        scrapedData.coreFeatures.length > 0
      ) {
        extras.push(`CORE FEATURES: ${scrapedData.coreFeatures.slice(0, 5).join(', ')}`)
      }

      // 7. Secondary Features（次要特性）
      if (
        scrapedData.secondaryFeatures &&
        Array.isArray(scrapedData.secondaryFeatures) &&
        scrapedData.secondaryFeatures.length > 0
      ) {
        extras.push(`ADDITIONAL FEATURES: ${scrapedData.secondaryFeatures.slice(0, 5).join(', ')}`)
      }

      console.log('✅ 已加载独立站增强数据到Prompt')
    } catch (parseError: any) {
      console.warn('⚠️ 解析独立站增强数据失败（非致命错误）:', parseError.message)
    }
  }

  // 🎯 P0优化（2025-12-07）：利用新增AI数据字段
  let aiKeywords: string[] = []
  let aiCompetitiveEdges: any = null
  let aiReviews: any = null

  // 🔧 修复(2025-12-31): 使用 safeParseJson 处理 PostgreSQL jsonb 字段
  // 读取AI增强的关键词数据
  if (offer.ai_keywords) {
    aiKeywords = safeParseJson(offer.ai_keywords, [])
    if (Array.isArray(aiKeywords)) {
      console.log(`[AdCreativeGenerator] 🎯 使用AI生成关键词: ${aiKeywords.length}个`)
    } else {
      aiKeywords = []
    }
  }

  // 读取AI竞争优势数据
  if (offer.ai_competitive_edges) {
    aiCompetitiveEdges = safeParseJson(offer.ai_competitive_edges, null)
    if (aiCompetitiveEdges) {
      console.log(`[AdCreativeGenerator] 🏆 使用AI竞争优势数据:`, aiCompetitiveEdges)
    }
  }

  // 读取AI评论洞察数据
  if (offer.ai_reviews) {
    aiReviews = safeParseJson(offer.ai_reviews, null)
    if (aiReviews) {
      console.log(
        `[AdCreativeGenerator] ⭐ 使用AI评论洞察: rating=${aiReviews.rating}, sentiment=${aiReviews.sentiment}`
      )
    }
  }

  const precomputedKeywordSet = runtimeGuidance?.precomputedKeywordSet || null
  const keywordUsagePlan = buildCreativeKeywordUsagePlan({
    brandName: offer.brand,
    precomputedKeywordSet,
  })

  const promptKeywordPlan = resolveAdCreativePromptKeywordPlan({
    extractedKeywords:
      Array.isArray(precomputedKeywordSet?.keywordsWithVolume) &&
      precomputedKeywordSet.keywordsWithVolume.length > 0
        ? precomputedKeywordSet.keywordsWithVolume
        : extractedElements?.keywords,
    aiKeywords,
    titleAboutKeywordSeeds: titleAndAboutSignals.keywordSeeds || [],
    offerBrand: offer.brand,
    targetLanguage,
    policyGuardMode,
  })

  if (promptKeywordPlan.policyMatchedTerms.length > 0) {
    console.log(
      `[PolicyGuard] Prompt关键词净化: 命中${promptKeywordPlan.policyMatchedTerms.length}个敏感词`
    )
  }

  const promptRuleContext = createCreativeRuleContext({
    brandName: offer.brand,
    category: offer.category,
    productName: rawProductName,
    productTitle: rawProductTitle,
    productDescription: rawProductDescription,
    uniqueSellingPoints: rawUniqueSellingPoints,
    keywords: promptKeywordPlan.promptKeywords,
    targetLanguage,
  })

  // Build extras_data section（去噪，避免无关维修/工具类噪声污染Prompt）
  const filteredExtrasResult = filterPromptExtrasByRelevance(extras, promptRuleContext)
  if (filteredExtrasResult.removed.length > 0) {
    console.warn(
      `🧹 Prompt extras 去噪: 移除 ${filteredExtrasResult.removed.length} 条疑似离题片段`
    )
  }
  variables.extras_data = filteredExtrasResult.filtered.length
    ? '\n' + filteredExtrasResult.filtered.join(' | ') + '\n'
    : ''

  // ✅ VERIFIED FACTS（仅允许使用这些可验证信息；为空则不要写数字/承诺）
  // 只使用“产品数据”来源，避免把prompt中的示例数字误当作证据
  const verifiedFacts: string[] = []
  if (priceEvidenceBlocked) {
    verifiedFacts.push(
      '- PRICE EVIDENCE BLOCKED: Conflicting price signals detected. Do NOT mention any exact price amount.'
    )
  }
  const verifiedPrimaryProduct = formatSupplementalName(
    policySafeProductName.text || String(rawProductName || '')
  )
  if (verifiedPrimaryProduct) verifiedFacts.push(`- PRIMARY PRODUCT: ${verifiedPrimaryProduct}`)
  if (offer.category) verifiedFacts.push(`- PRIMARY CATEGORY: ${offer.category}`)
  if (currentPrice) verifiedFacts.push(`- PRICE: ${currentPrice}`)
  if (originalPrice) verifiedFacts.push(`- ORIGINAL PRICE: ${originalPrice}`)
  if (discount) verifiedFacts.push(`- DISCOUNT: ${discount}`)
  if (activePromotions.length > 0) {
    const p = activePromotions[0]
    verifiedFacts.push(
      `- PROMOTION: ${p.description}${p.code ? ` (Code: ${p.code})` : ''}${p.validUntil ? ` (Until: ${p.validUntil})` : ''}`
    )
  }
  if (salesRankForPrompt) verifiedFacts.push(`- SALES RANK: ${salesRankForPrompt}`)
  if (badge) verifiedFacts.push(`- BADGE: ${badge}`)
  if (availability) verifiedFacts.push(`- STOCK/AVAILABILITY: ${availability}`)
  if (primeEligible) verifiedFacts.push(`- PRIME/FAST SHIPPING: Yes`)
  if (totalReviews > 0) verifiedFacts.push(`- TOTAL REVIEWS: ${totalReviews}`)
  if (averageRating > 0) verifiedFacts.push(`- AVERAGE RATING: ${averageRating}`)
  if (linkType === 'store' && topProducts.length > 0) {
    verifiedFacts.push(
      `- VERIFIED HOT PRODUCTS: ${topProducts.slice(0, 3).map(formatSupplementalName).filter(Boolean).join(', ')}`
    )
  }
  if (supplementalVerifiedFacts.length > 0) {
    const filteredSupplementalFacts = filterPromptExtrasByRelevance(
      supplementalVerifiedFacts,
      promptRuleContext
    )
    if (filteredSupplementalFacts.removed.length > 0) {
      console.warn(
        `🧹 Verified facts 去噪: 移除 ${filteredSupplementalFacts.removed.length} 条疑似离题事实`
      )
    }
    verifiedFacts.push(...filteredSupplementalFacts.filtered.slice(0, 6))
  }
  if (quantitativeHighlights.length > 0) {
    verifiedFacts.push(
      `- QUANTITATIVE HIGHLIGHTS: ${quantitativeHighlights
        .slice(0, 3)
        .map((h) => `${h.metric}=${h.value}`)
        .join(', ')}`
    )
  }

  variables.verified_facts_section = verifiedFacts.length
    ? `\n## ✅ VERIFIED FACTS (Only use these claims; do NOT invent)\n${verifiedFacts.join('\n')}\n`
    : `\n## ✅ VERIFIED FACTS (Only use these claims; do NOT invent)\n- (No verified facts provided. Do NOT use numbers, discounts, or guarantees.)\n`
  const hasVerifiedFacts = verifiedFacts.length > 0
  const hasPromoEvidence = !!(
    discount ||
    activePromotions.length > 0 ||
    currentPrice ||
    originalPrice
  )
  const hasUrgencyEvidence = !!availability || activePromotions.some((p: any) => !!p?.validUntil)

  // 🔥 Build promotion_section（v2.1新增）
  let promotion_section = ''
  if (activePromotions.length > 0) {
    const mainPromo = activePromotions[0]
    promotion_section = `\n🔥 **CRITICAL PROMOTION EMPHASIS**:
This product has ${activePromotions.length} active promotion(s). YOU MUST highlight these in your creative:

**MAIN PROMOTION**: ${mainPromo.description}${mainPromo.code ? ` (Code: ${mainPromo.code})` : ''}
${mainPromo.validUntil ? `**VALID UNTIL**: ${mainPromo.validUntil}` : ''}
${mainPromo.conditions ? `**CONDITIONS**: ${mainPromo.conditions}` : ''}

**REQUIREMENTS**:
✅ Include promotion in at least 3-5 headlines (e.g., "20% Off Today", "Use Code ${mainPromo.code || 'SAVE20'}", "Limited Time Offer")
✅ Mention promotion in 2-3 descriptions with urgency (e.g., "Don't miss out", "Offer ends soon")
✅ Add promotion-related keywords (e.g., "discount", "sale", "promo code", "limited offer")
✅ Use callouts to emphasize savings (e.g., "20% Off First Order", "Free Shipping Available")
`

    if (activePromotions.length > 1) {
      const secondaryPromo = activePromotions[1]
      promotion_section += `\n**SECONDARY PROMOTION**: ${secondaryPromo.description}${secondaryPromo.code ? ` (Code: ${secondaryPromo.code})` : ''}\n`
    }

    promotion_section += `
**PROMOTION CREATIVE EXAMPLES**:
- Headline: "Get 20% Off - Use Code ${mainPromo.code || 'SAVE20'} | ${offer.brand}"
- Headline: "${offer.brand} - Limited Time Offer | Shop Now"
- Headline: "Save on ${offer.brand_description || offer.brand} - Deal Ends Soon"
- Description: "Shop now and save with code ${mainPromo.code || 'SAVE20'}. ${mainPromo.description}. Limited time!"
- Description: "${offer.brand_description || offer.brand} at special price. ${mainPromo.description}${offer.final_url ? '. Free shipping available.' : ''}"
- Callout: "${mainPromo.description}"
- Callout: "Limited Time Deal"

`
  }
  variables.promotion_section = promotion_section

  // Build theme_section
  let theme_section = ''
  if (theme) {
    theme_section = `\n**THEME: ${theme}** - All content must reflect this theme. 60%+ headlines should directly embody theme.\n`
  }
  variables.theme_section = theme_section

  // Build reference_performance_section
  let reference_performance_section = ''
  if (referencePerformance) {
    if (referencePerformance.best_headlines?.length) {
      reference_performance_section += `TOP HEADLINES: ${referencePerformance.best_headlines.slice(0, 3).join(', ')}\n`
    }
    if (referencePerformance.top_keywords?.length) {
      reference_performance_section += `TOP KEYWORDS: ${referencePerformance.top_keywords.slice(0, 5).join(', ')}\n`
    }
  }
  variables.reference_performance_section = reference_performance_section

  // 🎯 Build extracted_elements_section
  let extracted_elements_section = ''
  if (extractedElements) {
    if (titleAndAboutSignals.productTitle) {
      extracted_elements_section += `\n**EXTRACTED PRODUCT TITLE** (Amazon title, keep unique wording):\n"${truncateSnippetByWords(titleAndAboutSignals.productTitle, 180)}"\n`
    }

    if (titleAndAboutSignals.titlePhrases.length > 0) {
      extracted_elements_section += `\n**TITLE CORE PHRASES** (high-priority wording from title):\n${titleAndAboutSignals.titlePhrases.slice(0, 6).join(' | ')}\n`
    }

    if (titleAndAboutSignals.aboutClaims.length > 0) {
      extracted_elements_section += `\n**ABOUT THIS ITEM CORE CLAIMS** (high-priority wording from bullets):\n${titleAndAboutSignals.aboutClaims.slice(0, 6).join(' | ')}\n`
    }

    if (extractedElements.keywords && extractedElements.keywords.length > 0) {
      // 🔧 调整(2026-02-03): 将提取关键词数量限制在30个以内，避免Prompt噪声过高
      // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，保留searchVolume=0的关键词
      const promptBrandTokens = getPureBrandKeywords(offer.brand || '')
      const promptBrandKeywordCount = countBrandContainingKeywords(
        extractedElements.keywords
          .filter((k) => !!k?.keyword)
          .map((k) => ({ keyword: k.keyword, searchVolume: k.searchVolume })),
        offer.brand || '',
        promptBrandTokens
      )
      const promptDynamicNonBrandMinSearchVolume =
        resolveNonBrandMinSearchVolumeByBrandKeywordCount(promptBrandKeywordCount)
      const hasAnyVolume = extractedElements.keywords.some((k) => k.searchVolume > 0)
      const promptVolumeUnavailable = extractedElements.keywords.some((k: any) =>
        isSearchVolumeUnavailableReason(k?.volumeUnavailableReason)
      )
      const topKeywords = extractedElements.keywords
        .filter((k) => {
          if (!hasAnyVolume || promptVolumeUnavailable) return true
          const keywordText = String(k.keyword || '')
          const isBrandKeyword =
            containsPureBrand(keywordText, promptBrandTokens) ||
            isBrandConcatenation(keywordText, offer.brand || '')
          if (isBrandKeyword) return true
          return k.searchVolume >= promptDynamicNonBrandMinSearchVolume
        })
        .slice(0, 30)
        .map((k) =>
          k.searchVolume > 0 ? `"${k.keyword}" (${k.searchVolume}/mo)` : `"${k.keyword}"`
        )
      if (topKeywords.length > 0) {
        extracted_elements_section += `\n**EXTRACTED KEYWORDS** (from product data, validated by Keyword Planner):\n${topKeywords.join(', ')}\n`
      }
    }

    if (extractedElements.headlines && extractedElements.headlines.length > 0) {
      extracted_elements_section += `\n**EXTRACTED HEADLINES** (from product titles, ≤30 chars):\n${extractedElements.headlines.slice(0, 5).join(', ')}\n`
    }

    if (extractedElements.descriptions && extractedElements.descriptions.length > 0) {
      extracted_elements_section += `\n**EXTRACTED DESCRIPTIONS** (from product features, ≤90 chars):\n${extractedElements.descriptions.slice(0, 2).join('; ')}\n`
    }

    if (titleAndAboutSignals.calloutIdeas.length > 0) {
      extracted_elements_section += `\n**ABOUT-DERIVED CALLOUT IDEAS** (≤25 chars style):\n${titleAndAboutSignals.calloutIdeas.slice(0, 6).join(', ')}\n`
    }

    if (titleAndAboutSignals.sitelinkIdeas.length > 0) {
      const sitelinkHints = titleAndAboutSignals.sitelinkIdeas
        .slice(0, 6)
        .map((item) => `${item.text} - ${item.description}`)
      extracted_elements_section += `\n**ABOUT-DERIVED SITELINK IDEAS** (text/desc style):\n${sitelinkHints.join(' | ')}\n`
    }

    // 🔥 独立站增强：从extraction_metadata中读取SERP补充的callout/sitelink（如果有）
    const extractionMetadata = safeParseJson((offer as any).extraction_metadata, null)
    const serpCalloutsRaw = Array.isArray(extractionMetadata?.serpCallouts)
      ? extractionMetadata.serpCallouts
      : Array.isArray(extractionMetadata?.brandSearchSupplement?.extracted?.callouts)
        ? extractionMetadata.brandSearchSupplement.extracted.callouts
        : []
    const serpSitelinksRaw = Array.isArray(extractionMetadata?.serpSitelinks)
      ? extractionMetadata.serpSitelinks
      : Array.isArray(extractionMetadata?.brandSearchSupplement?.extracted?.sitelinks)
        ? extractionMetadata.brandSearchSupplement.extracted.sitelinks
        : []

    const serpCallouts = serpCalloutsRaw
      .filter((c: any) => typeof c === 'string' && c.trim().length > 0)
      .map((c: string) => c.trim())
      .slice(0, 6)
    if (serpCallouts.length > 0) {
      extracted_elements_section += `\n**EXTRACTED CALLOUTS** (from Google SERP/official site):\n${serpCallouts.join(', ')}\n`
    }

    const serpSitelinks = serpSitelinksRaw
      .filter((s: any) => s && typeof s.text === 'string' && s.text.trim().length > 0)
      .map((s: any) => {
        const text = String(s.text).trim()
        const desc = s.description ? String(s.description).trim() : ''
        return desc ? `${text} - ${desc}` : text
      })
      .slice(0, 6)
    if (serpSitelinks.length > 0) {
      extracted_elements_section += `\n**EXTRACTED SITELINK IDEAS** (from official site):\n${serpSitelinks.join(' | ')}\n`
    }

    extracted_elements_section += `\n**INSTRUCTION**: Use above extracted elements as reference. You can refine or expand them, but prioritize extracted keywords with search volume. TITLE CORE PHRASES and ABOUT THIS ITEM CORE CLAIMS are high-priority context for headlines, descriptions, callouts and sitelinks. For keywords, only use high-intent phrases as supplemental hints.\n`
  }
  variables.extracted_elements_section = extracted_elements_section

  // 🔧 v4.36: 移除了 primary_keyword 变量设置
  // 原因：已取消强制Headline #2使用DKI格式，此变量不再需要

  // 🔧 P0修复（2025-12-08）：添加缺失的section变量赋值
  variables.enhanced_features_section = enhanced_features_section
  variables.localization_section = localization_section
  variables.brand_analysis_section = brand_analysis_section

  // Build all dynamic guidance sections
  variables.headline_brand_guidance = buildHeadlineBrandGuidance(
    badge,
    featuredSalesRank,
    offer,
    hotInsights,
    topProducts,
    sentimentDistribution,
    averageRating
  )
  variables.headline_feature_guidance = buildHeadlineFeatureGuidance(
    technicalDetails,
    reviewHighlights,
    commonPraises,
    topPositiveKeywords,
    featureSource
  )
  variables.headline_promo_guidance = buildHeadlinePromoGuidance(
    discount,
    activePromotions,
    hasPromoEvidence,
    priceEvidenceBlocked
  )
  variables.headline_cta_guidance = buildHeadlineCTAGuidance(primeEligible, purchaseReasons)
  variables.headline_urgency_guidance = buildHeadlineUrgencyGuidance(
    availability,
    hasUrgencyEvidence
  )

  variables.description_1_guidance = buildDescription1Guidance(badge, featuredSalesRank)
  variables.description_2_guidance = buildDescription2Guidance(primeEligible, activePromotions)
  variables.description_3_guidance = buildDescription3Guidance(useCases, userProfiles)
  variables.description_4_guidance = buildDescription4Guidance(
    topReviews,
    hotInsights,
    topProducts,
    sentimentDistribution,
    totalReviews,
    averageRating
  )

  // 优先使用AI增强数据，fallback到原有数据
  variables.review_data_summary = buildReviewDataSummary(
    reviewHighlights,
    commonPraises,
    topPositiveKeywords,
    commonPainPoints,
    aiReviews
  )

  variables.callout_guidance = buildCalloutGuidance(
    salesRankForPrompt,
    primeEligible,
    availability,
    badge,
    activePromotions,
    hasVerifiedFacts
  )
  const searchTermFeedbackGuidance = buildSearchTermFeedbackGuidanceSection(
    runtimeGuidance?.searchTermFeedbackHints
  )
  const excludeKeywordLines: string[] = []
  const retainedKeywordProtectionSet = new Set(
    keywordUsagePlan.retainedNonBrandKeywords
      .map((keyword) => normalizeGoogleAdsKeyword(keyword))
      .filter(Boolean) as string[]
  )
  const filteredExcludeKeywords = Array.isArray(excludeKeywords)
    ? excludeKeywords.filter((keyword) => {
        const normalized = normalizeGoogleAdsKeyword(String(keyword || ''))
        return normalized ? !retainedKeywordProtectionSet.has(normalized) : false
      })
    : []
  if (filteredExcludeKeywords.length > 0) {
    excludeKeywordLines.push(`- 已用关键词: ${filteredExcludeKeywords.slice(0, 10).join(', ')}`)
  }
  if (searchTermFeedbackGuidance.hardTerms.length > 0) {
    excludeKeywordLines.push(`- 搜索词硬排除: ${searchTermFeedbackGuidance.hardTerms.join(', ')}`)
  }
  if (searchTermFeedbackGuidance.softTerms.length > 0) {
    excludeKeywordLines.push(`- 搜索词软抑制: ${searchTermFeedbackGuidance.softTerms.join(', ')}`)
  }

  // 🎯 新增：AI关键词section
  const validatedKeywordsForPrompt = promptKeywordPlan.validatedPromptKeywords
  const titleAboutKeywordSeeds = promptKeywordPlan.contextualPromptKeywords
  const keywordsForPrompt = promptKeywordPlan.promptKeywords
  const policyMatchedTerms = Array.from(
    new Set([...policySignalTerms, ...promptKeywordPlan.policyMatchedTerms])
  ).slice(0, 12)
  if (policyMatchedTerms.length > 0) {
    excludeKeywordLines.push(`- 政策敏感词硬排除: ${policyMatchedTerms.join(', ')}`)
  }
  variables.exclude_keywords_section = excludeKeywordLines.join('\n')
  variables.retained_keyword_slot_section = buildRetainedKeywordSlotSection(keywordUsagePlan)

  if (keywordsForPrompt.length > 0) {
    let aiKeywordSection = `\n**关键词池（优先）**:\n${validatedKeywordsForPrompt.join(', ')}\n`
    if (titleAboutKeywordSeeds.length > 0) {
      aiKeywordSection += `\n**上下文短语（来自TITLE/ABOUT，仅补充，非搜索量验证，占比≤20%）**:\n${titleAboutKeywordSeeds.join(', ')}\n`
    }
    variables.ai_keywords_section = aiKeywordSection
    console.log(
      `[Prompt] 🔑 提供给AI的关键词数量: ${keywordsForPrompt.length}个 (主关键词${validatedKeywordsForPrompt.length} + 上下文补充${titleAboutKeywordSeeds.length})`
    )
  } else {
    variables.ai_keywords_section = ''
  }

  // 🆕 非破坏式A/B/D意图引导（仅作用于标题/描述表达）
  const normalizedPromptBucket = normalizeCreativeBucketType(extractedElements?.bucketInfo?.bucket)
  const creativeTypeConstraintSection = buildCreativeTypeConstraintSection({
    bucket: normalizedPromptBucket,
    linkType,
    brand: String(offer.brand || ''),
    category: String(offer.category || ''),
    productName: verifiedPrimaryProduct,
    targetCountry: String(offer.target_country || ''),
    targetLanguage,
    topProducts: topProducts.slice(0, 3).map(formatSupplementalName).filter(Boolean),
    keywords: keywordsForPrompt,
  })
  const typeIntentGuidanceSection = buildTypeIntentGuidanceSection(
    normalizedPromptBucket,
    keywordsForPrompt,
    normalizeLanguageCode(targetLanguage || 'English')
  )
  const personaScenarioGuidanceSection = buildPersonaScenarioGuidanceSection({
    bucket: normalizedPromptBucket,
    targetAudience: String(offer.target_audience || ''),
    useCases: Array.from(
      new Set([
        ...useCases,
        ...(extractedElements?.productInfo?.useCases || []).map((item: any) =>
          String(item || '').trim()
        ),
      ])
    )
      .filter(Boolean)
      .slice(0, 6),
    userProfiles,
    linkType,
  })
  const policyGuidanceSection = buildGoogleAdsPolicyPromptGuardrails(
    targetLanguage,
    policyMatchedTerms,
    { mode: policyGuardMode }
  )
  const retryFailureGuidanceSection = buildRetryFailureGuidanceSection(
    runtimeGuidance?.retryFailureType
  )
  variables.type_intent_guidance_section = [
    creativeTypeConstraintSection,
    typeIntentGuidanceSection,
    personaScenarioGuidanceSection,
    policyGuidanceSection,
    searchTermFeedbackGuidance.section,
    retryFailureGuidanceSection,
  ]
    .filter(Boolean)
    .join('\n')

  // 🎯 新增：AI竞争优势section
  let ai_competitive_section = ''
  if (aiCompetitiveEdges) {
    if (aiCompetitiveEdges.badges && aiCompetitiveEdges.badges.length > 0) {
      ai_competitive_section += `\n**产品认证/优势标识**: ${aiCompetitiveEdges.badges.join(', ')}\n`
    }
    if (aiCompetitiveEdges.primeEligible) {
      ai_competitive_section += `\n**物流优势**: Prime Eligible（快速配送）\n`
    }
    if (aiCompetitiveEdges.stockStatus) {
      ai_competitive_section += `\n**库存状态**: ${aiCompetitiveEdges.stockStatus}\n`
    }
    if (aiCompetitiveEdges.salesRank) {
      const aiSalesRankSignal = resolveCreativeSalesRankSignal(aiCompetitiveEdges.salesRank)
      if (aiSalesRankSignal.strongSignal && aiSalesRankSignal.raw) {
        ai_competitive_section += `\n**销售排名**: ${aiSalesRankSignal.raw}\n`
      } else if (aiSalesRankSignal.raw) {
        console.log(
          `[SalesRankGuard] Offer ${offer.id}: skip ai_competitive salesRank "${aiSalesRankSignal.raw}" (not top-tier)`
        )
      }
    }
  }
  variables.ai_competitive_section = ai_competitive_section

  // 🎯 新增：AI评论洞察section
  let ai_reviews_section = ''
  if (aiReviews) {
    if (aiReviews.rating) {
      ai_reviews_section += `\n**用户评分**: ${aiReviews.rating}/5.0`
      if (aiReviews.count) {
        ai_reviews_section += ` (${aiReviews.count}条评价)`
      }
    }
    if (aiReviews.sentiment) {
      ai_reviews_section += `\n**整体评价**: ${aiReviews.sentiment}`
    }
    if (aiReviews.positives && aiReviews.positives.length > 0) {
      ai_reviews_section += `\n**用户好评亮点**: ${aiReviews.positives.slice(0, 3).join(', ')}\n`
    }
    if (aiReviews.useCases && aiReviews.useCases.length > 0) {
      ai_reviews_section += `\n**主要使用场景**: ${aiReviews.useCases.slice(0, 2).join(', ')}\n`
    }
  }
  variables.ai_reviews_section = ai_reviews_section

  // Build competitive_guidance_section（保留原有逻辑，但增强AI数据）
  let competitive_guidance_section = ''
  if (offer.competitor_analysis) {
    try {
      const compAnalysis = JSON.parse(offer.competitor_analysis)
      competitive_guidance_section = buildCompetitiveGuidance(compAnalysis)
    } catch {}
  }
  variables.competitive_guidance_section = competitive_guidance_section

  // 🆕 v4.10: 添加关键词池桶相关变量
  // 这些变量名需要与 prompt 模板中的占位符匹配
  if (extractedElements?.bucketInfo) {
    const { bucket, intent, intentEn, keywordCount } = extractedElements.bucketInfo
    const kissBucket = normalizeCreativeBucketSlot(bucket) ?? bucket
    variables.bucket_type = kissBucket
    variables.bucket_intent = intent || intentEn || ''
    variables.bucket_info_section = `
**📦 当前创意桶：${kissBucket} - ${intent || intentEn}**
- 桶主题：${intent || intentEn}
- 预选关键词数量：${keywordCount}
- 文案风格要求：所有 Headlines 和 Descriptions 必须与"${intent || intentEn}"主题一致`
  } else {
    // 未使用关键词池时的默认值
    variables.bucket_type = ''
    variables.bucket_intent = ''
    variables.bucket_info_section = ''
  }
  // 兼容性：保留旧的占位符名称
  variables.keyword_bucket_section = keyword_bucket_section

  // 🆕 v4.16: 添加链接类型策略 section
  // 根据 offer.page_type 区分单品链接和店铺链接，使用不同的创意策略
  // 注意：linkType 已在第307行声明
  if (linkType === 'store') {
    variables.link_type_section = `
## 📍 当前链接类型：店铺页面 (Store Page)
**目标**：最大化进店，扩大品牌认知（KISS-3：A/B/D）

**类型与关键词侧重（用户可见）**:
| 类型 | 主题 | 关键词侧重 | 文案重点 |
|----|------|-----------|---------|
| A | 品牌意图 | 品牌词 + 商品/品类锚点 | 品牌背书 + 真实商品集合 + 可信度 |
| B | 热门商品型号/产品族 | 品牌 + 热门商品型号/产品族 + 品类长尾词 | 热门型号/产品族 + 购买动作 + 完全匹配 |
| D | 商品需求 | 品牌 + 品类 + 功能/场景/产品线词 | 商品需求覆盖 + 商品卖点 + CTA |

**兼容性**：历史桶 \`C→B\`、\`S→D\`（不要在输出中写 \`C/S\`）。

**核心要求**:
- 强调品牌官方地位和可信度
- 突出店铺热销产品和高评价
- 展示店铺的独特卖点和售后保障
- 有证据时使用店铺层面的社会证明（评分、评价数、销量）；禁止编造数字
`
  } else {
    // 默认：单品链接策略
    variables.link_type_section = `
## 📍 当前链接类型：产品页面 (Product Page)
**目标**：最大化转化，让用户购买这个具体产品（KISS-3：A/B/D）

**类型与关键词侧重（用户可见）**:
| 类型 | 主题 | 文案重点 |
|----|------|---------|
| A | 品牌意图 | 品牌背书 + 当前商品强相关 + 单品聚焦 |
| B | 商品型号/产品族 | 当前商品型号/产品族 + 品类长尾词 + 单品聚焦 |
| D | 商品需求 | 品牌 + 商品需求/功能/场景覆盖 + 明确CTA |

**兼容性**：历史桶 \`C→B\`、\`S→D\`（不要在输出中写 \`C/S\`）。

**核心要求**:
- 标题必须与具体产品相关联
- 至少 2 个标题包含具体产品型号或参数
- 有证据时描述可包含价格/折扣/限时等细节；禁止编造
- 禁止使用店铺化引导（如“explore our collection/store”）
`
  }

  // 🆕 v4.17: 添加链接类型相关变量到模板
  variables.link_type_instructions = link_type_instructions
  variables.store_creative_instructions = store_creative_instructions

  // 🆕 v4.17: 添加输出格式要求（解决AI返回非JSON格式问题）
  // 🔧 2026-01-02: 修复AI只返回1个关键词的问题，明确要求返回多个关键词
  variables.output_format_section = `
## 📋 OUTPUT (JSON only, no markdown):

{
  "copyAngle": "...",
  "headlines": [
    {"text": "...", "type": "brand", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta", "length": N}
  ],
  "keywords": ["keyword1", "keyword2", ...],
  "keywordCandidates": [
    {
      "text": "...",
      "sourceType": "...",
      "sourceField": "...",
      "anchorType": "...",
      "evidence": ["field path / product / search term evidence"],
      "suggestedMatchType": "EXACT|PHRASE|BROAD",
      "confidence": 0.0,
      "qualityReason": "...",
      "rejectionReason": "..."
    }
  ],
  "evidenceProducts": ["verified product / hot product names actually referenced"],
  "cannotGenerateReason": "...",
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**TYPE RULES (CRITICAL):**
- headlines[].type 必须是单一值，仅能从以下选一个：brand / feature / promo / cta / urgency / social_proof / question / emotional
- descriptions[].type 必须是单一值，仅能从以下选一个：feature-benefit-cta / problem-solution-proof / offer-urgency-trust / usp-differentiation
- 禁止使用“|”拼接多个类型

**STRICT COUNT REQUIREMENTS (MUST MATCH EXACTLY):**
- Headlines: EXACTLY 15 items, each ≤ 30 chars
- Descriptions: EXACTLY 4 items, each ≤ 90 chars
- Keywords: 10-20 items (no more than 20)
- Callouts: EXACTLY 6 items, each ≤ 25 chars
- Sitelinks: EXACTLY 6 items, text ≤ 25, description ≤ 35

**STRUCTURED METADATA RULES:**
- copyAngle / evidenceProducts / keywordCandidates / cannotGenerateReason are OPTIONAL but strongly recommended.
- evidenceProducts must only contain verified current product names or verified hot product names actually used in copy.
- keywordCandidates are audit metadata only; keywords[] remains the final executable keyword list.
- keywordCandidates should include sourceType / sourceField / anchorType / evidence / suggestedMatchType / confidence whenever available.
- If a candidate is weak or excluded, prefer populating rejectionReason instead of silently inventing stronger evidence.
- If verified product/model evidence is insufficient, return cannotGenerateReason instead of inventing unsupported models, series, functions, or product lines.
- Do not fabricate sourceType, sourceField, anchorType, evidence, suggestedMatchType, confidence, evidenceProducts, or cannotGenerateReason.

**IMPORTANT**: Return ONLY valid JSON. No explanations or markdown. All content must be in {{target_language}}.`

  // Substitute all placeholders and return
  return {
    prompt: substitutePlaceholders(promptTemplate, variables),
    promptKeywords: promptKeywordPlan.promptKeywords,
  }
}

export function buildHeadlineBrandGuidance(
  badge: string | null,
  featuredSalesRank: string | null,
  offer: any,
  hotInsights: any,
  topProducts: string[],
  sentimentDistribution: any,
  averageRating: number
): string {
  const rankHint = featuredSalesRank
    ? `Optional social proof: use SALES RANK only when truly top-tier (e.g., "${featuredSalesRank}")`
    : 'Do NOT invent ranking claims such as "#1" or "Best Seller" without strong evidence'
  return `- Brand (2): ${badge ? `🎯 **P3 CRITICAL - MUST use complete BADGE text**: "${badge}" (e.g., "${badge} | ${offer.brand}", "${badge} - Trusted Quality")` : '"Trusted Brand"'}, ${rankHint}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: For stores with hot products, create "Best Seller Collection" headlines featuring top products (e.g., "Best ${topProducts[0]?.split(' ').slice(0, 2).join(' ')} Collection")` : ''}${sentimentDistribution && sentimentDistribution.positive >= 80 ? `. **SOCIAL PROOF**: Use review-backed trust phrasing like "Highly Rated by Customers"${averageRating ? `, "Rated ${averageRating} Stars"` : ''}. Avoid "% of people" claims.` : ''}
  * IMPORTANT: Make these 2 brand headlines COMPLETELY DIFFERENT in focus and wording
  * Focus on trust signals, quality, reliability, or unique brand strengths — derived from actual product data
  * ❌ AVOID: "official", "store", "shop" in any brand headline
`
}

export function buildHeadlineFeatureGuidance(
  technicalDetails: Record<string, string>,
  reviewHighlights: string[],
  commonPraises: string[],
  topPositiveKeywords: Array<{ keyword: string; frequency: number }>,
  productFeatures: string[] = []
): string {
  // 🔥 2025-12-10优化：整合productFeatures到guidance中
  const featureExamples =
    productFeatures.length > 0
      ? `\n  * **SCRAPED FEATURES** (use these for authentic headlines): ${productFeatures
          .slice(0, 3)
          .map((f) => `"${f.substring(0, 30)}..."`)
          .join(', ')}`
      : ''
  return `- Feature (4): ${Object.keys(technicalDetails).length > 0 ? 'Use SPECS data for technical features' : 'Core product benefits'}${reviewHighlights.length > 0 ? `, incorporate REVIEW INSIGHTS (e.g., "${reviewHighlights[0]}")` : ''}${commonPraises.length > 0 ? `. **USER PRAISES**: Use authentic features: ${commonPraises.slice(0, 2).join(', ')}` : ''}${
    topPositiveKeywords.length > 0
      ? `. **POSITIVE KEYWORDS**: Incorporate high-frequency praise words: ${topPositiveKeywords
          .slice(0, 3)
          .map((k) => k.keyword)
          .join(', ')}`
      : ''
  }${featureExamples}
  * IMPORTANT: Each of the 4 feature headlines must focus on a DIFFERENT feature or benefit
  * Example 1: "4K Resolution Display" (technical spec)
  * Example 2: "Extended Battery Life" (performance benefit)
  * Example 3: "Smart Navigation System" (functionality)
  * Example 4: "Eco-Friendly Design" (sustainability)
  * ❌ AVOID: "4K Display", "4K Resolution", "High Resolution" (too similar)
`
}

export function buildHeadlinePromoGuidance(
  discount: string | null,
  activePromotions: any[],
  hasPromoEvidence: boolean,
  priceEvidenceBlocked: boolean = false
): string {
  if (priceEvidenceBlocked) {
    return `- Promo (3): ⚠️ PRICE SAFETY OVERRIDE: Conflicting price signals detected.
  * Do NOT mention any exact price amount (e.g., "$37.95", "$369.99", "Only $X").
  * You may use verified promotion wording without explicit price amounts.
  * Prefer non-numeric value messaging (e.g., "Smart Value", "Quality Choice", "Shop Official Store").`
  }

  // 🔥 修复（2026-02-04）：无证据时禁止要求量化优惠，避免与Evidence-Only冲突
  if (!hasPromoEvidence) {
    return `- Promo (3): If there is NO verified promo/price evidence, do NOT mention discounts, prices, or savings.
  * Use value-focused, non-numeric wording only (e.g., "Smart Value Picks", "Quality That Lasts", "Designed for Modern Homes")`
  }

  let promoGuidance = ''

  if (discount) {
    const hasPercent = /\d+%/.test(discount)
    const hasAmount = /[£$€]\s*\d+|\d+\s*(?:USD|GBP|EUR)/i.test(discount)

    promoGuidance = `- Promo (3): 🎯 **P0 CRITICAL**: Use ONLY VERIFIED savings/price data
  * ✅ Use the exact amount/price/percent from VERIFIED FACTS. Do NOT estimate or invent.`
    if (hasAmount) {
      promoGuidance += `
  * ✅ Examples (amount verified):
  *   - "Save £170 Today"
  *   - "Only £499 - Save £170"
  *   - "Was £669, Now £499"`
    }
    if (hasPercent) {
      promoGuidance += `
  * ✅ Examples (percent verified):
  *   - "20% Off Today"
  *   - "Save 20% This Week"`
    }
    promoGuidance += `
  * ❌ Avoid: inventing amounts not in VERIFIED FACTS`
  } else if (activePromotions.length > 0) {
    promoGuidance = `- Promo (3): 🎯 **P0 CRITICAL**: Use ONLY VERIFIED promotion wording
  * Example: "${activePromotions[0].description}" (verbatim or shortened)
  * If the promotion text includes numbers/discounts, you may use them. Otherwise, avoid adding numbers.`
  } else {
    promoGuidance = `- Promo (3): Use ONLY VERIFIED price info (if available). Avoid any invented discounts or numbers.`
  }

  promoGuidance += `
  * IMPORTANT: Each promo headline must use a DIFFERENT promotional angle
  * ✅ Different angles:
  *   - Verified savings/price angle (if available)
  *   - Verified price anchoring (if available)
  *   - Value-focused angle (non-numeric if needed)
  * ❌ Too similar (avoid): same wording with only tiny changes`

  return promoGuidance
}

export function buildHeadlineCTAGuidance(
  primeEligible: boolean,
  purchaseReasons: string[]
): string {
  return `- CTA (3): "Shop Now", "Get Yours Today"${primeEligible ? ', "Prime Eligible"' : ''}${purchaseReasons.length > 0 ? `. **WHY BUY**: Incorporate purchase motivations: ${purchaseReasons.slice(0, 2).join(', ')}` : ''}
  * IMPORTANT: Each CTA headline must use a DIFFERENT call-to-action verb or angle
  * Example 1: "Shop Now" (direct action)
  * Example 2: "Get Yours Today" (possession focus)
  * Example 3: "Claim Your Deal" (exclusivity focus)
  * ❌ AVOID: "Shop Now", "Shop Today", "Buy Now" (too similar)
`
}

export function buildHeadlineUrgencyGuidance(
  availability: string | null,
  hasUrgencyEvidence: boolean
): string {
  let urgencyText = ''
  let isCritical = false

  if (availability) {
    const stockMatch = availability.match(/(\d+)\s*left/i)
    if (stockMatch) {
      const stockLevel = parseInt(stockMatch[1])
      if (stockLevel < 10) {
        urgencyText = `🎯 **P1 CRITICAL - MUST use real STOCK data**: "${availability}" (Low stock detected: ${stockLevel} units)`
        isCritical = true
      }
    }
    if (!isCritical) {
      const lowStockKeywords = [
        'low stock',
        'limited quantity',
        'almost gone',
        'running low',
        'few left',
      ]
      const hasLowStockKeyword = lowStockKeywords.some((kw) =>
        availability.toLowerCase().includes(kw)
      )
      if (hasLowStockKeyword) {
        urgencyText = `🎯 **P1 CRITICAL - MUST use URGENCY**: "${availability}" or "Limited Stock - Act Fast"`
        isCritical = true
      }
    }
  }

  if (!urgencyText) {
    if (hasUrgencyEvidence) {
      urgencyText = `Use ONLY verified urgency evidence (stock/expiry) from VERIFIED FACTS or PROMOTION.`
    } else {
      urgencyText = `No verified urgency evidence. DO NOT use time/stock/limited claims.`
    }
  }

  return `- Urgency (0-3): ${urgencyText}
  * If verified stock/expiry evidence exists, include 1-2 urgency headlines using those exact facts.
  * If no verified evidence, skip urgency headlines and use neutral CTAs instead.
  * ❌ AVOID: unverified time/stock claims ("Limited Time", "Ends Soon", "Only X Left")`
}

export function buildDescription1Guidance(
  badge: string | null,
  featuredSalesRank: string | null
): string {
  return `- **Description 1 (Value-Driven)**: Lead with the PRIMARY benefit or competitive advantage${badge ? `. Optionally mention BADGE: "${badge}" if natural` : ''}${featuredSalesRank ? `. Optional social proof: mention SALES RANK "${featuredSalesRank}" at most once` : `. Do NOT add ranking numbers or "Best Seller" claims without strong evidence`}
  * Focus: What makes this product/brand special (unique value proposition)
  * Example: "Premium design. Built for everyday comfort."
  * ❌ AVOID: Repeating "shop", "buy", "get" from other descriptions
`
}

export function buildDescription2Guidance(primeEligible: boolean, activePromotions: any[]): string {
  return `- **Description 2 (Action-Oriented)**: Strong CTA with immediate incentive${primeEligible ? ' + Prime eligibility' : ''}${activePromotions.length > 0 ? `. 🎯 **P2 CRITICAL**: MUST mention promotion "${activePromotions[0].description}"${activePromotions[0].code ? ` with code "${activePromotions[0].code}"` : ''}. Example: "Save ${activePromotions[0].description} - Shop Now!"` : ''}
  * Focus: Urgency + convenience + trust signal (action-focused)
  * Example: "Shop now for refined design. Order today."
  * ❌ AVOID: Using the same CTA verb as Description 1 or 3
`
}

export function buildDescription3Guidance(
  useCases: string[],
  userProfiles: Array<{ profile: string; indicators?: string[] }>
): string {
  return `- **Description 3 (Feature-Rich)**: Specific product features or use cases${useCases.length > 0 ? `. **USE CASES**: Reference real scenarios: ${useCases.slice(0, 2).join(', ')}` : ''}${
    userProfiles.length > 0
      ? `. **TARGET PERSONAS**: Speak to: ${userProfiles
          .slice(0, 2)
          .map((p) => p.profile)
          .join(', ')}`
      : ''
  }
  * Focus: Technical specs, capabilities, or versatility (feature-focused)
  * Example: "Sleek finishes. Smart storage. Designed for modern homes."
  * ❌ AVOID: Mentioning "award", "rated", "trusted" from other descriptions
`
}

export function buildDescription4Guidance(
  topReviews: string[],
  hotInsights: any,
  topProducts: string[],
  sentimentDistribution: any,
  totalReviews: number,
  averageRating: number
): string {
  return `- **Description 4 (Trust + Social Proof)**: Customer validation or support${
    topReviews.length > 0
      ? `. 🎯 **P0 OPTIMIZATION - TOP REVIEWS**: Prefer concise, policy-safe review-backed phrasing (quote or paraphrase): ${topReviews
          .slice(0, 2)
          .map((r) => `"${r.length > 50 ? r.substring(0, 47) + '...' : r}"`)
          .join(' or ')}`
      : ''
  }${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: Mention product variety and quality (Avg: ${hotInsights.avgRating.toFixed(1)} stars from ${hotInsights.avgReviews}+ reviews)` : ''}${sentimentDistribution && totalReviews > 0 ? `. **SOCIAL PROOF DATA**: Strong positive review sentiment from ${totalReviews} reviews${averageRating ? `, ${averageRating} stars` : ''}. Avoid "% of people" claims.` : ''}
  * 🎯 **P0 CRITICAL**: If TOP REVIEWS available, use clean and trustworthy wording; avoid slang/colloquial quotes
  * Focus: Reviews, ratings, guarantees, customer service (proof-focused)
  * Example with review: "Works perfectly!" - Customer Review. Shop with confidence.
  * Example without review: "Trusted for quality and style. Learn more today."
  * ❌ AVOID: Repeating "fast", "free", "easy" from other descriptions
`
}

export function buildReviewDataSummary(
  reviewHighlights: string[],
  commonPraises: string[],
  topPositiveKeywords: Array<{ keyword: string; frequency: number }>,
  commonPainPoints: string[],
  aiReviews?: any
): string {
  const parts: string[] = []

  // 🎯 P0优化：优先使用AI增强的评论数据
  if (aiReviews) {
    if (aiReviews.rating) {
      parts.push(`AI分析评分: ${aiReviews.rating}/5.0`)
    }
    if (aiReviews.sentiment) {
      parts.push(`用户情感倾向: ${aiReviews.sentiment}`)
    }
    if (aiReviews.positives && aiReviews.positives.length > 0) {
      parts.push(`用户好评要点: ${aiReviews.positives.slice(0, 3).join(', ')}`)
    }
    if (aiReviews.concerns && aiReviews.concerns.length > 0) {
      parts.push(`用户关注点: ${aiReviews.concerns.slice(0, 2).join(', ')}`)
    }
    if (aiReviews.useCases && aiReviews.useCases.length > 0) {
      parts.push(`主要使用场景: ${aiReviews.useCases.slice(0, 2).join(', ')}`)
    }
  }

  // Fallback到原有数据（向后兼容）
  if (reviewHighlights.length > 0)
    parts.push(`Review insights: ${reviewHighlights.slice(0, 3).join(', ')}`)
  if (commonPraises.length > 0) parts.push(`User praises: ${commonPraises.slice(0, 2).join(', ')}`)
  if (topPositiveKeywords.length > 0)
    parts.push(
      `Positive keywords: ${topPositiveKeywords
        .slice(0, 3)
        .map((k) => k.keyword)
        .join(', ')}`
    )
  if (commonPainPoints.length > 0)
    parts.push(
      `(Address pain points indirectly - don't highlight negatives): ${commonPainPoints.slice(0, 2).join(', ')}`
    )

  return parts.length > 0 ? parts.join('; ') : ''
}

export function buildCalloutGuidance(
  salesRank: string | null,
  primeEligible: boolean,
  availability: string | null,
  badge: string | null,
  activePromotions: any[],
  hasVerifiedFacts: boolean
): string {
  const parts: string[] = []

  if (salesRank) {
    const rankMatch = salesRank.match(/#(\d+,?\d*)/)
    if (rankMatch) {
      const rankNum = parseInt(rankMatch[1].replace(/,/g, ''))
      if (rankNum < 100) {
        parts.push(
          `- 🎯 **P0 CRITICAL - MUST include**: "Best Seller" or "#1 in Category" or "Top Rated" (salesRank ${salesRank} indicates top product)`
        )
      }
    }
  }

  if (primeEligible) {
    parts.push('- **MUST include**: "Prime Free Shipping"')
  }

  if (availability && !availability.toLowerCase().includes('out of stock')) {
    parts.push('- **MUST include**: "In Stock Now"')
  }

  if (badge) {
    parts.push(`- 🎯 **P3 CRITICAL - MUST include**: "${badge}"`)
  }

  if (activePromotions.length > 0) {
    parts.push(
      `- 🎯 **P2 CRITICAL - MUST include**: Promotion callout (e.g., "${activePromotions[0].description.substring(0, 22)}..." or "Limited Deal")`
    )
  }

  if (!hasVerifiedFacts) {
    parts.push(
      '- ⚠️ No verified facts: avoid numbers, discounts, guarantees, shipping promises, or time claims.'
    )
  }

  parts.push(
    '- Safe alternatives (non-numeric): "Modern Designs", "Curated Collections", "Quality Materials", "Shop New Arrivals", "Easy Browsing", "Top Rated Products"'
  )

  return parts.join('\n')
}

export function buildCompetitiveGuidance(compAnalysis: any): string {
  let guidance =
    '\n**🎯 COMPETITIVE POSITIONING GUIDANCE (CRITICAL - Use competitor analysis data)**:\n'

  if (compAnalysis.pricePosition && compAnalysis.pricePosition.priceAdvantage === 'below_average') {
    guidance += `- **PRICE ADVANTAGE**: Emphasize value and affordability. Use phrases like "Best Value", "Affordable Premium", "Save vs Competitors"\n`
  }

  if (compAnalysis.uniqueSellingPoints && compAnalysis.uniqueSellingPoints.length > 0) {
    const usps = compAnalysis.uniqueSellingPoints.filter((u: any) => u.significance === 'high')
    if (usps.length > 0) {
      guidance += `- **UNIQUE ADVANTAGES**: Highlight these differentiators that competitors DON'T have:\n`
      usps.forEach((u: any) => {
        guidance += `  * "${u.usp}" - ${u.differentiator}\n`
      })
    }
  }

  if (compAnalysis.competitorAdvantages && compAnalysis.competitorAdvantages.length > 0) {
    guidance += `- **COUNTER COMPETITOR STRENGTHS**: Apply these positioning strategies:\n`
    compAnalysis.competitorAdvantages.slice(0, 2).forEach((a: any) => {
      guidance += `  * vs "${a.advantage}" → ${a.howToCounter}\n`
    })
  }

  if (compAnalysis.featureComparison) {
    const ourAdvantages = compAnalysis.featureComparison.filter(
      (f: any) => f.weHave && f.ourAdvantage
    )
    if (ourAdvantages.length > 0) {
      guidance += `- **COMPETITIVE FEATURES**: Emphasize these features where we lead:\n`
      ourAdvantages.slice(0, 3).forEach((f: any) => {
        guidance += `  * ${f.feature}\n`
      })
    }
  }

  return guidance
}

/**
 * Substitute placeholders in template with actual values
 */

export function buildSimplifiedAdCreativeRetryPrompt(prompt: string): string {
  const cutMarkers = [
    '## 输出（JSON only）',
    '## 📋 OUTPUT (JSON only, no markdown):',
    '## Structured Evidence Metadata (recommended)',
  ]
  let cutIndex = -1

  for (const marker of cutMarkers) {
    const markerIndex = prompt.indexOf(marker)
    if (markerIndex !== -1 && (cutIndex === -1 || markerIndex < cutIndex)) {
      cutIndex = markerIndex
    }
  }

  const preservedPrompt = (cutIndex === -1 ? prompt : prompt.slice(0, cutIndex)).trimEnd()
  return `${preservedPrompt}

## RETRY OVERRIDE (CRITICAL)
The previous attempt either exceeded the token budget or returned an incomplete asset set.
Ignore any earlier request for optional audit metadata, explanations, scoring blocks, or diagnostic fields.
If any earlier instruction conflicts with this section, this section wins.

Return ONLY one valid JSON object with these top-level fields:
{
  "headlines": [{"text": "...", "type": "...", "length": N}],
  "descriptions": [{"text": "...", "type": "...", "length": N}],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

Strict rules:
- EXACTLY 15 headlines, each <= 30 chars
- EXACTLY 4 descriptions, each <= 90 chars
- 10-20 keywords
- For model_intent output, never include transactional+model template keywords (no forms like "buy x200", "x200 price", "order gen 2")
- EXACTLY 6 callouts, each <= 25 chars
- EXACTLY 6 sitelinks, text <= 25 chars, description <= 35 chars
- Do NOT return copyAngle, keywordCandidates, evidenceProducts, cannotGenerateReason, explanation, quality_metrics, or any other metadata
- No markdown, no prose, no comments
- Stop immediately after the final closing brace`
}

export function buildEmergencyAdCreativeRetryPrompt(prompt: string): string {
  const simplifiedPrompt = buildSimplifiedAdCreativeRetryPrompt(prompt)
  return `${simplifiedPrompt}

## EMERGENCY OUTPUT CONTRACT (CRITICAL)
The previous attempt produced runaway output.
Return ONLY the five required top-level fields:
{
  "headlines": [{"text": "...", "type": "..."}],
  "descriptions": [{"text": "...", "type": "..."}],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}]
}

Emergency rules:
- Use only the required properties shown above; omit length, group, theme, path1, path2, explanation, and every audit field
- Keep wording concise; do not restate instructions, verified facts, keyword plans, or reasoning
- Stop immediately after the final closing brace`
}
