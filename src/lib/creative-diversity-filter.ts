/**
 * 创意多样性过滤机制
 *
 * 在创意生成后自动过滤相似度 >20% 的创意
 * 确保返回给用户的创意都符合多样性要求
 */

import { GeneratedAdCreativeData } from './ad-creative'

/**
 * 计算两个文本的相似度 (0-1)
 * 使用加权多算法
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  // 1. Jaccard 相似度 (词集合) - 30%
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 0))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 0))

  if (words1.size === 0 && words2.size === 0) return 1
  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0

  // 2. 词频相似度 - 30%
  const allWords = new Set([...words1, ...words2])
  let dotProduct = 0
  let mag1 = 0
  let mag2 = 0

  for (const word of allWords) {
    const count1 = text1.toLowerCase().split(word).length - 1
    const count2 = text2.toLowerCase().split(word).length - 1
    dotProduct += count1 * count2
    mag1 += count1 * count1
    mag2 += count2 * count2
  }

  const cosineSimilarity = mag1 > 0 && mag2 > 0 ? dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2)) : 0

  // 3. 编辑距离相似度 - 20%
  const maxLen = Math.max(text1.length, text2.length)
  const editDistance = calculateEditDistance(text1, text2)
  const levenshteinSimilarity = maxLen > 0 ? 1 - editDistance / maxLen : 0

  // 4. N-gram 相似度 - 20%
  const ngrams1 = getNgrams(text1, 2)
  const ngrams2 = getNgrams(text2, 2)
  const ngramIntersection = ngrams1.filter(ng => ngrams2.includes(ng)).length
  const ngramUnion = new Set([...ngrams1, ...ngrams2]).size
  const ngramSimilarity = ngramUnion > 0 ? ngramIntersection / ngramUnion : 0

  // 加权平均
  const weightedSimilarity =
    jaccardSimilarity * 0.3 +
    cosineSimilarity * 0.3 +
    levenshteinSimilarity * 0.2 +
    ngramSimilarity * 0.2

  return Math.min(1, Math.max(0, weightedSimilarity))
}

/**
 * 计算编辑距离 (Levenshtein Distance)
 */
function calculateEditDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

/**
 * 提取 N-gram
 */
function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const ngrams: string[] = []

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '))
  }

  return ngrams
}

/**
 * 计算两个创意的标题相似度
 */
function calculateHeadlineSimilarity(
  headlines1: string[],
  headlines2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const h1 of headlines1.slice(0, 3)) {
    for (const h2 of headlines2.slice(0, 3)) {
      totalSimilarity += calculateTextSimilarity(h1, h2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的描述相似度
 */
function calculateDescriptionSimilarity(
  descriptions1: string[],
  descriptions2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const d1 of descriptions1) {
    for (const d2 of descriptions2) {
      totalSimilarity += calculateTextSimilarity(d1, d2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的关键词相似度
 */
function calculateKeywordSimilarity(
  keywords1: string[],
  keywords2: string[]
): number {
  const set1 = new Set(keywords1.map(k => k.toLowerCase()))
  const set2 = new Set(keywords2.map(k => k.toLowerCase()))

  const intersection = new Set([...set1].filter(k => set2.has(k)))
  const union = new Set([...set1, ...set2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * 相似度过滤结果
 */
export interface DiversityFilterResult {
  filtered: GeneratedAdCreativeData[]
  removed: Array<{
    creative: GeneratedAdCreativeData
    reason: string
    similarities: Array<{
      comparedWith: number
      headlineSimilarity: number
      descriptionSimilarity: number
      keywordSimilarity: number
    }>
  }>
  stats: {
    totalInput: number
    totalFiltered: number
    totalRemoved: number
    filterRate: number
  }
}

/**
 * 过滤相似度过高的创意
 *
 * @param creatives 创意列表
 * @param maxSimilarity 最大允许相似度 (默认 0.2 = 20%)
 * @returns 过滤结果
 */
export function filterCreativesByDiversity(
  creatives: GeneratedAdCreativeData[],
  maxSimilarity: number = 0.2
): DiversityFilterResult {
  const filtered: GeneratedAdCreativeData[] = []
  const removed: DiversityFilterResult['removed'] = []

  console.log(`\n🔍 开始过滤创意 (最大相似度: ${maxSimilarity * 100}%)`)
  console.log(`   输入创意数: ${creatives.length}`)

  for (let i = 0; i < creatives.length; i++) {
    const creative = creatives[i]
    let shouldRemove = false
    const similarities: any[] = []

    // 与已过滤的创意比较
    for (let j = 0; j < filtered.length; j++) {
      const headlineSimilarity = calculateHeadlineSimilarity(
        creative.headlines,
        filtered[j].headlines
      )
      const descriptionSimilarity = calculateDescriptionSimilarity(
        creative.descriptions,
        filtered[j].descriptions
      )
      const keywordSimilarity = calculateKeywordSimilarity(
        creative.keywords,
        filtered[j].keywords
      )

      similarities.push({
        comparedWith: j,
        headlineSimilarity,
        descriptionSimilarity,
        keywordSimilarity
      })

      // 如果任何维度的相似度过高，则标记为移除
      if (
        headlineSimilarity > maxSimilarity ||
        descriptionSimilarity > maxSimilarity ||
        keywordSimilarity > maxSimilarity
      ) {
        shouldRemove = true
      }
    }

    if (shouldRemove) {
      // 找出相似度最高的维度
      const maxHeadline = Math.max(...similarities.map(s => s.headlineSimilarity))
      const maxDescription = Math.max(...similarities.map(s => s.descriptionSimilarity))
      const maxKeyword = Math.max(...similarities.map(s => s.keywordSimilarity))

      let reason = '相似度过高: '
      const reasons = []
      if (maxHeadline > maxSimilarity) reasons.push(`标题 ${(maxHeadline * 100).toFixed(1)}%`)
      if (maxDescription > maxSimilarity) reasons.push(`描述 ${(maxDescription * 100).toFixed(1)}%`)
      if (maxKeyword > maxSimilarity) reasons.push(`关键词 ${(maxKeyword * 100).toFixed(1)}%`)
      reason += reasons.join(', ')

      removed.push({
        creative,
        reason,
        similarities
      })

      console.log(`   ❌ 创意 ${i + 1} 被移除: ${reason}`)
    } else {
      filtered.push(creative)
      console.log(`   ✅ 创意 ${i + 1} 保留`)
    }
  }

  const filterRate = creatives.length > 0 ? removed.length / creatives.length : 0

  console.log(`\n📊 过滤完成:`)
  console.log(`   输入: ${creatives.length}`)
  console.log(`   保留: ${filtered.length}`)
  console.log(`   移除: ${removed.length}`)
  console.log(`   过滤率: ${(filterRate * 100).toFixed(1)}%`)

  return {
    filtered,
    removed,
    stats: {
      totalInput: creatives.length,
      totalFiltered: filtered.length,
      totalRemoved: removed.length,
      filterRate
    }
  }
}

/**
 * 过滤并返回多样化的创意
 * 如果过滤后创意数不足，返回警告
 *
 * @param creatives 创意列表
 * @param minRequired 最少需要的创意数 (默认 3)
 * @param maxSimilarity 最大允许相似度 (默认 0.2 = 20%)
 * @returns 过滤结果和警告
 */
export function filterCreativesWithValidation(
  creatives: GeneratedAdCreativeData[],
  minRequired: number = 3,
  maxSimilarity: number = 0.2
): DiversityFilterResult & { warnings: string[] } {
  const result = filterCreativesByDiversity(creatives, maxSimilarity)
  const warnings: string[] = []

  if (result.filtered.length < minRequired) {
    warnings.push(
      `⚠️  过滤后创意数不足: ${result.filtered.length} < ${minRequired} (需要)`
    )
  }

  if (result.stats.filterRate > 0.5) {
    warnings.push(
      `⚠️  过滤率过高: ${(result.stats.filterRate * 100).toFixed(1)}% (建议检查创意生成质量)`
    )
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  警告:`)
    warnings.forEach(w => console.log(`   ${w}`))
  }

  return {
    ...result,
    warnings
  }
}

/**
 * 获取过滤详情报告
 */
export function getFilterReport(result: DiversityFilterResult): string {
  let report = `\n📋 创意多样性过滤报告\n`
  report += `${'='.repeat(60)}\n`
  report += `\n📊 统计信息:\n`
  report += `   输入创意: ${result.stats.totalInput}\n`
  report += `   保留创意: ${result.stats.totalFiltered}\n`
  report += `   移除创意: ${result.stats.totalRemoved}\n`
  report += `   过滤率: ${(result.stats.filterRate * 100).toFixed(1)}%\n`

  if (result.removed.length > 0) {
    report += `\n❌ 被移除的创意:\n`
    result.removed.forEach((item, index) => {
      report += `\n   创意 ${index + 1}:\n`
      report += `   原因: ${item.reason}\n`
      report += `   相似度详情:\n`
      item.similarities.forEach(sim => {
        report += `     - 与创意 ${sim.comparedWith + 1} 比较:\n`
        report += `       标题: ${(sim.headlineSimilarity * 100).toFixed(1)}%\n`
        report += `       描述: ${(sim.descriptionSimilarity * 100).toFixed(1)}%\n`
        report += `       关键词: ${(sim.keywordSimilarity * 100).toFixed(1)}%\n`
      })
    })
  }

  report += `\n${'='.repeat(60)}\n`
  return report
}
