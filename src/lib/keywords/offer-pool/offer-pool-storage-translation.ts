/**
 * 关键词池：目标语言翻译与术语规范化
 */
import {
  generateContent,
  repairJsonText,
  loadPrompt,
  interpolateTemplate,
  recordTokenUsage,
  estimateTokenCost,
  buildUntrustedInputGuardrail,
  sanitizePromptBlockValue,
  sanitizePromptInlineValue,
  type InputReview,
} from '../../ai/server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { isPureBrandKeyword } from '../server'
import { analyzeKeywordLanguageCompatibility } from '../server'
import { extractFirstJsonObject } from './keyword-clustering'

const TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE = 24
const TARGET_LANGUAGE_TRANSLATION_NEUTRAL_TOKENS = new Set([
  'nsf',
  'ansi',
  'etl',
  'ul',
  'fcc',
  'ce',
  'rohs',
  'gpd',
  'btu',
  'mah',
  'wh',
  'w',
  'kw',
  'v',
  'psi',
  'db',
  'hz',
  'khz',
  'mhz',
  'ghz',
  'mm',
  'cm',
  'inch',
  'in',
  'ft',
  'l',
  'ml',
  'kg',
  'lb',
  'lbs',
])

function parseBooleanFeatureFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(size))
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

function buildTranslationPrompt(params: {
  promptTemplate: string
  targetLanguage: string
  keywords: string[]
}): string {
  const reviewedInputs: InputReview[] = []
  const numbered = params.keywords.map((keyword, index) => `${index}. ${keyword}`).join('\n')

  const variables = {
    targetLanguage: sanitizePromptInlineValue(
      reviewedInputs,
      'keyword_translation_target_language',
      params.targetLanguage,
      40,
      'English'
    ),
    keywordsBlock: sanitizePromptBlockValue(
      reviewedInputs,
      'keyword_translation_keywords',
      numbered,
      4000,
      '0. keyword'
    ),
  }

  return interpolateTemplate(params.promptTemplate, {
    inputGuardrail: buildUntrustedInputGuardrail(reviewedInputs),
    ...variables,
  })
}

function parseTranslationResponse(text: string): Array<{ index: number; keyword: string }> {
  const parseRawJson = (rawText: string): any => {
    return JSON.parse(rawText)
  }

  const parseCandidates = [text]
  const firstJson = extractFirstJsonObject(text)
  if (firstJson) parseCandidates.push(firstJson)

  let parsed: any = null
  for (const candidate of parseCandidates) {
    try {
      parsed = parseRawJson(candidate)
      break
    } catch {
      try {
        parsed = parseRawJson(repairJsonText(candidate))
        break
      } catch {
        // Ignore and continue trying the next candidate.
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') return []
  const translations = Array.isArray((parsed as any).translations)
    ? (parsed as any).translations
    : []

  return translations
    .map((item: any) => ({
      index: Number(item?.index),
      keyword: String(item?.keyword || '').trim(),
    }))
    .filter(
      (item: { index: number; keyword: string }) =>
        Number.isInteger(item.index) && item.index >= 0 && item.keyword.length > 0
    )
}

function buildTranslationNeutralTokenSet(pureBrandKeywords: string[]): Set<string> {
  const out = new Set<string>(TARGET_LANGUAGE_TRANSLATION_NEUTRAL_TOKENS)
  for (const brandKeyword of pureBrandKeywords) {
    const normalized = normalizeGoogleAdsKeyword(brandKeyword) || ''
    if (!normalized) continue
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      out.add(token)
    }
  }
  return out
}

function isNeutralTokenForTranslation(token: string, neutralTokens: Set<string>): boolean {
  if (!token) return true
  if (neutralTokens.has(token)) return true
  if (/^\d+$/.test(token)) return true
  if (/^[a-z]*\d+[a-z0-9-]*$/i.test(token)) return true
  if (/^\d+[a-z]{1,4}$/i.test(token)) return true
  return false
}

function shouldAttemptTranslationForKeyword(params: {
  keyword: string
  pureBrandKeywords: string[]
}): boolean {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return false
  if (isPureBrandKeyword(normalized, params.pureBrandKeywords)) return false

  const neutralTokens = buildTranslationNeutralTokenSet(params.pureBrandKeywords)
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false

  const hasNonNeutralToken = tokens.some(
    (token) => !isNeutralTokenForTranslation(token, neutralTokens)
  )
  return hasNonNeutralToken
}

export async function translateKeywordsToTargetLanguage(params: {
  userId?: number
  targetLanguage?: string | null
  keywords: string[]
}): Promise<Map<string, string>> {
  const userId = Number(params.userId)
  const targetLanguage = String(params.targetLanguage || '').trim()
  const translationEnabled = parseBooleanFeatureFlag(
    process.env.OFFER_KEYWORD_TARGET_LANGUAGE_TRANSLATION_ENABLED,
    true
  )
  const out = new Map<string, string>()

  if (!translationEnabled || !Number.isFinite(userId) || userId <= 0) return out
  if (!targetLanguage || params.keywords.length === 0) return out
  const promptTemplate = await loadPrompt('keyword_translation_normalization')

  for (const chunk of splitIntoChunks(
    params.keywords,
    TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE
  )) {
    const uniqueChunkKeywords = Array.from(
      new Set(chunk.map((keyword) => String(keyword || '').trim()).filter(Boolean))
    )
    if (uniqueChunkKeywords.length === 0) continue

    try {
      const aiResponse = await generateContent(
        {
          operationType: 'keyword_translation_normalization',
          prompt: buildTranslationPrompt({
            promptTemplate,
            targetLanguage,
            keywords: uniqueChunkKeywords,
          }),
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseSchema: {
            type: 'OBJECT',
            properties: {
              translations: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    index: { type: 'INTEGER' },
                    keyword: { type: 'STRING' },
                  },
                  required: ['index', 'keyword'],
                },
              },
            },
            required: ['translations'],
          },
          responseMimeType: 'application/json',
        },
        userId
      )

      if (aiResponse.usage) {
        const cost = estimateTokenCost(
          aiResponse.model,
          aiResponse.usage.inputTokens,
          aiResponse.usage.outputTokens
        )
        await recordTokenUsage({
          userId,
          model: aiResponse.model,
          operationType: 'keyword_translation_normalization',
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
          cost,
          apiType: aiResponse.apiType,
        })
      }

      const parsed = parseTranslationResponse(aiResponse.text)
      for (const item of parsed) {
        const sourceKeyword = uniqueChunkKeywords[item.index]
        if (!sourceKeyword) continue
        const translated = String(item.keyword || '').trim()
        if (!translated) continue
        out.set(sourceKeyword, translated)
      }
    } catch (error: any) {
      console.warn(
        `[VerifiedSource] 目标语翻译失败，回退为语言过滤: ${error?.message || String(error)}`
      )
    }
  }

  return out
}

export async function normalizeKeywordTermsByTargetLanguage(params: {
  userId?: number
  keywords: string[]
  targetLanguage?: string | null
  pureBrandKeywords: string[]
}): Promise<{ keywords: string[]; removed: number; translated: number }> {
  const out: string[] = []
  const seen = new Set<string>()
  let removed = 0
  let translated = 0
  const candidatesNeedingTranslation: string[] = []

  for (const rawKeyword of params.keywords) {
    const raw = String(rawKeyword || '').trim()
    const normalized = normalizeGoogleAdsKeyword(raw)
    if (!raw || !normalized) continue

    const compatibility = analyzeKeywordLanguageCompatibility({
      keyword: raw,
      targetLanguage: params.targetLanguage || undefined,
      pureBrandKeywords: params.pureBrandKeywords,
    })
    if (compatibility.hardReject) {
      if (
        shouldAttemptTranslationForKeyword({
          keyword: raw,
          pureBrandKeywords: params.pureBrandKeywords,
        })
      ) {
        candidatesNeedingTranslation.push(raw)
        continue
      }
      removed += 1
      continue
    }

    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(raw)
  }

  if (candidatesNeedingTranslation.length > 0) {
    const translatedKeywordMap = await translateKeywordsToTargetLanguage({
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      keywords: candidatesNeedingTranslation,
    })

    for (const sourceKeyword of candidatesNeedingTranslation) {
      const candidate = translatedKeywordMap.get(sourceKeyword) || sourceKeyword
      const normalizedCandidate = normalizeGoogleAdsKeyword(candidate)
      if (!normalizedCandidate) {
        removed += 1
        continue
      }

      const candidateCompatibility = analyzeKeywordLanguageCompatibility({
        keyword: candidate,
        targetLanguage: params.targetLanguage || undefined,
        pureBrandKeywords: params.pureBrandKeywords,
      })
      if (candidateCompatibility.hardReject) {
        removed += 1
        continue
      }

      if (seen.has(normalizedCandidate)) continue
      seen.add(normalizedCandidate)
      out.push(candidate)
      if (normalizeGoogleAdsKeyword(sourceKeyword) !== normalizedCandidate) {
        translated += 1
      }
    }
  }

  return { keywords: out, removed, translated }
}
