export interface KeywordTopNConsistencyReport {
  topN: number
  threshold: number
  baselineCount: number
  candidateCount: number
  overlapCount: number
  overlapRate: number
  passed: boolean
  missingInCandidate: string[]
  extraInCandidate: string[]
}

export interface MultiEntryConsistencyReport {
  baselineEntry: string
  topN: number
  threshold: number
  reports: Record<string, KeywordTopNConsistencyReport>
  passed: boolean
}

export interface SourceDistributionDiffReport {
  topN: number
  maxDifferenceThreshold: number
  maxAbsoluteDifference: number
  totalVariationDistance: number
  passed: boolean
  diffs: Record<string, number>
}

export interface MultiEntrySourceDistributionReport {
  baselineEntry: string
  topN: number
  maxDifferenceThreshold: number
  reports: Record<string, SourceDistributionDiffReport>
  passed: boolean
}

function normalizeKeywordForCompare(keyword: string): string {
  return String(keyword || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function toTopNormalizedKeywords(keywords: string[], topN: number): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const rawKeyword of keywords || []) {
    const keyword = normalizeKeywordForCompare(rawKeyword)
    if (!keyword || seen.has(keyword)) continue
    seen.add(keyword)
    normalized.push(keyword)
    if (normalized.length >= topN) break
  }

  return normalized
}

function normalizeSourceForCompare(value: unknown): string {
  return String(value || '').trim().toUpperCase() || 'UNKNOWN'
}

function toTopSourceRatio(input: {
  keywords: Array<{ rawSource?: string }>
  topN: number
}): Record<string, number> {
  const counts: Record<string, number> = {}
  const topItems = (input.keywords || []).slice(0, input.topN)
  const denominator = Math.max(1, topItems.length)

  for (const item of topItems) {
    const source = normalizeSourceForCompare(item?.rawSource)
    counts[source] = (counts[source] || 0) + 1
  }

  const ratios: Record<string, number> = {}
  for (const [source, count] of Object.entries(counts)) {
    ratios[source] = count / denominator
  }

  return ratios
}

export function compareTopKeywordConsistency(input: {
  baselineKeywords: string[]
  candidateKeywords: string[]
  topN?: number
  threshold?: number
}): KeywordTopNConsistencyReport {
  const topN = Math.max(1, Math.floor(Number(input.topN) || 20))
  const threshold = Math.max(0, Math.min(1, Number(input.threshold) || 0.9))

  const baselineTop = toTopNormalizedKeywords(input.baselineKeywords || [], topN)
  const candidateTop = toTopNormalizedKeywords(input.candidateKeywords || [], topN)

  const baselineSet = new Set(baselineTop)
  const candidateSet = new Set(candidateTop)

  let overlapCount = 0
  for (const keyword of baselineSet) {
    if (candidateSet.has(keyword)) overlapCount += 1
  }

  const denominator = Math.max(1, baselineSet.size)
  const overlapRate = overlapCount / denominator
  const passed = overlapRate >= threshold

  const missingInCandidate = baselineTop.filter((keyword) => !candidateSet.has(keyword))
  const extraInCandidate = candidateTop.filter((keyword) => !baselineSet.has(keyword))

  return {
    topN,
    threshold,
    baselineCount: baselineTop.length,
    candidateCount: candidateTop.length,
    overlapCount,
    overlapRate: Math.round(overlapRate * 10000) / 10000,
    passed,
    missingInCandidate,
    extraInCandidate,
  }
}

export function evaluateMultiEntryTopNConsistency(input: {
  entryKeywords: Record<string, string[]>
  baselineEntry?: string
  topN?: number
  threshold?: number
}): MultiEntryConsistencyReport {
  const topN = Math.max(1, Math.floor(Number(input.topN) || 20))
  const threshold = Math.max(0, Math.min(1, Number(input.threshold) || 0.9))
  const entryNames = Object.keys(input.entryKeywords || {})

  if (entryNames.length === 0) {
    return {
      baselineEntry: input.baselineEntry || 'baseline',
      topN,
      threshold,
      reports: {},
      passed: true,
    }
  }

  const baselineEntry = input.baselineEntry && entryNames.includes(input.baselineEntry)
    ? input.baselineEntry
    : entryNames[0]

  const baselineKeywords = input.entryKeywords[baselineEntry] || []
  const reports: Record<string, KeywordTopNConsistencyReport> = {}
  let passed = true

  for (const entryName of entryNames) {
    if (entryName === baselineEntry) continue
    const report = compareTopKeywordConsistency({
      baselineKeywords,
      candidateKeywords: input.entryKeywords[entryName] || [],
      topN,
      threshold,
    })
    reports[entryName] = report
    if (!report.passed) passed = false
  }

  return {
    baselineEntry,
    topN,
    threshold,
    reports,
    passed,
  }
}

export function compareTopSourceDistributionDiff(input: {
  baselineKeywords: Array<{ rawSource?: string }>
  candidateKeywords: Array<{ rawSource?: string }>
  topN?: number
  maxDifferenceThreshold?: number
}): SourceDistributionDiffReport {
  const topN = Math.max(1, Math.floor(Number(input.topN) || 20))
  const maxDifferenceThreshold = Math.max(0, Math.min(1, Number(input.maxDifferenceThreshold) || 0.1))

  const baselineRatio = toTopSourceRatio({
    keywords: input.baselineKeywords || [],
    topN,
  })
  const candidateRatio = toTopSourceRatio({
    keywords: input.candidateKeywords || [],
    topN,
  })

  const allSources = new Set<string>([
    ...Object.keys(baselineRatio),
    ...Object.keys(candidateRatio),
  ])

  const diffs: Record<string, number> = {}
  let maxAbsoluteDifference = 0
  let totalAbs = 0

  for (const source of allSources) {
    const diff = Math.abs((baselineRatio[source] || 0) - (candidateRatio[source] || 0))
    const rounded = Math.round(diff * 10000) / 10000
    diffs[source] = rounded
    if (rounded > maxAbsoluteDifference) maxAbsoluteDifference = rounded
    totalAbs += rounded
  }

  const totalVariationDistance = Math.round((totalAbs / 2) * 10000) / 10000

  return {
    topN,
    maxDifferenceThreshold,
    maxAbsoluteDifference,
    totalVariationDistance,
    passed: maxAbsoluteDifference <= maxDifferenceThreshold,
    diffs,
  }
}

export function evaluateMultiEntryTopSourceDistribution(input: {
  entryKeywordsWithSource: Record<string, Array<{ rawSource?: string }>>
  baselineEntry?: string
  topN?: number
  maxDifferenceThreshold?: number
}): MultiEntrySourceDistributionReport {
  const topN = Math.max(1, Math.floor(Number(input.topN) || 20))
  const maxDifferenceThreshold = Math.max(0, Math.min(1, Number(input.maxDifferenceThreshold) || 0.1))
  const entryNames = Object.keys(input.entryKeywordsWithSource || {})

  if (entryNames.length === 0) {
    return {
      baselineEntry: input.baselineEntry || 'baseline',
      topN,
      maxDifferenceThreshold,
      reports: {},
      passed: true,
    }
  }

  const baselineEntry = input.baselineEntry && entryNames.includes(input.baselineEntry)
    ? input.baselineEntry
    : entryNames[0]

  const baselineKeywords = input.entryKeywordsWithSource[baselineEntry] || []
  const reports: Record<string, SourceDistributionDiffReport> = {}
  let passed = true

  for (const entryName of entryNames) {
    if (entryName === baselineEntry) continue
    const report = compareTopSourceDistributionDiff({
      baselineKeywords,
      candidateKeywords: input.entryKeywordsWithSource[entryName] || [],
      topN,
      maxDifferenceThreshold,
    })
    reports[entryName] = report
    if (!report.passed) passed = false
  }

  return {
    baselineEntry,
    topN,
    maxDifferenceThreshold,
    reports,
    passed,
  }
}
