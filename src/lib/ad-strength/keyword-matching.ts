import { MULTILINGUAL_CTA_WORDS } from './lexicons'

export function resolveLanguageKey(language?: string): string {
  const normalized = String(language || 'en')
    .trim()
    .toLowerCase()
  if (!normalized) return 'en'

  const aliasMap: Record<string, string> = {
    chinese: 'zh',
    mandarin: 'zh',
    japanese: 'ja',
    korean: 'ko',
    german: 'de',
    french: 'fr',
    spanish: 'es',
    italian: 'it',
    portuguese: 'pt',
    dutch: 'nl',
    swedish: 'sv',
    norwegian: 'no',
    danish: 'da',
    finnish: 'fi',
    polish: 'pl',
    russian: 'ru',
    arabic: 'ar',
    turkish: 'tr',
    vietnamese: 'vi',
    thai: 'th',
  }

  const direct = normalized.split(/[-_]/)[0]
  if (MULTILINGUAL_CTA_WORDS[direct]) return direct
  if (aliasMap[normalized]) return aliasMap[normalized]
  if (aliasMap[direct]) return aliasMap[direct]

  return 'en'
}

export function containsLocalizedPhrase(
  text: string,
  dict: Record<string, string[]>,
  languageKey: string
): boolean {
  const lowerText = String(text || '').toLowerCase()
  if (!lowerText) return false
  const words = [...(dict[languageKey] || []), ...(dict.en || [])]
  return words.some((word) => lowerText.includes(word.toLowerCase()))
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeForKeywordMatching(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeForKeywordMatching(text: string): string[] {
  const normalized = normalizeForKeywordMatching(text)
  return normalized ? normalized.split(' ') : []
}

function stemKeywordToken(token: string): string {
  const normalized = String(token || '').toLowerCase()
  if (normalized.length <= 4) return normalized
  return normalized.replace(/(ing|ed|es|s)$/i, '')
}

export function keywordAppearsInText(
  keyword: string,
  normalizedText: string,
  textTokenSet: Set<string>
): boolean {
  const normalizedKeyword = normalizeForKeywordMatching(keyword)
  if (!normalizedKeyword) return false

  const phrasePattern = new RegExp(
    `(^|\\s)${escapeRegex(normalizedKeyword).replace(/\s+/g, '\\s+')}(?=\\s|$)`,
    'i'
  )
  if (phrasePattern.test(normalizedText)) return true

  const keywordTokens = normalizedKeyword.split(' ').filter(Boolean)
  if (keywordTokens.length === 0) return false

  if (keywordTokens.length === 1) {
    const token = keywordTokens[0]
    if (textTokenSet.has(token)) return true
    const stem = stemKeywordToken(token)
    if (stem.length >= 4) {
      for (const textToken of textTokenSet) {
        if (textToken.startsWith(stem)) return true
      }
    }
    return false
  }

  return keywordTokens.every((token) => textTokenSet.has(token))
}

export function calculateKeywordDensityByToken(text: string, keywords: string[]): number {
  const words = tokenizeForKeywordMatching(text)
  if (words.length === 0) return 0

  const keywordTokenSet = new Set<string>()
  for (const keyword of keywords) {
    const keywordTokens = tokenizeForKeywordMatching(keyword)
    for (const token of keywordTokens) {
      keywordTokenSet.add(token)
      const stem = stemKeywordToken(token)
      if (stem.length >= 4) keywordTokenSet.add(stem)
    }
  }

  if (keywordTokenSet.size === 0) return 0

  const matches = words.filter((word) => {
    if (keywordTokenSet.has(word)) return true
    const stem = stemKeywordToken(word)
    return stem.length >= 4 && keywordTokenSet.has(stem)
  }).length

  return matches / words.length
}
