import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../server'

// AI语义分类
// 导入否定关键词生成函数
// 导入token追踪函数
// v3.0: 导入数据库prompt加载函数
// 购买意图评分

// Google Ads关键词标准化去重

// 导入关键词质量过滤函数 补充导入纯品牌词函数 改为 shouldUseExactMatch 策略函数 补充导入品牌变体和语义查询过滤函数
// 导入纯品牌词判断函数
import {
  LANGUAGE_CODE_MAP,
  getLanguageName,
  getLanguageNameForCountry,
  normalizeCountryCode,
  normalizeLanguageCode,
} from '../../common/server'

import {
  applyDescriptionTextGuardrail,
  applyHeadlineTextGuardrail,
  fitLocalizedDescription,
  fitLocalizedHeadline,
  getDefaultProductNoun,
  getSoftCopyTemplates,
  normalizeHeadlineCandidateText,
  resolveDescriptionKeywordTargets,
  resolveHeadlineKeywordTargets,
  syncHeadlineMetadataSlot,
} from './contract/index'
import type {
  CopyPatternSet,
  CreativeTargetLanguageResolution,
  NormalizedCreativeBucket,
  SupportedSoftCopyLanguage,
} from './types'

export function isHeadlineCompatibleWithTargetLanguage(
  text: string,
  targetLanguage: string | null | undefined
): boolean {
  const language = normalizeLanguageCode(targetLanguage || 'en')
  if (!text) return false
  if (language === 'zh') return /[\p{Script=Han}]/u.test(text)
  if (language === 'ja') return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
  if (language === 'ko') return /[\p{Script=Hangul}]/u.test(text)
  if (language === 'ar') return /[\p{Script=Arabic}]/u.test(text)
  if (language === 'ru') return /[\p{Script=Cyrillic}]/u.test(text)
  if (
    LATIN_SOFT_COPY_LANGUAGES.includes(language as SupportedSoftCopyLanguage) &&
    language !== 'en'
  ) {
    if (isLikelyCrossLanguageLatinAsset(text, language as SupportedSoftCopyLanguage)) {
      return false
    }
  }
  return true
}

export const EN_CTA_REGEX = /shop now|buy now|learn more|get|order|sign up|try|start/i

export const EN_CTA_PHRASES = [
  'Shop Now',
  'Buy Now',
  'Learn More',
  'Order Now',
  'Get Yours',
  'Try Now',
  'Start Now',
  'Sign Up',
]

export const FR_CTA_REGEX =
  /acheter maintenant|acheter|commander|en savoir plus|inscrivez-vous|essayer|commencer|obtenir|découvrir|magasiner/i

export const FR_CTA_PHRASES = [
  'Acheter maintenant',
  'Commander',
  'En savoir plus',
  'Découvrir',
  'Obtenir',
]

export const DE_CTA_REGEX =
  /jetzt kaufen|kaufen|bestellen|mehr erfahren|anmelden|testen|starten|entdecken|sparen|sichern|holen/i

export const DE_CTA_PHRASES = ['Jetzt kaufen', 'Bestellen', 'Mehr erfahren', 'Entdecken', 'Sichern']

export const ES_CTA_REGEX =
  /comprar ahora|comprar|pedir|más información|mas informacion|registrarse|probar|empezar|descubrir|ahorrar|obtener|solicitar/i

export const ES_CTA_PHRASES = ['Comprar ahora', 'Pedir', 'Más información', 'Descubrir', 'Obtener']

export const IT_CTA_REGEX =
  /acquista ora|acquista|compra|ordina|scopri di più|scopri di piu|iscriviti|prova|inizia|scopri|risparmia|ottieni|richiedi/i

export const IT_CTA_PHRASES = ['Acquista ora', 'Ordina', 'Scopri di più', 'Scopri', 'Ottieni']

export const PT_CTA_REGEX =
  /comprar agora|comprar|pedir|saiba mais|inscreva-se|experimentar|começar|comecar|descobrir|economizar|obter/i

export const PT_CTA_PHRASES = ['Comprar agora', 'Pedir', 'Saiba mais', 'Descobrir', 'Obter']

export const ZH_CTA_REGEX =
  /立即购买|马上购买|立刻购买|立即下单|马上下单|了解更多|获取|立即开始|注册|立即查看|马上行动/i

export const ZH_CTA_PHRASES = ['立即购买', '了解更多', '立即下单', '马上行动', '立即查看']

export const JA_CTA_REGEX =
  /今すぐ購入|購入する|ご注文|詳しく見る|詳細を見る|今すぐ開始|登録|今すぐチェック/i

export const JA_CTA_PHRASES = [
  '今すぐ購入',
  '詳しく見る',
  'ご注文はこちら',
  '今すぐ開始',
  '今すぐチェック',
]

export const KO_CTA_REGEX =
  /지금 구매|구매하기|주문하기|자세히 보기|더 알아보기|지금 시작|지금 신청|지금 확인/i

export const KO_CTA_PHRASES = ['지금 구매', '자세히 보기', '지금 주문', '지금 시작', '지금 확인']

export const RU_CTA_REGEX =
  /купить сейчас|купить|заказать|узнать больше|подробнее|начать|получить|смотреть/i

export const RU_CTA_PHRASES = ['Купить сейчас', 'Узнать больше', 'Заказать', 'Начать', 'Получить']

export const AR_CTA_REGEX =
  /اشتري الآن|اشتر الآن|اطلب الآن|اعرف المزيد|اكتشف المزيد|ابدأ الآن|سجل الآن|احصل الآن/i

export const AR_CTA_PHRASES = ['اشتري الآن', 'اعرف المزيد', 'اطلب الآن', 'ابدأ الآن', 'احصل الآن']

export const EN_COPY_PATTERNS: CopyPatternSet = {
  transactional: /\b(buy|shop|order|save|deal|offer|discount|price|quote|get)\b/i,
  trust: /\b(official|authentic|trusted|certified|warranty|support|guarantee)\b/i,
  scenario:
    /\b(for|when|during|project|repair|install|build|fix|home|garden|yard|fence|deck|job)\b/i,
  solution:
    /\b(solution|solve|built|designed|helps|easy|durable|powerful|reliable|heavy[-\s]?duty|lightweight)\b/i,
  pain: /\b(problem|struggle|frustrat|tired|hard|issue|worry|difficult|stuck|slow)\b/i,
  cta: EN_CTA_REGEX,
  ctaPhrases: EN_CTA_PHRASES,
}

export const FR_COPY_PATTERNS: CopyPatternSet = {
  transactional:
    /(acheter|commander|prix|devis|offre|promo|promotion|remise|économiser|obtenir|magasiner)/i,
  trust: /(officiel|authentique|fiable|certifi|garantie|assistance|support|confiance)/i,
  scenario:
    /(pour|quand|pendant|projet|réparation|installer|installation|construire|bricolage|maison|jardin|terrasse|clôture|chantier)/i,
  solution: /(solution|résout|résoudre|conçu|aide|facile|durable|puissant|fiable|robuste|léger)/i,
  pain: /(problème|difficile|galère|frustr|fatigu|lent|bloqué|inquiét|souci)/i,
  cta: FR_CTA_REGEX,
  ctaPhrases: FR_CTA_PHRASES,
}

export const DE_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(kaufen|bestellen|preis|angebot|rabatt|sparen|holen|deal)/i,
  trust: /(offiziell|authentisch|vertrau|zertifiz|garantie|support|zuverlässig|zuverlaessig)/i,
  scenario:
    /(für|fuer|wenn|während|waehrend|projekt|reparatur|installation|bauen|haus|garten|zaun|terrasse|job)/i,
  solution:
    /(lösung|loesung|löst|loest|entwickelt|hilft|einfach|robust|leistungsstark|zuverlässig|zuverlaessig|langlebig|leicht)/i,
  pain: /(problem|schwierig|frust|müde|muede|langsam|steck|sorge|hürde|huerde)/i,
  cta: DE_CTA_REGEX,
  ctaPhrases: DE_CTA_PHRASES,
}

export const ES_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(comprar|pedido|pedir|precio|oferta|descuento|ahorrar|obtener)/i,
  trust: /(oficial|auténtico|autentico|confiable|certific|garantía|garantia|soporte|confianza)/i,
  scenario:
    /(para|cuando|durante|proyecto|reparaci|instal|constru|hogar|jardín|jardin|patio|valla|trabajo)/i,
  solution:
    /(solución|solucion|resuelve|diseñado|disenado|ayuda|fácil|facil|duradero|potente|fiable|ligero|robusto)/i,
  pain: /(problema|difícil|dificil|frustr|cansad|lento|atasc|preocup|complic)/i,
  cta: ES_CTA_REGEX,
  ctaPhrases: ES_CTA_PHRASES,
}

export const IT_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(acquista|compra|ordina|prezzo|offerta|sconto|risparmia|ottieni)/i,
  trust: /(ufficiale|autentico|affidabile|certificat|garanzia|supporto|fiducia)/i,
  scenario:
    /(per|quando|durante|progetto|ripar|install|costru|casa|giardino|cortile|recinzione|lavoro)/i,
  solution: /(soluzione|risolve|progett|aiuta|facile|duraturo|potente|affidabile|leggero|robusto)/i,
  pain: /(problema|difficile|frustr|stanco|lento|blocc|preoccup|fatica)/i,
  cta: IT_CTA_REGEX,
  ctaPhrases: IT_CTA_PHRASES,
}

export const PT_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(comprar|pedir|preço|preco|oferta|desconto|economizar|obter)/i,
  trust:
    /(oficial|autêntico|autentico|confiável|confiavel|certific|garantia|suporte|confiança|confianca)/i,
  scenario:
    /(para|quando|durante|projeto|reparo|instala|constru|casa|jardim|quintal|cerca|trabalho)/i,
  solution:
    /(solução|solucao|resolve|projetado|ajuda|fácil|facil|durável|duravel|potente|confiável|confiavel|leve|robusto)/i,
  pain: /(problema|difícil|dificil|frustr|cansad|lento|pres|preocup|trav)/i,
  cta: PT_CTA_REGEX,
  ctaPhrases: PT_CTA_PHRASES,
}

export const ZH_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(购买|下单|报价|优惠|折扣|省钱|价格|立减|获取)/i,
  trust: /(官方|正品|认证|质保|售后|支持|可靠|保障)/i,
  scenario: /(适用于|用于|家庭|花园|庭院|维修|安装|施工|项目|围栏|露台)/i,
  solution: /(解决|帮助|轻松|耐用|强劲|高效|可靠|省力|便捷|稳固)/i,
  pain: /(问题|困扰|费力|麻烦|卡住|慢|担心|难|痛点)/i,
  cta: ZH_CTA_REGEX,
  ctaPhrases: ZH_CTA_PHRASES,
}

export const JA_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(購入|注文|価格|割引|お得|セール|今すぐ|入手)/i,
  trust: /(公式|正規|認証|保証|サポート|信頼|安心)/i,
  scenario: /(家庭|庭|ガーデン|修理|設置|施工|プロジェクト|フェンス|デッキ|作業)/i,
  solution: /(解決|サポート|簡単|耐久|強力|高性能|信頼性|軽量|効率)/i,
  pain: /(問題|悩み|大変|難しい|不安|遅い|困る|手間)/i,
  cta: JA_CTA_REGEX,
  ctaPhrases: JA_CTA_PHRASES,
}

export const KO_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(구매|주문|가격|할인|혜택|특가|지금|받기)/i,
  trust: /(공식|정품|인증|보증|지원|신뢰|안심)/i,
  scenario: /(가정|정원|마당|수리|설치|시공|프로젝트|울타리|데크|작업)/i,
  solution: /(해결|도움|간편|내구성|강력|효율|신뢰성|경량|튼튼)/i,
  pain: /(문제|고민|어려움|불편|느림|막힘|걱정|번거로움)/i,
  cta: KO_CTA_REGEX,
  ctaPhrases: KO_CTA_PHRASES,
}

export const RU_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(купить|заказать|цена|скидк|выгод|предлож|акция|получить)/i,
  trust: /(официальн|подлинн|сертифиц|гарант|поддержк|надежн|довер)/i,
  scenario: /(дом|сад|двор|ремонт|установк|проект|работ|забор|террас)/i,
  solution: /(решен|помога|легко|прочн|мощн|надежн|эффектив|удобн|долговеч)/i,
  pain: /(проблем|сложно|трудно|медлен|застр|беспоко|неудоб)/i,
  cta: RU_CTA_REGEX,
  ctaPhrases: RU_CTA_PHRASES,
}

export const AR_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(شراء|اطلب|سعر|خصم|عرض|وفر|احصل|الآن)/i,
  trust: /(رسمي|أصلي|موثوق|معتمد|ضمان|دعم|ثقة)/i,
  scenario: /(منزل|حديقة|فناء|إصلاح|تركيب|مشروع|سياج|سطح|عمل)/i,
  solution: /(حل|يساعد|سهل|متين|قوي|فعال|موثوق|خفيف|عملي)/i,
  pain: /(مشكلة|صعب|معاناة|بطيء|عالق|قلق|متعب)/i,
  cta: AR_CTA_REGEX,
  ctaPhrases: AR_CTA_PHRASES,
}

export const SUPPORTED_SOFT_COPY_LANGUAGES = new Set<SupportedSoftCopyLanguage>([
  'en',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'zh',
  'ja',
  'ko',
  'ru',
  'ar',
])

export function resolveSoftCopyLanguage(languageCode: string): SupportedSoftCopyLanguage | null {
  const raw = String(languageCode || '').trim()
  if (!raw) return null
  const lowerRaw = raw.toLowerCase()
  const mapped = LANGUAGE_CODE_MAP[lowerRaw]
  const normalized = mapped || lowerRaw

  const localeBase = normalized.split(/[-_]/)[0]
  if (SUPPORTED_SOFT_COPY_LANGUAGES.has(localeBase as SupportedSoftCopyLanguage)) {
    return localeBase as SupportedSoftCopyLanguage
  }

  let candidate = normalized
  if (candidate === 'de-ch') candidate = 'de'

  if (SUPPORTED_SOFT_COPY_LANGUAGES.has(candidate as SupportedSoftCopyLanguage)) {
    return candidate as SupportedSoftCopyLanguage
  }

  if (!mapped) {
    return null
  }

  const fallbackNormalized = normalizeLanguageCode(raw)
  const fallbackCandidate = fallbackNormalized === 'de-ch' ? 'de' : fallbackNormalized
  return SUPPORTED_SOFT_COPY_LANGUAGES.has(fallbackCandidate as SupportedSoftCopyLanguage)
    ? (fallbackCandidate as SupportedSoftCopyLanguage)
    : null
}

export function getCopyPatterns(languageCode: string): CopyPatternSet {
  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (softLanguage === 'fr') return FR_COPY_PATTERNS
  if (softLanguage === 'de') return DE_COPY_PATTERNS
  if (softLanguage === 'es') return ES_COPY_PATTERNS
  if (softLanguage === 'it') return IT_COPY_PATTERNS
  if (softLanguage === 'pt') return PT_COPY_PATTERNS
  if (softLanguage === 'zh') return ZH_COPY_PATTERNS
  if (softLanguage === 'ja') return JA_COPY_PATTERNS
  if (softLanguage === 'ko') return KO_COPY_PATTERNS
  if (softLanguage === 'ru') return RU_COPY_PATTERNS
  if (softLanguage === 'ar') return AR_COPY_PATTERNS
  return EN_COPY_PATTERNS
}

export const LATIN_SOFT_COPY_LANGUAGES: SupportedSoftCopyLanguage[] = [
  'en',
  'fr',
  'de',
  'es',
  'it',
  'pt',
]

export const LANGUAGE_PURITY_MARKERS: Record<SupportedSoftCopyLanguage, string[]> = {
  en: ['shop now', 'learn more', 'official', 'buy now', 'order now'],
  fr: ['acheter', 'commander', 'officiel', 'découvrir', 'en savoir plus', 'fiable', 'garantie'],
  de: [
    'jetzt kaufen',
    'bestellen',
    'offiziell',
    'zertifiz',
    'alkalisch',
    'umkehrosmose',
    'zuverlässig',
  ],
  es: ['comprar ahora', 'oficial', 'descubrir', 'más información', 'pedir', 'confiable'],
  it: ['acquista ora', 'ufficiale', 'ordina', 'scopri', 'acqua', 'affidabile', 'certificato'],
  pt: ['comprar agora', 'oficial', 'saiba mais', 'pedir', 'descobrir', 'confiável'],
  zh: ['立即购买', '官方', '了解更多', '获取'],
  ja: ['今すぐ購入', '公式', '詳しく見る', '注文'],
  ko: ['지금 구매', '공식', '주문', '자세히'],
  ru: ['купить', 'официальн', 'заказать', 'узнать больше'],
  ar: ['اشتري الآن', 'رسمي', 'اطلب', 'اعرف المزيد'],
}

export const LATIN_LANGUAGE_SIGNATURE_MARKERS: Partial<
  Record<SupportedSoftCopyLanguage, string[]>
> = {
  en: ['the', 'with', 'official', 'shop', 'learn'],
  fr: ['avec', 'officiel', 'fiable', 'découvrez', 'savoir'],
  de: ['offiziell', 'zertifiz', 'alkalisch', 'jetzt', 'kaufen'],
  es: ['oficial', 'comprar', 'descubrir', 'más', 'información'],
  it: ['ufficiale', 'acquista', 'scopri', 'affidabile', 'oggi'],
  pt: ['oficial', 'comprar', 'saiba', 'descobrir', 'confiável'],
}

export function countMarkerHits(text: string, markers: string[]): number {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return 0
  return markers.reduce(
    (sum, marker) => (normalized.includes(marker.toLowerCase()) ? sum + 1 : sum),
    0
  )
}

export function countSignatureHits(text: string, languageCode: SupportedSoftCopyLanguage): number {
  const markers = LATIN_LANGUAGE_SIGNATURE_MARKERS[languageCode] || []
  return countMarkerHits(text, markers)
}

export function getLanguagePatternHitCount(
  text: string,
  languageCode: SupportedSoftCopyLanguage
): number {
  const patterns = getCopyPatterns(languageCode)
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return 0
  const checks = [
    patterns.transactional,
    patterns.trust,
    patterns.scenario,
    patterns.solution,
    patterns.pain,
    patterns.cta,
  ]
  return checks.reduce((sum, pattern) => (pattern.test(normalized) ? sum + 1 : sum), 0)
}

export function isLikelyCrossLanguageLatinAsset(
  text: string,
  targetLanguage: SupportedSoftCopyLanguage
): boolean {
  if (!LATIN_SOFT_COPY_LANGUAGES.includes(targetLanguage)) return false
  if (targetLanguage === 'en') return false

  const normalized = String(text || '').trim()
  if (!normalized) return false

  const targetMarkerHits = countMarkerHits(
    normalized,
    LANGUAGE_PURITY_MARKERS[targetLanguage] || []
  )
  const targetPatternHits = getLanguagePatternHitCount(normalized, targetLanguage)
  const targetSignatureHits = countSignatureHits(normalized, targetLanguage)

  let otherMarkerMax = 0
  let otherPatternMax = 0
  let otherSignatureMax = 0
  for (const lang of LATIN_SOFT_COPY_LANGUAGES) {
    if (lang === targetLanguage) continue
    otherMarkerMax = Math.max(
      otherMarkerMax,
      countMarkerHits(normalized, LANGUAGE_PURITY_MARKERS[lang] || [])
    )
    otherPatternMax = Math.max(otherPatternMax, getLanguagePatternHitCount(normalized, lang))
    otherSignatureMax = Math.max(otherSignatureMax, countSignatureHits(normalized, lang))
  }

  if (otherMarkerMax >= 1 && targetMarkerHits === 0) return true
  if (otherSignatureMax >= 2 && targetSignatureHits === 0) return true
  if (otherSignatureMax >= 3 && otherSignatureMax > targetSignatureHits + 1) return true
  return otherPatternMax >= 2 && otherPatternMax > targetPatternHits
}

export function getCtaRegexForLanguage(languageCode: string): RegExp {
  return getCopyPatterns(languageCode).cta
}

export function getCtaPhrasesForLanguage(languageCode: string): string[] {
  return getCopyPatterns(languageCode).ctaPhrases
}

export function enforceLanguageCtas(
  descriptions: string[],
  minCount: number,
  maxLength: number,
  languageCode: string
): { updated: string[]; fixed: number } {
  const updated = [...descriptions]
  const ctaRegex = getCtaRegexForLanguage(languageCode)
  const ctaPhrases = getCtaPhrasesForLanguage(languageCode)
  let ctaCount = updated.filter((d) => ctaRegex.test(d)).length
  let fixed = 0

  for (let i = 0; i < updated.length && ctaCount < minCount; i += 1) {
    if (ctaRegex.test(updated[i])) continue
    const base = updated[i].trim().replace(/[.!?]+$/, '')
    const suffix = ctaPhrases[fixed % ctaPhrases.length]
    const candidate = `${base}. ${suffix}`.trim()
    if (candidate.length <= maxLength) {
      updated[i] = candidate
      ctaCount += 1
      fixed += 1
      continue
    }
    const fallback = `${updated[i].trim()} ${suffix}`.trim()
    if (fallback.length <= maxLength) {
      updated[i] = fallback
      ctaCount += 1
      fixed += 1
    }
  }

  return { updated, fixed }
}

export function enforceLanguagePurityGate(
  result: GeneratedAdCreativeData,
  bucket: NormalizedCreativeBucket,
  languageCode: string,
  brandName: string
): { headlineFixes: number; descriptionFixes: number } {
  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (!softLanguage) {
    return { headlineFixes: 0, descriptionFixes: 0 }
  }

  const headlines = [...(result.headlines || [])]
  const descriptions = [...(result.descriptions || [])]
  const keywords = [...(result.keywords || [])]
  const languageSafeKeywords = keywords.filter((keyword) =>
    isKeywordCompatibleWithCreativeLanguage(keyword, languageCode)
  )
  const preferredKeyword =
    languageSafeKeywords.find((kw) => kw.length <= 24) ||
    languageSafeKeywords[0] ||
    keywords.find((kw) => kw.length <= 24) ||
    brandName ||
    getDefaultProductNoun(softLanguage)
  const brandSeed = String(brandName || preferredKeyword).trim() || preferredKeyword
  const templates = getSoftCopyTemplates(softLanguage, preferredKeyword, brandSeed)

  const fallbackHeadline =
    bucket === 'A'
      ? templates.a.brandHeadline
      : bucket === 'B'
        ? templates.b.scenarioHeadline
        : templates.d.transactionalHeadline
  const fallbackDescription =
    bucket === 'A'
      ? templates.a.trustDescription
      : bucket === 'B'
        ? templates.b.painSolution1
        : templates.d.valueDescription

  let headlineFixes = 0
  for (let index = 1; index < headlines.length; index += 1) {
    if (isHeadlineCompatibleWithTargetLanguage(headlines[index], languageCode)) continue
    const replacementSeed = index <= 3 ? `${brandSeed} ${preferredKeyword}` : fallbackHeadline
    const replacement = applyHeadlineTextGuardrail(fitLocalizedHeadline(replacementSeed, 30), 30)
    if (!replacement || replacement === headlines[index]) continue
    headlines[index] = replacement
    syncHeadlineMetadataSlot(result, index, replacement)
    headlineFixes += 1
  }

  let descriptionFixes = 0
  for (let index = 0; index < descriptions.length; index += 1) {
    if (isHeadlineCompatibleWithTargetLanguage(descriptions[index], languageCode)) continue
    const replacement = applyDescriptionTextGuardrail(
      fitLocalizedDescription(fallbackDescription.base, fallbackDescription.cta, 90),
      90
    )
    if (!replacement || replacement === descriptions[index]) continue
    descriptions[index] = replacement
    descriptionFixes += 1
  }

  if (headlineFixes > 0) result.headlines = headlines
  if (descriptionFixes > 0) result.descriptions = descriptions

  return { headlineFixes, descriptionFixes }
}

export function isKeywordCompatibleWithCreativeLanguage(
  keyword: string,
  languageCode: string
): boolean {
  const normalizedKeyword = normalizeHeadlineCandidateText(keyword)
  if (!normalizedKeyword) return false

  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (!softLanguage) {
    return true
  }
  return isHeadlineCompatibleWithTargetLanguage(normalizedKeyword, languageCode)
}

export function toLanguageCompatibleKeywordList(
  keywords: string[],
  languageCode: string
): string[] {
  return keywords
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .filter((keyword) => isKeywordCompatibleWithCreativeLanguage(keyword, languageCode))
}

export function buildLanguageSafeUsagePlan(
  usagePlan: CreativeKeywordUsagePlan | null | undefined,
  keywords: string[],
  languageCode: string
): CreativeKeywordUsagePlan | null {
  if (!usagePlan) return null

  const headlineKeywordTargets = resolveHeadlineKeywordTargets(usagePlan, keywords, languageCode)
  const descriptionKeywordTargets = resolveDescriptionKeywordTargets(
    usagePlan,
    keywords,
    languageCode
  )
  const retainedNonBrandKeywords = Array.from(
    new Set([...headlineKeywordTargets, ...descriptionKeywordTargets])
  )

  if (headlineKeywordTargets.length === 0 && descriptionKeywordTargets.length === 0) {
    return usagePlan
  }

  return {
    ...usagePlan,
    retainedNonBrandKeywords:
      retainedNonBrandKeywords.length > 0
        ? retainedNonBrandKeywords
        : usagePlan.retainedNonBrandKeywords,
    headlineKeywordTargets:
      headlineKeywordTargets.length > 0 ? headlineKeywordTargets : usagePlan.headlineKeywordTargets,
    descriptionKeywordTargets:
      descriptionKeywordTargets.length > 0
        ? descriptionKeywordTargets
        : usagePlan.descriptionKeywordTargets,
  }
}

export function resolveCreativeTargetLanguage(
  targetLanguageInput: string | null | undefined,
  targetCountryInput: string | null | undefined
): CreativeTargetLanguageResolution {
  const normalizedCountry = normalizeCountryCode(String(targetCountryInput || '').trim() || 'US')
  const countryMappedLanguageName = getLanguageNameForCountry(normalizedCountry)
  const countryMappedLanguageCode = normalizeLanguageCode(countryMappedLanguageName)

  const rawTargetLanguage = String(targetLanguageInput || '').trim()
  const normalizedRawLanguage = rawTargetLanguage.toLowerCase()
  const hasRecognizedLanguageInput = Boolean(
    rawTargetLanguage &&
    (LANGUAGE_CODE_MAP[normalizedRawLanguage] ||
      /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(normalizedRawLanguage))
  )

  const languageCode = hasRecognizedLanguageInput
    ? normalizeLanguageCode(rawTargetLanguage)
    : countryMappedLanguageCode

  const languageName = (() => {
    const resolved = getLanguageName(languageCode)
    if (resolved && resolved !== 'Unknown') return resolved
    return countryMappedLanguageName || 'English'
  })()

  return {
    languageCode,
    languageName,
    targetCountry: normalizedCountry,
    usedCountryFallback: !hasRecognizedLanguageInput,
  }
}

export function getLanguageInstruction(
  targetLanguageInput: string | null | undefined,
  targetCountryInput: string | null | undefined
): string {
  const resolved = resolveCreativeTargetLanguage(targetLanguageInput, targetCountryInput)
  const fallbackNote = resolved.usedCountryFallback
    ? `- Target language missing/invalid, fallback by country ${resolved.targetCountry}: ${resolved.languageName} (${resolved.languageCode}).`
    : ''

  return `🔴 CRITICAL LANGUAGE REQUIREMENT
- Output language: ${resolved.languageName} ONLY (${resolved.languageCode})
- Headlines, descriptions, keywords, callouts and sitelinks must all be ${resolved.languageName}
- If any source product info/facts/phrases are in another language, translate them into ${resolved.languageName} first, then write the final ad copy
- Keep brand names, model numbers and fixed compliance acronyms unchanged
- Never output mixed-language copy or untranslated fragments
${fallbackNote}`.trim()
}

/**
 * 生成广告创意的Prompt（优化版 - 减少40%+ token消耗）
 * 需求34: 新增 extractedElements 参数，包含从爬虫阶段提取的关键词、标题、描述
 *
 * @version v2.8
 * @changes P3优化 - badge徽章突出展示
 * Headlines Brand: badge优先级提升，明确指令使用完整badge文本
 * Callouts: badge改为P3 CRITICAL级别（与P2促销同级）
 * @previous v2.7 - P2 promotion促销强化
 *
 * @previous v2.6 - P1优化（availability紧迫感 + primeEligible验证）
 */
