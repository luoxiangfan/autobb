import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from './brand-keyword-utils'
import { normalizeLanguageCode } from './language-country-codes'

export type KeywordIntent =
  | 'TRANSACTIONAL'
  | 'COMMERCIAL'
  | 'SUPPORT'
  | 'PIRACY'
  | 'JOBS'
  | 'DOWNLOAD'
  | 'OTHER'

export interface KeywordIntentResult {
  intent: KeywordIntent
  hardNegative: boolean
  reasons: string[]
}

export interface KeywordIntentOptions {
  language?: string
}

type PatternGroup = {
  intent: KeywordIntent
  reason: string
  hardNegative: boolean
  patterns: RegExp[]
}

type LocalizedIntentGroup = {
  intent: KeywordIntent
  reason: string
  hardNegative: boolean
  termsByLanguage: Record<string, string[]>
}

const INTENT_PATTERN_GROUPS: PatternGroup[] = [
  {
    intent: 'PIRACY',
    reason: 'piracy_or_freebie',
    hardNegative: true,
    patterns: [
      /\b(crack|cracked|torrent|pirate|pirated|nulled|serial key)\b/i,
    ],
  },
  {
    intent: 'JOBS',
    reason: 'jobs_or_hiring',
    hardNegative: true,
    patterns: [
      /\b(job|jobs|career|careers|hiring|salary|employment|recruit|vacancy|internship)\b/i,
    ],
  },
  {
    intent: 'DOWNLOAD',
    reason: 'download_or_software_support',
    hardNegative: true,
    patterns: [
      /\b(download|downloads|apk|ipa|iso|firmware|driver|software update)\b/i,
      /\b(app\s+download|mobile app\b|android app\b|ios app\b)\b/i,
    ],
  },
  {
    intent: 'SUPPORT',
    reason: 'support_or_after_sales',
    hardNegative: true,
    patterns: [
      /\b(login|log in|sign in|signin|register|registration|account|password|forgot password)\b/i,
      /\b(manual|instruction|help|support|faq|setup|set up|install|installation|configure|configuration)\b/i,
      /\b(repair|fix|broken|not working|troubleshoot|reset|warranty|return policy|refund|exchange|rma)\b/i,
      /\b(how to|tutorial|guide)\b/i,
    ],
  },
  {
    intent: 'SUPPORT',
    reason: 'visual_asset_or_size_lookup',
    hardNegative: true,
    patterns: [
      /\b(gif|meme|emoji|sticker|drawing|image|images|logo|png|jpg|jpeg|svg|icon|clipart|wallpaper)\b/i,
      /\b(size chart|size guide|sizing)\b/i,
    ],
  },
  {
    intent: 'COMMERCIAL',
    reason: 'commercial_research',
    hardNegative: false,
    patterns: [
      /\b(review|reviews|vs\b|versus|compare|comparison|top rated|best\b|ranking|rating)\b/i,
      /\b(alternative|alternatives|better than|which is better)\b/i,
    ],
  },
  {
    intent: 'TRANSACTIONAL',
    reason: 'transaction_signal',
    hardNegative: false,
    patterns: [
      /\b(buy|shop|order|price|pricing|cost|quote|deal|deals|sale|coupon|discount|promo|offer)\b/i,
      /\b(official store|official site|manufacturer|authorized|in stock|shipping)\b/i,
    ],
  },
]

const INTENT_WEIGHT: Record<KeywordIntent, number> = {
  TRANSACTIONAL: 4,
  COMMERCIAL: 3,
  OTHER: 2,
  SUPPORT: 1,
  DOWNLOAD: 1,
  JOBS: 1,
  PIRACY: 1,
}

const CJK_LANGUAGES = new Set(['zh', 'ja', 'ko'])

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeIntentLanguage(language?: string): string {
  const raw = String(language || '').trim().toLowerCase().replace('_', '-')
  const rawBase = raw.split('-')[0]
  if (rawBase && rawBase.length === 2) return rawBase

  const normalized = normalizeLanguageCode(language || 'en')
  const normalizedBase = normalized.split('-')[0]
  if (normalizedBase && normalizedBase.length === 2) return normalizedBase

  return 'en'
}

function hasLocalizedTerm(keyword: string, language: string, term: string): boolean {
  if (!term) return false
  const normalizedTerm = term.trim().toLowerCase()
  if (!normalizedTerm) return false

  if (CJK_LANGUAGES.has(language)) {
    return keyword.toLowerCase().includes(normalizedTerm)
  }

  const escaped = escapeRegex(normalizedTerm).replace(/\s+/g, '\\s+')
  const pattern = new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i')
  return pattern.test(keyword)
}

function matchesLocalizedTerms(
  keyword: string,
  language: string,
  termsByLanguage: Record<string, string[]>
): boolean {
  const languageTerms = termsByLanguage[language] || []
  const fallbackTerms = language === 'en' ? [] : (termsByLanguage.en || [])
  const terms = [...languageTerms, ...fallbackTerms]
  return terms.some((term) => hasLocalizedTerm(keyword, language, term))
}

const LOCALIZED_INTENT_GROUPS: LocalizedIntentGroup[] = [
  {
    intent: 'PIRACY',
    reason: 'piracy_or_freebie',
    hardNegative: true,
    termsByLanguage: {
      en: ['crack', 'cracked', 'torrent', 'pirate', 'pirated', 'nulled', 'serial key'],
      de: ['crack', 'torrent', 'raubkopie', 'seriennummer'],
      fr: ['crack', 'torrent', 'piraté', 'clé série'],
      es: ['crack', 'torrent', 'pirata', 'serial'],
      it: ['crack', 'torrent', 'pirata', 'seriale'],
      pt: ['crack', 'torrent', 'pirata', 'serial'],
      ja: ['クラック', 'トレント', '海賊版', 'シリアルキー'],
      ko: ['크랙', '토렌트', '불법', '시리얼'],
      zh: ['破解', '盗版', '种子', '激活码', '序列号'],
    },
  },
  {
    intent: 'JOBS',
    reason: 'jobs_or_hiring',
    hardNegative: true,
    termsByLanguage: {
      en: ['job', 'jobs', 'career', 'careers', 'hiring', 'salary', 'employment', 'recruit', 'vacancy', 'internship'],
      de: ['job', 'jobs', 'karriere', 'stellenangebot', 'gehalt', 'praktikum'],
      fr: ['emploi', 'carrière', 'recrutement', 'salaire', 'stage'],
      es: ['empleo', 'trabajo', 'carrera', 'contratando', 'salario', 'prácticas'],
      it: ['lavoro', 'carriera', 'assunzioni', 'stipendio', 'stage'],
      pt: ['emprego', 'carreira', 'contratação', 'salário', 'estágio'],
      ja: ['求人', '採用', '就職', '給与', 'インターン'],
      ko: ['채용', '구인', '구직', '연봉', '인턴'],
      zh: ['招聘', '岗位', '工作', '求职', '薪资', '实习'],
    },
  },
  {
    intent: 'DOWNLOAD',
    reason: 'download_or_software_support',
    hardNegative: true,
    termsByLanguage: {
      en: ['download', 'downloads', 'apk', 'ipa', 'iso', 'firmware', 'driver', 'software update', 'app download'],
      de: ['download', 'herunterladen', 'firmware', 'treiber', 'app'],
      fr: ['télécharger', 'download', 'firmware', 'pilote', 'application'],
      es: ['descargar', 'download', 'firmware', 'driver', 'aplicación'],
      it: ['download', 'scaricare', 'firmware', 'driver', 'app'],
      pt: ['download', 'baixar', 'firmware', 'driver', 'aplicativo'],
      ja: ['ダウンロード', 'ファームウェア', 'ドライバー', 'アプリ'],
      ko: ['다운로드', '펌웨어', '드라이버', '앱'],
      zh: ['下载', '固件', '驱动', '安装包', '应用'],
    },
  },
  {
    intent: 'SUPPORT',
    reason: 'support_or_after_sales',
    hardNegative: true,
    termsByLanguage: {
      en: ['login', 'sign in', 'manual', 'help', 'support', 'faq', 'install', 'repair', 'warranty', 'refund', 'return'],
      de: ['anmelden', 'login', 'handbuch', 'hilfe', 'support', 'installation', 'reparatur', 'garantie', 'rückgabe'],
      fr: ['connexion', 'se connecter', 'manuel', 'aide', 'support', 'installation', 'réparation', 'garantie', 'retour', 'remboursement'],
      es: ['iniciar sesión', 'manual', 'ayuda', 'soporte', 'instalación', 'reparación', 'garantía', 'devolución', 'reembolso'],
      it: ['accedi', 'login', 'manuale', 'aiuto', 'supporto', 'installazione', 'riparazione', 'garanzia', 'reso', 'rimborso'],
      pt: ['login', 'entrar', 'manual', 'ajuda', 'suporte', 'instalação', 'reparo', 'garantia', 'devolução', 'reembolso'],
      ja: ['ログイン', 'マニュアル', '取扱説明書', 'ヘルプ', 'サポート', 'インストール', '修理', '保証', '返品'],
      ko: ['로그인', '매뉴얼', '도움말', '지원', '설치', '수리', '보증', '반품', '환불'],
      zh: ['登录', '登入', '手册', '说明书', '帮助', '支持', '安装', '维修', '保修', '退货', '退款'],
    },
  },
  {
    intent: 'COMMERCIAL',
    reason: 'commercial_research',
    hardNegative: false,
    termsByLanguage: {
      en: ['review', 'reviews', 'vs', 'versus', 'compare', 'comparison', 'best', 'top rated', 'ranking', 'rating', 'alternative'],
      de: ['bewertung', 'test', 'vergleich', 'vs', 'beste', 'alternative'],
      fr: ['avis', 'comparatif', 'comparer', 'vs', 'meilleur', 'alternative'],
      es: ['reseña', 'opiniones', 'comparar', 'comparativa', 'vs', 'mejor', 'alternativa'],
      it: ['recensione', 'recensioni', 'confronto', 'vs', 'migliore', 'alternativa'],
      pt: ['avaliação', 'review', 'comparar', 'comparação', 'vs', 'melhor', 'alternativa'],
      ja: ['レビュー', '比較', 'おすすめ', '代替'],
      ko: ['리뷰', '비교', '추천', '대안'],
      zh: ['评测', '测评', '对比', '比较', '哪个好', '替代', '口碑'],
    },
  },
  {
    intent: 'TRANSACTIONAL',
    reason: 'transaction_signal',
    hardNegative: false,
    termsByLanguage: {
      en: ['buy', 'shop', 'order', 'price', 'pricing', 'cost', 'quote', 'deal', 'discount', 'promo', 'offer', 'supplier', 'manufacturer', 'oem', 'wholesale'],
      de: ['kaufen', 'bestellen', 'preis', 'angebot', 'rabatt', 'lieferant', 'hersteller', 'großhandel'],
      fr: ['acheter', 'commande', 'prix', 'devis', 'offre', 'remise', 'fournisseur', 'fabricant', 'grossiste'],
      es: ['comprar', 'pedido', 'precio', 'cotización', 'oferta', 'descuento', 'proveedor', 'fabricante', 'mayorista'],
      it: ['acquistare', 'ordine', 'prezzo', 'preventivo', 'offerta', 'sconto', 'fornitore', 'produttore', 'ingrosso'],
      pt: ['comprar', 'pedido', 'preço', 'cotação', 'oferta', 'desconto', 'fornecedor', 'fabricante', 'atacado'],
      ja: ['購入', '注文', '価格', '見積', '割引', 'メーカー', 'サプライヤー', '卸売'],
      ko: ['구매', '주문', '가격', '견적', '할인', '제조사', '공급업체', '도매'],
      zh: ['购买', '采购', '价格', '报价', '下单', '优惠', '折扣', '供应商', '厂家', '制造商', '批发', 'oem'],
    },
  },
]

export function classifyKeywordIntent(
  keyword: string,
  options: KeywordIntentOptions = {}
): KeywordIntentResult {
  const normalizedKeyword = String(keyword ?? '').trim()
  if (!normalizedKeyword) {
    return {
      intent: 'OTHER',
      hardNegative: false,
      reasons: ['empty_keyword'],
    }
  }

  const matchedGroups: Array<{ intent: KeywordIntent; hardNegative: boolean; reason: string }> = []
  const language = normalizeIntentLanguage(options.language)

  for (const group of INTENT_PATTERN_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(normalizedKeyword))) {
      matchedGroups.push({
        intent: group.intent,
        hardNegative: group.hardNegative,
        reason: group.reason,
      })
    }
  }

  for (const group of LOCALIZED_INTENT_GROUPS) {
    if (matchesLocalizedTerms(normalizedKeyword, language, group.termsByLanguage)) {
      matchedGroups.push({
        intent: group.intent,
        hardNegative: group.hardNegative,
        reason: group.reason,
      })
    }
  }

  if (matchedGroups.length === 0) {
    return {
      intent: 'OTHER',
      hardNegative: false,
      reasons: ['generic_or_unclassified'],
    }
  }

  // 优先 hard negative（避免误入无效流量）
  const hardNegativeMatch = matchedGroups.find((item) => item.hardNegative)
  if (hardNegativeMatch) {
    return {
      intent: hardNegativeMatch.intent,
      hardNegative: true,
      reasons: Array.from(new Set(matchedGroups.map((item) => item.reason))),
    }
  }

  // 在非 hard negative 中选最高优先级意图
  matchedGroups.sort((a, b) => INTENT_WEIGHT[b.intent] - INTENT_WEIGHT[a.intent])
  const selected = matchedGroups[0]

  return {
    intent: selected.intent,
    hardNegative: false,
    reasons: Array.from(new Set(matchedGroups.map((item) => item.reason))),
  }
}

export function recommendMatchTypeForKeyword(params: {
  keyword: string
  brandName?: string
  intent?: KeywordIntent
}): 'EXACT' | 'PHRASE' | 'BROAD' {
  const keyword = String(params.keyword ?? '').trim()
  if (!keyword) return 'PHRASE'

  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  if (pureBrandKeywords.length > 0) {
    if (isPureBrandKeyword(keyword, pureBrandKeywords)) return 'EXACT'
    if (containsPureBrand(keyword, pureBrandKeywords)) return 'PHRASE'
  }

  const intent = params.intent ?? classifyKeywordIntent(keyword).intent
  if (intent === 'TRANSACTIONAL' || intent === 'COMMERCIAL') return 'PHRASE'
  if (intent === 'SUPPORT' || intent === 'PIRACY' || intent === 'JOBS' || intent === 'DOWNLOAD') {
    // 这些通常不会进入正向关键词池；兜底仍给PHRASE，避免误放大
    return 'PHRASE'
  }

  return 'PHRASE'
}

export function isHardNegativeIntent(intent: KeywordIntent): boolean {
  return intent === 'SUPPORT' || intent === 'PIRACY' || intent === 'JOBS' || intent === 'DOWNLOAD'
}
