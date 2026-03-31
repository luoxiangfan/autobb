/**
 * 关键词生成器 v2.0 (精简版)
 *
 * ⚠️ 重要变更 (2025-12-14):
 * - 正向关键词生成已迁移到 unified-keyword-service.ts
 * - 本文件只保留否定关键词生成功能
 * - generateKeywords() 已废弃，请使用 getUnifiedKeywordData()
 *
 * @see unified-keyword-service.ts 获取正向关键词
 */

import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import type { Offer } from './offers'

/**
 * 获取否定关键词的语言指令
 */
function getLanguageInstructionForNegativeKeywords(targetLanguage: string): string {
  const lang = targetLanguage.toLowerCase()

  if (lang.includes('italian') || lang === 'it') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in ITALIAN ONLY.
- Examples: "gratuito", "economico", "tutorial", "come usare", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Italian.`
  } else if (lang.includes('spanish') || lang === 'es') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in SPANISH ONLY.
- Examples: "gratis", "barato", "tutorial", "cómo usar", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Spanish.`
  } else if (lang.includes('french') || lang === 'fr') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in FRENCH ONLY.
- Examples: "gratuit", "bon marché", "tutoriel", "comment utiliser", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in French.`
  } else if (lang.includes('german') || lang === 'de') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in GERMAN ONLY.
- Examples: "kostenlos", "billig", "anleitung", "wie man benutzt", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in German.`
  } else if (lang.includes('portuguese') || lang === 'pt') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in PORTUGUESE ONLY.
- Examples: "grátis", "barato", "tutorial", "como usar", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Portuguese.`
  } else if (lang.includes('japanese') || lang === 'ja') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in JAPANESE ONLY.
- Examples: "無料", "安い", "チュートリアル", "使い方", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Japanese.`
  } else if (lang.includes('korean') || lang === 'ko') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in KOREAN ONLY.
- Examples: "무료", "싼", "튜토리얼", "사용 방법", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Korean.`
  } else if (lang.includes('russian') || lang === 'ru') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in RUSSIAN ONLY.
- Examples: "бесплатно", "дешево", "учебник", "как использовать", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Russian.`
  } else if (lang.includes('arabic') || lang === 'ar') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in ARABIC ONLY.
- Examples: "مجاني", "رخيص", "درس تعليمي", "كيفية الاستخدام", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Arabic.`
  } else if (lang.includes('chinese') || lang === 'zh') {
    return `🔴 IMPORTANT: Generate ALL negative keywords in CHINESE ONLY.
- Examples: "免费", "便宜", "教程", "如何使用", not "free", "cheap", "tutorial"
- Do NOT use English words or mix languages. Every single word must be in Chinese.`
  }

  // Default to English
  return `Generate negative keywords in English.`
}

/**
 * AI生成的关键词数据结构
 * @deprecated 正向关键词请使用 unified-keyword-service.ts 的 UnifiedKeywordData
 */
export interface GeneratedKeyword {
  keyword: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  category: string
  estimatedCpc?: number
  searchIntent?: string
  reasoning?: string
  searchVolume?: number
}

/**
 * 关键词生成结果
 * @deprecated 正向关键词请使用 unified-keyword-service.ts
 */
export interface KeywordGenerationResult {
  keywords: GeneratedKeyword[]
  totalCount: number
  categories: string[]
  estimatedBudget?: {
    minDaily: number
    maxDaily: number
    currency: string
  }
  recommendations: string[]
  filteredCount?: number
  brandKeywordsCount?: number
}

/**
 * 使用AI生成关键词
 *
 * @deprecated 已废弃 (2025-12-14)
 * 正向关键词生成已迁移到 unified-keyword-service.ts
 * 请使用 getUnifiedKeywordData() 代替
 *
 * @see unified-keyword-service.ts
 */
export async function generateKeywords(
  _offer: Offer,
  _userId: number,
  _options?: { minSearchVolume?: number }
): Promise<KeywordGenerationResult> {
  console.warn('⚠️ generateKeywords() 已废弃，请使用 getUnifiedKeywordData() 代替')
  throw new Error('generateKeywords() 已废弃。请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()')
}

/**
 * 生成否定关键词（排除不相关流量）
 *
 * 🔥 新策略(2025-12-18): KISS原则 - 10类固定否定词模板 + 零维护
 * - 覆盖原方案的10个类别（更全面）
 * - 不依赖AI生成（固定模板，可靠且快速）
 * - 不维护竞品列表（只否定比较意向词）
 * - 支持多语言（预置翻译）
 *
 * @param offer - Offer信息
 * @param userId - 用户ID（未使用，保留接口兼容性）
 */
export async function generateNegativeKeywords(offer: Offer, userId: number): Promise<string[]> {
  const targetLanguage = (offer.target_language || 'English').toLowerCase()

  console.log(`📋 生成否定关键词（10类固定模板，覆盖全场景）`)
  console.log(`   品牌: ${offer.brand}`)
  console.log(`   类别: ${offer.category || '未分类'}`)
  console.log(`   语言: ${targetLanguage}`)

  // 🔥 10类固定否定词策略（不依赖AI，零维护，覆盖原方案所有类别）
  const negatives = [
    // === 1. 低价值搜索（免费、盗版、样品）===
    'free',
    'crack',
    'cracked',
    'torrent',
    'pirate',
    'pirated',
    'trial',
    'sample',
    'demo',

    // === 2. 信息查询（教程、评测、对比）===
    'forum',
    'youtube',
    'how to',
    'tutorial',
    'guide',
    'manual',
    'instructions',
    'setup',
    'install',
    'unboxing',

    // === 3. 招聘/工作 ===
    'job',
    'jobs',
    'career',
    'hiring',
    'salary',
    'employment',
    'recruit',

    // === 4. 二手/维修 ===
    'used',
    'refurbished',
    'repair',
    'fix',
    'broken',
    'replacement parts',
    'spare parts',
    'parts',

    // === 5. 竞品比较意向（不维护具体竞品名，只否定比较模式）===
    'vs',
    'versus',
    'compared to',
    'compare',
    'comparison',
    'alternative',
    'alternative to',
    'instead of',
    'replace',
    'better than',
    'or',  // "brand A or brand B"

    // === 6. 不相关产品（通用否定词，避免跨品类流量）===
    // 注：这部分可根据category动态调整，但保留通用低价值词
    'clothing',
    'shoes',
    'toy',
    'book',

    // === 7. 低价搜索（价格敏感用户）===
    'cheap',
    'cheapest',
    'discount',
    'clearance',
    'wholesale',
    'bulk',
    'lowest price',

    // === 8. DIY/自制 ===
    'diy',
    'homemade',
    'handmade',
    'build your own',
    'make your own',

    // === 9. 下载/虚拟（避免软件/数字产品流量）===
    'download',
    'software',
    'app',
    'apk',
    'pdf',
    'ebook',
    'digital',

    // === 10. 地域/渠道限制（避免不相关渠道）===
    'ebay',
    'craigslist',
    'alibaba',
    'aliexpress',
    'wish',
  ]

  // 多语言支持（覆盖10个类别的高频词翻译）
  if (targetLanguage.includes('chinese') || targetLanguage === 'zh') {
    negatives.push(
      '免费', '破解', '试用', '样品',  // 1. 低价值
      '教程', '评测', '对比', '如何使用', '安装',  // 2. 信息查询
      '招聘', '工作', '职位',  // 3. 招聘
      '二手', '翻新', '维修', '配件',  // 4. 二手
      '对比', '替代',  // 5. 竞品比较
      '便宜', '最低价', '批发',  // 7. 低价
      '手工', '自制',  // 8. DIY
      '下载', '软件', 'APP'  // 9. 下载
    )
  } else if (targetLanguage.includes('spanish') || targetLanguage === 'es') {
    negatives.push(
      'gratis', 'piratear', 'muestra',
      'tutorial', 'reseña', 'comparar',
      'trabajo', 'empleo',
      'usado', 'reparar',
      'barato', 'descuento',
      'descargar', 'aplicación'
    )
  } else if (targetLanguage.includes('french') || targetLanguage === 'fr') {
    negatives.push(
      'gratuit', 'piraté', 'échantillon',
      'tutoriel', 'avis', 'comparer',
      'emploi', 'travail',
      'occasion', 'réparer',
      'bon marché', 'remise',
      'télécharger', 'application'
    )
  } else if (targetLanguage.includes('german') || targetLanguage === 'de') {
    negatives.push(
      'kostenlos', 'raubkopie', 'probe',
      'anleitung', 'bewertung', 'vergleichen',
      'arbeit', 'stelle',
      'gebraucht', 'reparieren',
      'billig', 'rabatt',
      'herunterladen', 'anwendung'
    )
  } else if (targetLanguage.includes('japanese') || targetLanguage === 'ja') {
    negatives.push(
      '無料', '割れ', 'サンプル',
      'チュートリアル', 'レビュー', '比較',
      '仕事', '求人',
      '中古', '修理',
      '安い', '割引',
      'ダウンロード', 'アプリ'
    )
  }

  const dedupedNegatives: string[] = []
  const seen = new Set<string>()
  for (const rawKeyword of negatives) {
    const keyword = String(rawKeyword ?? '').trim().replace(/\s+/g, ' ')
    if (!keyword) continue
    const key = keyword.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    dedupedNegatives.push(keyword)
  }

  console.log(`✅ 生成 ${dedupedNegatives.length} 个否定关键词（10类全覆盖，零维护）`)
  console.log(`   - 1. 低价值搜索: 9个`)
  console.log(`   - 2. 信息查询: 10个`)
  console.log(`   - 3. 招聘/工作: 7个`)
  console.log(`   - 4. 二手/维修: 8个`)
  console.log(`   - 5. 竞品比较: 11个`)
  console.log(`   - 6. 不相关产品: 4个`)
  console.log(`   - 7. 低价搜索: 7个`)
  console.log(`   - 8. DIY/自制: 5个`)
  console.log(`   - 9. 下载/虚拟: 7个`)
  console.log(`   - 10. 地域/渠道: 6个`)
  console.log(`   - 多语言词: ${Math.max(dedupedNegatives.length - 74, 0)}个`)
  if (dedupedNegatives.length !== negatives.length) {
    console.log(`   - 去重移除: ${negatives.length - dedupedNegatives.length}个`)
  }

  return dedupedNegatives
}

/**
 * 关键词扩展（基于已有关键词生成更多变体）
 *
 * @deprecated 已废弃 (2025-12-14)
 * 关键词扩展已迁移到 unified-keyword-service.ts
 * 请使用 getUnifiedKeywordData() 代替
 *
 * @see unified-keyword-service.ts
 */
export async function expandKeywords(
  _baseKeywords: string[],
  _offer: Offer,
  _userId: number
): Promise<GeneratedKeyword[]> {
  console.warn('⚠️ expandKeywords() 已废弃，请使用 getUnifiedKeywordData() 代替')
  throw new Error('expandKeywords() 已废弃。请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()')
}

// ============================================
// 以下函数已迁移到 unified-keyword-service.ts
// 保留空实现以避免编译错误（向后兼容）
// ============================================

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts buildSmartSeedPool
 */
function expandBrandKeywordsWithPlanner(): Promise<GeneratedKeyword[]> {
  throw new Error('已迁移到 unified-keyword-service.ts')
}

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts extractKeywordsFromProductTitle
 */
function extractKeywordsFromProductTitle(_productTitle: string, _brandName: string): string[] {
  return []
}

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts aggregateStoreProductSeeds
 */
function aggregateStoreProductKeywords(
  _productNames: string[],
  _brandName: string,
  _category?: string | null
): GeneratedKeyword[] {
  return []
}

/**
 * @deprecated 已迁移到 unified-keyword-service.ts
 * @see unified-keyword-service.ts extractFeatureSeeds
 */
function generateKeywordsFromFeatures(
  _features: string,
  _brandName: string,
  _category?: string | null
): GeneratedKeyword[] {
  return []
}

// 防止 unused variable 警告
void expandBrandKeywordsWithPlanner
void extractKeywordsFromProductTitle
void aggregateStoreProductKeywords
void generateKeywordsFromFeatures
