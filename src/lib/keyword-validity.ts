import { containsPureBrand, isPureBrandKeyword } from './brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { normalizeLanguageCode } from './language-country-codes'

type ScriptFamily =
  | 'latin'
  | 'han'
  | 'hiragana'
  | 'katakana'
  | 'hangul'
  | 'cyrillic'
  | 'arabic'
  | 'hebrew'
  | 'thai'

const SCRIPT_FAMILY_PATTERNS: Array<{ family: ScriptFamily; pattern: RegExp }> = [
  { family: 'latin', pattern: /[A-Za-z]/u },
  { family: 'han', pattern: /\p{Script=Han}/u },
  { family: 'hiragana', pattern: /\p{Script=Hiragana}/u },
  { family: 'katakana', pattern: /\p{Script=Katakana}/u },
  { family: 'hangul', pattern: /\p{Script=Hangul}/u },
  { family: 'cyrillic', pattern: /\p{Script=Cyrillic}/u },
  { family: 'arabic', pattern: /\p{Script=Arabic}/u },
  { family: 'hebrew', pattern: /\p{Script=Hebrew}/u },
  { family: 'thai', pattern: /\p{Script=Thai}/u },
]

const CYRILLIC_LANGUAGE_CODES = new Set(['ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'ky', 'uz'])
const LATIN_SCRIPT_LANGUAGE_CODES = new Set([
  'en', 'de', 'es', 'fr', 'it', 'pt', 'tr', 'pl', 'nl', 'sv', 'no', 'da', 'fi', 'cs', 'hu', 'ro'
])
const DEFAULT_ALLOWED_SCRIPT_FAMILIES = new Set<ScriptFamily>(['latin'])
const LANGUAGE_HINT_TOKENS: Record<string, Set<string>> = {
  en: new Set([
    'buy', 'price', 'deal', 'sale', 'shop', 'official', 'store', 'reviews',
    'review', 'best', 'compare', 'comparison', 'online'
  ]),
  de: new Set([
    'kaufen', 'kauf', 'preis', 'angebote', 'angebot', 'guenstig', 'günstig',
    'offiziell', 'bewertung', 'bewertungen', 'vergleich', 'deutschland', 'shop',
    'modellnummer', 'alkalisch', 'alkalische', 'alkalisches', 'alkalischen',
    'umkehrosmose', 'zertifiziert', 'zertifizierung', 'stufig', 'stufige',
    'stufigen', 'stufen', 'tanklos', 'abfluss', 'durchfluss', 'schneller',
    'untertisch', 'wasserfilter', 'wasserfiltersystem', 'garantie'
  ]),
  es: new Set([
    'comprar', 'precio', 'oferta', 'ofertas', 'tienda', 'oficial', 'reseñas',
    'resenas', 'comparar'
  ]),
  fr: new Set([
    'acheter', 'prix', 'offre', 'offres', 'boutique', 'officiel', 'avis',
    'comparaison'
  ]),
  it: new Set([
    'comprare', 'prezzo', 'offerta', 'offerte', 'negozio', 'ufficiale',
    'recensioni', 'confronto', 'acquista', 'garanzia', 'supporto', 'ordina'
  ]),
  pt: new Set([
    'comprar', 'preco', 'oferta', 'ofertas', 'loja', 'oficial', 'avaliacoes',
    'avaliações', 'comparacao', 'comparação'
  ]),
  tr: new Set([
    'satın', 'satin', 'fiyat', 'indirim', 'magaza', 'mağaza', 'resmi',
    'yorum', 'karsilastir', 'karşılaştır'
  ]),
  pl: new Set([
    'kupic', 'kupić', 'cena', 'oferta', 'oferty', 'sklep', 'oficjalny',
    'opinie', 'porownanie', 'porównanie'
  ]),
  ru_latn: new Set([
    'kupit', 'tsena', 'cena', 'otzyv', 'otzyvy', 'dostavka', 'ventilyator',
    'napolnyy', 'nastolnyy'
  ]),
}

const LANGUAGE_SUPPORT_TOKENS = new Set([
  'a', 'an', 'and', 'the', 'or', 'to', 'for', 'from', 'of', 'on', 'in', 'at', 'by', 'with', 'without',
  'per', 'con', 'da', 'di', 'del', 'della', 'dei', 'degli', 'delle', 'il', 'lo', 'la', 'gli', 'le',
  'de', 'des', 'du', 'et', 'pour', 'sur', 'par', 'mit', 'und', 'fur', 'für', 'zum', 'zur', 'von',
  'y', 'e', 'para', 'por', 'en', 'el', 'los', 'las', 'una', 'uno', 'un'
])

const LANGUAGE_NEUTRAL_UNIT_TOKENS = new Set([
  'v', 'w', 'kw', 'wh', 'kwh', 'mah', 'ah', 'gb', 'tb', 'mb', 'hz', 'khz', 'mhz', 'ghz',
  'mm', 'cm', 'm', 'km', 'in', 'inch', 'inches', 'ft', 'oz', 'lb', 'lbs', 'kg', 'g', 'mg',
  'ml', 'l', 'qt', 'pack', 'packs', 'ct', 'pcs', 'pc', 'piece', 'pieces', 'set', 'sets', 'xl'
])

export interface KeywordLanguageCompatibility {
  hardReject: boolean
  softDemote: boolean
  targetLanguage: string
  allowedLanguageHints: string[]
  detectedLanguageHints: string[]
  contentTokenCount: number
  unauthorizedContentTokenCount: number
  unauthorizedContentRatio: number
  unauthorizedHeadToken?: string
}

function normalizeTargetLanguageCode(targetLanguage?: string): string {
  return normalizeLanguageCode(targetLanguage || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0] || ''
}

function resolveAllowedScriptFamilies(targetLanguage?: string): Set<ScriptFamily> {
  const lang = normalizeTargetLanguageCode(targetLanguage)
  if (!lang) return DEFAULT_ALLOWED_SCRIPT_FAMILIES
  if (lang === 'zh') return new Set<ScriptFamily>(['han', 'latin'])
  if (lang === 'ja') return new Set<ScriptFamily>(['han', 'hiragana', 'katakana', 'latin'])
  if (lang === 'ko') return new Set<ScriptFamily>(['hangul', 'latin'])
  if (lang === 'ar') return new Set<ScriptFamily>(['arabic', 'latin'])
  if (lang === 'he') return new Set<ScriptFamily>(['hebrew', 'latin'])
  if (lang === 'th') return new Set<ScriptFamily>(['thai', 'latin'])
  if (CYRILLIC_LANGUAGE_CODES.has(lang)) return new Set<ScriptFamily>(['cyrillic', 'latin'])
  return DEFAULT_ALLOWED_SCRIPT_FAMILIES
}

function detectKeywordScriptFamilies(keyword: string): Set<ScriptFamily> {
  const families = new Set<ScriptFamily>()
  const text = String(keyword || '')
  if (!text) return families

  for (const { family, pattern } of SCRIPT_FAMILY_PATTERNS) {
    if (pattern.test(text)) families.add(family)
  }

  return families
}

function hasOnlyLatinLetters(families: Set<ScriptFamily>): boolean {
  return families.size > 0 && Array.from(families).every((family) => family === 'latin')
}

function hasAnyNonLatinFamily(families: Set<ScriptFamily>): boolean {
  return Array.from(families).some((family) => family !== 'latin')
}

function getAllowedLanguageHintsForTarget(targetLanguage: string): Set<string> {
  const code = normalizeTargetLanguageCode(targetLanguage || 'en')
  return new Set<string>([code])
}

function detectLatinLanguageHints(keyword: string): Set<string> {
  const hints = new Set<string>()
  const normalized = normalizeGoogleAdsKeyword(String(keyword || '')) || ''
  if (!normalized) return hints

  const tokens = normalized.split(/\s+/).filter(Boolean)

  for (const token of tokens) {
    const tokenHints = detectLatinLanguageHintsForToken(token)
    for (const hint of tokenHints) hints.add(hint)
  }

  if (/[äöüß]/u.test(normalized)) hints.add('de')
  if (/[ñ]/u.test(normalized)) hints.add('es')
  if (/[àâçéèêëîïôûùœ]/u.test(normalized)) hints.add('fr')
  if (/[ãõ]/u.test(normalized)) hints.add('pt')
  if (/[ığş]/u.test(normalized)) hints.add('tr')
  if (/[ąćęłńóśźż]/u.test(normalized)) hints.add('pl')

  return hints
}

function normalizeLanguageHintCode(code: string): string {
  return String(code || '')
    .trim()
    .toLowerCase()
    .split('_')[0] || ''
}

function tokenizeKeywordLanguageUnits(keyword: string): string[] {
  return String(keyword || '')
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function buildPureBrandTokenSet(pureBrandKeywords: string[]): Set<string> {
  const tokens = new Set<string>()
  for (const keyword of pureBrandKeywords || []) {
    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalized) continue
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      tokens.add(token)
    }
  }
  return tokens
}

function isLanguageNeutralToken(token: string, brandTokens: Set<string>): boolean {
  if (!token) return true
  if (brandTokens.has(token)) return true
  if (token.length <= 2) return true
  if (/^\d+$/.test(token)) return true
  if (/^[a-z]*\d+[a-z0-9-]*$/i.test(token)) return true
  if (/^\d+(?:[a-z]{1,4})$/i.test(token)) return true
  if (/^[a-z]$/i.test(token)) return true
  return LANGUAGE_NEUTRAL_UNIT_TOKENS.has(token)
}

function isLanguageSupportToken(token: string): boolean {
  if (!token) return true
  if (token.length <= 2) return true
  return LANGUAGE_SUPPORT_TOKENS.has(token)
}

function detectLatinLanguageHintsForToken(token: string): Set<string> {
  const hints = new Set<string>()
  const normalized = normalizeGoogleAdsKeyword(String(token || '')) || ''
  if (!normalized) return hints

  for (const [languageCode, markerTokens] of Object.entries(LANGUAGE_HINT_TOKENS)) {
    if (markerTokens.has(normalized)) {
      hints.add(languageCode)
    }
  }

  if (/[äöüß]/u.test(normalized)) hints.add('de')
  if (/[ñ]/u.test(normalized)) hints.add('es')
  if (/[àâçéèêëîïôûùœ]/u.test(normalized)) hints.add('fr')
  if (/[ãõ]/u.test(normalized)) hints.add('pt')
  if (/[ığş]/u.test(normalized)) hints.add('tr')
  if (/[ąćęłńóśźż]/u.test(normalized)) hints.add('pl')
  if (/(?:lich|liche|lichen|licher|liches|isch|ische|ischen|ischer|isches|keit|heit|ungen|ung|fluss|frei|los)$/u.test(normalized)) {
    hints.add('de')
  }

  return hints
}

function normalizeLexicalAnchorToken(value: string): string {
  return normalizeGoogleAdsKeyword(value)
    ?.replace(/\s+/g, ' ')
    .trim() || ''
}

function isLexicalAnchorToken(value: string): boolean {
  if (!value || value.length < 5) return false
  if (value.includes(' ')) return false
  return /^[a-z0-9]+$/i.test(value)
}

function isExactPureBrandKeyword(keyword: string, pureBrandKeywords: string[]): boolean {
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedKeyword) return false

  return pureBrandKeywords.some((brand) => normalizeLexicalAnchorToken(brand) === normalizedKeyword)
}

export function buildKeywordIntegrityAnchors(params: {
  pureBrandKeywords: string[]
  productName?: string
}): string[] {
  const anchors = new Set<string>()

  for (const keyword of params.pureBrandKeywords || []) {
    const normalized = normalizeLexicalAnchorToken(keyword)
    if (isLexicalAnchorToken(normalized)) {
      anchors.add(normalized)
    }
  }

  const productTokens = normalizeGoogleAdsKeyword(params.productName || '')
    ?.split(/\s+/)
    .filter(Boolean) || []

  for (const token of productTokens) {
    const normalized = normalizeLexicalAnchorToken(token)
    if (!normalized) continue
    if (!/[a-z]/i.test(normalized) || !/\d/.test(normalized)) continue
    if (!isLexicalAnchorToken(normalized)) continue
    anchors.add(normalized)
  }

  return Array.from(anchors)
}

export function getSplitAnchorDistortionReason(params: {
  keyword: string
  anchorTerms: string[]
  pureBrandKeywords: string[]
}): string | null {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return null
  if (isExactPureBrandKeyword(normalized, params.pureBrandKeywords)) return null

  const keywordTokens = normalized.split(/\s+/).filter(Boolean)
  const intactBrandTokenPresent = params.pureBrandKeywords.some((brand) => {
    const normalizedBrand = normalizeLexicalAnchorToken(brand)
    return Boolean(normalizedBrand) && keywordTokens.includes(normalizedBrand)
  })
  if (intactBrandTokenPresent) return null

  if (keywordTokens.length < 2) return null

  const anchors = new Set(
    (params.anchorTerms || [])
      .map(normalizeLexicalAnchorToken)
      .filter(isLexicalAnchorToken)
  )
  if (anchors.size === 0) return null

  for (let start = 0; start < keywordTokens.length; start += 1) {
    for (let width = 2; width <= 3 && start + width <= keywordTokens.length; width += 1) {
      const window = keywordTokens.slice(start, start + width)
      if (window.some((token) => token.length < 2)) continue

      const combined = window.join('')
      if (!anchors.has(combined)) continue

      return `锚点裂词/拆写变体: "${params.keyword}" (${window.join(' + ')} → ${combined})`
    }
  }

  return null
}

export function isKeywordLanguageMismatch(params: {
  keyword: string
  targetLanguage?: string
  pureBrandKeywords: string[]
}): boolean {
  return analyzeKeywordLanguageCompatibility(params).hardReject
}

export function analyzeKeywordLanguageCompatibility(params: {
  keyword: string
  targetLanguage?: string
  pureBrandKeywords: string[]
}): KeywordLanguageCompatibility {
  const { keyword, targetLanguage, pureBrandKeywords } = params
  const targetLang = normalizeTargetLanguageCode(targetLanguage)
  const emptyResult: KeywordLanguageCompatibility = {
    hardReject: false,
    softDemote: false,
    targetLanguage: targetLang,
    allowedLanguageHints: Array.from(getAllowedLanguageHintsForTarget(targetLanguage || '')),
    detectedLanguageHints: [],
    contentTokenCount: 0,
    unauthorizedContentTokenCount: 0,
    unauthorizedContentRatio: 0,
  }

  if (!keyword || !targetLanguage) return emptyResult
  if (isPureBrandKeyword(keyword, pureBrandKeywords)) return emptyResult

  const allowedFamilies = resolveAllowedScriptFamilies(targetLanguage)
  const scriptFamilies = detectKeywordScriptFamilies(keyword)
  if (scriptFamilies.size > 0) {
    if (allowedFamilies.size === 1 && allowedFamilies.has('latin') && hasAnyNonLatinFamily(scriptFamilies)) {
      return {
        ...emptyResult,
        hardReject: true,
      }
    }

    const disallowedFamilies = Array.from(scriptFamilies).filter((family) => !allowedFamilies.has(family))
    if (disallowedFamilies.length > 0) {
      return {
        ...emptyResult,
        hardReject: true,
      }
    }

    if (
      (targetLang === 'ar' || targetLang === 'he' || targetLang === 'th' || CYRILLIC_LANGUAGE_CODES.has(targetLang))
      && hasOnlyLatinLetters(scriptFamilies)
      && !containsPureBrand(keyword, pureBrandKeywords)
    ) {
      return {
        ...emptyResult,
        hardReject: true,
      }
    }
  }

  if (!LATIN_SCRIPT_LANGUAGE_CODES.has(targetLang)) return emptyResult

  const allowedHints = getAllowedLanguageHintsForTarget(targetLanguage)
  const brandTokens = buildPureBrandTokenSet(pureBrandKeywords)
  const tokens = tokenizeKeywordLanguageUnits(keyword)
  const contentTokens: string[] = []
  const unauthorizedTokens: string[] = []
  const detectedHints = new Set<string>()

  for (const token of tokens) {
    if (isLanguageSupportToken(token)) continue
    if (isLanguageNeutralToken(token, brandTokens)) continue

    contentTokens.push(token)
    const tokenHints = detectLatinLanguageHintsForToken(token)
    for (const hint of tokenHints) {
      detectedHints.add(normalizeLanguageHintCode(hint))
    }

    if (tokenHints.size === 0) continue
    const authorized = Array.from(tokenHints).some((hint) => allowedHints.has(normalizeLanguageHintCode(hint)))
    if (!authorized) unauthorizedTokens.push(token)
  }

  if (contentTokens.length === 0) {
    return {
      ...emptyResult,
      detectedLanguageHints: Array.from(detectedHints),
    }
  }

  const unauthorizedContentRatio = unauthorizedTokens.length / Math.max(1, contentTokens.length)
  const unauthorizedHeadToken = contentTokens.find((token) => unauthorizedTokens.includes(token))
  const hardReject = unauthorizedTokens.length > 0
    && (
      unauthorizedContentRatio > 0.2
      || unauthorizedHeadToken === contentTokens[0]
    )

  return {
    hardReject,
    softDemote: !hardReject && unauthorizedTokens.length > 0,
    targetLanguage: targetLang,
    allowedLanguageHints: Array.from(allowedHints),
    detectedLanguageHints: Array.from(detectedHints),
    contentTokenCount: contentTokens.length,
    unauthorizedContentTokenCount: unauthorizedTokens.length,
    unauthorizedContentRatio,
    unauthorizedHeadToken,
  }
}
