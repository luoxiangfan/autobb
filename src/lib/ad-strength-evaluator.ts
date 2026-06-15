/**
 * Ad Strength评估器 - 本地评估算法
 *
 * 基于Google Ads Ad Strength标准的7维度评分系统（优化版）：
 * 1. Diversity (18%) - 资产多样性
 * 2. Relevance (22%) - 关键词相关性
 * 3. Brand Search Volume (18%) - 品牌搜索量
 * 4. Completeness (10%) - 资产完整性
 * 5. Quality (14%) - 内容质量
 * 6. Compliance (8%) - 政策合规性
 * 7. Competitive Positioning (10%) - 竞争定位 [NEW]
 *
 * 输出：0-100分 + POOR/AVERAGE/GOOD/EXCELLENT评级
 */

import type { HeadlineAsset, DescriptionAsset } from './ad-creative'
import {
  getKeywordSearchVolumesForPlannerContext,
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { normalizeLanguageCode } from './language-country-codes'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { loadPrompt, interpolateTemplate } from './prompt-loader'
import {
  CP_AI_FEATURE_FLAG,
  AD_STRENGTH_DIMENSION_CONFIG,
  AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG,
  mapRawScoreToTarget,
  validateAdStrengthConfig,
} from './ad-strength-config'
import type { CanonicalCreativeType } from './creative-type'
import {
  buildUntrustedInputGuardrail,
  sanitizePromptBlockValue,
  sanitizePromptInlineValue,
  type InputReview,
} from './llm-input-guard'

const adStrengthConfigValidation = validateAdStrengthConfig()
if (!adStrengthConfigValidation.valid) {
  console.warn(
    `[AdStrength] invalid config detected: ${adStrengthConfigValidation.errors.join('; ')}`
  )
}

export type { AdStrengthRating, AdStrengthEvaluation } from './ad-strength/types'
import type { AdStrengthEvaluation } from './ad-strength/types'

import {
  parseCompetitivePositioningAiScores,
  type CompetitivePositioningAIScores,
} from './ad-strength/competitive-positioning-ai-parse'

export { parseCompetitivePositioningAiScores } from './ad-strength/competitive-positioning-ai-parse'

function isCompetitivePositioningAiEnabled(): boolean {
  return String(process.env[CP_AI_FEATURE_FLAG] || '').toLowerCase() === 'true'
}

import { calculateDiversity } from './ad-strength/dimensions/diversity'
import { calculateRelevance } from './ad-strength/dimensions/relevance'
import { calculateCompleteness } from './ad-strength/dimensions/completeness'
import { calculateQuality } from './ad-strength/dimensions/quality'
import { calculateCompliance } from './ad-strength/dimensions/compliance'
import { calculateCopyIntentMetrics } from './ad-strength/copy-intent-metrics'
import { generateSuggestions, scoreToRating } from './ad-strength/rating-suggestions'

/**
 * 主评估函数
 */
export async function evaluateAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  options?: {
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    userId?: number
    offerId?: number
    sitelinks?: Array<{ text: string; url: string; description?: string }>
    callouts?: string[]
    // [NEW] 关键词搜索量数据（用于品牌关键词搜索量评分）
    keywordsWithVolume?: Array<{
      keyword: string
      searchVolume: number
      volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY'
    }>
    // [NEW] 产品类别（用于品牌-内容一致性检查）
    category?: string
    // [NEW] 创意类型（A/B/D，兼容C/S映射）
    bucketType?: 'A' | 'B' | 'C' | 'D' | 'S'
    // [NEW] 规范化创意类型（用于copy intent对齐）
    creativeType?: CanonicalCreativeType
    /** 快速/均衡生成模式：跳过竞争定位 AI 增强 */
    skipCompetitivePositioningAi?: boolean
    /** 创意生成前已 prepare 时传入，避免品牌搜索量查询重复 load */
    plannerSession?: KeywordPlannerPreparedSession
    /** 批量预加载已尝试过 expand 且失败时传入，避免每个创意重复 loadKeywordPoolExpandCredentialsForOffer */
    skipKeywordPoolExpandLoad?: boolean
  }
): Promise<AdStrengthEvaluation> {
  // 1. Diversity维度 (18%)
  const diversityRaw = calculateDiversity(headlines, descriptions)
  const diversityConfig = AD_STRENGTH_DIMENSION_CONFIG.diversity
  const diversity = {
    score: mapRawScoreToTarget(
      diversityRaw.score,
      diversityConfig.rawMax,
      diversityConfig.targetMax
    ),
    weight: diversityConfig.weight,
    details: diversityRaw.details,
  }

  // 2. Relevance维度 (22%)
  const relevanceRaw = calculateRelevance(
    headlines,
    descriptions,
    keywords,
    options?.sitelinks,
    options?.callouts,
    options?.brandName,
    options?.category
  )
  const relevanceConfig = AD_STRENGTH_DIMENSION_CONFIG.relevance
  const relevance = {
    score: mapRawScoreToTarget(
      relevanceRaw.score,
      relevanceConfig.rawMax,
      relevanceConfig.targetMax
    ),
    weight: relevanceConfig.weight,
    details: relevanceRaw.details,
  }

  // 3. Completeness维度 (10%)
  const completenessRaw = calculateCompleteness(headlines, descriptions)
  const completenessConfig = AD_STRENGTH_DIMENSION_CONFIG.completeness
  const completeness = {
    score: mapRawScoreToTarget(
      completenessRaw.score,
      completenessConfig.rawMax,
      completenessConfig.targetMax
    ),
    weight: completenessConfig.weight,
    details: completenessRaw.details,
  }

  // 4. Quality维度 (14%)
  const qualityRaw = calculateQuality(
    headlines,
    descriptions,
    options?.brandName,
    undefined,
    options?.targetLanguage
  )
  const qualityConfig = AD_STRENGTH_DIMENSION_CONFIG.quality
  const quality = {
    score: mapRawScoreToTarget(qualityRaw.score, qualityConfig.rawMax, qualityConfig.targetMax),
    weight: qualityConfig.weight,
    details: qualityRaw.details,
  }

  // 5. Compliance维度 (8%)
  const complianceRaw = calculateCompliance(headlines, descriptions)
  const complianceConfig = AD_STRENGTH_DIMENSION_CONFIG.compliance
  const compliance = {
    score: mapRawScoreToTarget(
      complianceRaw.score,
      complianceConfig.rawMax,
      complianceConfig.targetMax
    ),
    weight: complianceConfig.weight,
    details: complianceRaw.details,
  }

  // 6. Brand Search Volume维度 (18%) - [NEW] 融入品牌关键词搜索量
  const brandSearchVolumeRaw = await calculateBrandSearchVolume(
    options?.brandName,
    options?.targetCountry || 'US',
    options?.targetLanguage || 'en',
    options?.userId,
    options?.keywordsWithVolume,
    options?.offerId,
    options?.plannerSession,
    options?.skipKeywordPoolExpandLoad
  )
  const brandSearchVolumeConfig = AD_STRENGTH_DIMENSION_CONFIG.brandSearchVolume
  const brandSearchVolume = {
    score: mapRawScoreToTarget(
      brandSearchVolumeRaw.score,
      brandSearchVolumeConfig.rawMax,
      brandSearchVolumeConfig.targetMax
    ),
    weight: brandSearchVolumeConfig.weight,
    details: brandSearchVolumeRaw.details,
  }

  // 7. Competitive Positioning维度 (10%) - 新增
  const competitivePositioningRaw = await calculateCompetitivePositioning(
    headlines,
    descriptions,
    options?.userId,
    { skipAiEnhancement: options?.skipCompetitivePositioningAi === true }
  )
  const competitivePositioningConfig = AD_STRENGTH_DIMENSION_CONFIG.competitivePositioning
  const competitivePositioning = {
    ...competitivePositioningRaw,
    score: mapRawScoreToTarget(
      competitivePositioningRaw.score,
      competitivePositioningConfig.rawMax,
      competitivePositioningConfig.targetMax
    ),
    weight: competitivePositioningConfig.weight,
  }

  // 计算总分（100分制）
  const overallScore =
    diversity.score +
    relevance.score +
    completeness.score +
    quality.score +
    compliance.score +
    brandSearchVolume.score +
    competitivePositioning.score

  // 确定评级
  const rating = scoreToRating(overallScore)

  // 非阻断文案意图评估
  const copyIntentMetrics = calculateCopyIntentMetrics(
    headlines,
    descriptions,
    options?.bucketType,
    options?.targetLanguage,
    keywords,
    options?.creativeType
  )

  // 生成改进建议
  const suggestions = generateSuggestions(
    diversity,
    relevance,
    completeness,
    quality,
    compliance,
    brandSearchVolume,
    competitivePositioning,
    rating,
    copyIntentMetrics
  )

  return {
    overallScore: Math.round(overallScore),
    rating,
    dimensions: {
      diversity,
      relevance,
      completeness,
      quality,
      compliance,
      brandSearchVolume,
      competitivePositioning,
    },
    copyIntentMetrics,
    suggestions,
  }
}

/**
 * 1. 计算Diversity（多样性）- 20分
 */
async function calculateCompetitivePositioning(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  userId?: number,
  options?: { skipAiEnhancement?: boolean }
): Promise<{
  score: number
  weight: 0.1
  details: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
  }
}> {
  const allTexts = [...headlines.map((h) => h.text), ...descriptions.map((d) => d.text)].join(' ')
  const allTextsLower = allTexts.toLowerCase()

  let priceAdvantage = 0
  let uniqueMarketPosition = 0
  let competitiveComparison = 0
  let valueEmphasis = 0

  console.log('🎯 评估竞争定位维度 (混合方案 - 全语言支持):')

  // ========================================
  // 第一层：快速通用检测（支持所有语言）
  // ========================================

  // 1. 价格优势量化检测 (0-3分)
  // 通用货币符号 + 数字模式（支持全球所有货币）
  const universalCurrencyPattern =
    /(?:€|£|\$|¥|₹|₽|฿|₪|₩|元|円|圓|บาท|रु|руб)\s*\d+|\d+\s*(?:€|£|\$|¥|₹|₽|฿|₪|₩|元|円|圓|บาท|रु|руб)/

  // 常见"节省"关键词（20+语言）
  const savingsKeywords =
    /(?:save|risparmia|ahorra|économise?|sparen|economize|bespaar|сэкономить|節約|절약|ประหยัด|توفير|חסוך|tasarruf|spara|gem|חיסכון|tiết kiệm|menjimat|save|discount|sconto|descuento|réduction|rabatt|desconto|korting|скидка|割引|할인|ส่วนลด|خصم|הנחה|indirim|rabat|छूट|giảm giá|diskaun)/i

  // 百分比折扣模式（如 "Save 20%", "20% off", "20% discount"）
  const percentagePattern =
    /(?:save|discount|off|减|折扣|割引|할인|ส่วนลด|خصم|הנחה|indirim|छूट|giảm|diskaun)?\s*(\d{1,2})%/i

  // "No fees" / "Zero cost" 模式（明确的零成本承诺）
  const noFeesPattern =
    /(?:no|zero|without|免|無|なし|없음|ไม่มี|بدون|ללא|yok|बिना|không|tanpa)\s+(?:monthly\s+)?(?:fees?|cost|charge|price|subscription|月费|费用|料金|수수료|ค่าธรรมเนียม|رسوم|עמלה|ücret|शुल्क|phí|bayaran)/i

  // "Free" 相关模式（免费福利）
  const freePattern =
    /\bfree\s+(?:shipping|delivery|trial|returns?|installation|warranty|support|训练|运费|配送|试用|退货|安装|保修|サポート|無料|무료|ฟรี|مجاني|חינם|ücretsiz|मुफ़्त|miễn phí|percuma)\b/i

  // 优先检测高价值量化模式
  const hasQuantifiedSavings =
    universalCurrencyPattern.test(allTexts) && savingsKeywords.test(allTextsLower)
  const hasPercentageDiscount = percentagePattern.test(allTexts)
  const hasNoFees = noFeesPattern.test(allTextsLower)
  const hasFreeOffer = freePattern.test(allTextsLower)

  if (hasQuantifiedSavings || hasPercentageDiscount || hasNoFees) {
    priceAdvantage = 3
    if (hasQuantifiedSavings) console.log('   ✅ 价格优势量化（货币+节省） (+3分)')
    if (hasPercentageDiscount) console.log('   ✅ 价格优势量化（百分比折扣） (+3分)')
    if (hasNoFees) console.log('   ✅ 价格优势量化（零费用承诺） (+3分)')
  } else if (hasFreeOffer) {
    priceAdvantage = 2.5
    console.log('   ✅ 免费福利（Free offer） (+2.5分)')
  } else if (
    savingsKeywords.test(allTextsLower) ||
    /best value|affordable|budget|cheap|economic|便宜|实惠|划算|お得|저렴|ราคาถูก|رخيص|זול|ucuz|billig|goedkoop|дешевый|barato|bon marché|economico|सस्ता|rẻ|murah/i.test(
      allTextsLower
    )
  ) {
    priceAdvantage = 1.5
    console.log('   ⚠️ 价格优势非量化（通用检测） (+1.5分)')
  } else {
    console.log('   ❌ 无价格优势表达 (+0分)')
  }

  // 2. 独特市场定位检测 (0-3分)
  // 常见"唯一/独特"关键词（20+语言）
  const uniquenessKeywords =
    /(?:only|unique|exclusive|first|sole|unico|unica|único|única|einzig|exclusivo|exclusiva|seul|seule|единственный|唯一|独家|専用|のみ|유일|독점|เท่านั้น|พิเศษ|الوحيد|حصري|יחיד|בלעדי|sadece|एकमात्र|विशेष|duy nhất|độc quyền|eksklusif|tunggal|exclusief|eneste|unik|ainoa|μόνο|μοναδικό|jedyny|wyłączny)/i

  // 常见"第一/领先"关键词
  const leadershipKeywords =
    /#1|numero\s*1|number\s*one|第一|ナンバーワン|넘버원|อันดับ\s*1|رقم\s*1|מספר\s*1|1\s*numaralı|नंबर\s*1|số\s*1|nombor\s*1|primeiro|primero|erste|premier|première|первый|πρώτο|pierwszy/i

  // "Official" 官方店铺/授权经销商
  const officialPattern =
    /\bofficial\s+(?:store|shop|seller|dealer|partner|retailer|support|service|warranty)|(?:support|service)\s+official|ufficiale\s+(?:supporto|assistenza|servizio)|supporto\s+ufficiale|authorized\s+(?:dealer|seller|retailer|support|service)|官方|正規店|공식|อย่างเป็นทางการ|رسمي|רשמי|resmi|официальный|chính thức|rasmi\b/i

  // 技术规格/等级标识（如 IK10, IP67, 4K, Ultra HD）
  const technicalSpecPattern =
    /\b(?:IK\d{1,2}|IP\d{2}|4K|8K|[UQ]HD|Ultra\s+HD|Full\s+HD|[0-9]+MP|[0-9]+K|HDR10|Dolby|DTS|WiFi\s*[56]|5G|LTE|A\+\+|Grade\s+A|CE|FCC|UL|ISO\s*\d+|NSF\/?ANSI|ANSI\s*\d+|ASHRAE|Energy\s*Star|[0-9]{2,5}\s*BTU|[0-9]{2,5}\s*GPD|[0-9]{2,3}\s*dB)/i

  const hasUniqueness = uniquenessKeywords.test(allTexts) || leadershipKeywords.test(allTexts)
  const hasOfficialStatus = officialPattern.test(allTexts)
  const hasTechnicalDifferentiation = technicalSpecPattern.test(allTexts)

  if (hasUniqueness || hasOfficialStatus) {
    uniqueMarketPosition = 3
    if (hasUniqueness) console.log('   ✅ 独特市场定位（唯一性声明） (+3分)')
    if (hasOfficialStatus) console.log('   ✅ 独特市场定位（官方/授权） (+3分)')
  } else if (hasTechnicalDifferentiation) {
    uniqueMarketPosition = 2.5
    console.log('   ✅ 独特市场定位（技术规格） (+2.5分)')
  } else if (
    /top|best|leading|premier|superior|migliore|mejor|meilleur|beste|лучший|最好|最高|ベスト|최고|ดีที่สุด|الأفضل|הטוב|en iyi|सर्वश्रेष्ठ|tốt nhất|terbaik|beste|paras|bästa|καλύτερο|najlepszy/i.test(
      allTextsLower
    )
  ) {
    uniqueMarketPosition = 1.5
    console.log('   ⚠️ 隐含独特性（通用检测） (+1.5分)')
  } else {
    console.log('   ❌ 无独特定位声明 (+0分)')
  }

  // 3. 竞品对比暗示检测 (0-2分)
  // 常见"对比/替换"关键词（20+语言）
  const comparisonKeywords =
    /(?:vs|versus|compared?|comparison|replace|substitute|switch|sostituisci|rimpiazza|reemplazar|sustituir|remplacer|substituer|ersetzen|austauschen|substituir|trocar|vervangen|замени|比較|比较|取代|代替|比べる|交換|비교|교체|เปรียบเทียบ|แทนที่|مقارنة|استبدال|השווה|החלף|karşılaştır|değiştir|तुलना|बदलें|so sánh|thay thế|bandingkan|ganti|vergelijken|sammenlign|bytt|vertaa|vaihda|jämför|byt|σύγκριση|αντικατάσταση|porównaj|wymień)/i

  const hasComparison = comparisonKeywords.test(allTextsLower)

  if (hasComparison) {
    competitiveComparison = 2
    console.log('   ✅ 明确竞品对比（通用检测） (+2分)')
  } else if (
    /better|superior|outperform|migliore|mejor|meilleur|besser|melhor|beter|лучше|更好|优于|より良い|더 좋은|ดีกว่า|أفضل من|טוב יותר|daha iyi|बेहतर|tốt hơn|lebih baik|bedre|parempi|bättre|καλύτερο|lepszy/i.test(
      allTextsLower
    )
  ) {
    competitiveComparison = 1
    console.log('   ⚠️ 隐含对比（通用检测） (+1分)')
  } else {
    console.log('   ❌ 无竞品对比暗示 (+0分)')
  }

  // 4. 性价比强调检测 (0-2分)
  // 常见"性价比/价值"关键词（20+语言）
  const valueKeywords =
    /(?:value\s+for\s+money|worth|bang\s+for|rapporto\s+qualità|qualità.prezzo|relación\s+calidad|calidad.precio|rapport\s+qualité|qualité.prix|preis.leistung|custo.benefício|prijs.kwaliteit|соотношение|价值|性价比|コスパ|가성비|คุ้มค่า|قيمة مقابل|ערך תמורה|fiyat performans|मूल्य के लिए|giá trị|nilai untuk wang|waarde voor|verdi for|arvo|värde för|αξία για|stosunek)/i

  const hasValue = valueKeywords.test(allTextsLower)

  if (hasValue) {
    valueEmphasis = 2
    console.log('   ✅ 性价比强调 (+2分)')
  } else if (
    /great\s+deal|special\s+offer|offerta\s+speciale|ottim[ao]\s+prezzo/i.test(allTextsLower)
  ) {
    valueEmphasis = 1
    console.log('   ⚠️ 隐含性价比 (+1分)')
  } else {
    console.log('   ❌ 无性价比强调 (+0分)')
  }

  const totalScore = priceAdvantage + uniqueMarketPosition + competitiveComparison + valueEmphasis
  console.log(`   🎯 竞争定位总分（第一层）: ${totalScore.toFixed(1)}/10`)

  // ========================================
  // 第二层：AI增强分析（按需触发）
  // ========================================
  // 触发条件：快速检测分数 > 6分（说明有较强的竞争定位元素，值得深度分析）
  const AI_ENHANCEMENT_THRESHOLD = AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG.aiEnhancementThreshold
  const aiEnhancementEnabled =
    isCompetitivePositioningAiEnabled() && options?.skipAiEnhancement !== true

  if (aiEnhancementEnabled && totalScore > AI_ENHANCEMENT_THRESHOLD) {
    console.log(
      `   🤖 触发AI增强分析（分数${totalScore.toFixed(1)} > ${AI_ENHANCEMENT_THRESHOLD}）`
    )

    const aiEnhancedScore = await enhanceCompetitivePositioningWithAI(
      allTexts,
      {
        priceAdvantage,
        uniqueMarketPosition,
        competitiveComparison,
        valueEmphasis,
      },
      userId
    )

    if (aiEnhancedScore) {
      console.log(`   ✨ AI增强后总分: ${aiEnhancedScore.score.toFixed(1)}/10`)
      return aiEnhancedScore
    }
  } else if (!aiEnhancementEnabled && totalScore > AI_ENHANCEMENT_THRESHOLD) {
    console.log(`   ℹ️ 已跳过AI增强（${CP_AI_FEATURE_FLAG}=false）`)
  }

  return {
    score: Math.min(10, Math.max(0, totalScore)),
    weight: 0.1 as const,
    details: {
      priceAdvantage: Math.round(priceAdvantage * 10) / 10,
      uniqueMarketPosition: Math.round(uniqueMarketPosition * 10) / 10,
      competitiveComparison: Math.round(competitiveComparison * 10) / 10,
      valueEmphasis: Math.round(valueEmphasis * 10) / 10,
    },
  }
}

// ========================================
// 缓存机制（Redis优先，内存降级）
// ========================================
interface CachedResult {
  score: number
  weight: 0.1
  details: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
    aiConfidence: number
  }
  timestamp: number
}

// 内存缓存（Redis不可用时的降级方案）
const memoryCache = new Map<string, CachedResult>()
const CACHE_TTL_SECONDS = 60 * 60 * 24 // 24小时（Redis用秒）
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000 // 24小时（内存用毫秒）
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'autoads:'

// Redis可用性状态（避免频繁检查）
let redisAvailable: boolean | null = null
let lastRedisCheck = 0
const REDIS_CHECK_INTERVAL = 60 * 1000 // 60秒检查一次

/**
 * 检查Redis是否可用
 */
async function isRedisAvailable(): Promise<boolean> {
  const now = Date.now()

  // 如果60秒内检查过，直接返回缓存结果
  if (redisAvailable !== null && now - lastRedisCheck < REDIS_CHECK_INTERVAL) {
    return redisAvailable
  }

  try {
    const { getRedisClient } = await import('./redis')
    const client = getRedisClient()
    if (!client) {
      redisAvailable = false
      lastRedisCheck = now
      return false
    }
    await client.ping()
    redisAvailable = true
    lastRedisCheck = now
    return true
  } catch (_error) {
    redisAvailable = false
    lastRedisCheck = now
    return false
  }
}

/**
 * 生成缓存key
 */
function generateCacheKey(text: string): string {
  // 使用简单的哈希函数生成缓存key
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${REDIS_KEY_PREFIX}cp:${Math.abs(hash).toString(36)}`
}

/**
 * 从缓存获取结果（Redis优先，内存降级）
 */
async function getCachedResult(adCopyText: string): Promise<CachedResult | null> {
  const key = generateCacheKey(adCopyText)

  // 尝试从Redis获取
  if (await isRedisAvailable()) {
    try {
      const { getRedisClient } = await import('./redis')
      const client = getRedisClient()
      if (!client) return null
      const data = await client.get(key)

      if (data) {
        console.log('   📦 Redis缓存命中')
        return JSON.parse(data)
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Redis读取失败: ${error.message}，尝试内存缓存`)
    }
  }

  // 降级到内存缓存
  const cached = memoryCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('   📦 内存缓存命中')
    return cached
  }

  // 过期则删除
  if (cached) {
    memoryCache.delete(key)
  }

  return null
}

/**
 * 保存结果到缓存（Redis优先，内存降级）
 */
async function setCachedResult(adCopyText: string, result: CachedResult) {
  const key = generateCacheKey(adCopyText)
  const resultWithTimestamp = { ...result, timestamp: Date.now() }

  // 尝试保存到Redis
  if (await isRedisAvailable()) {
    try {
      const { getRedisClient } = await import('./redis')
      const client = getRedisClient()
      if (!client) return
      await client.setex(key, CACHE_TTL_SECONDS, JSON.stringify(resultWithTimestamp))
      console.log('   💾 已缓存到Redis（TTL: 24小时）')
      return
    } catch (error: any) {
      console.warn(`   ⚠️ Redis写入失败: ${error.message}，降级到内存缓存`)
    }
  }

  // 降级到内存缓存
  memoryCache.set(key, resultWithTimestamp)

  // 内存缓存清理：超过1000条时删除最旧的500条
  if (memoryCache.size > 1000) {
    const entries = Array.from(memoryCache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    entries.slice(0, 500).forEach(([k]) => memoryCache.delete(k))
    console.log('   🗑️ 内存缓存清理：删除500条旧记录')
  }

  console.log('   💾 已缓存到内存（TTL: 24小时）')
}

/**
 * 🤖 AI增强的竞争定位分析（第二层）
 *
 * 使用Gemini进行深度语义分析，支持所有语言
 * 仅在第一层检测分数 > 6分时触发
 */
async function enhanceCompetitivePositioningWithAI(
  adCopyText: string,
  fastDetectionScores: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
  },
  userId?: number
): Promise<{
  score: number
  weight: 0.1
  details: {
    priceAdvantage: number
    uniqueMarketPosition: number
    competitiveComparison: number
    valueEmphasis: number
    aiConfidence: number
  }
} | null> {
  try {
    // 如果没有userId，无法调用AI，直接返回null
    if (!userId) {
      console.log('   ⚠️ 无用户ID，跳过AI增强分析')
      return null
    }

    // 检查是否有缓存
    const cached = await getCachedResult(adCopyText)
    if (cached) {
      console.log('   📦 使用缓存结果（AI增强）')
      return {
        score: cached.score,
        weight: cached.weight,
        details: cached.details,
      }
    }

    const { generateContent } = await import('./gemini')
    const promptTemplate = await loadPrompt('competitive_positioning_analysis')
    const reviewedInputs: InputReview[] = []
    const promptVariables = {
      adCopyText: sanitizePromptBlockValue(
        reviewedInputs,
        'competitive_positioning_ad_copy',
        adCopyText,
        3000,
        'No ad copy provided.'
      ),
      priceAdvantageScore: sanitizePromptInlineValue(
        reviewedInputs,
        'competitive_positioning_price_advantage',
        `${fastDetectionScores.priceAdvantage}/3`,
        20,
        '0/3'
      ),
      uniqueMarketPositionScore: sanitizePromptInlineValue(
        reviewedInputs,
        'competitive_positioning_unique_market_position',
        `${fastDetectionScores.uniqueMarketPosition}/3`,
        20,
        '0/3'
      ),
      competitiveComparisonScore: sanitizePromptInlineValue(
        reviewedInputs,
        'competitive_positioning_comparison',
        `${fastDetectionScores.competitiveComparison}/2`,
        20,
        '0/2'
      ),
      valueEmphasisScore: sanitizePromptInlineValue(
        reviewedInputs,
        'competitive_positioning_value_emphasis',
        `${fastDetectionScores.valueEmphasis}/2`,
        20,
        '0/2'
      ),
    }
    const prompt = interpolateTemplate(promptTemplate, {
      inputGuardrail: buildUntrustedInputGuardrail(reviewedInputs),
      ...promptVariables,
    })

    // 智能模型选择：广告强度评估使用Flash模型（简单评分任务）
    // 🔧 修复：添加try-catch和降级策略
    let result
    try {
      result = await generateContent(
        {
          operationType: 'ad_strength_evaluation',
          prompt,
          temperature: 0.3, // 低温度确保一致性
          maxOutputTokens: 4096, // 🔧 增加token限制，避免Gemini 2.5 Pro thinking模式导致MAX_TOKENS错误（thinking tokens ~2000 + response ~500）
          responseSchema: {
            type: 'OBJECT',
            properties: {
              priceAdvantage: { type: 'NUMBER', description: 'Score 0-3' },
              uniqueMarketPosition: { type: 'NUMBER', description: 'Score 0-3' },
              competitiveComparison: { type: 'NUMBER', description: 'Score 0-2' },
              valueEmphasis: { type: 'NUMBER', description: 'Score 0-2' },
              confidence: { type: 'NUMBER', description: 'Confidence 0.0-1.0' },
            },
            required: [
              'priceAdvantage',
              'uniqueMarketPosition',
              'competitiveComparison',
              'valueEmphasis',
              'confidence',
            ],
          },
          responseMimeType: 'application/json',
        },
        userId
      )
    } catch (schemaError: any) {
      // 如果schema模式失败，降级到纯文本模式
      console.warn(`   ⚠️ JSON schema模式失败: ${schemaError.message}`)
      console.log(`   🔄 降级到纯文本模式重试...`)

      // 修改prompt，要求返回JSON格式但不使用schema约束
      const fallbackPrompt =
        prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no extra text.'

      result = await generateContent(
        {
          operationType: 'ad_strength_evaluation',
          prompt: fallbackPrompt,
          temperature: 0.3,
          maxOutputTokens: 4096, // 🔧 增加token限制，避免Gemini 2.5 Pro thinking模式导致MAX_TOKENS错误（thinking tokens ~2000 + response ~500）
        },
        userId
      )

      console.log(`   ✓ 降级模式成功获取响应`)
    }

    // 记录token使用
    if (result.usage) {
      const cost = estimateTokenCost(
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: result.model,
        operationType: 'competitive_positioning_analysis',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        cost,
        apiType: result.apiType,
      })
    }

    // 🔧 健壮的JSON解析
    let aiScores: CompetitivePositioningAIScores
    try {
      aiScores = parseCompetitivePositioningAiScores(result.text)

      // 验证必需字段
      const requiredFields = [
        'priceAdvantage',
        'uniqueMarketPosition',
        'competitiveComparison',
        'valueEmphasis',
        'confidence',
      ]
      const missingFields = requiredFields.filter((field) => !(field in aiScores))

      if (missingFields.length > 0) {
        throw new Error(`AI响应缺少必需字段: ${missingFields.join(', ')}`)
      }
    } catch (parseError: any) {
      console.error(`   ❌ JSON解析失败: ${parseError.message}`)
      console.error(`   原始响应: ${result.text}`)
      throw new Error(`AI响应格式错误: ${parseError.message}`)
    }

    console.log(`   🤖 AI分析结果 (置信度: ${(aiScores.confidence * 100).toFixed(0)}%):`)
    console.log(
      `      价格优势: ${fastDetectionScores.priceAdvantage} → ${aiScores.priceAdvantage}`
    )
    console.log(
      `      独特定位: ${fastDetectionScores.uniqueMarketPosition} → ${aiScores.uniqueMarketPosition}`
    )
    console.log(
      `      竞品对比: ${fastDetectionScores.competitiveComparison} → ${aiScores.competitiveComparison}`
    )
    console.log(`      性价比: ${fastDetectionScores.valueEmphasis} → ${aiScores.valueEmphasis}`)

    // 只有当置信度 >= 0.6 时才使用AI增强结果
    if (aiScores.confidence < 0.6) {
      console.log(
        `   ⚠️ AI置信度过低 (${(aiScores.confidence * 100).toFixed(0)}%)，使用快速检测结果`
      )
      return null
    }

    const totalScore =
      aiScores.priceAdvantage +
      aiScores.uniqueMarketPosition +
      aiScores.competitiveComparison +
      aiScores.valueEmphasis

    const enhancedResult = {
      score: Math.min(10, Math.max(0, totalScore)),
      weight: 0.1 as const,
      details: {
        priceAdvantage: Math.round(aiScores.priceAdvantage * 10) / 10,
        uniqueMarketPosition: Math.round(aiScores.uniqueMarketPosition * 10) / 10,
        competitiveComparison: Math.round(aiScores.competitiveComparison * 10) / 10,
        valueEmphasis: Math.round(aiScores.valueEmphasis * 10) / 10,
        aiConfidence: Math.round(aiScores.confidence * 100) / 100,
      },
    }

    // 缓存结果（24小时）
    setCachedResult(adCopyText, { ...enhancedResult, timestamp: Date.now() })
    console.log(`   💾 结果已缓存（TTL: 24小时）`)

    return enhancedResult
  } catch (error: any) {
    console.error(`   ❌ AI增强分析失败: ${error.message}`)
    console.error(`   → 降级使用快速检测结果`)
    return null // 失败时返回null，使用快速检测结果
  }
}

/**
 * 6. 计算Brand Search Volume（品牌搜索量）- 18分
 * [NEW] 融入品牌关键词搜索量：品牌名搜索量 + 包含品牌名的关键词搜索量总和
 */
async function calculateBrandSearchVolume(
  brandName: string | undefined,
  targetCountry: string,
  targetLanguage: string,
  userId?: number,
  keywordsWithVolume?: Array<{
    keyword: string
    searchVolume: number
    volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY'
  }>,
  offerId?: number,
  plannerSession?: KeywordPlannerPreparedSession,
  skipKeywordPoolExpandLoad?: boolean
) {
  const isSearchVolumeUnavailableReason = (
    reason: unknown
  ): reason is 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY' =>
    reason === 'DEV_TOKEN_INSUFFICIENT_ACCESS' || reason === 'DEV_TOKEN_TEST_ONLY'

  const calculateUnavailableProxyScore = (
    totalKeywords: number,
    brandKeywordsCount: number,
    hasExactBrandKeyword: boolean
  ): number => {
    if (totalKeywords <= 0) return 3
    if (brandKeywordsCount <= 0) return 2

    const coverage = brandKeywordsCount / Math.max(1, totalKeywords)
    let score = 3
    if (brandKeywordsCount >= 1) score += 2
    if (brandKeywordsCount >= 3) score += 2
    if (brandKeywordsCount >= 5) score += 1
    if (hasExactBrandKeyword) score += 2
    if (coverage >= 0.8) score += 2
    else if (coverage >= 0.5) score += 1
    return Math.min(12, Math.max(2, score))
  }

  // 如果没有品牌名称，返回0分
  if (!brandName || brandName.trim() === '') {
    console.log('⚠️ 未提供品牌名称，品牌搜索量得分为0')
    return {
      score: 0,
      weight: 0.2 as const,
      details: {
        brandNameSearchVolume: 0,
        brandKeywordSearchVolume: 0,
        totalBrandSearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const,
      },
    }
  }

  try {
    const normalizedBrandName = brandName.trim().toLowerCase()
    const normalizedKeywordsWithVolume = Array.isArray(keywordsWithVolume) ? keywordsWithVolume : []
    const brandKeywords = normalizedKeywordsWithVolume.filter((kw) => {
      const keywordLower = String(kw.keyword || '').toLowerCase()
      return keywordLower.includes(normalizedBrandName) && keywordLower !== normalizedBrandName
    })
    const brandKeywordsCount = brandKeywords.length
    const brandKeywordSearchVolume = brandKeywords.reduce(
      (sum, kw) => sum + (kw.searchVolume || 0),
      0
    )
    const exactBrandKeywordSearchVolume = normalizedKeywordsWithVolume
      .filter((kw) => String(kw.keyword || '').toLowerCase() === normalizedBrandName)
      .reduce((sum, kw) => sum + (kw.searchVolume || 0), 0)
    const hasExactBrandKeyword = normalizedKeywordsWithVolume.some(
      (kw) => String(kw.keyword || '').toLowerCase() === normalizedBrandName
    )
    const keywordCoverage =
      normalizedKeywordsWithVolume.length > 0
        ? brandKeywordsCount / normalizedKeywordsWithVolume.length
        : 0
    const keywordVolumeUnavailable = normalizedKeywordsWithVolume.some((kw) =>
      isSearchVolumeUnavailableReason(kw.volumeUnavailableReason)
    )

    // ========================================
    // 1. 计算品牌名搜索量（brandNameSearchVolume）
    // ========================================
    const normalizedLanguage = normalizeLanguageCode(targetLanguage)

    const exactBrandKeywordEntry = normalizedKeywordsWithVolume.find(
      (kw) => String(kw.keyword || '').toLowerCase() === normalizedBrandName
    )
    const exactBrandVolumeMarkedUnavailable =
      exactBrandKeywordEntry != null &&
      isSearchVolumeUnavailableReason(exactBrandKeywordEntry.volumeUnavailableReason)
    const canReuseExactBrandVolume = hasExactBrandKeyword && !exactBrandVolumeMarkedUnavailable

    let resolvedPlannerSession = plannerSession
    let plannerUnavailableReason:
      | 'DEV_TOKEN_INSUFFICIENT_ACCESS'
      | 'DEV_TOKEN_TEST_ONLY'
      | undefined
    let hasPlannerData = false
    let dataSource: 'keyword_planner' | 'cached' | 'database' | 'unavailable' = 'unavailable'
    let resolvedBrandNameSearchVolume = 0
    let fallbackMode: 'none' | 'exact_brand_keyword_backfill' = 'none'

    if (canReuseExactBrandVolume) {
      resolvedBrandNameSearchVolume = exactBrandKeywordSearchVolume
      hasPlannerData = true
      dataSource = 'database'
      console.log(
        `♻️ 使用创意内精确品牌词搜索量，跳过品牌名 Planner 查询: ${exactBrandKeywordSearchVolume.toLocaleString()}/月`
      )
    } else {
      if (!resolvedPlannerSession && userId && offerId && !skipKeywordPoolExpandLoad) {
        const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offerId)
        if (expandLoad.ok) {
          resolvedPlannerSession = expandLoad.plannerSession
        }
      }

      if (skipKeywordPoolExpandLoad) {
        hasPlannerData = false
        resolvedBrandNameSearchVolume = 0
        dataSource = 'unavailable'
        if (!plannerUnavailableReason) {
          const unavailableFromKeywords = normalizedKeywordsWithVolume.find((kw) =>
            isSearchVolumeUnavailableReason(kw.volumeUnavailableReason)
          )?.volumeUnavailableReason
          plannerUnavailableReason = isSearchVolumeUnavailableReason(unavailableFromKeywords)
            ? unavailableFromKeywords
            : 'DEV_TOKEN_INSUFFICIENT_ACCESS'
        }
        console.log('♻️ expand 预加载已失败，跳过品牌名 Planner 查询')
      } else if (userId) {
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: [brandName],
          country: targetCountry,
          language: normalizedLanguage,
          plannerSession: resolvedPlannerSession,
        })
        const volumeResults = volumeResult.ok
          ? volumeResult.volumes
          : [
              {
                avgMonthlySearches: 0,
                volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS' as const,
              },
            ]

        const brandVolume = volumeResults[0]
        plannerUnavailableReason = isSearchVolumeUnavailableReason(
          (brandVolume as any)?.volumeUnavailableReason
        )
          ? ((brandVolume as any).volumeUnavailableReason as
              | 'DEV_TOKEN_INSUFFICIENT_ACCESS'
              | 'DEV_TOKEN_TEST_ONLY')
          : undefined
        hasPlannerData =
          typeof brandVolume?.avgMonthlySearches === 'number' && !plannerUnavailableReason
        const brandNameSearchVolume = hasPlannerData ? brandVolume?.avgMonthlySearches || 0 : 0

        dataSource = hasPlannerData ? 'keyword_planner' : 'unavailable'
        if (hasPlannerData && brandNameSearchVolume > 0) {
          dataSource = 'cached'
        }

        resolvedBrandNameSearchVolume = brandNameSearchVolume
      }

      const shouldBackfillExactBrandVolume =
        !hasPlannerData &&
        Boolean(
          plannerUnavailableReason || keywordVolumeUnavailable || skipKeywordPoolExpandLoad
        ) &&
        exactBrandKeywordSearchVolume > 0
      if (shouldBackfillExactBrandVolume) {
        resolvedBrandNameSearchVolume = exactBrandKeywordSearchVolume
        dataSource = 'database'
        fallbackMode = 'exact_brand_keyword_backfill'
        console.log(
          `♻️ Planner不可用，回填精确品牌词搜索量: ${exactBrandKeywordSearchVolume.toLocaleString()}/月`
        )
      }
    }

    if (normalizedKeywordsWithVolume.length > 0) {
      console.log(`🏷️ 品牌关键词: 发现${brandKeywordsCount}个包含"${brandName}"的关键词`)
      console.log(`   品牌关键词搜索量: ${brandKeywordSearchVolume.toLocaleString()}/月`)
    } else {
      console.log('⚠️ 未提供keywordsWithVolume，跳过品牌关键词搜索量计算')
    }

    // ========================================
    // 3. 计算总分（品牌名搜索量 + 品牌关键词搜索量）
    // ========================================
    const totalBrandSearchVolume = resolvedBrandNameSearchVolume + brandKeywordSearchVolume
    const volumeUnavailable = Boolean(
      plannerUnavailableReason || keywordVolumeUnavailable || skipKeywordPoolExpandLoad
    )
    if (volumeUnavailable && totalBrandSearchVolume <= 0) {
      const proxyScore = calculateUnavailableProxyScore(
        normalizedKeywordsWithVolume.length,
        brandKeywordsCount,
        hasExactBrandKeyword
      )
      console.log(`⚠️ 品牌搜索量不可用，使用品牌信号代理评分: ${proxyScore}分`)
      return {
        score: proxyScore,
        weight: 0.2 as const,
        details: {
          brandNameSearchVolume: 0,
          brandKeywordSearchVolume: 0,
          exactBrandKeywordSearchVolume,
          totalBrandSearchVolume: 0,
          volumeLevel: 'micro' as const,
          dataSource: 'unavailable' as const,
          fallbackMode: 'brand_signal_proxy' as const,
          plannerUnavailableReason,
          brandKeywordCount: brandKeywordsCount,
          brandKeywordCoverage: Math.round(keywordCoverage * 100) / 100,
        },
      }
    }

    console.log(`📊 品牌"${brandName}"搜索量分析:`)
    console.log(`   品牌名搜索量: ${resolvedBrandNameSearchVolume.toLocaleString()}/月`)
    console.log(`   品牌关键词搜索量: ${brandKeywordSearchVolume.toLocaleString()}/月`)
    console.log(`   总计: ${totalBrandSearchVolume.toLocaleString()}/月`)

    // 根据总搜索量确定流量级别和分数（对数缩放）
    let volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge'
    let score: number

    if (totalBrandSearchVolume >= 100001) {
      // xlarge: 100001+ → 18-20分
      volumeLevel = 'xlarge'
      if (totalBrandSearchVolume >= 1000001) {
        score = 20
      } else if (totalBrandSearchVolume >= 500001) {
        score = 19
      } else {
        score = 18
      }
    } else if (totalBrandSearchVolume >= 10001) {
      // large: 10001-100000 → 13-17分
      volumeLevel = 'large'
      const logMin = Math.log10(10001)
      const logMax = Math.log10(100000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(13 + ratio * 4)
    } else if (totalBrandSearchVolume >= 1001) {
      // medium: 1001-10000 → 8-12分
      volumeLevel = 'medium'
      const logMin = Math.log10(1001)
      const logMax = Math.log10(10000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(8 + ratio * 4)
    } else if (totalBrandSearchVolume >= 100) {
      // small: 100-1000 → 4-7分
      volumeLevel = 'small'
      const logMin = Math.log10(100)
      const logMax = Math.log10(1000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(4 + ratio * 3)
    } else if (totalBrandSearchVolume >= 10) {
      // micro-high: 10-99 → 2-3分
      volumeLevel = 'micro'
      score = totalBrandSearchVolume >= 50 ? 3 : 2
    } else if (totalBrandSearchVolume >= 1) {
      // micro-low: 1-9 → 1分
      volumeLevel = 'micro'
      score = 1
    } else {
      // zero: 0
      // KISS: 不再默认给中等分，避免“数据不可用”误抬分
      volumeLevel = 'micro'
      score = 0
    }

    console.log(`   流量级别: ${volumeLevel}, 评分: ${score}分`)

    return {
      score,
      weight: 0.2 as const,
      details: {
        brandNameSearchVolume: resolvedBrandNameSearchVolume,
        brandKeywordSearchVolume,
        exactBrandKeywordSearchVolume,
        totalBrandSearchVolume,
        volumeLevel,
        dataSource,
        fallbackMode,
        plannerUnavailableReason,
        brandKeywordCount: brandKeywordsCount,
        brandKeywordCoverage: Math.round(keywordCoverage * 100) / 100,
      },
    }
  } catch (error) {
    console.error(`❌ 获取品牌搜索量失败:`, error)
    return {
      score: 0,
      weight: 0.2 as const,
      details: {
        brandNameSearchVolume: 0,
        brandKeywordSearchVolume: 0,
        totalBrandSearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const,
      },
    }
  }
}

/**
 * 辅助函数：计算两个文本的综合相似度 (0-1)
 * 使用多种算法的加权平均，确保更精确的相似度检测
 * 权重: Jaccard 30%, Cosine 30%, Levenshtein 20%, N-gram 20%
 */

export const __testOnly = {
  parseCompetitivePositioningAiScores,
}
