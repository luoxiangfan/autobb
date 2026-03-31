/**
 * 广告创意本地评分算法
 *
 * 功能：
 * - 作为AI评分的补充或备选
 * - 基于确定性规则的评分系统
 * - 5个维度：relevance, quality, engagement, diversity, clarity
 * - 支持全局多语言（20+种语言）
 *
 * 使用场景：
 * 1. AI API不可用时的备选方案
 * 2. 与AI评分对比验证
 * 3. 快速本地评分
 */

/**
 * 多语言CTA词汇表（行动召唤）
 * 支持: 英语、中文、日语、韩语、德语、法语、西班牙语、意大利语、葡萄牙语、
 *       荷兰语、瑞典语、挪威语、丹麦语、芬兰语、波兰语、俄语、阿拉伯语、土耳其语、越南语、泰语
 */
const MULTILINGUAL_CTA_WORDS: string[] = [
  // 英语
  'buy', 'shop', 'get', 'order', 'purchase', 'save', 'deal', 'free', 'discount', 'subscribe', 'download', 'join', 'discover', 'explore', 'claim', 'try', 'start', 'learn more', 'sign up',
  // 中文
  '购买', '立即', '免费', '优惠', '折扣', '限时', '特价', '抢购', '下单', '订阅', '下载', '加入', '探索', '领取', '点击', '获取', '了解更多', '注册', '开始',
  // 日语
  '今すぐ購入', '購入する', 'ご注文', '詳しく', '登録', '試す', '始める', 'ダウンロード', '参加', '発見', '節約', '申し込む',
  // 韩语
  '지금 구매', '구매하기', '주문', '자세히', '가입', '시작', '다운로드', '참여', '발견', '절약', '신청',
  // 德语
  'jetzt kaufen', 'kaufen', 'bestellen', 'mehr erfahren', 'anmelden', 'testen', 'starten', 'herunterladen', 'beitreten', 'entdecken', 'sparen', 'sichern', 'holen',
  // 法语
  'acheter maintenant', 'acheter', 'commander', 'en savoir plus', 'essayer', 'commencer', 'télécharger', 'rejoindre', 'découvrir', 'économiser', 'obtenir',
  // 西班牙语
  'comprar ahora', 'comprar', 'pedir', 'más información', 'registrarse', 'probar', 'empezar', 'descargar', 'unirse', 'descubrir', 'ahorrar', 'obtener',
  // 意大利语
  'acquista ora', 'acquista', 'compra', 'ordina', 'scopri di più', 'iscriviti', 'prova', 'inizia', 'scarica', 'unisciti', 'scopri', 'risparmia', 'ottieni', 'richiedi',
  // 葡萄牙语
  'comprar agora', 'comprar', 'pedir', 'saiba mais', 'experimentar', 'começar', 'baixar', 'participar', 'descobrir', 'economizar', 'obter',
  // 荷兰语
  'nu kopen', 'kopen', 'bestellen', 'meer informatie', 'aanmelden', 'proberen', 'starten', 'downloaden', 'deelnemen', 'ontdekken', 'besparen',
  // 瑞典语
  'köp nu', 'köp', 'beställ', 'läs mer', 'registrera', 'prova', 'börja', 'ladda ner', 'upptäck', 'spara',
  // 挪威语
  'kjøp nå', 'kjøp', 'bestill', 'les mer', 'registrer', 'prøv', 'start', 'last ned', 'oppdag', 'spar',
  // 丹麦语
  'køb nu', 'køb', 'bestil', 'læs mere', 'tilmeld', 'prøv', 'start', 'download', 'opdag', 'spar',
  // 芬兰语
  'osta nyt', 'osta', 'tilaa', 'lue lisää', 'rekisteröidy', 'kokeile', 'aloita', 'lataa', 'löydä', 'säästä',
  // 波兰语
  'kup teraz', 'kup', 'zamów', 'dowiedz się więcej', 'zarejestruj', 'wypróbuj', 'zacznij', 'pobierz', 'odkryj', 'oszczędź',
  // 俄语
  'купить сейчас', 'купить', 'заказать', 'узнать больше', 'попробовать', 'начать', 'скачать', 'открыть', 'сэкономить',
  // 阿拉伯语
  'اشتري الآن', 'اشتري', 'اطلب', 'اعرف المزيد', 'جرب', 'ابدأ', 'حمل', 'اكتشف', 'وفر',
  // 土耳其语
  'şimdi satın al', 'satın al', 'sipariş ver', 'daha fazla bilgi', 'dene', 'başla', 'indir', 'keşfet', 'tasarruf et',
  // 越南语
  'mua ngay', 'mua', 'đặt hàng', 'tìm hiểu thêm', 'thử', 'bắt đầu', 'tải xuống', 'khám phá', 'tiết kiệm',
  // 泰语
  'ซื้อเลย', 'ซื้อ', 'สั่งซื้อ', 'เรียนรู้เพิ่มเติม', 'ลอง', 'เริ่มต้น', 'ดาวน์โหลด', 'ค้นพบ', 'ประหยัด'
]

/**
 * 多语言紧迫感词汇表
 */
const MULTILINGUAL_URGENCY_WORDS: string[] = [
  // 英语
  'today', 'now', 'limited', 'hurry', 'exclusive', 'only', 'last chance', 'ending soon', 'act fast', 'urgent', 'final', 'sale ends',
  // 中文
  '今天', '现在', '限时', '仅限', '独家', '最后', '紧急', '倒计时', '抢购', '限量', '马上', '立即', '不要错过',
  // 日语
  '限定', '今日', '今すぐ', '急いで', '独占', 'のみ', '最後のチャンス', '間もなく終了', '在庫限り', '緊急', '最終',
  // 韩语
  '한정', '오늘', '지금', '서둘러', '독점', '단독', '마지막 기회', '곧 종료', '재고 한정', '긴급', '마지막',
  // 德语
  'begrenzt', 'heute', 'jetzt', 'schnell', 'exklusiv', 'nur', 'letzte chance', 'bald endend', 'eilen', 'dringend', 'letzte',
  // 法语
  'limité', "aujourd'hui", 'maintenant', 'vite', 'exclusif', 'seulement', 'dernière chance', 'bientôt terminé', 'urgent', 'final',
  // 西班牙语
  'limitado', 'hoy', 'ahora', 'rápido', 'exclusivo', 'solo', 'última oportunidad', 'pronto termina', 'urgente', 'final',
  // 意大利语
  'limitato', 'oggi', 'ora', 'subito', 'esclusivo', 'solo', 'ultima occasione', 'tempo limitato', 'urgente', 'ultimi', 'pochi pezzi', 'a breve', 'offerta scade',
  // 葡萄牙语
  'limitado', 'hoje', 'agora', 'rápido', 'exclusivo', 'apenas', 'última chance', 'em breve', 'urgente', 'final',
  // 荷兰语
  'beperkt', 'vandaag', 'nu', 'snel', 'exclusief', 'alleen', 'laatste kans', 'binnenkort eindigend', 'urgent', 'laatste',
  // 瑞典语
  'begränsad', 'idag', 'nu', 'snabbt', 'exklusiv', 'endast', 'sista chansen', 'snart slut', 'brådskande', 'sista',
  // 挪威语
  'begrenset', 'i dag', 'nå', 'fort', 'eksklusiv', 'kun', 'siste sjanse', 'snart slutt', 'haster', 'siste',
  // 丹麦语
  'begrænset', 'i dag', 'nu', 'hurtigt', 'eksklusiv', 'kun', 'sidste chance', 'snart slut', 'haster', 'sidste',
  // 芬兰语
  'rajoitettu', 'tänään', 'nyt', 'nopeasti', 'eksklusiivinen', 'vain', 'viimeinen mahdollisuus', 'pian päättyy', 'kiireellinen', 'viimeinen',
  // 波兰语
  'ograniczone', 'dziś', 'teraz', 'szybko', 'ekskluzywne', 'tylko', 'ostatnia szansa', 'wkrótce kończy się', 'pilne', 'ostatni',
  // 俄语
  'ограничено', 'сегодня', 'сейчас', 'быстро', 'эксклюзивно', 'только', 'последний шанс', 'скоро закончится', 'срочно', 'последний',
  // 阿拉伯语
  'محدود', 'اليوم', 'الآن', 'سريعا', 'حصري', 'فقط', 'الفرصة الأخيرة', 'ينتهي قريبا', 'عاجل', 'أخير',
  // 土耳其语
  'sınırlı', 'bugün', 'şimdi', 'hızlı', 'özel', 'sadece', 'son şans', 'yakında bitiyor', 'acil', 'son',
  // 越南语
  'giới hạn', 'hôm nay', 'ngay', 'nhanh', 'độc quyền', 'chỉ', 'cơ hội cuối', 'sắp kết thúc', 'khẩn cấp', 'cuối cùng',
  // 泰语
  'จำกัด', 'วันนี้', 'ตอนนี้', 'เร็ว', 'พิเศษ', 'เท่านั้น', 'โอกาสสุดท้าย', 'ใกล้หมด', 'ด่วน', 'สุดท้าย'
]

export interface AdCreative {
  headline: string[]
  description: string[]
  keywords: string[]
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    description?: string
    url?: string
  }>
  theme?: string
}

export interface ScoreBreakdown {
  relevance: number      // 相关性 (0-100)
  quality: number        // 质量 (0-100)
  engagement: number     // 吸引力 (0-100)
  diversity: number      // 多样性 (0-100)
  clarity: number        // 清晰度 (0-100)
}

export interface ScoringResult {
  score: number                    // 总分 (0-100)
  score_breakdown: ScoreBreakdown
  score_explanation: string
  scoring_method: 'local' | 'ai' | 'hybrid'
}

/**
 * 本地评分算法
 *
 * @param creative 广告创意数据
 * @param context 上下文信息（Offer数据等）
 * @returns 评分结果
 */
export function scoreAdCreativeLocally(
  creative: AdCreative,
  context?: {
    offerName?: string
    brandName?: string
    targetCountry?: string
    productCategory?: string
    landingPageUrl?: string
  }
): ScoringResult {
  const breakdown: ScoreBreakdown = {
    relevance: scoreRelevance(creative, context),
    quality: scoreQuality(creative),
    engagement: scoreEngagement(creative),
    diversity: scoreDiversity(creative),
    clarity: scoreClarity(creative)
  }

  // 加权计算总分
  const weights = {
    relevance: 0.30,      // 相关性权重30%
    quality: 0.25,        // 质量权重25%
    engagement: 0.20,     // 吸引力权重20%
    diversity: 0.15,      // 多样性权重15%
    clarity: 0.10         // 清晰度权重10%
  }

  const totalScore = Math.round(
    breakdown.relevance * weights.relevance +
    breakdown.quality * weights.quality +
    breakdown.engagement * weights.engagement +
    breakdown.diversity * weights.diversity +
    breakdown.clarity * weights.clarity
  )

  const explanation = generateExplanation(breakdown, totalScore)

  return {
    score: totalScore,
    score_breakdown: breakdown,
    score_explanation: explanation,
    scoring_method: 'local'
  }
}

/**
 * 评分维度1: 相关性 (Relevance)
 * 评估广告内容与Offer、品牌、目标的相关性
 */
function scoreRelevance(
  creative: AdCreative,
  context?: {
    offerName?: string
    brandName?: string
    targetCountry?: string
    productCategory?: string
  }
): number {
  let score = 70 // 基准分

  if (!context) return score

  const allText = [
    ...creative.headline,
    ...creative.description,
    ...creative.keywords
  ].join(' ').toLowerCase()

  // 1. 品牌名称出现 (+15分)
  if (context.brandName && allText.includes(context.brandName.toLowerCase())) {
    score += 15
  }

  // 2. 关键词丰富度 (+10分)
  if (creative.keywords.length >= 10) {
    score += 10
  } else if (creative.keywords.length >= 5) {
    score += 5
  }

  // 3. 主题一致性 (+5分)
  if (creative.theme && creative.theme.length > 0) {
    score += 5
  }

  return Math.min(100, score)
}

/**
 * 评分维度2: 质量 (Quality)
 * 评估广告文案的质量、完整性、符合规范程度
 */
function scoreQuality(creative: AdCreative): number {
  let score = 60 // 基准分

  // 1. Headlines完整性 (+15分)
  if (creative.headline.length >= 3) {
    score += 15
    // 长度适中奖励
    const avgLength = creative.headline.reduce((sum, h) => sum + h.length, 0) / creative.headline.length
    if (avgLength >= 15 && avgLength <= 25) {
      score += 5
    }
  } else {
    score -= 10 // 不足3条扣分
  }

  // 2. Descriptions完整性 (+10分)
  if (creative.description.length >= 2) {
    score += 10
    // 长度适中奖励
    const avgLength = creative.description.reduce((sum, d) => sum + d.length, 0) / creative.description.length
    if (avgLength >= 40 && avgLength <= 80) {
      score += 5
    }
  } else {
    score -= 5
  }

  // 3. Callouts (+5分)
  if (creative.callouts && creative.callouts.length >= 3) {
    score += 5
  }

  // 4. Sitelinks (+5分) - v3.3 CTR优化：增强多样性检查
  if (creative.sitelinks && creative.sitelinks.length >= 2) {
    const sitelinkDiversity = evaluateSitelinkDiversity(creative.sitelinks)
    // 基础分2分 + 多样性奖励最多3分
    score += 2 + Math.round(sitelinkDiversity.diversityScore * 3)
  }

  // 5. 字符长度规范检查 (+5分)
  const headlineLengthValid = creative.headline.every(h => h.length <= 30)
  const descriptionLengthValid = creative.description.every(d => d.length <= 90)

  if (headlineLengthValid && descriptionLengthValid) {
    score += 5
  }

  return Math.min(100, Math.max(0, score))
}

/**
 * 评分维度3: 吸引力 (Engagement)
 * 评估广告的吸引用户点击的能力
 * 支持全局多语言（20+种语言）
 */
function scoreEngagement(creative: AdCreative): number {
  let score = 65 // 基准分

  const allText = [
    ...creative.headline,
    ...creative.description
  ].join(' ').toLowerCase()

  // 1. 行动号召词 (Call-to-Action) (+15分) - 使用全局多语言词汇表
  const ctaCount = MULTILINGUAL_CTA_WORDS.filter(word => allText.includes(word.toLowerCase())).length
  if (ctaCount >= 3) {
    score += 15
  } else if (ctaCount >= 1) {
    score += 8
  }

  // 2. 数字和统计数据 (+10分)
  const numberRegex = /\d+(\.\d+)?%?/g
  const numbers = allText.match(numberRegex)
  if (numbers && numbers.length >= 2) {
    score += 10
  } else if (numbers && numbers.length >= 1) {
    score += 5
  }

  // 3. 紧迫性词汇 (+5分) - 使用全局多语言词汇表
  const hasUrgency = MULTILINGUAL_URGENCY_WORDS.some(word => allText.includes(word.toLowerCase()))
  if (hasUrgency) {
    score += 5
  }

  // 4. 问题或疑问词 (+5分) - 支持多语言问号和疑问词
  const questionMarks = /[?？¿‽⁇؟]/  // 多语言问号
  const questionWords = [
    // 英语
    'how', 'what', 'why', 'when', 'where', 'which', 'who',
    // 中文
    '如何', '什么', '为什么', '怎么', '哪里', '谁', '吗',
    // 日语
    'どう', '何', 'なぜ', 'どこ', '誰',
    // 韩语
    '어떻게', '무엇', '왜', '어디', '누구',
    // 德语
    'wie', 'was', 'warum', 'wann', 'wo', 'wer',
    // 法语
    'comment', 'quoi', 'pourquoi', 'quand', 'où', 'qui',
    // 西班牙语
    'cómo', 'qué', 'por qué', 'cuándo', 'dónde', 'quién',
    // 意大利语
    'come', 'cosa', 'perché', 'quando', 'dove', 'chi'
  ]
  const hasQuestion = questionMarks.test(allText) || questionWords.some(word => allText.includes(word))
  if (hasQuestion) {
    score += 5
  }

  return Math.min(100, score)
}

/**
 * 评分维度4: 多样性 (Diversity)
 * 评估广告内容的多样性和变化性
 */
function scoreDiversity(creative: AdCreative): number {
  let score = 70 // 基准分

  // 1. Headlines多样性 (+15分)
  const headlineUniqueness = calculateUniqueness(creative.headline)
  score += headlineUniqueness * 15

  // 2. Descriptions多样性 (+10分)
  const descriptionUniqueness = calculateUniqueness(creative.description)
  score += descriptionUniqueness * 10

  // 3. 关键词多样性 (+5分)
  const keywordUniqueness = calculateUniqueness(creative.keywords)
  score += keywordUniqueness * 5

  return Math.min(100, Math.max(0, score))
}

/**
 * 评分维度5: 清晰度 (Clarity)
 * 评估广告信息的清晰度和易理解性
 */
function scoreClarity(creative: AdCreative): number {
  let score = 75 // 基准分

  // 1. 句子长度适中 (+10分)
  const avgHeadlineLength = creative.headline.reduce((sum, h) => sum + h.split(' ').length, 0) / creative.headline.length
  if (avgHeadlineLength >= 3 && avgHeadlineLength <= 6) {
    score += 10
  }

  // 2. 避免过度复杂 (+10分)
  const complexWords = ['synergy', 'paradigm', 'leverage', 'optimize', 'utilize']
  const allText = [...creative.headline, ...creative.description].join(' ').toLowerCase()
  const hasComplexWords = complexWords.some(word => allText.includes(word))
  if (!hasComplexWords) {
    score += 10
  }

  // 3. 一致的语言风格 (+5分)
  const hasConsistentTone = checkToneConsistency(creative)
  if (hasConsistentTone) {
    score += 5
  }

  return Math.min(100, Math.max(0, score))
}

/**
 * 计算文本数组的唯一性
 * 返回0-1之间的值，1表示完全不重复
 */
function calculateUniqueness(texts: string[]): number {
  if (texts.length === 0) return 0

  const words = texts.map(t => t.toLowerCase().split(/\s+/)).flat()
  const uniqueWords = new Set(words)

  return uniqueWords.size / words.length
}

/**
 * 检查语言风格一致性
 */
function checkToneConsistency(creative: AdCreative): boolean {
  const allText = [...creative.headline, ...creative.description].join(' ')

  // 简单检查：大小写使用是否一致
  const hasAllCaps = /[A-Z]{4,}/.test(allText)
  const hasAllLower = /^[a-z\s]+$/.test(allText)

  // 既不全大写也不全小写，说明有适当的大小写混合，表示一致性较好
  return !hasAllCaps || !hasAllLower
}

/**
 * 生成评分说明
 */
function generateExplanation(breakdown: ScoreBreakdown, totalScore: number): string {
  const parts: string[] = []

  // 总体评价
  if (totalScore >= 85) {
    parts.push('该广告创意整体质量优秀')
  } else if (totalScore >= 70) {
    parts.push('该广告创意整体质量良好')
  } else if (totalScore >= 60) {
    parts.push('该广告创意整体质量一般')
  } else {
    parts.push('该广告创意需要改进')
  }

  // 强项
  const strengths: string[] = []
  if (breakdown.relevance >= 85) strengths.push('相关性')
  if (breakdown.quality >= 85) strengths.push('质量')
  if (breakdown.engagement >= 85) strengths.push('吸引力')
  if (breakdown.diversity >= 85) strengths.push('多样性')
  if (breakdown.clarity >= 85) strengths.push('清晰度')

  if (strengths.length > 0) {
    parts.push(`，在${strengths.join('、')}方面表现突出`)
  }

  // 弱项
  const weaknesses: string[] = []
  if (breakdown.relevance < 60) weaknesses.push('相关性')
  if (breakdown.quality < 60) weaknesses.push('质量')
  if (breakdown.engagement < 60) weaknesses.push('吸引力')
  if (breakdown.diversity < 60) weaknesses.push('多样性')
  if (breakdown.clarity < 60) weaknesses.push('清晰度')

  if (weaknesses.length > 0) {
    parts.push(`。建议改进${weaknesses.join('、')}`)
  } else {
    parts.push('。各维度表现均衡')
  }

  return parts.join('')
}

/**
 * v3.3 CTR优化：Sitelink多样性评估
 *
 * Google Ads最佳实践：
 * - 6个Sitelinks覆盖不同用户意图 (🔧 2025-12-24: 从4-6个改为6个)
 * - 类型多样：产品页、分类页、促销页、关于我们、联系方式等
 * - 避免重复或相似的链接文本
 *
 * @param sitelinks Sitelink数组
 * @returns 多样性评估结果
 */
export interface SitelinkDiversityResult {
  diversityScore: number // 0-1，1表示完全多样
  typesCovered: string[] // 覆盖的类型
  suggestions: string[] // 改进建议
  details: {
    textUniqueness: number // 文本独特性 0-1
    typeCoverage: number // 类型覆盖率 0-1
    lengthVariation: number // 长度变化 0-1
  }
}

/**
 * Sitelink类型分类
 */
const SITELINK_TYPE_PATTERNS: Record<string, RegExp> = {
  product: /product|shop|buy|store|item|collection|catalog|prodotto|prodotti|negozio|acquista|compra|tienda|producto|boutique|produit|produkt|kaufen|商品|产品|购买|製品|商店|제품|구매/i,
  category: /category|categories|browse|all|view all|see all|categoria|categorie|sfoglia|categoría|catégorie|kategorie|分类|类别|カテゴリ|카테고리/i,
  promo: /sale|deal|offer|discount|promo|coupon|save|offerta|sconto|promozione|oferta|descuento|soldes|rabatt|优惠|折扣|促销|セール|할인/i,
  about: /about|who we are|our story|company|brand|chi siamo|sobre|à propos|über uns|关于|について|소개/i,
  contact: /contact|support|help|customer service|contatti|contacto|kontakt|联系|お問い合わせ|연락/i,
  shipping: /shipping|delivery|free shipping|spedizione|envío|livraison|versand|配送|运费|配達|배송/i,
  returns: /return|refund|exchange|reso|resi|devolución|retour|rückgabe|退货|退款|返品|반품/i,
  reviews: /review|testimonial|rating|recensioni|reseña|avis|bewertung|评价|评论|レビュー|리뷰/i,
  new: /new|latest|arrival|nuovo|nuovi|nuevo|nouveau|neu|新品|新着|신상품/i,
  bestseller: /best seller|popular|top|trending|più venduti|más vendido|meilleure vente|bestseller|热销|人気|인기/i
}

export function evaluateSitelinkDiversity(
  sitelinks: Array<{ text: string; description?: string; url?: string }>
): SitelinkDiversityResult {
  if (!sitelinks || sitelinks.length === 0) {
    return {
      diversityScore: 0,
      typesCovered: [],
      suggestions: ['添加6个Sitelinks以提高广告效果'],  // 🔧 修复(2025-12-24): 从4个改为6个
      details: { textUniqueness: 0, typeCoverage: 0, lengthVariation: 0 }
    }
  }

  const suggestions: string[] = []
  const typesCovered: string[] = []

  // 1. 文本独特性评估 (0-1)
  const texts = sitelinks.map(s => s.text.toLowerCase())
  const uniqueTexts = new Set(texts)
  const textUniqueness = uniqueTexts.size / texts.length

  // 检查相似文本
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const similarity = calculateTextSimilarity(texts[i], texts[j])
      if (similarity > 0.6) {
        suggestions.push(`Sitelink "${sitelinks[i].text}" 与 "${sitelinks[j].text}" 过于相似，建议差异化`)
      }
    }
  }

  // 2. 类型覆盖率评估 (0-1)
  const allText = sitelinks.map(s => `${s.text} ${s.description || ''}`).join(' ')

  for (const [type, pattern] of Object.entries(SITELINK_TYPE_PATTERNS)) {
    if (pattern.test(allText)) {
      typesCovered.push(type)
    }
  }

  // 理想覆盖4种以上类型
  const typeCoverage = Math.min(1, typesCovered.length / 4)

  // 建议缺失的重要类型
  const importantTypes = ['product', 'promo', 'shipping', 'contact']
  const missingTypes = importantTypes.filter(t => !typesCovered.includes(t))
  if (missingTypes.length > 0) {
    const typeNames: Record<string, string> = {
      product: '产品页',
      promo: '促销页',
      shipping: '配送信息',
      contact: '联系方式'
    }
    suggestions.push(`建议添加: ${missingTypes.map(t => typeNames[t]).join('、')}`)
  }

  // 3. 长度变化评估 (0-1)
  const lengths = sitelinks.map(s => s.text.length)
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length
  const lengthVariance = lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / lengths.length
  const lengthStdDev = Math.sqrt(lengthVariance)
  // 标准差在3-8之间表示良好的变化
  const lengthVariation = Math.min(1, lengthStdDev / 5)

  // 4. 数量检查 - 🔧 修复(2025-12-24): 改为要求6个
  if (sitelinks.length < 6) {
    suggestions.push(`当前${sitelinks.length}个Sitelinks，建议增加到6个`)
  }

  // 综合多样性得分
  const diversityScore = (textUniqueness * 0.4) + (typeCoverage * 0.4) + (lengthVariation * 0.2)

  return {
    diversityScore: Math.round(diversityScore * 100) / 100,
    typesCovered,
    suggestions,
    details: {
      textUniqueness: Math.round(textUniqueness * 100) / 100,
      typeCoverage: Math.round(typeCoverage * 100) / 100,
      lengthVariation: Math.round(lengthVariation * 100) / 100
    }
  }
}

/**
 * 计算两个文本的相似度 (简化版Jaccard)
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2))
  const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2))

  if (words1.size === 0 && words2.size === 0) return 1
  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])

  return intersection.size / union.size
}

/**
 * 混合评分：结合AI评分和本地评分
 *
 * @param aiScore AI生成的评分
 * @param creative 广告创意数据
 * @param context 上下文信息
 * @returns 混合评分结果
 */
export function scoreAdCreativeHybrid(
  aiScore: ScoringResult | null,
  creative: AdCreative,
  context?: any
): ScoringResult {
  const localScore = scoreAdCreativeLocally(creative, context)

  // 如果没有AI评分，直接返回本地评分
  if (!aiScore) {
    return localScore
  }

  // 混合策略：AI评分占70%，本地评分占30%
  const hybridScore = Math.round(aiScore.score * 0.7 + localScore.score * 0.3)

  const hybridBreakdown: ScoreBreakdown = {
    relevance: Math.round(aiScore.score_breakdown.relevance * 0.7 + localScore.score_breakdown.relevance * 0.3),
    quality: Math.round(aiScore.score_breakdown.quality * 0.7 + localScore.score_breakdown.quality * 0.3),
    engagement: Math.round(aiScore.score_breakdown.engagement * 0.7 + localScore.score_breakdown.engagement * 0.3),
    diversity: Math.round(aiScore.score_breakdown.diversity * 0.7 + localScore.score_breakdown.diversity * 0.3),
    clarity: Math.round(aiScore.score_breakdown.clarity * 0.7 + localScore.score_breakdown.clarity * 0.3)
  }

  return {
    score: hybridScore,
    score_breakdown: hybridBreakdown,
    score_explanation: `${aiScore.score_explanation}（AI评分：${aiScore.score}，本地评分：${localScore.score}，混合评分：${hybridScore}）`,
    scoring_method: 'hybrid'
  }
}
