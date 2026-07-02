import { normalizeLanguageCode } from '@/lib/common/server'
import { isPureBrandKeyword } from '@/lib/keywords/brand/brand-keyword-utils'

const LATIN_SCRIPT_LANGUAGE_CODES = new Set([
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'sv',
  'no',
  'da',
  'fi',
  'pl',
  'cs',
  'tr',
  'vi',
  'id',
  'ms',
  'ro',
  'hu',
  'sk',
  'tl',
])

const DISALLOWED_NON_LATIN_SCRIPT_FOR_LATIN_LANG_RE =
  /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Greek}]/u

const LANGUAGE_HINT_TOKENS: Record<string, Set<string>> = {
  en: new Set([
    'buy',
    'price',
    'deal',
    'sale',
    'shop',
    'official',
    'store',
    'reviews',
    'review',
    'best',
    'compare',
    'comparison',
    'online',
  ]),
  de: new Set([
    'kaufen',
    'kauf',
    'preis',
    'angebote',
    'angebot',
    'guenstig',
    'günstig',
    'offiziell',
    'bewertung',
    'bewertungen',
    'vergleich',
    'deutschland',
    'shop',
  ]),
  es: new Set([
    'comprar',
    'precio',
    'oferta',
    'ofertas',
    'tienda',
    'oficial',
    'reseñas',
    'resenas',
    'comparar',
  ]),
  fr: new Set([
    'acheter',
    'prix',
    'offre',
    'offres',
    'boutique',
    'officiel',
    'avis',
    'comparaison',
  ]),
  it: new Set([
    'comprare',
    'prezzo',
    'offerta',
    'offerte',
    'negozio',
    'ufficiale',
    'recensioni',
    'confronto',
  ]),
  pt: new Set([
    'comprar',
    'preco',
    'oferta',
    'ofertas',
    'loja',
    'oficial',
    'avaliacoes',
    'avaliações',
    'comparacao',
    'comparação',
  ]),
  tr: new Set([
    'satın',
    'satin',
    'fiyat',
    'indirim',
    'magaza',
    'mağaza',
    'resmi',
    'yorum',
    'karsilastir',
    'karşılaştır',
  ]),
  pl: new Set([
    'kupic',
    'kupić',
    'cena',
    'oferta',
    'oferty',
    'sklep',
    'oficjalny',
    'opinie',
    'porownanie',
    'porównanie',
  ]),
  // 俄语拉丁转写（用于补充脚本检测覆盖不到的场景）
  ru_latn: new Set([
    'kupit',
    'tsena',
    'cena',
    'otzyv',
    'otzyvy',
    'dostavka',
    'ventilyator',
    'napolnyy',
    'nastolnyy',
  ]),
}

function getAllowedLanguageHintsForTarget(targetLanguage: string): Set<string> {
  const code = normalizeLanguageCode(targetLanguage || 'en')
  // 收紧到“目标语 + 中性词豁免”策略：不再默认放行 en。
  // 中性词（品牌/型号/规格）由 hints=empty 路径自然放行。
  return new Set<string>([code])
}

function detectLatinLanguageHints(keyword: string): Set<string> {
  const hints = new Set<string>()
  const normalized = String(keyword || '')
    .toLowerCase()
    .normalize('NFKC')
  if (!normalized) return hints

  // 先按 token 做词形提示
  const tokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter(Boolean)

  for (const token of tokens) {
    for (const [languageCode, markerTokens] of Object.entries(LANGUAGE_HINT_TOKENS)) {
      if (markerTokens.has(token)) {
        hints.add(languageCode)
      }
    }
  }

  // 再做字符级提示（仅拉丁字母扩展字符）
  if (/[äöüß]/u.test(normalized)) hints.add('de')
  if (/[ñ]/u.test(normalized)) hints.add('es')
  if (/[àâçéèêëîïôûùœ]/u.test(normalized)) hints.add('fr')
  if (/[ãõ]/u.test(normalized)) hints.add('pt')
  if (/[ığş]/u.test(normalized)) hints.add('tr')
  if (/[ąćęłńóśźż]/u.test(normalized)) hints.add('pl')

  return hints
}

function isLanguageScriptMismatch(
  keyword: string,
  targetLanguage: string,
  pureBrandKeywords: string[]
): boolean {
  const normalizedKeyword = String(keyword || '').trim()
  if (!normalizedKeyword) return false

  // 纯品牌词豁免，避免误伤多语种品牌名
  if (isPureBrandKeyword(normalizedKeyword, pureBrandKeywords)) return false

  const languageCode = normalizeLanguageCode(targetLanguage || 'en')
  if (!LATIN_SCRIPT_LANGUAGE_CODES.has(languageCode)) return false

  // 第一层：脚本拦截（西里尔/阿拉伯/汉字等）
  if (DISALLOWED_NON_LATIN_SCRIPT_FOR_LATIN_LANG_RE.test(normalizedKeyword)) {
    return true
  }

  // 第二层：拉丁语系词形提示（例如 DE 允许 de/en，不允许 es/it/ru_latn）
  const hints = detectLatinLanguageHints(normalizedKeyword)
  if (hints.size === 0) return false

  const allowedHints = getAllowedLanguageHintsForTarget(targetLanguage)
  for (const hint of hints) {
    if (allowedHints.has(hint)) return false
  }

  return true
}

export { isLanguageScriptMismatch }
