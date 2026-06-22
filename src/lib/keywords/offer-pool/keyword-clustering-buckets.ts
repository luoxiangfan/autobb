/**
 * 关键词聚类：桶校验与后处理
 */
import {
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
  type KeywordBuckets,
  type StoreKeywordBuckets,
} from './types'

/**
 * 创建空桶
 */
export function createEmptyBuckets(): KeywordBuckets {
  return {
    bucketA: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.A, keywords: [] },
    bucketB: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.B, keywords: [] },
    bucketC: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.C, keywords: [] },
    bucketD: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.D, keywords: [] },
    statistics: {
      totalKeywords: 0,
      bucketACount: 0,
      bucketBCount: 0,
      bucketCCount: 0,
      bucketDCount: 0,
      balanceScore: 1.0,
    },
  }
}

/**
 * 🆕 v4.16: 创建店铺链接空桶（5个桶）
 */
export function createEmptyStoreBuckets(): StoreKeywordBuckets {
  return {
    bucketA: { ...DEFAULT_STORE_CLUSTER_BUCKETS.A, keywords: [] },
    bucketB: { ...DEFAULT_STORE_CLUSTER_BUCKETS.B, keywords: [] },
    bucketC: { ...DEFAULT_STORE_CLUSTER_BUCKETS.C, keywords: [] },
    bucketD: { ...DEFAULT_STORE_CLUSTER_BUCKETS.D, keywords: [] },
    bucketS: { ...DEFAULT_STORE_CLUSTER_BUCKETS.S, keywords: [] },
    statistics: {
      totalKeywords: 0,
      bucketACount: 0,
      bucketBCount: 0,
      bucketCCount: 0,
      bucketDCount: 0,
      bucketSCount: 0,
      balanceScore: 1.0,
    },
  }
}

/**
 * 验证桶结果
 */
export function validateBuckets(buckets: KeywordBuckets, originalKeywords: string[]): void {
  // 🔥 2025-12-22 添加安全检查，防止undefined错误
  if (!buckets) {
    throw new Error('聚类结果为空')
  }

  const allBucketKeywords = [
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || []),
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(
    (kw) => !allBucketKeywords.some((bkw) => bkw.toLowerCase() === kw.toLowerCase())
  )

  if (missing.length > 0) {
    console.warn(`⚠️ 有 ${missing.length} 个关键词未分配到桶中:`, missing.slice(0, 5))
  }

  // 检查是否有重复
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const kw of allBucketKeywords) {
    const lower = kw.toLowerCase()
    if (seen.has(lower)) {
      duplicates.push(kw)
    }
    seen.add(lower)
  }

  if (duplicates.length > 0) {
    console.warn(`⚠️ 有 ${duplicates.length} 个关键词重复分配:`, duplicates.slice(0, 5))
  }
}

/**
 * 🆕 v4.16: 验证店铺桶结果（5个桶）
 * 🔥 2025-12-24: 添加均衡性检查，不均衡时抛出错误让上层重试
 */
export function validateStoreBuckets(
  buckets: StoreKeywordBuckets,
  originalKeywords: string[]
): void {
  if (!buckets) {
    throw new Error('店铺聚类结果为空')
  }

  const allBucketKeywords = [
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || []),
    ...(buckets.bucketS?.keywords || []),
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(
    (kw) => !allBucketKeywords.some((bkw) => bkw.toLowerCase() === kw.toLowerCase())
  )

  if (missing.length > 0) {
    console.warn(`⚠️ 有 ${missing.length} 个店铺关键词未分配到桶中:`, missing.slice(0, 5))
  }

  // 检查是否有重复
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const kw of allBucketKeywords) {
    const lower = kw.toLowerCase()
    if (seen.has(lower)) {
      duplicates.push(kw)
    }
    seen.add(lower)
  }

  if (duplicates.length > 0) {
    console.warn(`⚠️ 有 ${duplicates.length} 个店铺关键词重复分配:`, duplicates.slice(0, 5))
  }

  // 🔥 2025-12-24 新增：均衡性检查
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
    buckets.bucketS?.keywords?.length || 0,
  ]
  const nonZeroCounts = counts.filter((c) => c > 0).length
  const maxCount = Math.max(...counts)
  const minCount = Math.min(...counts.filter((c) => c > 0))

  // 计算均衡度：使用 AI 报告的 balanceScore 或手动计算
  const reportedBalanceScore = buckets.statistics?.balanceScore ?? calculateBalanceScore(counts)

  // 打印各桶分布情况，便于调试
  console.log(
    `   📊 店铺桶分布: A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]}`
  )
  console.log(`   📊 有效桶数: ${nonZeroCounts}/5, 最大桶=${maxCount}, 最小非空桶=${minCount}`)
  console.log(`   📊 均衡度: ${reportedBalanceScore.toFixed(2)}`)

  // ⚠️ 2026-01-11: 店铺链接在小样本/概念型站点（如SaaS落地页）上，AI 可能倾向把词都放到桶S。
  // 这里不再直接抛错阻断创意生成，而是记录告警；上层会做兜底分桶/默认关键词降级。
  if (originalKeywords.length >= 8 && nonZeroCounts <= 1) {
    const warnMsg = `聚类结果不均衡: 只有 ${nonZeroCounts}/5 个桶有数据 (A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]})`
    console.warn(`⚠️ ${warnMsg}`)
  }

  if (reportedBalanceScore < 0.2 && originalKeywords.length >= 20) {
    const warnMsg = `聚类均衡度偏低: ${reportedBalanceScore.toFixed(2)} < 0.2 (A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]})`
    console.warn(`⚠️ ${warnMsg}`)
  }
}

/**
 * 🔥 2025-12-24: 计算均衡度
 */
export function calculateBalanceScore(counts: number[]): number {
  if (counts.length === 0) return 1.0
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0) return 1.0
  const avg = total / counts.length
  const maxDiff = Math.max(...counts.map((c) => Math.abs(c - avg)))
  return Math.max(0, 1 - maxDiff / total)
}

export function normalizeKeywordsForBuckets(keywords: string[]): string[] {
  const unique = new Map<string, string>()
  for (const kw of keywords) {
    const trimmed = String(kw || '').trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (!unique.has(key)) unique.set(key, trimmed)
  }
  return Array.from(unique.values())
}

export function recalculateStoreBucketStatistics(buckets: StoreKeywordBuckets): void {
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
    buckets.bucketS?.keywords?.length || 0,
  ]

  const totalKeywords = counts.reduce((a, b) => a + b, 0)
  buckets.statistics.totalKeywords = totalKeywords
  buckets.statistics.bucketACount = counts[0]
  buckets.statistics.bucketBCount = counts[1]
  buckets.statistics.bucketCCount = counts[2]
  buckets.statistics.bucketDCount = counts[3]
  buckets.statistics.bucketSCount = counts[4]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)
}

export function recalculateBucketStatistics(buckets: KeywordBuckets): void {
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
  ]

  const totalKeywords = counts.reduce((a, b) => a + b, 0)
  buckets.statistics.totalKeywords = totalKeywords
  buckets.statistics.bucketACount = counts[0]
  buckets.statistics.bucketBCount = counts[1]
  buckets.statistics.bucketCCount = counts[2]
  buckets.statistics.bucketDCount = counts[3]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)
}

export function filterBucketsToAllowedKeywords(
  buckets: KeywordBuckets | StoreKeywordBuckets,
  allowedKeywords: Set<string>
): void {
  const filterList = (list?: string[]) =>
    (list || []).filter((kw) => allowedKeywords.has(String(kw || '').toLowerCase()))

  buckets.bucketA.keywords = filterList(buckets.bucketA.keywords)
  buckets.bucketB.keywords = filterList(buckets.bucketB.keywords)
  buckets.bucketC.keywords = filterList(buckets.bucketC.keywords)
  buckets.bucketD.keywords = filterList(buckets.bucketD.keywords)

  const storeBuckets = buckets as StoreKeywordBuckets
  if (storeBuckets.bucketS) {
    storeBuckets.bucketS.keywords = filterList(storeBuckets.bucketS.keywords)
    recalculateStoreBucketStatistics(storeBuckets)
  } else {
    recalculateBucketStatistics(buckets as KeywordBuckets)
  }
}

export function redistributeStoreBucketsFromS(
  buckets: StoreKeywordBuckets,
  originalKeywords: string[]
): void {
  const all = normalizeKeywordsForBuckets([
    ...originalKeywords,
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || []),
    ...(buckets.bucketS?.keywords || []),
  ])

  if (all.length === 0) return

  const trustSignalsPattern =
    /\b(review|reviews|rating|ratings|testimonial|testimonials|feedback|support|customer\s*service|warranty|guarantee|refund|return|secure|security|privacy|trusted|trust)\b/i
  const sceneSolutionPattern =
    /\b(lonely|loneliness|wellness|mental|anxiety|stress|depression|therapy|support|growth|self[- ]?reflection|mindfulness|sleep|relationship|friendship)\b/i
  const collectionPattern =
    /\b(best|top|popular|recommended|recommendation|features?|feature|compare|comparison|vs|alternatives?|examples?|templates?|list)\b/i
  const brandTrustPattern =
    /\b(official|authorized|authentic|download|app|signup|sign[- ]?up|login|subscribe|subscription|plan|pricing)\b/i
  const productTypePattern = /\b(ai|chatbot|assistant|companion|virtual|friend|conversation)\b/i

  const assigned: Record<'A' | 'B' | 'C' | 'D', string[]> = { A: [], B: [], C: [], D: [] }

  for (const kw of all) {
    const lower = kw.toLowerCase()
    if (trustSignalsPattern.test(lower)) {
      assigned.D.push(kw)
    } else if (sceneSolutionPattern.test(lower)) {
      assigned.B.push(kw)
    } else if (collectionPattern.test(lower)) {
      assigned.C.push(kw)
    } else if (brandTrustPattern.test(lower)) {
      assigned.A.push(kw)
    } else if (productTypePattern.test(lower)) {
      assigned.C.push(kw)
    } else {
      assigned.B.push(kw)
    }
  }

  // 确保 A/B/C/D 至少各有 1 个（当关键词数足够时）
  const bucketOrder: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D']
  if (all.length >= 4) {
    for (const target of bucketOrder) {
      if (assigned[target].length > 0) continue

      let donor: 'A' | 'B' | 'C' | 'D' | null = null
      let donorSize = 0
      for (const candidate of bucketOrder) {
        if (candidate === target) continue
        if (assigned[candidate].length > donorSize) {
          donor = candidate
          donorSize = assigned[candidate].length
        }
      }
      if (!donor || donorSize === 0) continue

      const moved = assigned[donor].pop()
      if (moved) assigned[target].push(moved)
    }
  }

  buckets.bucketA.keywords = normalizeKeywordsForBuckets(assigned.A)
  buckets.bucketB.keywords = normalizeKeywordsForBuckets(assigned.B)
  buckets.bucketC.keywords = normalizeKeywordsForBuckets(assigned.C)
  buckets.bucketD.keywords = normalizeKeywordsForBuckets(assigned.D)
  buckets.bucketS.keywords = all
  recalculateStoreBucketStatistics(buckets)
}

/**
 * 🔥 v4.18 新增：店铺桶后处理规则
 *
 * 目的：修正 AI 聚类可能的错误分配，作为双重保障
 *
 * 规则：
 * 1. 促销/价格词 → 从其他桶移到桶S
 * 2. 具体型号词 → 从桶A/B/D移到桶C
 * 3. 评价词 → 从桶A/B/C移到桶D
 * 4. 地理位置词 → 从桶A/B移到桶S
 */
export function applyStoreBucketPostProcessing(buckets: StoreKeywordBuckets): void {
  console.log(`\n🔧 应用后处理规则修正关键词分配...`)

  let totalMoved = 0
  const moves: Array<{ keyword: string; from: string; to: string; reason: string }> = []

  // 定义匹配规则
  const PROMO_PRICE_PATTERNS =
    /\b(discount|sale|deal|coupon|promo|code|offer|clearance|price|cost|cheap|affordable|budget)\b/i
  const MODEL_PATTERNS = /\b(s\d+|q\d+|s7|s8|q5|q7|max|ultra|pro(?!\s*store))\b/i // 排除 "pro store"
  const REVIEW_PATTERNS = /\b(review|rating|testimonial|feedback|comment|opinion)\b/i
  const GEO_PATTERNS = /\b(locations?|near\s+me|delivery|shipping|local|store\s+finder)\b/i

  // 辅助函数：移动关键词
  const moveKeyword = (
    keyword: string,
    fromBucket: { intent: string; keywords: string[] },
    toBucket: { intent: string; keywords: string[] },
    fromName: string,
    toName: string,
    reason: string
  ) => {
    const index = fromBucket.keywords.indexOf(keyword)
    if (index > -1) {
      fromBucket.keywords.splice(index, 1)
      toBucket.keywords.push(keyword)
      totalMoved++
      moves.push({ keyword, from: fromName, to: toName, reason })
    }
  }

  // 规则1：促销/价格词 → 桶S
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketS, '桶A', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketS, '桶B', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketC.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword) && !MODEL_PATTERNS.test(keyword)) {
      // 如果同时包含型号词，优先保留在桶C（如 "s8 price" 可以在桶C）
      moveKeyword(keyword, buckets.bucketC, buckets.bucketS, '桶C', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketD.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketD, buckets.bucketS, '桶D', '桶S', '含促销/价格词')
    }
  }

  // 规则2：具体型号词 → 桶C
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (MODEL_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketC, '桶A', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (MODEL_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketC, '桶B', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketD.keywords]) {
    if (MODEL_PATTERNS.test(keyword) && !REVIEW_PATTERNS.test(keyword)) {
      // 如果同时包含评价词，优先保留在桶D（如 "s8 review" 可以在桶D）
      moveKeyword(keyword, buckets.bucketD, buckets.bucketC, '桶D', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketS.keywords]) {
    if (MODEL_PATTERNS.test(keyword) && !PROMO_PRICE_PATTERNS.test(keyword)) {
      // 如果同时包含促销词，保留在桶S（如 "s8 discount" 保留在桶S）
      moveKeyword(keyword, buckets.bucketS, buckets.bucketC, '桶S', '桶C', '含具体型号')
    }
  }

  // 规则3：评价词 → 桶D
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (REVIEW_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketD, '桶A', '桶D', '含评价词')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (REVIEW_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketD, '桶B', '桶D', '含评价词')
    }
  }
  for (const keyword of [...buckets.bucketC.keywords]) {
    if (REVIEW_PATTERNS.test(keyword) && !MODEL_PATTERNS.test(keyword)) {
      // 如果同时包含型号词，保留在桶C（如 "s8 review" 可能在桶C，让它保留）
      moveKeyword(keyword, buckets.bucketC, buckets.bucketD, '桶C', '桶D', '含评价词')
    }
  }

  // 规则4：地理位置词 → 桶S
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (GEO_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketS, '桶A', '桶S', '含地理位置')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (GEO_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketS, '桶B', '桶S', '含地理位置')
    }
  }

  // 更新统计数据
  buckets.statistics.bucketACount = buckets.bucketA.keywords.length
  buckets.statistics.bucketBCount = buckets.bucketB.keywords.length
  buckets.statistics.bucketCCount = buckets.bucketC.keywords.length
  buckets.statistics.bucketDCount = buckets.bucketD.keywords.length
  buckets.statistics.bucketSCount = buckets.bucketS.keywords.length

  // 重新计算均衡度
  const counts = [
    buckets.statistics.bucketACount,
    buckets.statistics.bucketBCount,
    buckets.statistics.bucketCCount,
    buckets.statistics.bucketDCount,
    buckets.statistics.bucketSCount,
  ]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)

  // 输出日志
  if (totalMoved > 0) {
    console.log(`   ✅ 后处理完成：移动 ${totalMoved} 个关键词`)
    moves.slice(0, 10).forEach((m) => {
      console.log(`      "${m.keyword}" (${m.from} → ${m.to}: ${m.reason})`)
    })
    if (moves.length > 10) {
      console.log(`      ... 共 ${moves.length} 个移动`)
    }
  } else {
    console.log(`   ✅ 后处理完成：无需调整（AI聚类已正确）`)
  }
}
