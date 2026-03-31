import type { PoolKeywordData } from '@/lib/offer-keyword-pool'

export function resolveKeywordCandidatesAfterContextFilter(params: {
  contextFilteredCandidates: PoolKeywordData[]
  originalCandidates: PoolKeywordData[]
}): {
  keywords: PoolKeywordData[]
  strategy: 'filtered' | 'keyword_pool' | 'original'
} {
  const { contextFilteredCandidates, originalCandidates } = params

  if (contextFilteredCandidates.length > 0) {
    return {
      keywords: contextFilteredCandidates,
      strategy: 'filtered',
    }
  }

  const keywordPoolCandidates = originalCandidates.filter((item) =>
    String(item.source || '').trim().toUpperCase() === 'KEYWORD_POOL'
  )
  if (keywordPoolCandidates.length > 0) {
    return {
      keywords: keywordPoolCandidates,
      strategy: 'keyword_pool',
    }
  }

  return {
    keywords: originalCandidates,
    strategy: 'original',
  }
}
