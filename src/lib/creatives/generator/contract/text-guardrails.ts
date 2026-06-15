import { getGoogleAdsTextEffectiveLength } from '@/lib/google-ads/common/ad-text'
import { buildDkiKeywordHeadline } from '../prompts'
import { normalizeSnippetText } from '../utils'
import { HEADLINE_DANGLING_TAIL_TOKENS } from './headline-tokens'

export const LATIN_HEADLINE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

export function normalizeHeadlineCandidateText(value: string): string {
  return normalizeSnippetText(value)
    .replace(/[{}]/g, '')
    .replace(/[•|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function shouldSplitTitleSegmentAt(raw: string, index: number): boolean {
  const char = raw[index]
  if (char === '|' || char === ':' || char === ';') return true
  if (char !== ',') return false

  const prev = raw[index - 1] || ''
  const next = raw[index + 1] || ''
  if (/\d/.test(prev) && /\d/.test(next)) {
    return false
  }
  return true
}

export function splitTitleSegmentsSafely(title: string): string[] {
  const raw = String(title || '').trim()
  if (!raw) return []

  const segments: string[] = []
  let start = 0
  for (let index = 0; index < raw.length; index += 1) {
    if (!shouldSplitTitleSegmentAt(raw, index)) continue
    const segment = normalizeHeadlineCandidateText(raw.slice(start, index))
    if (segment) segments.push(segment)
    start = index + 1
  }

  const tail = normalizeHeadlineCandidateText(raw.slice(start))
  if (tail) segments.push(tail)
  return segments
}

export function trimTextToWordBoundary(text: string, maxLength: number): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length <= maxLength) return normalized
  if (maxLength <= 0) return ''

  let truncated = normalized.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace >= Math.max(6, Math.floor(maxLength * 0.55))) {
    truncated = truncated.slice(0, lastSpace)
  }

  return truncated.replace(/\s+/g, ' ').trim()
}

export function dropDanglingTailFragment(text: string): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return normalized
  const parts = normalized.split(' ')
  if (parts.length < 2) return normalized

  const tail = parts[parts.length - 1]
  const tailLetters = tail.replace(/[^\p{L}]/gu, '')
  if (tailLetters.length <= 2 && !/[.!?]$/.test(normalized)) {
    return parts.slice(0, -1).join(' ').trim()
  }
  return normalized
}

export function balanceHeadlineParentheses(text: string): string {
  let normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return normalized

  let open = (normalized.match(/\(/g) || []).length
  let close = (normalized.match(/\)/g) || []).length
  if (open === close) return normalized

  if (open > close) {
    let toRemove = open - close
    for (let i = normalized.length - 1; i >= 0 && toRemove > 0; i -= 1) {
      if (normalized[i] !== '(') continue
      normalized = `${normalized.slice(0, i)}${normalized.slice(i + 1)}`
      toRemove -= 1
    }
  } else {
    let toRemove = close - open
    for (let i = normalized.length - 1; i >= 0 && toRemove > 0; i -= 1) {
      if (normalized[i] !== ')') continue
      normalized = `${normalized.slice(0, i)}${normalized.slice(i + 1)}`
      toRemove -= 1
    }
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

export function stripHeadlineTrailingPunctuation(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[;,.:|/&+\-]+$/g, '')
    .trim()
}

export function trimDanglingHeadlineTailToken(text: string): string {
  let normalized = stripHeadlineTrailingPunctuation(text)
  if (!normalized) return normalized

  for (let i = 0; i < 2; i += 1) {
    const parts = normalized.split(/\s+/).filter(Boolean)
    if (parts.length < 2) break

    const tailToken = parts[parts.length - 1].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

    if (!tailToken || !HEADLINE_DANGLING_TAIL_TOKENS.has(tailToken)) {
      break
    }

    normalized = stripHeadlineTrailingPunctuation(parts.slice(0, -1).join(' '))
  }

  return normalized
}

export function applyHeadlineTextGuardrail(text: string, maxLength: number): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return normalized

  const hasDki = /\{KeyWord:[^}]*\}/i.test(normalized)
  if (hasDki && getGoogleAdsTextEffectiveLength(normalized) > maxLength) {
    const match = normalized.match(/\{KeyWord:([^}]*)\}/i)
    if (match) {
      return buildDkiKeywordHeadline(match[1], maxLength)
    }
  }

  let output = normalized
  if (!hasDki && output.length > maxLength) {
    output = trimTextToWordBoundary(output, maxLength)
    output = dropDanglingTailFragment(output)
  }

  if (!hasDki) {
    const cleanedTail = trimDanglingHeadlineTailToken(output)
    if (cleanedTail) output = cleanedTail
  }

  output = balanceHeadlineParentheses(output)
  return output.replace(/\s+/g, ' ').trim()
}

export function stripHeadlineNumericSuffixArtifact(text: string): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return normalized
  // Historical dedupe fallback used one-digit numeric suffixes (e.g. "Headline 2").
  // Keep legitimate product specs like "12 inch" / "14 inch" intact.
  const match = normalized.match(/^(.*\D)\s([2-9])$/)
  if (!match) return normalized
  const base = match[1].trim()
  if (base.length < 8) return normalized
  return base
}

export function applyDescriptionTextGuardrail(text: string, maxLength: number): string {
  let normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return normalized
  if (normalized.length > maxLength) {
    normalized = trimTextToWordBoundary(normalized, maxLength)
    normalized = dropDanglingTailFragment(normalized)
  }

  normalized = normalized.replace(/[;,:-]\s*$/g, '').trim()
  if (normalized && !/[.!?]$/.test(normalized)) {
    if (normalized.length + 1 <= maxLength) {
      normalized = `${normalized}.`
    }
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

export const MODEL_INTENT_TRANSACTIONAL_MODIFIER_PATTERN =
  /\b(buy|purchase|order|shop|shopping|shops|price|pricing|cost|deal|deals|discount|sale|offer|coupon|promo|store)\b/i
