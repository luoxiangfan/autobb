/**
 * Gemini response schemas, business limits, and AI response parsing.
 * Extracted from contract.ts for structural clarity.
 */
import type {
  GeneratedAdCreativeData,
  GeneratedKeywordCandidateMetadata,
  HeadlineAsset,
  DescriptionAsset,
} from '../../server'
import type { AdCreativeRetryPlan, NormalizedCreativeBucket } from '../types'
import { type ResponseSchema } from '../../../ai/server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { hasModelAnchorEvidence } from '../../server'

import { sanitizeGoogleAdsSymbols } from '@/lib/google-ads/common/ad-text'
import {
  type GoogleAdsPolicyGuardMode,
  resolveGoogleAdsPolicyGuardMode,
  sanitizeGoogleAdsPolicyText,
  sanitizeKeywordListForGoogleAdsPolicy,
} from '@/lib/google-ads/policy/policy-guard'

import { normalizeSitelinkItem } from '../../sitelink-utils'
import { escapeRegex, extractJsonCandidates, sanitizeJsonText } from '../utils'
import {
  applyDescriptionTextGuardrail,
  applyHeadlineTextGuardrail,
  MODEL_INTENT_TRANSACTIONAL_MODIFIER_PATTERN,
} from './text-guardrails'

export type { ResponseSchema } from '../../../ai/server'

export {
  HEADLINE2_INTENT_TOKENS,
  HEADLINE2_BANNED_TOKENS,
  HEADLINE2_STOPWORDS,
  HEADLINE_DANGLING_TAIL_TOKENS,
} from './headline-tokens'

// extracted body below

export function normalizeBrandFreeText(text: string, brandName: string): string {
  if (!text) return ''
  const brand = String(brandName || '').trim()
  if (!brand) return String(text).trim()
  const pattern = new RegExp(escapeRegex(brand), 'ig')
  return String(text).replace(pattern, '').replace(/\s{2}/g, ' ').trim()
}

export function normalizeHeadline2KeywordCandidate(text: string): string {
  return String(text || '')
    .replace(/[{}]/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s{2}/g, ' ')
    .trim()
}

export function tokenizeHeadline2Keyword(text: string): string[] {
  const normalized = normalizeHeadline2KeywordCandidate(text).toLowerCase().normalize('NFKC')
  // Unicode-aware tokenization (letters+numbers). Keep it permissive for non-English.
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

export function isLikelyModelCodeToken(token: string): boolean {
  const t = String(token || '').toLowerCase()
  // e.g. "f17", "vp40", "x100", "a7" (very short alnum code)
  return /^[a-z]*\d+[a-z0-9]*$/i.test(t) && t.length <= 6
}

export function scoreAdCreativeCandidate(raw: any): number {
  if (!raw || typeof raw !== 'object') return 0

  const data = raw?.responsive_search_ads ?? raw?.responsiveSearchAds ?? raw
  if (!data || typeof data !== 'object') return 0

  let score = 0
  if (Array.isArray(data.headlines)) score += 3
  if (Array.isArray(data.descriptions)) score += 2
  if (Array.isArray(data.keywords)) score += 1
  if (Array.isArray(data.callouts)) score += 1
  if (Array.isArray(data.sitelinks)) score += 1

  return score
}

// Gemini official structured output only supports a conservative schema subset and
// may reject large or deeply nested schemas with INVALID_ARGUMENT. Keep the
// transport schema shallow and let the prompt + parseAIResponse enforce business
// counts/length limits and parse optional audit metadata when present.

export const AD_CREATIVE_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    headlines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: [
              'brand',
              'feature',
              'promo',
              'cta',
              'urgency',
              'social_proof',
              'question',
              'emotional',
            ],
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' },
        },
        required: ['text'],
      },
    },
    descriptions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: [
              'feature-benefit-cta',
              'problem-solution-proof',
              'offer-urgency-trust',
              'usp-differentiation',
            ],
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' },
        },
        required: ['text'],
      },
    },
    keywords: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    callouts: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    sitelinks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          url: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['text'],
      },
    },
    path1: { type: 'STRING' },
    path2: { type: 'STRING' },
    theme: { type: 'STRING' },
    explanation: { type: 'STRING' },
    quality_metrics: {
      type: 'OBJECT',
      properties: {
        headline_diversity_score: { type: 'NUMBER' },
        keyword_relevance_score: { type: 'NUMBER' },
      },
    },
  },
  required: ['headlines', 'descriptions', 'keywords'],
}

export const AD_CREATIVE_RETRY_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    headlines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: [
              'brand',
              'feature',
              'promo',
              'cta',
              'urgency',
              'social_proof',
              'question',
              'emotional',
            ],
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' },
        },
        required: ['text'],
      },
    },
    descriptions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: [
              'feature-benefit-cta',
              'problem-solution-proof',
              'offer-urgency-trust',
              'usp-differentiation',
            ],
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' },
        },
        required: ['text'],
      },
    },
    keywords: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    callouts: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    sitelinks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          url: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['text'],
      },
    },
    path1: { type: 'STRING' },
    path2: { type: 'STRING' },
    theme: { type: 'STRING' },
  },
  required: ['headlines', 'descriptions', 'keywords'],
}

export const AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    headlines: {
      type: 'ARRAY',
      minItems: 15,
      maxItems: 15,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: [
              'brand',
              'feature',
              'promo',
              'cta',
              'urgency',
              'social_proof',
              'question',
              'emotional',
            ],
          },
        },
        required: ['text', 'type'],
      },
    },
    descriptions: {
      type: 'ARRAY',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: [
              'feature-benefit-cta',
              'problem-solution-proof',
              'offer-urgency-trust',
              'usp-differentiation',
            ],
          },
        },
        required: ['text', 'type'],
      },
    },
    keywords: {
      type: 'ARRAY',
      minItems: 10,
      maxItems: 20,
      items: { type: 'STRING' },
    },
    callouts: {
      type: 'ARRAY',
      minItems: 6,
      maxItems: 6,
      items: { type: 'STRING' },
    },
    sitelinks: {
      type: 'ARRAY',
      minItems: 6,
      maxItems: 6,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          url: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['text', 'url'],
      },
    },
  },
  required: ['headlines', 'descriptions', 'keywords', 'callouts', 'sitelinks'],
}

export const AD_CREATIVE_REQUIRED_COUNTS = {
  headlines: 15,
  descriptions: 4,
  callouts: 6,
  sitelinks: 6,
  keywordMin: 10,
  keywordMax: 20,
} as const

export const AD_CREATIVE_SIMPLIFIED_RETRY_MAX_OUTPUT_TOKENS = 8192

export const AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE = 0.2

export function createAdCreativeBusinessLimitsError(details: string[]): Error {
  const error: any = new Error(`广告创意业务约束未满足: ${details.join(', ')}`)
  error.code = 'AD_CREATIVE_BUSINESS_LIMITS'
  error.details = details
  return error
}

export function isModelIntentTransactionalTemplateKeyword(keyword: string): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [normalized] })
  if (!hasModelAnchor) return false
  return MODEL_INTENT_TRANSACTIONAL_MODIFIER_PATTERN.test(normalized)
}

export function filterModelIntentGeneratedKeywords(
  creative: GeneratedAdCreativeData,
  bucket: NormalizedCreativeBucket
): GeneratedAdCreativeData {
  if (bucket !== 'B') return creative

  const originalKeywords = (creative.keywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
  if (originalKeywords.length === 0) return creative

  const filteredKeywords = originalKeywords.filter(
    (keyword) => !isModelIntentTransactionalTemplateKeyword(keyword)
  )
  if (filteredKeywords.length === originalKeywords.length) return creative

  const removed = originalKeywords.length - filteredKeywords.length
  console.warn(
    `[AdCreative] model_intent 关键词生成过滤: 移除 ${removed} 个交易修饰词+型号锚点模板词`
  )

  return {
    ...creative,
    keywords: filteredKeywords,
  }
}

export function normalizeBusinessLimitedStringArray(
  items: string[] | undefined,
  maxLength: number,
  limit: number
): string[] {
  return (items || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.substring(0, maxLength))
    .slice(0, limit)
}

export function validateGeneratedAdCreativeBusinessLimits(
  creative: GeneratedAdCreativeData
): GeneratedAdCreativeData {
  const headlines = normalizeBusinessLimitedStringArray(
    creative.headlines,
    30,
    AD_CREATIVE_REQUIRED_COUNTS.headlines
  )
  const descriptions = normalizeBusinessLimitedStringArray(
    creative.descriptions,
    90,
    AD_CREATIVE_REQUIRED_COUNTS.descriptions
  )
  const callouts = normalizeBusinessLimitedStringArray(
    creative.callouts,
    25,
    AD_CREATIVE_REQUIRED_COUNTS.callouts
  )

  const seenKeywords = new Set<string>()
  const keywords = (creative.keywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .filter((keyword) => {
      const normalized = keyword.toLowerCase()
      if (seenKeywords.has(normalized)) return false
      seenKeywords.add(normalized)
      return true
    })
    .slice(0, AD_CREATIVE_REQUIRED_COUNTS.keywordMax)

  const sitelinks = (creative.sitelinks || [])
    .map((raw) => {
      if (!raw) return null
      const text = String(raw.text || '')
        .trim()
        .substring(0, 25)
      const url = String(raw.url || '/').trim() || '/'
      const description =
        typeof raw.description === 'string' ? raw.description.trim().substring(0, 35) : undefined
      if (!text) return null
      return { text, url, description }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, AD_CREATIVE_REQUIRED_COUNTS.sitelinks)

  const details: string[] = []
  if (headlines.length < AD_CREATIVE_REQUIRED_COUNTS.headlines) {
    details.push(`headlines=${headlines.length}/${AD_CREATIVE_REQUIRED_COUNTS.headlines}`)
  }
  if (descriptions.length < AD_CREATIVE_REQUIRED_COUNTS.descriptions) {
    details.push(`descriptions=${descriptions.length}/${AD_CREATIVE_REQUIRED_COUNTS.descriptions}`)
  }
  if (keywords.length < AD_CREATIVE_REQUIRED_COUNTS.keywordMin) {
    details.push(`keywords=${keywords.length}/${AD_CREATIVE_REQUIRED_COUNTS.keywordMin}`)
  }
  if (callouts.length < AD_CREATIVE_REQUIRED_COUNTS.callouts) {
    details.push(`callouts=${callouts.length}/${AD_CREATIVE_REQUIRED_COUNTS.callouts}`)
  }
  if (sitelinks.length < AD_CREATIVE_REQUIRED_COUNTS.sitelinks) {
    details.push(`sitelinks=${sitelinks.length}/${AD_CREATIVE_REQUIRED_COUNTS.sitelinks}`)
  }

  if (details.length > 0) {
    throw createAdCreativeBusinessLimitsError(details)
  }

  return {
    ...creative,
    headlines,
    descriptions,
    keywords,
    callouts,
    sitelinks,
    theme:
      String(creative.theme || '通用广告')
        .trim()
        .substring(0, 60) || '通用广告',
    explanation:
      String(creative.explanation || '基于产品信息生成的广告创意')
        .trim()
        .substring(0, 180) || '基于产品信息生成的广告创意',
    path1: creative.path1 ? String(creative.path1).trim().substring(0, 15) : undefined,
    path2: creative.path2 ? String(creative.path2).trim().substring(0, 15) : undefined,
    headlinesWithMetadata: creative.headlinesWithMetadata?.slice(
      0,
      AD_CREATIVE_REQUIRED_COUNTS.headlines
    ),
    descriptionsWithMetadata: creative.descriptionsWithMetadata?.slice(
      0,
      AD_CREATIVE_REQUIRED_COUNTS.descriptions
    ),
  }
}

export function shouldRetryAdCreativeWithSimplifiedPrompt(
  error: any,
  alreadySimplified: boolean
): boolean {
  if (alreadySimplified) return false

  const message = String(error?.message || '')
  if (error?.code === 'MAX_TOKENS') return true
  if (error?.code === 'AD_CREATIVE_BUSINESS_LIMITS') return true
  if (message.includes('AI响应解析失败')) return true
  return false
}

export function resolveAdCreativeRetryPlan(
  error: any,
  alreadySimplified: boolean
): AdCreativeRetryPlan | null {
  if (alreadySimplified) return null

  if (error?.code === 'MAX_TOKENS' && error?.isRunawayCandidate) {
    return {
      mode: 'emergency',
      reason: 'max_tokens_runaway',
    }
  }

  if (!shouldRetryAdCreativeWithSimplifiedPrompt(error, alreadySimplified)) {
    return null
  }

  return {
    mode: 'simplified',
    reason: String(error?.code || 'fallback_retry').toLowerCase(),
  }
}

export function selectBestJsonCandidate(text: string): string | null {
  const candidates = extractJsonCandidates(text)
  if (candidates.length === 0) return null

  let bestCandidate: string | null = null
  let bestScore = -1
  let bestLength = -1

  for (const candidate of candidates) {
    const cleaned = sanitizeJsonText(candidate)
    try {
      const parsed = JSON.parse(cleaned)
      const score = scoreAdCreativeCandidate(parsed)
      if (score > bestScore || (score === bestScore && cleaned.length > bestLength)) {
        bestCandidate = candidate
        bestScore = score
        bestLength = cleaned.length
      }
    } catch {
      // Ignore invalid JSON candidates.
    }
  }

  if (bestCandidate && bestScore > 0) {
    return bestCandidate
  }

  return null
}

/**
 * 解析AI响应
 */

export function parseAIResponse(
  text: string,
  options?: { policyGuardMode?: GoogleAdsPolicyGuardMode }
): GeneratedAdCreativeData {
  const policyGuardMode = resolveGoogleAdsPolicyGuardMode(options?.policyGuardMode)
  console.log('🔍 AI原始响应长度:', text.length)
  console.log('🔍 AI原始响应前500字符:', text.substring(0, 500))

  // 移除可能的markdown代码块标记
  let jsonText = text.trim()
  jsonText = jsonText
    .replace(/```json\s*/gi, '')
    .replace(/```javascript\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/^json\s*/i, '')
    .trim()

  console.log('🔍 清理markdown后长度:', jsonText.length)
  console.log('🔍 清理markdown后前200字符:', jsonText.substring(0, 200))

  // 尝试提取JSON对象或数组（如果AI在JSON前后加了其他文本）
  // 优先使用候选扫描，避免误截取 {KeyWord:...} 这类内容
  const selectedCandidate = selectBestJsonCandidate(jsonText)
  if (selectedCandidate) {
    jsonText = selectedCandidate
    console.log('✅ 选择JSON候选片段，长度:', jsonText.length)
  } else {
    // 支持 { ... } 和 [ ... ] 两种格式
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/)
    const jsonArrayMatch = jsonText.match(/\[[\s\S]*\]/)

    if (jsonObjectMatch && jsonArrayMatch) {
      // 两者都存在时，选择更长的那个
      jsonText =
        jsonObjectMatch[0].length > jsonArrayMatch[0].length
          ? jsonObjectMatch[0]
          : jsonArrayMatch[0]
    } else if (jsonObjectMatch) {
      jsonText = jsonObjectMatch[0]
    } else if (jsonArrayMatch) {
      jsonText = jsonArrayMatch[0]
    } else {
      console.warn('⚠️ 未能通过正则提取JSON对象或数组')
    }

    if (jsonObjectMatch || jsonArrayMatch) {
      console.log('✅ 成功提取JSON，长度:', jsonText.length)
    }
  }

  // 清理提取后可能残留的markdown标记
  jsonText = jsonText.replace(/\n?```$/, '').trim()

  // 修复常见的JSON格式错误
  jsonText = sanitizeJsonText(jsonText)

  console.log('🔍 修复后JSON前200字符:', jsonText.substring(0, 200))

  try {
    const raw = JSON.parse(jsonText)
    const responsiveSearchAds = raw?.responsive_search_ads ?? raw?.responsiveSearchAds

    // 兼容新格式：AI 可能返回 { responsive_search_ads: { ... } }
    // 旧解析器要求顶层字段 headlines/descriptions/keywords/callouts/sitelinks
    const data =
      responsiveSearchAds && typeof responsiveSearchAds === 'object'
        ? { ...raw, ...responsiveSearchAds }
        : raw

    const copyAngle =
      typeof data.copyAngle === 'string'
        ? data.copyAngle.trim()
        : typeof data.copy_angle === 'string'
          ? data.copy_angle.trim()
          : undefined
    const cannotGenerateReason =
      typeof data.cannotGenerateReason === 'string'
        ? data.cannotGenerateReason.trim()
        : typeof data.cannot_generate_reason === 'string'
          ? data.cannot_generate_reason.trim()
          : undefined
    const evidenceProducts = Array.isArray(data.evidenceProducts)
      ? data.evidenceProducts
          .map((item: any) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 8)
      : Array.isArray(data.evidence_products)
        ? data.evidence_products
            .map((item: any) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 8)
        : []
    const keywordCandidatesRaw: unknown[] = Array.isArray(data.keywordCandidates)
      ? data.keywordCandidates
      : Array.isArray(data.keyword_candidates)
        ? data.keyword_candidates
        : []
    const normalizeSuggestedMatchType = (
      value: unknown
    ): 'EXACT' | 'PHRASE' | 'BROAD' | undefined => {
      const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
      if (normalized === 'EXACT' || normalized === 'PHRASE' || normalized === 'BROAD') {
        return normalized
      }
      return undefined
    }
    const normalizeConfidence = (value: unknown): number | undefined => {
      const parsed =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
      return Number.isFinite(parsed) ? parsed : undefined
    }
    const normalizeDerivedTags = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined
      const tags = Array.from(
        new Set(value.map((entry: any) => String(entry || '').trim()).filter(Boolean))
      ).slice(0, 8)
      return tags.length > 0 ? tags : undefined
    }
    const keywordCandidates: GeneratedKeywordCandidateMetadata[] = keywordCandidatesRaw
      .map((item: any): GeneratedKeywordCandidateMetadata | null => {
        if (!item || typeof item !== 'object') return null
        const candidateText = String(item.text || item.keyword || '').trim()
        if (!candidateText) return null
        return {
          text: candidateText,
          sourceType:
            typeof item.sourceType === 'string'
              ? item.sourceType.trim()
              : typeof item.source_type === 'string'
                ? item.source_type.trim()
                : undefined,
          sourceSubtype:
            typeof item.sourceSubtype === 'string'
              ? item.sourceSubtype.trim()
              : typeof item.source_subtype === 'string'
                ? item.source_subtype.trim()
                : undefined,
          rawSource:
            typeof item.rawSource === 'string'
              ? item.rawSource.trim()
              : typeof item.raw_source === 'string'
                ? item.raw_source.trim()
                : undefined,
          derivedTags: normalizeDerivedTags(item.derivedTags ?? item.derived_tags),
          sourceField:
            typeof item.sourceField === 'string'
              ? item.sourceField.trim()
              : typeof item.source_field === 'string'
                ? item.source_field.trim()
                : undefined,
          anchorType:
            typeof item.anchorType === 'string'
              ? item.anchorType.trim()
              : typeof item.anchor_type === 'string'
                ? item.anchor_type.trim()
                : undefined,
          evidence: Array.isArray(item.evidence)
            ? item.evidence
                .map((entry: any) => String(entry || '').trim())
                .filter(Boolean)
                .slice(0, 6)
            : Array.isArray(item.evidence_list)
              ? item.evidence_list
                  .map((entry: any) => String(entry || '').trim())
                  .filter(Boolean)
                  .slice(0, 6)
              : undefined,
          suggestedMatchType: normalizeSuggestedMatchType(
            item.suggestedMatchType ?? item.suggested_match_type
          ),
          confidence: normalizeConfidence(item.confidence),
          qualityReason:
            typeof item.qualityReason === 'string'
              ? item.qualityReason.trim()
              : typeof item.quality_reason === 'string'
                ? item.quality_reason.trim()
                : undefined,
          rejectionReason:
            typeof item.rejectionReason === 'string'
              ? item.rejectionReason.trim()
              : typeof item.rejection_reason === 'string'
                ? item.rejection_reason.trim()
                : undefined,
        }
      })
      .filter((item): item is GeneratedKeywordCandidateMetadata => item !== null)
      .slice(0, 20)

    if (
      (!data.headlines || !Array.isArray(data.headlines) || data.headlines.length < 3) &&
      cannotGenerateReason
    ) {
      throw new Error(cannotGenerateReason)
    }

    // 验证必需字段
    if (!data.headlines || !Array.isArray(data.headlines) || data.headlines.length < 3) {
      throw new Error('Headlines格式无效或数量不足')
    }

    if (!data.descriptions || !Array.isArray(data.descriptions) || data.descriptions.length < 2) {
      throw new Error('Descriptions格式无效或数量不足')
    }

    if (!data.keywords || !Array.isArray(data.keywords)) {
      throw new Error('Keywords格式无效')
    }

    // 处理headlines格式（支持新旧格式）
    let headlinesArray: string[]
    let headlinesWithMetadata: HeadlineAsset[] | undefined

    // 检测格式：第一个元素是string还是object
    const isNewFormat = data.headlines.length > 0 && typeof data.headlines[0] === 'object'

    if (isNewFormat) {
      // 新格式：对象数组（带metadata）
      headlinesWithMetadata = data.headlines as HeadlineAsset[]
      headlinesArray = headlinesWithMetadata.map((h) => h.text)
      console.log('✅ 检测到新格式headlines（带metadata）')
    } else {
      // 旧格式：字符串数组
      headlinesArray = data.headlines as string[]
      console.log('✅ 检测到旧格式headlines（字符串数组）')
    }

    // 处理descriptions格式
    let descriptionsArray: string[]
    let descriptionsWithMetadata: DescriptionAsset[] | undefined

    const isDescNewFormat = data.descriptions.length > 0 && typeof data.descriptions[0] === 'object'

    if (isDescNewFormat) {
      descriptionsWithMetadata = data.descriptions as DescriptionAsset[]
      descriptionsArray = descriptionsWithMetadata.map((d) => d.text)
      console.log('✅ 检测到新格式descriptions（带metadata）')
    } else {
      descriptionsArray = data.descriptions as string[]
      console.log('✅ 检测到旧格式descriptions（字符串数组）')
    }

    // 预先执行文本护栏（长度、断词、括号平衡）
    const headlineGuarded = headlinesArray.map((h: string) => applyHeadlineTextGuardrail(h, 30))
    const headlineGuardFixes = headlineGuarded.filter((h, idx) => h !== headlinesArray[idx]).length
    if (headlineGuardFixes > 0) {
      console.log(`🔧 Headline文本护栏: 修复 ${headlineGuardFixes} 条`)
    }
    headlinesArray = headlineGuarded
    if (headlinesWithMetadata) {
      headlinesWithMetadata = headlinesWithMetadata.map((h, idx) => ({
        ...h,
        text: headlinesArray[idx] || '',
        length: Math.min(30, (headlinesArray[idx] || '').length),
      }))
    }

    // 修复Ad Customizer标签格式（DKI语法验证）
    // 问题：AI可能生成 "{KeyWord:Text" 缺少结束符 "}"
    const fixDKISyntax = (text: string): string => {
      // 检测未闭合的 {KeyWord: 标签
      const unclosedPattern = /\{KeyWord:([^}]*?)$/i
      if (unclosedPattern.test(text)) {
        // 尝试如果只是缺少结束符，添加它
        const match = text.match(unclosedPattern)
        if (match) {
          const defaultText = match[1].trim()
          // Google Ads headline限制30字符，DKI的defaultText也应支持到30字符
          if (defaultText.length > 0 && defaultText.length <= 30) {
            // 合理的默认文本长度，添加结束符
            console.log(`🔧 修复DKI标签: "${text}" → "${text}}"`)
            return text + '}'
          } else {
            // 默认文本过长或为空，移除整个DKI标签
            const fixedText = text.replace(unclosedPattern, match[1].trim() || '')
            console.log(
              `🔧 移除无效DKI标签（defaultText长度${defaultText.length}）: "${text}" → "${fixedText}"`
            )
            return fixedText
          }
        }
      }
      return text
    }

    // 过滤Google Ads禁止的符号（Policy Violation防御）
    const removeProhibitedSymbols = (text: string): string => {
      const { text: cleaned, removed } = sanitizeGoogleAdsSymbols(text)
      if (removed.length > 0) {
        console.log(`🛡️ 移除违规符号: "${text}" → "${cleaned}" (移除: ${removed.join(', ')})`)
      }
      return cleaned
    }

    const sanitizePolicySensitiveText = (text: string, maxLength: number): string => {
      const policySafe = sanitizeGoogleAdsPolicyText(text, { maxLength, mode: policyGuardMode })
      if (policySafe.changed) {
        console.log(
          `🛡️ 政策敏感词净化: "${text}" → "${policySafe.text}" (命中: ${policySafe.matchedTerms.join(', ')})`
        )
      }
      return policySafe.text
    }

    // 应用DKI修复到所有headlines
    const originalHeadlines = [...headlinesArray]
    headlinesArray = headlinesArray.map((h: string) => fixDKISyntax(h))
    const fixedCount = headlinesArray.filter(
      (h: string, i: number) => h !== originalHeadlines[i]
    ).length
    if (fixedCount > 0) {
      console.log(`✅ 修复了${fixedCount}个DKI标签格式问题`)
    }

    // 应用符号过滤到所有headlines和descriptions
    headlinesArray = headlinesArray.map((h: string) => removeProhibitedSymbols(h))
    descriptionsArray = descriptionsArray.map((d: string) => removeProhibitedSymbols(d))
    headlinesArray = headlinesArray.map((h: string) => sanitizePolicySensitiveText(h, 30))
    descriptionsArray = descriptionsArray.map((d: string) => sanitizePolicySensitiveText(d, 90))

    // 兜底：政策净化后再次执行文本护栏，确保无断词断句
    const headlineGuardedAfterPolicy = headlinesArray.map((h: string) =>
      applyHeadlineTextGuardrail(h, 30)
    )
    const descriptionGuardedAfterPolicy = descriptionsArray.map((d: string) =>
      applyDescriptionTextGuardrail(d, 90)
    )
    const headlineGuardFixesAfterPolicy = headlineGuardedAfterPolicy.filter(
      (h, idx) => h !== headlinesArray[idx]
    ).length
    const descriptionGuardFixesAfterPolicy = descriptionGuardedAfterPolicy.filter(
      (d, idx) => d !== descriptionsArray[idx]
    ).length
    if (headlineGuardFixesAfterPolicy > 0 || descriptionGuardFixesAfterPolicy > 0) {
      console.log(
        `🔧 文本护栏(政策后): headlines ${headlineGuardFixesAfterPolicy} 条, descriptions ${descriptionGuardFixesAfterPolicy} 条`
      )
    }
    headlinesArray = headlineGuardedAfterPolicy
    descriptionsArray = descriptionGuardedAfterPolicy

    if (headlinesWithMetadata) {
      headlinesWithMetadata = headlinesWithMetadata.map((h, idx) => ({
        ...h,
        text: headlinesArray[idx] || '',
        length: Math.min(30, (headlinesArray[idx] || '').length),
      }))
    }

    if (descriptionsWithMetadata) {
      descriptionsWithMetadata = descriptionsWithMetadata.map((d, idx) => ({
        ...d,
        text: descriptionsArray[idx] || '',
        length: Math.min(90, (descriptionsArray[idx] || '').length),
      }))
    }

    // Google Ads RSA 数量上限防御（Headlines ≤15, Descriptions ≤4）

    if (headlinesArray.length > 15) {
      console.warn(`⚠️ headlines 超过15个（${headlinesArray.length}），已截断为15个`)
      headlinesArray = headlinesArray.slice(0, 15)
      if (headlinesWithMetadata) {
        headlinesWithMetadata = headlinesWithMetadata.slice(0, 15)
      }
    }

    if (descriptionsArray.length > 4) {
      console.warn(`⚠️ descriptions 超过4个（${descriptionsArray.length}），已截断为4个`)
      descriptionsArray = descriptionsArray.slice(0, 4)
      if (descriptionsWithMetadata) {
        descriptionsWithMetadata = descriptionsWithMetadata.slice(0, 4)
      }
    }

    // 全大写检测工具函数（Google Ads 会因 excessive capitalization 拒登）
    const isExcessiveCaps = (s: string): boolean => {
      const letters = s.replace(/[^a-zA-Z]/g, '')
      return letters.length >= 3 && letters === letters.toUpperCase()
    }
    const toTitleCase = (s: string): string => {
      return s.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
    }

    // 验证 Callouts 长度 (≤25 字符)

    let calloutsArray = Array.isArray(data.callouts) ? data.callouts : []
    const invalidCallouts = calloutsArray.filter((c: string) => c && c.length > 25)
    if (invalidCallouts.length > 0) {
      console.warn(`警告: ${invalidCallouts.length}个callout超过25字符限制`)
      console.warn(
        `  超长callouts: ${invalidCallouts.map((c: string) => `"${c}"(${c.length}字符)`).join(', ')}`
      )
      // 截断过长的callouts
      calloutsArray = calloutsArray.map((c: string) => {
        if (c && c.length > 25) {
          const truncated = c.substring(0, 25)
          console.warn(`  截断: "${c}" → "${truncated}"`)
          return truncated
        }
        return c
      })
    }
    calloutsArray = calloutsArray.map((c: string) =>
      sanitizePolicySensitiveText(String(c || ''), 25)
    )

    // 检测并修正全大写的 callout 文案（与 sitelink 同理）
    calloutsArray = calloutsArray.map((c: string) => {
      if (typeof c === 'string' && isExcessiveCaps(c)) {
        const fixed = toTitleCase(c)
        console.log(`🔧 修正全大写callout: "${c}" → "${fixed}"`)
        return fixed
      }
      return c
    })

    // 验证 Sitelinks 长度 (text≤25, desc≤35)

    let sitelinksArray = Array.isArray(data.sitelinks) ? data.sitelinks : []

    // 兼容：AI 有时输出 description1/description2、description 或 description_1/description_2
    // 统一归一为 { text, url, description1?, description2? }
    const normalizeSitelink = (raw: any) => {
      const normalized = normalizeSitelinkItem(raw, '/')
      if (!normalized) return null

      const text = sanitizePolicySensitiveText(removeProhibitedSymbols(normalized.text).trim(), 25)
      if (!text) return null

      const url = String(normalized.url).trim() || '/'
      const description1 = normalized.description1
        ? sanitizePolicySensitiveText(removeProhibitedSymbols(normalized.description1).trim(), 35)
        : undefined
      const description2 = normalized.description2
        ? sanitizePolicySensitiveText(removeProhibitedSymbols(normalized.description2).trim(), 35)
        : undefined

      return { text, url, description1, description2 }
    }

    sitelinksArray = sitelinksArray.map(normalizeSitelink).filter((v: any) => v !== null)

    // 检测并修正全大写的 sitelink 文案
    sitelinksArray = sitelinksArray.map((s: any) => {
      if (!s) return s
      let changed = false
      let text = s.text
      let description1 = s.description1
      let description2 = s.description2
      if (typeof text === 'string' && isExcessiveCaps(text)) {
        text = toTitleCase(text)
        changed = true
      }
      if (typeof description1 === 'string' && isExcessiveCaps(description1)) {
        description1 = toTitleCase(description1)
        changed = true
      }
      if (typeof description2 === 'string' && isExcessiveCaps(description2)) {
        description2 = toTitleCase(description2)
        changed = true
      }
      if (changed) {
        console.log(`🔧 修正全大写sitelink: "${s.text}" → "${text}"`)
      }
      return changed ? { ...s, text, description1, description2 } : s
    })

    const invalidSitelinks = sitelinksArray.filter(
      (s: any) =>
        s && (s.text?.length > 25 || s.description1?.length > 35 || s.description2?.length > 35)
    )
    if (invalidSitelinks.length > 0) {
      // 理论上已在 normalize 中截断，这里仅用于兜底日志
      console.warn(`警告: ${invalidSitelinks.length}个sitelink超过长度限制（将自动截断）`)
      sitelinksArray = sitelinksArray.map((s: any) => {
        if (!s) return s
        return {
          ...s,
          text: typeof s.text === 'string' ? s.text.substring(0, 25) : s.text,
          description1:
            typeof s.description1 === 'string' ? s.description1.substring(0, 35) : s.description1,
          description2:
            typeof s.description2 === 'string' ? s.description2.substring(0, 35) : s.description2,
        }
      })
    }

    // 验证关键词长度 (1-10 个单词)
    // 放宽到10个单词，符合Google Ads实际限制
    // Google Ads允许最多10个单词的关键词

    let keywordsArray = Array.isArray(data.keywords)
      ? data.keywords.map((k: any) => String(k || '').trim()).filter(Boolean)
      : []
    const policySafeKeywords = sanitizeKeywordListForGoogleAdsPolicy(keywordsArray, {
      mode: policyGuardMode,
    })
    if (policySafeKeywords.changedCount > 0 || policySafeKeywords.droppedCount > 0) {
      console.log(
        `🛡️ 关键词政策净化: 替换${policySafeKeywords.changedCount}个, 丢弃${policySafeKeywords.droppedCount}个`
      )
    }
    keywordsArray = policySafeKeywords.items
    const invalidKeywords = keywordsArray.filter((k: string) => {
      if (!k) return false
      const wordCount = k.trim().split(/\s+/).length
      return wordCount < 1 || wordCount > 10
    })
    if (invalidKeywords.length > 0) {
      console.warn(`警告: ${invalidKeywords.length}个keyword不符合1-10单词要求`)
      invalidKeywords.forEach((k: string) => {
        const wordCount = k.trim().split(/\s+/).length
        console.warn(`  "${k}"(${wordCount}个单词)`)
      })
      // 过滤不符合要求的关键词
      const originalCount = keywordsArray.length
      keywordsArray = keywordsArray.filter((k: string) => {
        if (!k) return false
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 10
      })
      console.warn(`  长度过滤后: ${originalCount} → ${keywordsArray.length}个关键词`)
    }

    // 关键词去重（AI可能生成重复关键词）
    const originalKeywordCount = keywordsArray.length
    const seenKeywords = new Set<string>()
    keywordsArray = keywordsArray.filter((k: string) => {
      const normalized = k.toLowerCase().trim()
      if (seenKeywords.has(normalized)) {
        return false
      }
      seenKeywords.add(normalized)
      return true
    })
    if (keywordsArray.length < originalKeywordCount) {
      console.warn(
        `⚠️ 关键词去重: ${originalKeywordCount} → ${keywordsArray.length}个关键词 (移除 ${originalKeywordCount - keywordsArray.length} 个重复)`
      )
    }

    // 解析quality_metrics（如果存在）
    const qualityMetrics = data.quality_metrics
      ? {
          headline_diversity_score: data.quality_metrics.headline_diversity_score,
          keyword_relevance_score: data.quality_metrics.keyword_relevance_score,
        }
      : undefined

    if (qualityMetrics) {
      console.log('📊 Headline多样性:', qualityMetrics.headline_diversity_score)
      console.log('📊 关键词相关性:', qualityMetrics.keyword_relevance_score)
    }

    // v4.7: 解析 Display Path (path1/path2)
    let path1: string | undefined = data.path1
    let path2: string | undefined = data.path2

    // 验证并截断 path1/path2 (最多15字符)
    if (path1 && path1.length > 15) {
      console.warn(`⚠️ path1 超过15字符限制: "${path1}" (${path1.length}字符)`)
      path1 = path1.substring(0, 15)
      console.log(`  截断为: "${path1}"`)
    }
    if (path2 && path2.length > 15) {
      console.warn(`⚠️ path2 超过15字符限制: "${path2}" (${path2.length}字符)`)
      path2 = path2.substring(0, 15)
      console.log(`  截断为: "${path2}"`)
    }

    // 移除path中的空格（Google Ads Display Path不允许空格）
    if (path1) {
      path1 = path1.replace(/\s+/g, '-')
    }
    if (path2) {
      path2 = path2.replace(/\s+/g, '-')
    }

    if (path1 || path2) {
      console.log(`📍 Display Path: ${path1 || '(无)'}/${path2 || '(无)'}`)
    }

    return {
      // 核心字段（向后兼容）
      headlines: headlinesArray,
      descriptions: descriptionsArray,
      keywords: keywordsArray, // 使用验证后的关键词
      callouts: calloutsArray, // 使用验证后的 callouts
      sitelinks: sitelinksArray, // 使用验证后的 sitelinks
      theme: data.theme || '通用广告',
      explanation: data.explanation || '基于产品信息生成的广告创意',

      // v4.7: RSA Display Path
      path1,
      path2,

      // 新增字段（可选）
      copyAngle,
      evidenceProducts: evidenceProducts.length > 0 ? evidenceProducts : undefined,
      keywordCandidates: keywordCandidates.length > 0 ? keywordCandidates : undefined,
      cannotGenerateReason,
      headlinesWithMetadata,
      descriptionsWithMetadata,
      qualityMetrics,
    }
  } catch (error) {
    console.error('解析AI响应失败:', error)
    console.error('原始响应前500字符:', text.substring(0, 500))
    console.error('提取JSON前1000字符:', jsonText.substring(0, 1000))
    console.error('提取JSON后500字符:', jsonText.substring(Math.max(0, jsonText.length - 500)))
    throw new Error(`AI响应解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}
