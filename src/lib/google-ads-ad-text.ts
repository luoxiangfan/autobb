/**
 * Google Ads 文案工具
 * - DKI（Dynamic Keyword Insertion）: {KeyWord:DefaultText}
 *   Google Ads 字符计数通常按 DefaultText + token 外文本计算（不计入 "{KeyWord:...}" 结构本身）。
 */

const DKI_PATTERN = /\{keyword:([^}]*)\}/gi

export const GOOGLE_ADS_PROHIBITED_SYMBOLS = [
  '★', '☆', '⭐', '🌟', '✨', // stars
  '©', '®', '™',             // copyright/trademark
  '•', '●', '◆', '▪',        // bullets
  '→', '←', '↑', '↓',        // arrows
  '✓', '✔', '✗', '✘',        // checkmarks
  '❤', '♥', '♡',             // hearts
  '⚡', '🔥', '💎',           // decorative emoji
  '👍', '👎',                 // gestures
  '"',                       // straight double quote (observed SYMBOLS policy hits)
  '”', '”', '”', '„', '‟', '«', '»', // double curly quotes (observed SYMBOLS policy hits)
  '\u2018', '\u2019',        // single curly quotes (observed SYMBOLS policy hits)
  '₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉', // subscript digits
  '；',                      // fullwidth semicolon
  '(', ')',                  // parentheses (observed SYMBOLS policy hits)
  '|',                       // pipe (can trigger SYMBOLS policy in some contexts)
]

const EMOJI_REGEX = /[\p{Extended_Pictographic}]/gu
const EMOJI_JOINERS_REGEX = /[\u200D\uFE0E\uFE0F]/g
const PRESERVED_UPPERCASE_TOKENS = new Set([
  'AI', 'AMD', 'API', 'ASUS', 'BBC', 'BMW', 'CEO', 'CFO', 'CIA', 'CNN', 'CPU', 'CPA', 'CTO',
  'DELL', 'DVD', 'EU', 'ESPN', 'FBI', 'GPS', 'GPU', 'HBO', 'HDD', 'HD', 'HP', 'IBM', 'LCD',
  'LED', 'LG', 'MTV', 'NASA', 'NBA', 'NFL', 'NHL', 'PPC', 'RAM', 'RGB', 'ROI', 'ROM', 'SEO',
  'SSD', 'TV', 'UAE', 'UHD', 'UK', 'USA', 'USB', 'US'
])

function hasExcessiveCapitalization(text: string): boolean {
  const letters = text.match(/[A-Za-z]/g) || []
  if (letters.length < 6) return false

  const upperCount = (text.match(/[A-Z]/g) || []).length
  if (upperCount / letters.length < 0.6) return false

  const uppercaseWords = text.match(/\b[A-Z]{2,}\b/g) || []
  return uppercaseWords.length >= 2
}

function toTitleCaseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[-'])[a-z]/g, token => token.toUpperCase())
}

function sanitizeExcessiveCapitalization(text: string): string {
  if (!hasExcessiveCapitalization(text)) return text

  return text.replace(/\b[A-Z][A-Z'&-]*\b/g, (word) => {
    const compact = word.replace(/['&-]/g, '')
    if (!compact || compact.length <= 1) return word
    if (PRESERVED_UPPERCASE_TOKENS.has(compact)) return word
    return toTitleCaseWord(word)
  })
}

export function findGoogleAdsProhibitedSymbols(text: string): string[] {
  const input = String(text ?? '')
  const found = new Set<string>()
  for (const symbol of GOOGLE_ADS_PROHIBITED_SYMBOLS) {
    if (input.includes(symbol)) found.add(symbol)
  }
  const emojiMatches = input.match(EMOJI_REGEX) || []
  emojiMatches.forEach(e => found.add(e))
  return Array.from(found)
}

export function sanitizeGoogleAdsSymbols(text: string): { text: string; removed: string[] } {
  const input = String(text ?? '')
  const removed = findGoogleAdsProhibitedSymbols(input)
  let cleaned = input
  for (const symbol of GOOGLE_ADS_PROHIBITED_SYMBOLS) {
    if (cleaned.includes(symbol)) {
      cleaned = cleaned.replace(new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')
    }
  }
  cleaned = cleaned
    .replace(EMOJI_REGEX, ' ')
    .replace(EMOJI_JOINERS_REGEX, ' ')
    // Normalize compatibility characters (e.g. 𝗔/𝟭) to plain forms.
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
  return { text: cleaned, removed }
}

export function getGoogleAdsTextEffectiveLength(text: string): number {
  const input = String(text ?? '')

  // Google Ads 的“字符长度”在部分双字节语言中会按更严格的规则计算；
  // 这里将常见的东亚宽字符（含标点/全角形式）按 2 计数，避免 API 侧报 Too long。
  const cjkPattern = /[\u3000-\u303F\u3040-\u30FF\u31F0-\u31FF\u3300-\u33FF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/
  const weightedLength = (value: string): number => {
    let total = 0
    for (const ch of Array.from(value)) {
      total += cjkPattern.test(ch) ? 2 : 1
    }
    return total
  }

  let total = 0
  let lastIndex = 0

  for (const match of input.matchAll(DKI_PATTERN)) {
    const matchText = match[0] || ''
    const defaultText = match[1] || ''
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) continue

    total += weightedLength(input.slice(lastIndex, matchIndex))
    total += weightedLength(defaultText)
    lastIndex = matchIndex + matchText.length
  }

  total += weightedLength(input.slice(lastIndex))
  return total
}

function truncateByEffectiveLength(text: string, maxLen: number): string {
  const input = String(text ?? '')
  if (maxLen <= 0) return ''

  const cjkPattern = /[\u3000-\u303F\u3040-\u30FF\u31F0-\u31FF\u3300-\u33FF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/
  const charWeight = (ch: string) => (cjkPattern.test(ch) ? 2 : 1)

  const takePlain = (value: string, budget: number): { text: string; used: number } => {
    let used = 0
    let out = ''
    for (const ch of Array.from(value)) {
      const w = charWeight(ch)
      if (used + w > budget) break
      out += ch
      used += w
    }
    return { text: out, used }
  }

  let out = ''
  let budget = maxLen
  let lastIndex = 0

  for (const match of input.matchAll(DKI_PATTERN)) {
    const token = match[0] || ''
    const defaultText = match[1] || ''
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) continue

    const before = input.slice(lastIndex, matchIndex)
    const beforeTaken = takePlain(before, budget)
    out += beforeTaken.text
    budget -= beforeTaken.used
    if (budget <= 0) return out.trim()

    const defaultTaken = takePlain(defaultText, budget)
    if (defaultTaken.text.length === 0) return out.trim()

    const colonIndex = token.indexOf(':')
    const tokenPrefix = colonIndex >= 0 ? token.slice(0, colonIndex + 1) : '{keyword:'
    out += `${tokenPrefix}${defaultTaken.text}}`
    budget -= defaultTaken.used
    lastIndex = matchIndex + token.length
    if (budget <= 0) return out.trim()
  }

  const tail = input.slice(lastIndex)
  out += takePlain(tail, budget).text
  return out.trim()
}

export function sanitizeGoogleAdsAdText(text: string, maxLen: number): string {
  const original = String(text ?? '')
  const symbolSanitized = sanitizeGoogleAdsSymbols(
    original
      .replace(/±/g, '+/-')
      // Google Ads policy: SYMBOLS (PROHIBITED) evidence: "~"
      .replace(/[~～]/g, ' ')
  )
  const replaced = sanitizeExcessiveCapitalization(symbolSanitized.text)
  if (getGoogleAdsTextEffectiveLength(replaced) <= maxLen) return replaced

  // 如果替换导致超长，回退为移除该符号，优先保证长度合规
  const removed = original
    .replace(/±/g, '')
    .replace(/[~～]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (getGoogleAdsTextEffectiveLength(removed) <= maxLen) return removed

  // 🔧 兜底：自动截断，避免发布失败（包含CJK字符权重 & DKI token 保护）
  return truncateByEffectiveLength(replaced, maxLen)
}

export function sanitizeGoogleAdsPath(text: string, maxLen: number = 15): string {
  const original = String(text ?? '')
  const symbolSanitized = sanitizeGoogleAdsSymbols(original).text
  const capsSanitized = sanitizeExcessiveCapitalization(symbolSanitized)
  const collapsed = capsSanitized
    .replace(/[~～]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^-+/, '')
    .replace(/-+$/, '')

  if (collapsed.length <= maxLen) return collapsed

  const chars = Array.from(collapsed)
  return chars.slice(0, maxLen).join('')
}

export function sanitizeGoogleAdsFinalUrlSuffix(value: string): string {
  const original = String(value ?? '')
  if (!original) return ''
  const symbolSanitized = sanitizeGoogleAdsSymbols(original).text
  return symbolSanitized
    .replace(/[~～]/g, '')
    .replace(/\s+/g, '')
    .trim()
}
