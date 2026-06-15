// 🔥 AI语义分类
// 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer' // 🔥 优化：Google Ads关键词标准化去重

// 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数

import { repairJsonText } from '../ai-json'

export function safeParseJson(value: any, defaultValue: any = null): any {
  if (value === null || value === undefined) return defaultValue
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (_e) {
      console.warn('[safeParseJson] 解析失败:', value)
      return defaultValue
    }
  }
  return value // 已经是对象/数组（PostgreSQL jsonb）
}

export function deriveLinkTypeFromScrapedData(scrapedData: any): 'store' | 'product' | null {
  if (!scrapedData || typeof scrapedData !== 'object') return null
  const explicit = typeof scrapedData.pageType === 'string' ? scrapedData.pageType : null
  if (explicit === 'store' || explicit === 'product') return explicit
  const productsLen = Array.isArray(scrapedData.products) ? scrapedData.products.length : 0
  const hasStoreName =
    typeof scrapedData.storeName === 'string' && scrapedData.storeName.trim().length > 0
  const hasDeep = !!scrapedData.deepScrapeResults
  if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
  return null
}

export function normalizeSnippetText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[•·]/g, ' ')
    .trim()
}

export function truncateSnippetByWords(value: string, maxLength: number): string {
  const text = normalizeSnippetText(value)
  if (text.length <= maxLength) return text
  const words = text.split(/\s+/)
  let out = ''
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (next.length > maxLength) break
    out = next
  }
  return out.length >= 4 ? out : text.slice(0, maxLength).trim()
}

export function isUsefulCreativePhrase(
  value: string,
  minLength: number = 4,
  maxLength: number = 90
): boolean {
  const text = normalizeSnippetText(value)
  if (!text || text.length < minLength || text.length > maxLength) return false
  const lower = text.toLowerCase()
  if (lower === 'about this item' || lower === 'product details') return false
  return /[\p{L}\p{N}]/u.test(text)
}

export function dedupeKeywordSeeds(keywords: string[], limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of keywords) {
    const cleaned = normalizeSnippetText(raw)
      .replace(/[^\p{L}\p{N}\s&/-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!isUsefulCreativePhrase(cleaned, 3, 80)) continue

    const normalized = normalizeGoogleAdsKeyword(cleaned)
    if (!normalized || seen.has(normalized)) continue

    seen.add(normalized)
    out.push(cleaned)
    if (out.length >= limit) break
  }

  return out
}

export function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function dedupePhrases(phrases: string[], limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const phrase of phrases) {
    const normalized = phrase.toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(phrase)
    if (out.length >= limit) break
  }
  return out
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function substitutePlaceholders(
  template: string,
  variables: Record<string, string>
): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`
    result = result.replace(
      new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      value
    )
  }
  return result
}

/**
 * 规范化非ASCII数字为ASCII数字
 * 将Bengali、Arabic、Devanagari等语言的数字转换为ASCII 0-9
 */

export function normalizeDigits(text: string): string {
  // 映射：非ASCII数字 → ASCII数字
  const digitMap: Record<string, string> = {
    // Bengali digits (০-৯)
    '০': '0',
    '১': '1',
    '২': '2',
    '৩': '3',
    '৪': '4',
    '৫': '5',
    '৬': '6',
    '৭': '7',
    '৮': '8',
    '৯': '9',
    // Arabic-Indic digits (٠-٩)
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
    // Persian/Extended Arabic-Indic digits (۰-۹)
    '۰': '0',
    '۱': '1',
    '۲': '2',
    '۳': '3',
    '۴': '4',
    '۵': '5',
    '۶': '6',
    '۷': '7',
    '۸': '8',
    '۹': '9',
    // Devanagari digits (०-९)
    '०': '0',
    '१': '1',
    '२': '2',
    '३': '3',
    '४': '4',
    '५': '5',
    '६': '6',
    '७': '7',
    '८': '8',
    '९': '9',
  }

  let normalized = text
  for (const [nonAscii, ascii] of Object.entries(digitMap)) {
    normalized = normalized.replace(new RegExp(nonAscii, 'g'), ascii)
  }
  return normalized
}

export function sanitizeJsonText(text: string): string {
  let jsonText = text.trim()

  // Remove trailing commas in arrays/objects.
  jsonText = jsonText.replace(/,\s*([}\]])/g, '$1')
  // Replace smart quotes with ASCII quotes.
  jsonText = jsonText.replace(/[“”]/g, '"')
  jsonText = jsonText.replace(/[‘’]/g, "'")
  // Remove stray debug identifiers between array items.
  jsonText = jsonText.replace(/],\s*[A-Z_]+\s*\n\s*"/g, '],\n  "')
  // Remove newlines inside string values while keeping structure.
  jsonText = jsonText.replace(/([a-zA-Z,.])\s*\n\s*([a-zA-Z])/g, '$1 $2')
  // Normalize non-ASCII digits to ASCII.
  jsonText = normalizeDigits(jsonText)
  // Remove _comment fields added by AI.
  jsonText = jsonText.replace(/,\s*_comment\s*:\s*["'][^"']*["']\s*,/g, ',')
  jsonText = jsonText.replace(/,\s*_comment\s*:\s*["'][^"']*["']/g, '')
  jsonText = jsonText.replace(/_comment\s*:\s*["'][^"']*["']\s*,/g, '')
  // Clean up duplicate commas or commas next to brackets.
  jsonText = jsonText.replace(/,\s*,/g, ',')
  jsonText = jsonText.replace(/([{\[]),/g, '$1')
  jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1')
  // Fix common invalid assignment operators.
  jsonText = jsonText.replace(/:\s*=/g, ':')
  jsonText = jsonText.replace(/=\s*:/g, ':')

  return repairJsonText(jsonText).trim()
}

export function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  const stack: string[] = []
  let startIndex = -1
  let inString: '"' | null = null
  let escape = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === '"') {
      inString = ch
      continue
    }

    if (ch === '{' || ch === '[') {
      if (stack.length === 0) {
        startIndex = i
      }
      stack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      if (stack.length === 0) {
        continue
      }

      const open = stack[stack.length - 1]
      const matches = (open === '{' && ch === '}') || (open === '[' && ch === ']')
      if (!matches) {
        continue
      }

      stack.pop()
      if (stack.length === 0 && startIndex !== -1) {
        candidates.push(text.slice(startIndex, i + 1))
        startIndex = -1
      }
    }
  }

  return candidates
}

export { calculateTextSimilarity, calculateEditDistance, getNgrams } from '../text-similarity'
