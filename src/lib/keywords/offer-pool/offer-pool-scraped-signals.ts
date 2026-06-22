export function extractCategorySignalsFromScrapedData(
  scrapedData: string | null | undefined
): string[] {
  if (!scrapedData) return []

  try {
    const parsed = JSON.parse(scrapedData)
    if (!parsed || typeof parsed !== 'object') return []

    const candidates: string[] = []
    const push = (value: unknown) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (trimmed) candidates.push(trimmed)
    }

    push((parsed as any).productCategory)
    push((parsed as any).category)

    const primaryCategories = (parsed as any)?.productCategories?.primaryCategories
    if (Array.isArray(primaryCategories)) {
      for (const item of primaryCategories) {
        push(item?.name)
      }
    }

    const breadcrumbs = (parsed as any)?.breadcrumbs
    if (Array.isArray(breadcrumbs)) {
      for (const item of breadcrumbs) {
        push(item)
      }
    }

    if (candidates.length === 0) return []
    return Array.from(new Set(candidates))
  } catch {
    return []
  }
}
