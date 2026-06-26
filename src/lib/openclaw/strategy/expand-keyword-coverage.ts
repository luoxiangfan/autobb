/**
 * Summary text helper for expand_keywords recommendations.
 * Legacy rows are backfilled via migration 262; kept for unit tests.
 */
export function patchExpandKeywordsSummaryCoverage(
  summary: string | null,
  keywordCoverageCount: number
): string | null {
  if (!summary) return summary
  if (!Number.isFinite(keywordCoverageCount) || keywordCoverageCount < 0) return summary
  return summary.replace(/当前关键词\s+\d+\s+个/, `当前关键词 ${Math.floor(keywordCoverageCount)} 个`)
}
