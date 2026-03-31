/**
 * Ad Strength多语言支持
 *
 * 根据offer.target_country动态调整评估标准：
 * 1. 字符长度计算（中文/日文/韩文 vs 英文）
 * 2. 禁用词清单（各语言政策词汇）
 * 3. CTA和紧迫感表达检测
 * 4. 关键词自然度评估
 */

/**
 * 支持的语言/地区配置
 */
export interface LanguageConfig {
  code: string
  name: string
  // 字符长度计算（CJK字符权重）
  charWeightMultiplier: number
  // 最大headline长度（字符数）
  maxHeadlineLength: number
  // 最大description长度（字符数）
  maxDescriptionLength: number
  // 禁用词清单
  forbiddenWords: string[]
  // CTA关键词
  ctaKeywords: string[]
  // 紧迫感关键词
  urgencyKeywords: string[]
  // 数字检测正则
  numberPattern: RegExp
}

/**
 * 根据target_country获取语言配置
 */
export function getLanguageConfig(targetCountry: string): LanguageConfig {
  const country = targetCountry.toUpperCase()

  // 中文区（中国大陆、香港、台湾）
  if (['CN', 'HK', 'TW', 'MO'].includes(country)) {
    return chineseConfig
  }

  // 日本
  if (country === 'JP') {
    return japaneseConfig
  }

  // 韩国
  if (country === 'KR') {
    return koreanConfig
  }

  // 意大利
  if (country === 'IT') {
    return italianConfig
  }

  // 瑞典
  if (country === 'SE') {
    return swedishConfig
  }

  // 西班牙语区
  if (['ES', 'MX', 'AR', 'CO', 'CL', 'PE'].includes(country)) {
    return spanishConfig
  }

  // 法语区（移除CH，瑞士单独处理）
  if (['FR', 'CA', 'BE'].includes(country)) {
    return frenchConfig
  }

  // 德语区（包括瑞士，瑞士默认使用德语）
  if (['DE', 'AT', 'CH'].includes(country)) {
    return germanConfig
  }

  // 默认：英语
  return englishConfig
}

/**
 * 英语配置（默认）
 */
const englishConfig: LanguageConfig = {
  code: 'en',
  name: 'English',
  charWeightMultiplier: 1,
  maxHeadlineLength: 30,
  maxDescriptionLength: 90,
  forbiddenWords: [
    // 绝对化词汇
    '100%', 'best in the world', 'number one', '#1', 'guaranteed',
    'always', 'never', 'perfect', 'flawless',
    // 夸大表述
    'miracle', 'magic', 'instant', 'revolutionary',
    // 误导性
    'free money', 'get rich quick', 'no risk', 'unlimited'
  ],
  ctaKeywords: [
    'shop now', 'buy now', 'get', 'order', 'learn more',
    'sign up', 'try', 'start', 'discover', 'explore',
    'download', 'subscribe', 'join', 'call', 'contact'
  ],
  urgencyKeywords: [
    'limited', 'today', 'now', 'hurry', 'exclusive',
    'only', 'sale ends', 'last chance', 'don\'t miss',
    'act now', 'while supplies last', 'ending soon'
  ],
  numberPattern: /\d+%?|\$\d+/
}

/**
 * 中文配置
 */
const chineseConfig: LanguageConfig = {
  code: 'zh',
  name: '中文',
  charWeightMultiplier: 2, // 中文字符通常占2个英文字符宽度
  maxHeadlineLength: 15, // 约等于30个英文字符
  maxDescriptionLength: 45, // 约等于90个英文字符
  forbiddenWords: [
    // 绝对化词汇
    '100%', '最佳', '第一', '保证', '必须', '绝对',
    '最好', '最强', '最优', '唯一', '首选',
    // 夸大表述
    '奇迹', '魔法', '神奇', '完美', '极致',
    '颠覆', '革命', '史无前例',
    // 误导性
    '免费', '白送', '零风险', '稳赚', '躺赚',
    '暴富', '月入过万'
  ],
  ctaKeywords: [
    '立即购买', '马上下单', '立即抢购', '点击了解',
    '免费试用', '立即注册', '开始使用', '马上体验',
    '立即咨询', '获取报价', '预约', '下载'
  ],
  urgencyKeywords: [
    '限时', '今日', '仅限', '最后', '抢购',
    '售罄', '即将截止', '错过', '倒计时',
    '库存告急', '名额有限', '先到先得'
  ],
  numberPattern: /\d+%?|¥\d+|\d+折/
}

/**
 * 日语配置
 */
const japaneseConfig: LanguageConfig = {
  code: 'ja',
  name: '日本語',
  charWeightMultiplier: 2,
  maxHeadlineLength: 15,
  maxDescriptionLength: 45,
  forbiddenWords: [
    // 绝对化
    '100%', '最高', '一番', '保証', '絶対',
    '完璧', '世界一', 'No.1',
    // 夸大
    '奇跡', '魔法', '革命的', '史上最強',
    // 误导
    '無料', '必ず', '確実に', 'リスクなし'
  ],
  ctaKeywords: [
    '今すぐ購入', '詳しく見る', '申し込む', '始める',
    'ダウンロード', '登録する', '試す', 'お問い合わせ',
    '予約する', '購入する', '確認する'
  ],
  urgencyKeywords: [
    '限定', '本日限り', '今だけ', '残りわずか',
    '終了間近', '売り切れ', 'お見逃しなく',
    '最後のチャンス', '先着順', '数量限定'
  ],
  numberPattern: /\d+%?|¥\d+|\d+円|\d+OFF/
}

/**
 * 韩语配置
 */
const koreanConfig: LanguageConfig = {
  code: 'ko',
  name: '한국어',
  charWeightMultiplier: 2,
  maxHeadlineLength: 15,
  maxDescriptionLength: 45,
  forbiddenWords: [
    // 绝对化
    '100%', '최고', '1위', '보장', '절대',
    '완벽', '세계 최고',
    // 夸大
    '기적', '마법', '혁명적',
    // 误导
    '무료', '반드시', '위험 없음'
  ],
  ctaKeywords: [
    '지금 구매', '자세히 보기', '신청하기', '시작하기',
    '다운로드', '가입하기', '문의하기', '예약하기',
    '구매하기', '확인하기'
  ],
  urgencyKeywords: [
    '한정', '오늘만', '지금만', '품절임박',
    '마감임박', '놓치지 마세요', '마지막 기회',
    '선착순', '수량 한정'
  ],
  numberPattern: /\d+%?|₩\d+|\d+원|\d+할인/
}

/**
 * 西班牙语配置
 */
const spanishConfig: LanguageConfig = {
  code: 'es',
  name: 'Español',
  charWeightMultiplier: 1,
  maxHeadlineLength: 30,
  maxDescriptionLength: 90,
  forbiddenWords: [
    '100%', 'mejor del mundo', 'número uno', 'garantizado',
    'perfecto', 'milagro', 'mágico', 'revolucionario',
    'dinero gratis', 'sin riesgo'
  ],
  ctaKeywords: [
    'comprar ahora', 'obtener', 'pedir', 'más información',
    'registrarse', 'probar', 'empezar', 'descubrir',
    'descargar', 'suscribirse', 'contactar'
  ],
  urgencyKeywords: [
    'limitado', 'hoy', 'ahora', 'exclusivo',
    'solo', 'oferta termina', 'última oportunidad',
    'no te lo pierdas', 'actúa ahora'
  ],
  numberPattern: /\d+%?|€\d+|\$\d+/
}

/**
 * 法语配置
 */
const frenchConfig: LanguageConfig = {
  code: 'fr',
  name: 'Français',
  charWeightMultiplier: 1,
  maxHeadlineLength: 30,
  maxDescriptionLength: 90,
  forbiddenWords: [
    '100%', 'meilleur au monde', 'numéro un', 'garanti',
    'parfait', 'miracle', 'magique', 'révolutionnaire',
    'argent gratuit', 'sans risque'
  ],
  ctaKeywords: [
    'acheter maintenant', 'obtenir', 'commander', 'en savoir plus',
    's\'inscrire', 'essayer', 'commencer', 'découvrir',
    'télécharger', 's\'abonner', 'contacter'
  ],
  urgencyKeywords: [
    'limité', 'aujourd\'hui', 'maintenant', 'exclusif',
    'seulement', 'offre se termine', 'dernière chance',
    'ne manquez pas', 'agissez maintenant'
  ],
  numberPattern: /\d+%?|€\d+/
}

/**
 * 德语配置
 */
const germanConfig: LanguageConfig = {
  code: 'de',
  name: 'Deutsch',
  charWeightMultiplier: 1,
  maxHeadlineLength: 30,
  maxDescriptionLength: 90,
  forbiddenWords: [
    '100%', 'beste der Welt', 'Nummer eins', 'garantiert',
    'perfekt', 'Wunder', 'magisch', 'revolutionär',
    'kostenloses Geld', 'risikofrei'
  ],
  ctaKeywords: [
    'jetzt kaufen', 'erhalten', 'bestellen', 'mehr erfahren',
    'registrieren', 'testen', 'starten', 'entdecken',
    'herunterladen', 'abonnieren', 'kontaktieren'
  ],
  urgencyKeywords: [
    'begrenzt', 'heute', 'jetzt', 'exklusiv',
    'nur', 'Angebot endet', 'letzte Chance',
    'nicht verpassen', 'jetzt handeln'
  ],
  numberPattern: /\d+%?|€\d+/
}

/**
 * 意大利语配置
 */
const italianConfig: LanguageConfig = {
  code: 'it',
  name: 'Italiano',
  charWeightMultiplier: 1,
  maxHeadlineLength: 30,
  maxDescriptionLength: 90,
  forbiddenWords: [
    '100%', 'migliore al mondo', 'numero uno', 'garantito',
    'perfetto', 'miracolo', 'magico', 'rivoluzionario',
    'soldi gratis', 'senza rischi', 'sempre', 'mai',
    'eccellente', 'straordinario', 'unico'
  ],
  ctaKeywords: [
    'acquista ora', 'compra ora', 'ottieni', 'ordina', 'scopri di più',
    'registrati', 'prova', 'inizia', 'scopri',
    'scarica', 'iscriviti', 'contatta', 'richiedi'
  ],
  urgencyKeywords: [
    'limitato', 'oggi', 'ora', 'esclusivo',
    'solo', 'offerta termina', 'ultima opportunità',
    'non perdere', 'agisci ora', 'fino a esaurimento'
  ],
  numberPattern: /\d+%?|€\d+/
}

/**
 * 瑞典语配置
 */
const swedishConfig: LanguageConfig = {
  code: 'sv',
  name: 'Svenska',
  charWeightMultiplier: 1,
  maxHeadlineLength: 30,
  maxDescriptionLength: 90,
  forbiddenWords: [
    '100%', 'bäst i världen', 'nummer ett', 'garanterad',
    'perfekt', 'mirakel', 'magisk', 'revolutionerande',
    'gratis pengar', 'ingen risk', 'alltid', 'aldrig'
  ],
  ctaKeywords: [
    'köp nu', 'få', 'beställ', 'läs mer',
    'registrera dig', 'prova', 'börja', 'upptäck',
    'ladda ner', 'prenumerera', 'kontakta', 'begär'
  ],
  urgencyKeywords: [
    'begränsad', 'idag', 'nu', 'exklusiv',
    'endast', 'erbjudandet slutar', 'sista chansen',
    'missa inte', 'agera nu', 'så länge lagret räcker'
  ],
  numberPattern: /\d+%?|kr\d+|\d+kr|€\d+/
}

/**
 * 计算文本的有效字符长度（考虑CJK字符权重）
 */
export function calculateEffectiveLength(
  text: string,
  config: LanguageConfig
): number {
  if (config.charWeightMultiplier === 1) {
    return text.length
  }

  // 检测CJK字符
  const cjkPattern = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g
  const cjkChars = text.match(cjkPattern) || []
  const nonCjkLength = text.length - cjkChars.length

  return nonCjkLength + cjkChars.length * config.charWeightMultiplier
}

/**
 * 检查文本是否包含CTA
 */
export function containsCTA(text: string, config: LanguageConfig): boolean {
  const lowerText = text.toLowerCase()
  return config.ctaKeywords.some(kw => lowerText.includes(kw.toLowerCase()))
}

/**
 * 检查文本是否包含紧迫感表达
 */
export function containsUrgency(text: string, config: LanguageConfig): boolean {
  const lowerText = text.toLowerCase()
  return config.urgencyKeywords.some(kw => lowerText.includes(kw.toLowerCase()))
}

/**
 * 检查文本是否包含数字
 */
export function containsNumber(text: string, config: LanguageConfig): boolean {
  return config.numberPattern.test(text)
}

/**
 * 检查文本是否包含禁用词
 */
export function containsForbiddenWord(
  text: string,
  config: LanguageConfig
): { hasForbidden: boolean; words: string[] } {
  const lowerText = text.toLowerCase()
  const foundWords = config.forbiddenWords.filter(word =>
    lowerText.includes(word.toLowerCase())
  )

  return {
    hasForbidden: foundWords.length > 0,
    words: foundWords
  }
}

/**
 * 验证headline长度是否符合语言标准
 */
export function validateHeadlineLength(
  text: string,
  config: LanguageConfig
): { isValid: boolean; effectiveLength: number; maxLength: number } {
  const effectiveLength = calculateEffectiveLength(text, config)
  return {
    isValid: effectiveLength <= config.maxHeadlineLength,
    effectiveLength,
    maxLength: config.maxHeadlineLength
  }
}

/**
 * 验证description长度是否符合语言标准
 */
export function validateDescriptionLength(
  text: string,
  config: LanguageConfig
): { isValid: boolean; effectiveLength: number; maxLength: number } {
  const effectiveLength = calculateEffectiveLength(text, config)
  return {
    isValid: effectiveLength <= config.maxDescriptionLength,
    effectiveLength,
    maxLength: config.maxDescriptionLength
  }
}
