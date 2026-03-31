/**
 * Industry Classifier Service
 * 根据Offer信息自动分类到二级行业类别
 */

import { getDatabase } from './db'

export interface IndustryBenchmark {
  id: number
  industry_l1: string
  industry_l2: string
  industry_code: string
  avg_ctr: number
  avg_cpc: number
  avg_conversion_rate: number
}

interface ClassificationResult {
  industry_code: string
  industry_l1: string
  industry_l2: string
  confidence: number
  benchmark: IndustryBenchmark
}

// 关键词到行业映射
const KEYWORD_MAPPINGS: Record<string, string[]> = {
  // E-commerce
  'ecom_fashion': ['fashion', 'clothing', 'apparel', 'dress', 'shirt', 'pants', 'shoes', 'jewelry', 'accessories', 'watch', 'bag', 'handbag'],
  'ecom_electronics': ['electronics', 'gadget', 'phone', 'laptop', 'computer', 'tablet', 'headphone', 'speaker', 'camera', 'tv', 'monitor'],
  'ecom_home': ['home', 'garden', 'furniture', 'decor', 'kitchen', 'bed', 'bath', 'lighting', 'storage', 'outdoor'],
  'ecom_beauty': ['beauty', 'skincare', 'makeup', 'cosmetic', 'haircare', 'perfume', 'nail', 'spa'],
  'ecom_sports': ['sports', 'outdoor', 'fitness', 'gym', 'yoga', 'running', 'cycling', 'camping', 'hiking'],
  'ecom_food': ['food', 'beverage', 'snack', 'coffee', 'tea', 'wine', 'organic', 'gourmet'],

  // Travel
  'travel_luggage': ['luggage', 'suitcase', 'travel bag', 'backpack', 'carry-on', 'travel gear', 'packing'],
  'travel_hotels': ['hotel', 'resort', 'accommodation', 'booking', 'stay', 'vacation rental'],
  'travel_flights': ['flight', 'airline', 'airfare', 'ticket', 'airport', 'travel booking'],
  'travel_tours': ['tour', 'activity', 'excursion', 'adventure', 'experience', 'sightseeing'],

  // Technology
  'tech_saas': ['software', 'saas', 'platform', 'tool', 'app', 'solution', 'service', 'cloud', 'subscription'],
  'tech_consumer': ['consumer electronics', 'smart home', 'wearable', 'iot'],
  'tech_b2b': ['enterprise', 'business', 'b2b', 'corporate', 'professional service'],
  'tech_apps': ['mobile app', 'ios', 'android', 'download', 'install'],

  // Finance
  'finance_banking': ['bank', 'credit', 'loan', 'mortgage', 'savings', 'account'],
  'finance_insurance': ['insurance', 'coverage', 'policy', 'claim', 'protection'],
  'finance_investment': ['investment', 'trading', 'stock', 'fund', 'portfolio', 'wealth'],
  'finance_crypto': ['crypto', 'bitcoin', 'blockchain', 'defi', 'nft', 'token'],

  // Education
  'edu_online': ['online course', 'e-learning', 'tutorial', 'certification', 'skill'],
  'edu_academic': ['university', 'college', 'degree', 'academic', 'school'],
  'edu_professional': ['training', 'workshop', 'professional development', 'career'],

  // Healthcare
  'health_medical': ['medical', 'doctor', 'clinic', 'hospital', 'healthcare', 'treatment'],
  'health_pharma': ['pharmacy', 'medicine', 'drug', 'prescription', 'supplement'],
  'health_wellness': ['wellness', 'fitness', 'nutrition', 'diet', 'mental health', 'meditation'],

  // Automotive
  'auto_sales': ['car', 'vehicle', 'auto', 'dealership', 'new car', 'used car'],
  'auto_parts': ['auto parts', 'car parts', 'repair', 'maintenance', 'tire', 'oil'],

  // Real Estate
  'realestate_residential': ['home', 'house', 'apartment', 'condo', 'residential', 'rent', 'buy home'],
  'realestate_commercial': ['commercial', 'office', 'retail space', 'warehouse', 'industrial'],

  // Entertainment
  'entertainment_gaming': ['game', 'gaming', 'esports', 'console', 'pc game', 'mobile game'],
  'entertainment_media': ['streaming', 'video', 'music', 'podcast', 'entertainment', 'media']
}

/**
 * 获取所有行业基准数据
 */
export async function getAllIndustryBenchmarks(): Promise<IndustryBenchmark[]> {
  const db = await getDatabase()
  return await db.query(`
    SELECT id, industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate
    FROM industry_benchmarks
    ORDER BY industry_l1, industry_l2
  `, []) as IndustryBenchmark[]
}

/**
 * 根据行业代码获取基准数据
 */
export async function getIndustryBenchmark(industryCode: string): Promise<IndustryBenchmark | null> {
  const db = await getDatabase()
  return await db.queryOne(`
    SELECT id, industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate
    FROM industry_benchmarks
    WHERE industry_code = ?
  `, [industryCode]) as IndustryBenchmark | null
}

/**
 * 根据Offer信息自动分类行业
 */
export async function classifyOfferIndustry(offer: {
  brand?: string
  category?: string
  brand_description?: string
  unique_selling_points?: string
  product_highlights?: string
}): Promise<ClassificationResult | null> {
  // 组合所有可用文本进行分析
  const textToAnalyze = [
    offer.brand || '',
    offer.category || '',
    offer.brand_description || '',
    offer.unique_selling_points || '',
    offer.product_highlights || ''
  ].join(' ').toLowerCase()

  if (!textToAnalyze.trim()) {
    return null
  }

  // 计算每个行业的匹配分数
  const scores: Record<string, number> = {}

  for (const [industryCode, keywords] of Object.entries(KEYWORD_MAPPINGS)) {
    let score = 0
    for (const keyword of keywords) {
      if (textToAnalyze.includes(keyword.toLowerCase())) {
        // 关键词匹配加分，较长的关键词权重更高
        score += keyword.split(' ').length
      }
    }
    if (score > 0) {
      scores[industryCode] = score
    }
  }

  // 找出最高分的行业
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1])

  if (sortedScores.length === 0) {
    // 默认返回电商-通用类别
    const defaultBenchmark = await getIndustryBenchmark('ecom_fashion')
    if (defaultBenchmark) {
      return {
        industry_code: 'ecom_fashion',
        industry_l1: defaultBenchmark.industry_l1,
        industry_l2: defaultBenchmark.industry_l2,
        confidence: 0.3,
        benchmark: defaultBenchmark
      }
    }
    return null
  }

  const [bestCode, bestScore] = sortedScores[0]
  const benchmark = await getIndustryBenchmark(bestCode)

  if (!benchmark) {
    return null
  }

  // 计算置信度（基于匹配关键词数量）
  const maxPossibleScore = Math.max(...Object.values(KEYWORD_MAPPINGS).map(k => k.length))
  const confidence = Math.min(0.95, 0.5 + (bestScore / maxPossibleScore) * 0.5)

  return {
    industry_code: bestCode,
    industry_l1: benchmark.industry_l1,
    industry_l2: benchmark.industry_l2,
    confidence,
    benchmark
  }
}

/**
 * 获取行业分类选项（用于UI下拉选择）
 */
export async function getIndustryOptions(): Promise<{
  label: string
  value: string
  l1: string
  l2: string
}[]> {
  const benchmarks = await getAllIndustryBenchmarks()
  return benchmarks.map(b => ({
    label: `${b.industry_l1} > ${b.industry_l2}`,
    value: b.industry_code,
    l1: b.industry_l1,
    l2: b.industry_l2
  }))
}

/**
 * 按一级行业分组获取选项
 */
export async function getGroupedIndustryOptions(): Promise<Record<string, {
  label: string
  value: string
}[]>> {
  const benchmarks = await getAllIndustryBenchmarks()
  const grouped: Record<string, { label: string; value: string }[]> = {}

  for (const b of benchmarks) {
    if (!grouped[b.industry_l1]) {
      grouped[b.industry_l1] = []
    }
    grouped[b.industry_l1].push({
      label: b.industry_l2,
      value: b.industry_code
    })
  }

  return grouped
}
