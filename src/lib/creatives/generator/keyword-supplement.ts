// AI语义分类
import { logger } from '@/lib/common/server'
import { generateContent, type ResponseSchema } from '../../ai/server'
// 导入否定关键词生成函数
import { recordTokenUsage, estimateTokenCost } from '../../ai/server' // 导入token追踪函数
import { loadPrompt, interpolateTemplate } from '../../ai/server' // v3.0: 导入数据库prompt加载函数
// 购买意图评分
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer' // Google Ads关键词标准化去重
import { hasModelAnchorEvidence } from '../server'

import { isCreativeKeywordSupplementThresholdGateEnabled } from '../../keywords/server'
import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from '../../keywords/server'
import { shouldUseExactMatch, isBrandVariant, isSemanticQuery } from '../../keywords/server'
import { normalizeLanguageCode } from '../../common/server'
import { repairJsonText } from '../../ai/server'

import { classifyKeywordIntent } from '../../keywords/server'

import { resolveCreativeBucketPoolKeywords } from './bucket'
import { extractTitleAndAboutSignals } from './prompt-keywords'
import type {
  ApplyKeywordSupplementationOnceInput,
  ApplyKeywordSupplementationOnceOutput,
  BuildKeywordSupplementScoringPromptInput,
  KeywordWithVolume,
  RankSupplementCandidatesWithModelInput,
  SupplementCandidateAssessment,
} from './types'
import { normalizeSnippetText, safeParseJson } from './utils'

export const KEYWORD_SUPPLEMENT_TRIGGER_THRESHOLD = 10

export const KEYWORD_SUPPLEMENT_DEFAULT_CAP = 20

export const KEYWORD_SUPPLEMENT_CAP_BY_BUCKET: Record<'A' | 'B' | 'C' | 'D' | 'S', number> = {
  A: 20,
  B: 25,
  C: 25,
  D: 30,
  S: 30,
}

export const KEYWORD_SUPPLEMENT_MIN_NON_BRAND = 8

export const KEYWORD_SUPPLEMENT_MIN_EFFECTIVE = 12

export const KEYWORD_SUPPLEMENT_MIN_B_MODEL_ANCHOR = 3

export const KEYWORD_SUPPLEMENT_MIN_D_DEMAND = 6

export const KEYWORD_SUPPLEMENT_MODEL_PASS_SCORE = 70

export const KEYWORD_SUPPLEMENT_MODEL_MAX_CANDIDATES = 60

export const KEYWORD_SUPPLEMENT_SCORING_PROMPT_ID = 'keyword_supplement_relevance_scoring'

export const KEYWORD_SUPPLEMENT_SCORING_PROMPT_FALLBACK = `You are a strict SEO keyword relevance scorer for paid search.
Task: score candidate supplemental keywords for product ads.

Source: {{source}}
Brand: {{brandName}}
Target language: {{targetLanguage}}

Product title:
{{titleLine}}

About this item:
{{aboutBlock}}

Existing high-confidence keywords:
{{existingLines}}

Candidate keywords to score:
{{candidateLines}}

Scoring rules (0-100):
- Keep only query-like keywords clearly related to product/category/function/use-case/material/spec.
- Reject generic marketing slogans or vague phrases (e.g., "easy clean", "wide use").
- Reject candidates that are semantically detached from product context.
- Prefer candidates likely to be real user search queries.

Output JSON only with this structure:
{ "assessments": [ { "candidate": "...", "score": 0-100, "keep": true|false, "reason": "..." } ] }
Include every candidate exactly once in assessments.`

export const KEYWORD_SUPPLEMENT_STOPWORDS_EN = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'for',
  'with',
  'in',
  'on',
  'at',
  'by',
  'from',
  'as',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'is',
  'are',
  'be',
  'can',
  'will',
  'you',
  'your',
  'our',
  'because',
])

export const KEYWORD_SUPPLEMENT_GENERIC_TOKENS_EN = new Set([
  'easy',
  'clean',
  'wide',
  'use',
  'quality',
  'premium',
  'durable',
  'reliable',
  'best',
  'new',
  'hot',
  'top',
  'great',
  'good',
  'nice',
  'perfect',
  'ultimate',
  'professional',
  'advanced',
  'improved',
])

export const KEYWORD_SUPPLEMENT_BANNED_PHRASES_EN = new Set([
  'easy clean',
  'easy to clean',
  'wide use',
  'wide usage',
  'high quality',
  'premium quality',
  'best quality',
])

export function resolveKeywordSupplementCap(input: {
  supplementCap?: number
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
}): number {
  const explicit = Number(input.supplementCap)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.floor(explicit))
  }

  if (input.bucket && KEYWORD_SUPPLEMENT_CAP_BY_BUCKET[input.bucket]) {
    return KEYWORD_SUPPLEMENT_CAP_BY_BUCKET[input.bucket]
  }

  return KEYWORD_SUPPLEMENT_DEFAULT_CAP
}

export function hasKeywordSupplementCoverageGap(input: {
  keywordsWithVolume: KeywordWithVolume[]
  pureBrandKeywords: string[]
  targetLanguage: string
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
}): boolean {
  const keywords = input.keywordsWithVolume || []
  const effectiveCount = keywords.length

  let nonPureBrandCount = 0
  let modelAnchorCount = 0
  let demandIntentCount = 0

  for (const item of keywords) {
    const keyword = String(item?.keyword || '').trim()
    if (!keyword) continue

    if (!isPureBrandKeyword(keyword, input.pureBrandKeywords)) {
      nonPureBrandCount++
    }

    if (hasModelAnchorEvidence({ keywords: [keyword] })) {
      modelAnchorCount++
    }

    const intent = classifyKeywordIntent(keyword, { language: input.targetLanguage })
    if (intent.intent === 'TRANSACTIONAL' || intent.intent === 'COMMERCIAL') {
      demandIntentCount++
    }
  }

  if (effectiveCount < KEYWORD_SUPPLEMENT_MIN_EFFECTIVE) return true
  if (nonPureBrandCount < KEYWORD_SUPPLEMENT_MIN_NON_BRAND) return true

  if (
    (input.bucket === 'B' || input.bucket === 'C') &&
    modelAnchorCount < KEYWORD_SUPPLEMENT_MIN_B_MODEL_ANCHOR
  ) {
    return true
  }

  if (
    (input.bucket === 'D' || input.bucket === 'S') &&
    demandIntentCount < KEYWORD_SUPPLEMENT_MIN_D_DEMAND
  ) {
    return true
  }

  return false
}

export function matchesTargetLanguageScriptForKeyword(
  keyword: string,
  targetLanguage: string
): boolean {
  const base = normalizeLanguageCode(targetLanguage || 'English').split(/[-_]/)[0]
  const text = String(keyword || '')
  if (!text.trim()) return false

  if (base === 'zh') return /[\p{Script=Han}]/u.test(text)
  if (base === 'ja') return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
  if (base === 'ko') return /[\p{Script=Hangul}]/u.test(text)
  if (base === 'ru') return /[\p{Script=Cyrillic}]/u.test(text)
  if (base === 'ar') return /[\p{Script=Arabic}]/u.test(text)

  const hasLatin = /[\p{Script=Latin}]/u.test(text)
  if (!hasLatin) return false
  return !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(
    text
  )
}

export function normalizeSupplementCandidate(raw: string): string {
  return String(raw || '')
    .replace(/[•·]/g, ' ')
    .replace(/[\/_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeSupplementCandidate(raw: string): string[] {
  return normalizeSupplementCandidate(raw)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function composeBrandedSupplementKeyword(
  rawKeyword: string,
  brandName: string
): string | null {
  const cleaned = normalizeSupplementCandidate(rawKeyword)
  if (!cleaned) return null

  const normalizedBrand = normalizeGoogleAdsKeyword(normalizeSupplementCandidate(brandName || ''))
  if (!normalizedBrand || normalizedBrand === 'unknown') {
    return cleaned
  }

  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0) {
    return cleaned
  }

  const candidateTokens = tokenizeSupplementCandidate(cleaned)
  if (candidateTokens.length === 0) return null

  const lowerTokens = candidateTokens.map((token) => token.toLowerCase())
  const withoutBrandTokens: string[] = []

  for (let i = 0; i < lowerTokens.length; ) {
    let matchesBrand = true
    for (let j = 0; j < brandTokens.length; j += 1) {
      if (lowerTokens[i + j] !== brandTokens[j]) {
        matchesBrand = false
        break
      }
    }

    if (matchesBrand) {
      i += brandTokens.length
      continue
    }

    withoutBrandTokens.push(lowerTokens[i])
    i += 1
  }

  const recomposedCandidate = withoutBrandTokens.join(' ').trim()
  const combined = recomposedCandidate
    ? `${normalizedBrand} ${recomposedCandidate}`
    : normalizedBrand
  const combinedTokens = tokenizeSupplementCandidate(combined)
  if (combinedTokens.length < 2 || combinedTokens.length > 5) {
    return null
  }

  return combinedTokens.join(' ')
}

export function isStructuredSupplementKeyword(keyword: string, targetLanguage: string): boolean {
  const cleaned = normalizeSupplementCandidate(keyword)
  if (!cleaned) return false
  if (cleaned.length < 4 || cleaned.length > 80) return false
  if (!matchesTargetLanguageScriptForKeyword(cleaned, targetLanguage)) return false

  const languageBase = normalizeLanguageCode(targetLanguage || 'English').split(/[-_]/)[0]
  const isCjkLanguage = languageBase === 'zh' || languageBase === 'ja' || languageBase === 'ko'
  const words = tokenizeSupplementCandidate(cleaned)
  if (isCjkLanguage) {
    const compact = cleaned.replace(/\s+/g, '')
    return compact.length >= 2 && compact.length <= 30
  }
  if (words.length < 2 || words.length > 6) return false

  const lowerWords = words.map((word) => word.toLowerCase())
  const normalizedPhrase = lowerWords.join(' ')
  if (KEYWORD_SUPPLEMENT_BANNED_PHRASES_EN.has(normalizedPhrase)) return false
  const allStopwords = lowerWords.every((word) => KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(word))
  if (allStopwords) return false

  const startsWithStopword = KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(lowerWords[0])
  const endsWithStopword = KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(lowerWords[lowerWords.length - 1])
  const secondTokenIsStopword =
    lowerWords.length >= 3 && KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(lowerWords[1])
  if (startsWithStopword || endsWithStopword || secondTokenIsStopword) return false

  const stopwordCount = lowerWords.filter((word) =>
    KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(word)
  ).length
  if (stopwordCount / lowerWords.length >= 0.4) return false
  const nonStopwords = lowerWords.filter((word) => !KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(word))
  if (nonStopwords.length === 0) return false
  const genericTokenCount = nonStopwords.filter((word) =>
    KEYWORD_SUPPLEMENT_GENERIC_TOKENS_EN.has(word)
  ).length
  if (genericTokenCount === nonStopwords.length && nonStopwords.length <= 3) return false

  return true
}

export function buildSupplementContextTokens(
  title: string,
  existingKeywords: KeywordWithVolume[]
): Set<string> {
  const seedTexts = [title, ...existingKeywords.map((kw) => kw.keyword)]

  const tokens = new Set<string>()
  for (const seed of seedTexts) {
    for (const rawToken of tokenizeSupplementCandidate(seed)) {
      const token = rawToken.toLowerCase()
      if (token.length < 3) continue
      if (KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(token)) continue
      if (KEYWORD_SUPPLEMENT_GENERIC_TOKENS_EN.has(token)) continue
      tokens.add(token)
    }
  }

  return tokens
}

export async function buildKeywordSupplementScoringPrompt(
  input: BuildKeywordSupplementScoringPromptInput
): Promise<string> {
  const variables = {
    source: input.source,
    brandName: input.brandName || 'N/A',
    targetLanguage: input.targetLanguage || 'English',
    titleLine: input.titleLine || 'N/A',
    aboutBlock: input.aboutBlock || 'N/A',
    existingLines: input.existingLines || 'N/A',
    candidateLines: input.candidateLines || 'N/A',
  }

  try {
    const promptTemplate = await loadPrompt(KEYWORD_SUPPLEMENT_SCORING_PROMPT_ID)
    return interpolateTemplate(promptTemplate, variables)
  } catch (error: any) {
    console.warn(
      `[KeywordSupplement] 加载 prompt(${KEYWORD_SUPPLEMENT_SCORING_PROMPT_ID}) 失败，回退内置模板: ${error?.message || error}`
    )
    return interpolateTemplate(KEYWORD_SUPPLEMENT_SCORING_PROMPT_FALLBACK, variables)
  }
}

export async function rankSupplementCandidatesWithModel(
  input: RankSupplementCandidatesWithModelInput
): Promise<string[]> {
  const uniqueCandidates: string[] = []
  const seen = new Set<string>()
  for (const raw of input.candidates) {
    const cleaned = normalizeSupplementCandidate(raw)
    const normalized = normalizeGoogleAdsKeyword(cleaned)
    if (!cleaned || !normalized || seen.has(normalized)) continue
    seen.add(normalized)
    uniqueCandidates.push(cleaned)
    if (uniqueCandidates.length >= KEYWORD_SUPPLEMENT_MODEL_MAX_CANDIDATES) break
  }

  if (uniqueCandidates.length === 0) return []

  if (input.skipAiRanking || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return uniqueCandidates
  }

  const existingKeywordTexts = input.existingKeywords
    .map((kw) => normalizeSupplementCandidate(kw.keyword))
    .filter(Boolean)
    .slice(0, 20)

  const titleLine = input.title || 'N/A'
  const aboutLines = (input.about || []).slice(0, 8)
  const candidateLines = uniqueCandidates.map((kw, idx) => `${idx + 1}. ${kw}`).join('\n')
  const existingLines =
    existingKeywordTexts.length > 0
      ? existingKeywordTexts.map((kw, idx) => `${idx + 1}. ${kw}`).join('\n')
      : 'N/A'
  const aboutBlock =
    aboutLines.length > 0 ? aboutLines.map((line, idx) => `${idx + 1}. ${line}`).join('\n') : 'N/A'
  const prompt = await buildKeywordSupplementScoringPrompt({
    source: input.source,
    brandName: input.brandName,
    targetLanguage: input.targetLanguage,
    titleLine,
    aboutBlock,
    existingLines,
    candidateLines,
  })

  const responseSchema: ResponseSchema = {
    type: 'OBJECT',
    properties: {
      assessments: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            candidate: { type: 'STRING' },
            score: { type: 'NUMBER' },
            keep: { type: 'BOOLEAN' },
            reason: { type: 'STRING' },
          },
          required: ['candidate', 'score', 'keep'],
        },
      },
    },
    required: ['assessments'],
  }

  try {
    const aiResponse = await generateContent(
      {
        operationType: 'keyword_supplement_relevance_scoring',
        prompt,
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseSchema,
        responseMimeType: 'application/json',
      },
      input.userId
    )

    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId: input.userId,
        model: aiResponse.model,
        operationType: 'keyword_supplement_relevance_scoring',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType,
      })
    }

    const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('model output missing JSON')
    }

    const parsed = JSON.parse(repairJsonText(jsonMatch[0])) as {
      assessments?: SupplementCandidateAssessment[]
    }
    const assessments = Array.isArray(parsed.assessments) ? parsed.assessments : []

    const scoredByNormalized = new Map<string, SupplementCandidateAssessment>()
    for (const item of assessments) {
      const normalized = normalizeGoogleAdsKeyword(item?.candidate || '')
      if (!normalized) continue
      const score = Number.isFinite(Number(item?.score)) ? Number(item.score) : 0
      const keep = Boolean(item?.keep) || score >= KEYWORD_SUPPLEMENT_MODEL_PASS_SCORE
      const existing = scoredByNormalized.get(normalized)
      if (!existing || score > existing.score) {
        scoredByNormalized.set(normalized, {
          candidate: normalizeSupplementCandidate(item?.candidate || ''),
          score,
          keep,
          reason: typeof item?.reason === 'string' ? item.reason : '',
        })
      }
    }

    const ranked = uniqueCandidates
      .map((candidate) => {
        const normalized = normalizeGoogleAdsKeyword(candidate)
        const scored = normalized ? scoredByNormalized.get(normalized) : undefined
        return {
          candidate,
          score: scored?.score ?? 0,
          keep: scored?.keep ?? false,
        }
      })
      .filter((item) => item.keep || item.score >= KEYWORD_SUPPLEMENT_MODEL_PASS_SCORE)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.candidate)

    if (ranked.length > 0) {
      return ranked
    }
  } catch (error: any) {
    console.warn(`[KeywordSupplement] 模型打分失败，回退规则筛选: ${error?.message || error}`)
  }

  return uniqueCandidates
}

export function extractRawTitleAndAboutForSupplement(offer: any): {
  title: string
  about: string[]
} {
  const scrapedData = safeParseJson(offer?.scraped_data, {}) || {}
  const title = normalizeSnippetText(
    scrapedData?.rawProductTitle || scrapedData?.productName || offer?.product_name || ''
  )

  const normalizeList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return []
    return input
      .map((item) => normalizeSnippetText(String(item || '')))
      .filter(Boolean)
      .slice(0, 8)
  }

  let about = normalizeList(scrapedData?.rawAboutThisItem)
  if (about.length === 0) about = normalizeList(scrapedData?.aboutThisItem)
  if (about.length === 0) about = normalizeList(scrapedData?.features)
  if (about.length === 0) about = normalizeList(scrapedData?.productFeatures)

  if (about.length === 0 && typeof scrapedData?.productDescription === 'string') {
    about = scrapedData.productDescription
      .split(/[\n.;!?]+/)
      .map((line: string) => normalizeSnippetText(line))
      .filter((line: string) => line.length >= 12)
      .slice(0, 6)
  }

  return { title, about }
}

export function buildTitleAboutSupplementCandidates(
  title: string,
  about: string[],
  targetLanguage: string,
  brandName?: string | null
): string[] {
  const signals = extractTitleAndAboutSignals(title, about, {
    targetLanguage,
    brandName,
  })
  const seedTexts = [
    signals.productTitle,
    ...signals.titlePhrases,
    ...signals.aboutClaims,
    ...signals.keywordSeeds,
  ].filter(Boolean)

  const candidates: string[] = []
  const seen = new Set<string>()
  const push = (phrase: string) => {
    const cleaned = normalizeSupplementCandidate(phrase)
    const norm = normalizeGoogleAdsKeyword(cleaned)
    if (!norm || seen.has(norm)) return
    if (!isStructuredSupplementKeyword(cleaned, targetLanguage)) return
    const intent = classifyKeywordIntent(cleaned, { language: targetLanguage })
    if (intent.hardNegative) return
    seen.add(norm)
    candidates.push(cleaned)
  }

  for (const text of seedTexts) {
    const words = tokenizeSupplementCandidate(text)
    if (words.length >= 2 && words.length <= 6) {
      push(words.join(' '))
      continue
    }

    if (words.length > 6) {
      // Prefer complete leading keyphrases over arbitrary sliding n-grams.
      // This keeps supplementation semantically coherent (e.g. "non slip bath mat")
      // and avoids broken fragments like "fit under" / "backing non".
      push(words.slice(0, 6).join(' '))
      push(words.slice(0, 5).join(' '))
      push(words.slice(0, 4).join(' '))
    }
  }

  return candidates
}

export async function loadPoolCandidatesForSupplement(offerId: number): Promise<string[]> {
  try {
    const { getKeywordPoolByOfferId } = await import('../../keywords/offer-pool')
    const { getDatabase } = await import('../../db')

    const pool = await getKeywordPoolByOfferId(offerId)
    if (!pool) return []

    // 获取品牌名用于质量过滤
    const db = await getDatabase()
    const offerRow = await db.queryOne<{ brand: string | null }>(
      'SELECT brand FROM offers WHERE id = ?',
      [offerId]
    )
    const brandName = offerRow?.brand || ''

    const extractKeywords = (list: Array<{ keyword?: string } | string>): string[] =>
      list
        .map((item) => (typeof item === 'string' ? item : String(item?.keyword || '')))
        .map((item) => item.trim())
        .filter(Boolean)

    // 统一走 canonical D 视图，避免补词阶段继续消费旧的 raw A/B/C/D/S 分桶语义。
    const rawKeywords = extractKeywords(resolveCreativeBucketPoolKeywords(pool, 'D', 'D'))

    // 二次质量过滤，防止关键词池污染
    // 确保池中关键词仍然符合当前质量标准
    if (!brandName) {
      // 无品牌名时跳过质量过滤，直接返回原始关键词
      return rawKeywords
    }

    const pureBrandKeywords = getPureBrandKeywords(brandName)

    let filteredCount = 0
    let brandVariantFiltered = 0
    let semanticFiltered = 0
    let nonBrandFiltered = 0

    const filteredKeywords = rawKeywords.filter((keyword) => {
      const normalized = normalizeGoogleAdsKeyword(keyword)
      if (!normalized) {
        filteredCount++
        return false
      }

      const isPureBrand = isPureBrandKeyword(keyword, pureBrandKeywords)

      // 过滤品牌变体词（如 "eurekaddl"）
      if (!isPureBrand && isBrandVariant(keyword, brandName)) {
        brandVariantFiltered++
        filteredCount++
        return false
      }

      // 过滤语义查询词（如 "significato"）
      if (!isPureBrand && isSemanticQuery(keyword)) {
        semanticFiltered++
        filteredCount++
        return false
      }

      // 确保非纯品牌词包含品牌（防止品牌化失败的词进入池）
      if (!isPureBrand && !containsPureBrand(keyword, pureBrandKeywords)) {
        nonBrandFiltered++
        filteredCount++
        return false
      }

      return true
    })

    if (filteredCount > 0) {
      logger.debug(
        `[KeywordSupplement] 关键词池二次过滤: ${rawKeywords.length} → ${filteredKeywords.length} ` +
          `(品牌变体:${brandVariantFiltered}, 语义查询:${semanticFiltered}, 不含品牌:${nonBrandFiltered})`
      )
    }

    return filteredKeywords
  } catch (error: any) {
    console.warn(`[KeywordSupplement] 读取关键词池失败: ${error?.message || error}`)
    return []
  }
}

export async function applyKeywordSupplementationOnce(
  input: ApplyKeywordSupplementationOnceInput
): Promise<ApplyKeywordSupplementationOnceOutput> {
  const triggerThreshold = input.triggerThreshold ?? KEYWORD_SUPPLEMENT_TRIGGER_THRESHOLD
  const supplementCap = resolveKeywordSupplementCap({
    supplementCap: input.supplementCap,
    bucket: input.bucket,
  })
  const beforeKeywords = [...(input.keywordsWithVolume || [])]
  const beforeCount = beforeKeywords.length
  const pureBrandKeywords = getPureBrandKeywords(input.brandName || '')
  const thresholdGateEnabled = isCreativeKeywordSupplementThresholdGateEnabled()

  if (thresholdGateEnabled && beforeCount >= triggerThreshold) {
    return {
      keywordsWithVolume: beforeKeywords,
      keywords: beforeKeywords.map((kw) => kw.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount,
        afterCount: beforeCount,
        addedKeywords: [],
        supplementCapApplied: beforeCount >= supplementCap,
      },
    }
  }

  const hasCoverageGap = hasKeywordSupplementCoverageGap({
    keywordsWithVolume: beforeKeywords,
    pureBrandKeywords,
    targetLanguage: input.targetLanguage,
    bucket: input.bucket,
  })
  if (!hasCoverageGap) {
    return {
      keywordsWithVolume: beforeKeywords,
      keywords: beforeKeywords.map((kw) => kw.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount,
        afterCount: beforeCount,
        addedKeywords: [],
        supplementCapApplied: beforeCount >= supplementCap,
      },
    }
  }

  const maxAddCount = Math.max(0, supplementCap - beforeCount)

  if (maxAddCount <= 0) {
    return {
      keywordsWithVolume: beforeKeywords,
      keywords: beforeKeywords.map((kw) => kw.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount,
        afterCount: beforeCount,
        addedKeywords: [],
        supplementCapApplied: true,
      },
    }
  }
  const seen = new Set(
    beforeKeywords.map((kw) => normalizeGoogleAdsKeyword(kw.keyword)).filter(Boolean)
  )

  const added: Array<{ keyword: string; source: 'keyword_pool' | 'title_about' }> = []
  const supplementWithVolume: KeywordWithVolume[] = []
  const rawContextForRelevance = extractRawTitleAndAboutForSupplement(input.offer)
  const contextTokens = buildSupplementContextTokens(rawContextForRelevance.title, beforeKeywords)

  // 定义 bucket 与意图类型的兼容性（基于意图权重）
  // 使用软过滤策略：只过滤明确不兼容的意图，而不是硬编码允许列表
  const BUCKET_INCOMPATIBLE_INTENTS: Record<string, Set<string>> = {
    A: new Set(['SUPPORT', 'DOWNLOAD', 'JOBS', 'PIRACY']), // 品牌商品锚点：排除支持、下载、招聘、盗版
    B: new Set(['JOBS', 'PIRACY', 'DOWNLOAD']), // 商品需求场景：排除招聘、盗版、下载
    C: new Set(['JOBS', 'PIRACY', 'DOWNLOAD']), // 功能规格/需求扩展：排除招聘、盗版、下载
    D: new Set(['SUPPORT', 'JOBS', 'PIRACY', 'DOWNLOAD']), // 商品需求/行动：排除支持、招聘、盗版、下载
    S: new Set(['JOBS', 'PIRACY']), // 综合需求：只排除招聘、盗版
  }

  // 监控统计
  const filterStats = {
    total: 0,
    structured: 0,
    hardNegative: 0,
    intentIncompatible: 0, // 改名：意图不兼容（而非不匹配）
    contextMismatch: 0,
    brandingFailed: 0,
    duplicate: 0,
    added: 0,
  }

  const tryAdd = (rawKeyword: string, source: 'keyword_pool' | 'title_about') => {
    if (maxAddCount <= 0 || added.length >= maxAddCount) return

    filterStats.total++

    const cleaned = normalizeSupplementCandidate(rawKeyword)
    if (!isStructuredSupplementKeyword(cleaned, input.targetLanguage)) {
      filterStats.structured++
      return
    }

    const intent = classifyKeywordIntent(cleaned, { language: input.targetLanguage })
    if (intent.hardNegative) {
      filterStats.hardNegative++
      return
    }

    // 意图兼容性检查（软过滤）
    // 策略：只过滤明确不兼容的意图，而不是要求匹配允许列表
    if (input.bucket && BUCKET_INCOMPATIBLE_INTENTS[input.bucket]) {
      const incompatibleIntents = BUCKET_INCOMPATIBLE_INTENTS[input.bucket]

      // 检查关键词意图是否在不兼容列表中
      if (incompatibleIntents.has(intent.intent)) {
        filterStats.intentIncompatible++
        if (filterStats.intentIncompatible <= 3) {
          logger.debug(
            `[KeywordSupplement] ❌ 意图不兼容: "${cleaned}" (${intent.intent}) 不适合 bucket ${input.bucket}`
          )
        }
        return
      }
    }

    if (source === 'title_about' && contextTokens.size > 0) {
      const candidateTokens = tokenizeSupplementCandidate(cleaned)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length >= 3)
      const hasContextOverlap = candidateTokens.some((token) => contextTokens.has(token))
      if (!hasContextOverlap) {
        filterStats.contextMismatch++
        return
      }
    }

    const finalKeyword = composeBrandedSupplementKeyword(cleaned, input.brandName)
    if (!finalKeyword) {
      filterStats.brandingFailed++
      return
    }

    const normalized = normalizeGoogleAdsKeyword(finalKeyword)
    if (!normalized || seen.has(normalized)) {
      if (normalized && seen.has(normalized)) {
        filterStats.duplicate++
      }
      return
    }

    seen.add(normalized)
    added.push({ keyword: finalKeyword, source })
    supplementWithVolume.push({
      keyword: finalKeyword,
      searchVolume: 0,
      source: source === 'keyword_pool' ? 'KEYWORD_POOL' : 'AI_GENERATED',
      sourceType: source === 'keyword_pool' ? 'CANONICAL_BUCKET_VIEW' : 'AI_TITLE_ABOUT_SUPPLEMENT',
      matchType: shouldUseExactMatch(finalKeyword, pureBrandKeywords) ? 'EXACT' : 'PHRASE',
    })
    filterStats.added++
  }

  const dbPoolCandidates = await loadPoolCandidatesForSupplement(Number(input.offer?.id || 0))
  const orderedPoolCandidatesRaw = [...(input.poolCandidates || []), ...dbPoolCandidates]
  const orderedPoolCandidates = await rankSupplementCandidatesWithModel({
    source: 'keyword_pool',
    candidates: orderedPoolCandidatesRaw,
    userId: input.userId,
    brandName: input.brandName,
    targetLanguage: input.targetLanguage,
    title: rawContextForRelevance.title,
    about: rawContextForRelevance.about,
    existingKeywords: beforeKeywords,
    skipAiRanking: input.skipAiRanking,
  })
  for (const candidate of orderedPoolCandidates) {
    tryAdd(candidate, 'keyword_pool')
    if (added.length >= maxAddCount) break
  }

  if (added.length < maxAddCount) {
    const titleAboutCandidatesRaw = buildTitleAboutSupplementCandidates(
      rawContextForRelevance.title,
      rawContextForRelevance.about,
      input.targetLanguage,
      input.brandName
    )
    const titleAboutCandidates = await rankSupplementCandidatesWithModel({
      source: 'title_about',
      candidates: titleAboutCandidatesRaw,
      userId: input.userId,
      brandName: input.brandName,
      targetLanguage: input.targetLanguage,
      title: rawContextForRelevance.title,
      about: rawContextForRelevance.about,
      existingKeywords: [...beforeKeywords, ...supplementWithVolume],
      skipAiRanking: input.skipAiRanking,
    })
    for (const candidate of titleAboutCandidates) {
      tryAdd(candidate, 'title_about')
      if (added.length >= maxAddCount) break
    }
  }

  const merged = [...beforeKeywords, ...supplementWithVolume]
  const afterCount = merged.length
  const supplementCapApplied = beforeCount < supplementCap && afterCount >= supplementCap

  // 详细的监控日志
  logger.debug(
    `[KeywordSupplement] offer=${input.offer?.id || 'unknown'} bucket=${input.bucket || 'unknown'} triggered=true before=${beforeCount} after=${afterCount} added=${added.length} cap=${supplementCap}`
  )

  // 输出过滤统计
  const filterRate =
    filterStats.total > 0
      ? (((filterStats.total - filterStats.added) / filterStats.total) * 100).toFixed(1)
      : '0.0'
  logger.debug(
    `[KeywordSupplement] 📊 过滤统计: 总候选=${filterStats.total} ` +
      `过滤=${filterStats.total - filterStats.added} (${filterRate}%) ` +
      `添加=${filterStats.added}`
  )
  logger.debug(
    `[KeywordSupplement] 📋 过滤原因: ` +
      `结构化=${filterStats.structured} ` +
      `硬负面=${filterStats.hardNegative} ` +
      `意图不兼容=${filterStats.intentIncompatible} ` +
      `上下文不匹配=${filterStats.contextMismatch} ` +
      `品牌化失败=${filterStats.brandingFailed} ` +
      `重复=${filterStats.duplicate}`
  )

  // 如果意图不兼容过滤较多，输出警告
  if (filterStats.intentIncompatible > filterStats.added * 0.5) {
    console.warn(
      `[KeywordSupplement] ⚠️ 意图不兼容过滤较多 (${filterStats.intentIncompatible}/${filterStats.total})，` +
        `可能需要调整 bucket ${input.bucket} 的不兼容意图定义`
    )
  }

  // 如果补充数量不足，输出警告
  if (added.length < maxAddCount * 0.5 && maxAddCount > 10) {
    console.warn(
      `[KeywordSupplement] ⚠️ 补充数量不足 (${added.length}/${maxAddCount})，` +
        `最终关键词数=${afterCount}，目标=${supplementCap}`
    )
  }

  if (added.length > 0) {
    logger.debug(
      `[KeywordSupplement] added: ${added
        .map((item) => `${item.keyword} [${item.source}]`)
        .slice(0, 12)
        .join(' | ')}`
    )
  }

  return {
    keywordsWithVolume: merged,
    keywords: merged.map((kw) => kw.keyword),
    keywordSupplementation: {
      triggered: true,
      beforeCount,
      afterCount,
      addedKeywords: added,
      supplementCapApplied,
    },
  }
}
