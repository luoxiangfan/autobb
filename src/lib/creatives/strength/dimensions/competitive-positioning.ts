import { logger } from '@/lib/common/server'
import type { HeadlineAsset, DescriptionAsset } from '../../server'
import { recordTokenUsage, estimateTokenCost } from '../../../ai/server'
import { generateContent } from '../../../ai/server'
import { loadPrompt, interpolateTemplate } from '../../../ai/server'
import { CP_AI_FEATURE_FLAG, AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG } from '../../server'
import {
  parseCompetitivePositioningAiScores,
  type CompetitivePositioningAIScores,
} from '../competitive-positioning-ai-parse'
import {
  buildUntrustedInputGuardrail,
  sanitizePromptBlockValue,
  sanitizePromptInlineValue,
  type InputReview,
} from '../../../ai/server'

function isCompetitivePositioningAiEnabled(): boolean {
  return String(process.env[CP_AI_FEATURE_FLAG] || '').toLowerCase() === 'true'
}
export async function calculateCompetitivePositioning(
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

  logger.debug('🎯 评估竞争定位维度 (混合方案 - 全语言支持):')

  // 第一层：快速通用检测（支持所有语言）

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
    if (hasQuantifiedSavings) logger.debug('   ✅ 价格优势量化（货币+节省） (+3分)')
    if (hasPercentageDiscount) logger.debug('   ✅ 价格优势量化（百分比折扣） (+3分)')
    if (hasNoFees) logger.debug('   ✅ 价格优势量化（零费用承诺） (+3分)')
  } else if (hasFreeOffer) {
    priceAdvantage = 2.5
    logger.debug('   ✅ 免费福利（Free offer） (+2.5分)')
  } else if (
    savingsKeywords.test(allTextsLower) ||
    /best value|affordable|budget|cheap|economic|便宜|实惠|划算|お得|저렴|ราคาถูก|رخيص|זול|ucuz|billig|goedkoop|дешевый|barato|bon marché|economico|सस्ता|rẻ|murah/i.test(
      allTextsLower
    )
  ) {
    priceAdvantage = 1.5
    logger.debug('   ⚠️ 价格优势非量化（通用检测） (+1.5分)')
  } else {
    logger.debug('   ❌ 无价格优势表达 (+0分)')
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
    if (hasUniqueness) logger.debug('   ✅ 独特市场定位（唯一性声明） (+3分)')
    if (hasOfficialStatus) logger.debug('   ✅ 独特市场定位（官方/授权） (+3分)')
  } else if (hasTechnicalDifferentiation) {
    uniqueMarketPosition = 2.5
    logger.debug('   ✅ 独特市场定位（技术规格） (+2.5分)')
  } else if (
    /top|best|leading|premier|superior|migliore|mejor|meilleur|beste|лучший|最好|最高|ベスト|최고|ดีที่สุด|الأفضل|הטוב|en iyi|सर्वश्रेष्ठ|tốt nhất|terbaik|beste|paras|bästa|καλύτερο|najlepszy/i.test(
      allTextsLower
    )
  ) {
    uniqueMarketPosition = 1.5
    logger.debug('   ⚠️ 隐含独特性（通用检测） (+1.5分)')
  } else {
    logger.debug('   ❌ 无独特定位声明 (+0分)')
  }

  // 3. 竞品对比暗示检测 (0-2分)
  // 常见"对比/替换"关键词（20+语言）
  const comparisonKeywords =
    /(?:vs|versus|compared?|comparison|replace|substitute|switch|sostituisci|rimpiazza|reemplazar|sustituir|remplacer|substituer|ersetzen|austauschen|substituir|trocar|vervangen|замени|比較|比较|取代|代替|比べる|交換|비교|교체|เปรียบเทียบ|แทนที่|مقارنة|استبدال|השווה|החלף|karşılaştır|değiştir|तुलना|बदलें|so sánh|thay thế|bandingkan|ganti|vergelijken|sammenlign|bytt|vertaa|vaihda|jämför|byt|σύγκριση|αντικατάσταση|porównaj|wymień)/i

  const hasComparison = comparisonKeywords.test(allTextsLower)

  if (hasComparison) {
    competitiveComparison = 2
    logger.debug('   ✅ 明确竞品对比（通用检测） (+2分)')
  } else if (
    /better|superior|outperform|migliore|mejor|meilleur|besser|melhor|beter|лучше|更好|优于|より良い|더 좋은|ดีกว่า|أفضل من|טוב יותר|daha iyi|बेहतर|tốt hơn|lebih baik|bedre|parempi|bättre|καλύτερο|lepszy/i.test(
      allTextsLower
    )
  ) {
    competitiveComparison = 1
    logger.debug('   ⚠️ 隐含对比（通用检测） (+1分)')
  } else {
    logger.debug('   ❌ 无竞品对比暗示 (+0分)')
  }

  // 4. 性价比强调检测 (0-2分)
  // 常见"性价比/价值"关键词（20+语言）
  const valueKeywords =
    /(?:value\s+for\s+money|worth|bang\s+for|rapporto\s+qualità|qualità.prezzo|relación\s+calidad|calidad.precio|rapport\s+qualité|qualité.prix|preis.leistung|custo.benefício|prijs.kwaliteit|соотношение|价值|性价比|コスパ|가성비|คุ้มค่า|قيمة مقابل|ערך תמורה|fiyat performans|मूल्य के लिए|giá trị|nilai untuk wang|waarde voor|verdi for|arvo|värde för|αξία για|stosunek)/i

  const hasValue = valueKeywords.test(allTextsLower)

  if (hasValue) {
    valueEmphasis = 2
    logger.debug('   ✅ 性价比强调 (+2分)')
  } else if (
    /great\s+deal|special\s+offer|offerta\s+speciale|ottim[ao]\s+prezzo/i.test(allTextsLower)
  ) {
    valueEmphasis = 1
    logger.debug('   ⚠️ 隐含性价比 (+1分)')
  } else {
    logger.debug('   ❌ 无性价比强调 (+0分)')
  }

  const totalScore = priceAdvantage + uniqueMarketPosition + competitiveComparison + valueEmphasis
  logger.debug(`   🎯 竞争定位总分（第一层）: ${totalScore.toFixed(1)}/10`)

  // 第二层：AI增强分析（按需触发）

  // 触发条件：快速检测分数 > 6分（说明有较强的竞争定位元素，值得深度分析）
  const AI_ENHANCEMENT_THRESHOLD = AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG.aiEnhancementThreshold
  const aiEnhancementEnabled =
    isCompetitivePositioningAiEnabled() && options?.skipAiEnhancement !== true

  if (aiEnhancementEnabled && totalScore > AI_ENHANCEMENT_THRESHOLD) {
    logger.debug(
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
      logger.debug(`   ✨ AI增强后总分: ${aiEnhancedScore.score.toFixed(1)}/10`)
      return aiEnhancedScore
    }
  } else if (!aiEnhancementEnabled && totalScore > AI_ENHANCEMENT_THRESHOLD) {
    logger.debug(`   ℹ️ 已跳过AI增强（${CP_AI_FEATURE_FLAG}=false）`)
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

// 缓存机制（Redis优先，内存降级）

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
    const { getRedisClient } = await import('../../../common/server')
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
      const { getRedisClient } = await import('../../../common/server')
      const client = getRedisClient()
      if (!client) return null
      const data = await client.get(key)

      if (data) {
        logger.debug('   📦 Redis缓存命中')
        return JSON.parse(data)
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Redis读取失败: ${error.message}，尝试内存缓存`)
    }
  }

  // 降级到内存缓存
  const cached = memoryCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.debug('   📦 内存缓存命中')
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
      const { getRedisClient } = await import('../../../common/server')
      const client = getRedisClient()
      if (!client) return
      await client.setex(key, CACHE_TTL_SECONDS, JSON.stringify(resultWithTimestamp))
      logger.debug('   💾 已缓存到Redis（TTL: 24小时）')
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
    logger.debug('   🗑️ 内存缓存清理：删除500条旧记录')
  }

  logger.debug('   💾 已缓存到内存（TTL: 24小时）')
}

/**
 * AI增强的竞争定位分析（第二层）
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
      logger.debug('   ⚠️ 无用户ID，跳过AI增强分析')
      return null
    }

    // 检查是否有缓存
    const cached = await getCachedResult(adCopyText)
    if (cached) {
      logger.debug('   📦 使用缓存结果（AI增强）')
      return {
        score: cached.score,
        weight: cached.weight,
        details: cached.details,
      }
    }

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
    // 添加try-catch和降级策略
    let result
    try {
      result = await generateContent(
        {
          operationType: 'ad_strength_evaluation',
          prompt,
          temperature: 0.3, // 低温度确保一致性
          maxOutputTokens: 4096, // 增加token限制，避免Gemini 2.5 Pro thinking模式导致MAX_TOKENS错误（thinking tokens ~2000 + response ~500）
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
      logger.debug(`   🔄 降级到纯文本模式重试...`)

      // 修改prompt，要求返回JSON格式但不使用schema约束
      const fallbackPrompt =
        prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no extra text.'

      result = await generateContent(
        {
          operationType: 'ad_strength_evaluation',
          prompt: fallbackPrompt,
          temperature: 0.3,
          maxOutputTokens: 4096, // 增加token限制，避免Gemini 2.5 Pro thinking模式导致MAX_TOKENS错误（thinking tokens ~2000 + response ~500）
        },
        userId
      )

      logger.debug(`   ✓ 降级模式成功获取响应`)
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

    // 健壮的JSON解析
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

    logger.debug(`   🤖 AI分析结果 (置信度: ${(aiScores.confidence * 100).toFixed(0)}%):`)
    logger.debug(
      `      价格优势: ${fastDetectionScores.priceAdvantage} → ${aiScores.priceAdvantage}`
    )
    logger.debug(
      `      独特定位: ${fastDetectionScores.uniqueMarketPosition} → ${aiScores.uniqueMarketPosition}`
    )
    logger.debug(
      `      竞品对比: ${fastDetectionScores.competitiveComparison} → ${aiScores.competitiveComparison}`
    )
    logger.debug(`      性价比: ${fastDetectionScores.valueEmphasis} → ${aiScores.valueEmphasis}`)

    // 只有当置信度 >= 0.6 时才使用AI增强结果
    if (aiScores.confidence < 0.6) {
      logger.debug(
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
    logger.debug(`   💾 结果已缓存（TTL: 24小时）`)

    return enhancedResult
  } catch (error: any) {
    console.error(`   ❌ AI增强分析失败: ${error.message}`)
    console.error(`   → 降级使用快速检测结果`)
    return null // 失败时返回null，使用快速检测结果
  }
}
