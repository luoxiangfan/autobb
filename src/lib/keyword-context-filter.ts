export function getMinContextTokenMatchesForKeywordQualityFilter(params: {
  pageType?: string | null
}): number {
  // Store pages often contain multiple product lines; using a single category/product token
  // as a hard relevance gate will over-filter valid brand keywords.
  return params.pageType === 'store' ? 0 : 1
}

